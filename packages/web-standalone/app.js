import express from 'express'
import { fetch, Agent, ProxyAgent } from 'undici'
import http from 'http'
import https from 'https'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { pathToFileURL } from 'url'
import { createHash, randomUUID } from 'crypto'
import * as db from './src/db.js'
import * as helpers from './src/helpers.js'
import TaskQueue from './src/task-queue.js'
import { withSentHeadersCapture } from './src/sent-headers-capture.js'
import { trustSystemCACertificates, parseCACertificates, getCACertificatesWithCustom } from './src/ca-certificates.js'
import { getProxyForRequest, takeProxyAuthorization, getProxyAgentOptions, removeProxyCredentials } from './src/proxy.js'

trustSystemCACertificates()

const app = express()

const operationQueue = new TaskQueue()

const port = process.env.PORT || 4004

app.use(express.static('public'))

app.use('/api/', express.json({ limit: '50mb' }))

function apiRoute(handler) {
    return async (req, res) => {
        try {
            const result = await operationQueue.enqueue(() => handler(req.body))
            res.json({ result })
        } catch (e) {
            console.error(e)
            res.status(500).json({ error: e.message })
        }
    }
}

// Settings > CA Certificates. The UI registers a file here once and names it by id in each request, so the file does
// not travel in every request's headers. One server can serve several people, each with their own file
const CUSTOM_CA_CERTIFICATES_LIMIT = 100
const customCACertificatesById = new Map()

app.post('/proxy-ca-certificates', express.text({ type: '*/*', limit: '5mb' }), (req, res) => {
    try {
        const certificates = parseCACertificates(req.body)
        const id = createHash('sha256').update(certificates.join('\n')).digest('hex')

        // the most recently registered stay, the oldest go past the limit
        customCACertificatesById.delete(id)
        customCACertificatesById.set(id, certificates)
        if(customCACertificatesById.size > CUSTOM_CA_CERTIFICATES_LIMIT) {
            customCACertificatesById.delete(customCACertificatesById.keys().next().value)
        }

        res.json({ id })
    } catch(e) {
        res.status(400).json({ error: e.message })
    }
})

// Settings > Proxy for relayed sockets. A socket's relay URL names it by id, so its password stays out of URLs, which a
// reverse proxy in front of this server may log. The id is random, the same setting keeps it, the oldest go past the limit
const PROXY_SETTINGS_LIMIT = 100
const proxySettingsById = new Map()
const proxySettingsIdsByValue = new Map()

app.post('/proxy-settings', express.text({ type: '*/*', limit: '100kb' }), (req, res) => {
    let proxySettings = null
    try {
        proxySettings = JSON.parse(req.body)
    } catch {}

    if(proxySettings === null || typeof proxySettings !== 'object' || Array.isArray(proxySettings)) {
        res.status(400).json({ error: 'The proxy setting must be a JSON object' })
        return
    }

    const value = JSON.stringify(proxySettings)
    const id = proxySettingsIdsByValue.get(value) ?? randomUUID()

    proxySettingsIdsByValue.delete(value)
    proxySettingsIdsByValue.set(value, id)
    proxySettingsById.set(id, proxySettings)
    if(proxySettingsIdsByValue.size > PROXY_SETTINGS_LIMIT) {
        const [oldestValue, oldestId] = proxySettingsIdsByValue.entries().next().value
        proxySettingsIdsByValue.delete(oldestValue)
        proxySettingsById.delete(oldestId)
    }

    res.json({ id })
})

const agents = new Map()

function getAgentForRequest(urlParsed, disableSSLVerification, customCACertificatesId = null, proxyUrl = null, proxyToken = null) {
    const key = `${urlParsed.hostname}:${urlParsed.port}:${disableSSLVerification}:${customCACertificatesId}:${proxyUrl}:${proxyToken}`

    if(!agents.has(key)) {
        const customCACertificates = customCACertificatesById.get(customCACertificatesId)
        const tls = {
            rejectUnauthorized: disableSSLVerification ? false : true,
            ...(customCACertificates ? { ca: getCACertificatesWithCustom(customCACertificates) } : {}),
        }
        const agent = proxyUrl !== null ? new ProxyAgent({
            ...getProxyAgentOptions(proxyUrl, tls, proxyToken),
            // plain HTTP goes to the proxy as a full URL, like browsers and curl send it, HTTPS through a CONNECT tunnel
            proxyTunnel: false,
            requestTls: { ...tls, allowH2: true },
            allowH2: true,
            headersTimeout: 0,
            bodyTimeout: 0,
        }) : new Agent({
            connect: tls,
            allowH2: true,
            headersTimeout: 0,
            bodyTimeout: 0,
        })

        agents.set(key, agent)
    }

    return agents.get(key)
}

app.post('/proxy', async(req, res) => {
    const disableSSLVerification = req.headers['x-proxy-flag-disable-ssl-verification'] === 'true'
    const url = req.headers['x-proxy-req-url']
    const method = req.headers['x-proxy-req-method']
    const requestTimeoutRaw = Number(req.headers['x-proxy-flag-timeout'] ?? 0)
    const requestTimeout = Number.isFinite(requestTimeoutRaw) && requestTimeoutRaw > 0 ? Math.floor(requestTimeoutRaw) : 0
    const customCACertificatesId = req.headers['x-proxy-flag-ca-certificates-id'] ?? null
    // Settings > Proxy, an older UI sends none, which is System, this server's HTTP_PROXY, HTTPS_PROXY and NO_PROXY
    let proxySettings = null
    try {
        proxySettings = JSON.parse(decodeURIComponent(req.headers['x-proxy-flag-proxy'] ?? 'null'))
    } catch {}
    const headers = {}

    // after a restart the server has forgotten the file, the UI registers it again and repeats the request
    if(customCACertificatesId !== null && !customCACertificatesById.has(customCACertificatesId)) {
        res.send({ event: 'caCertificatesNotFound' })
        return
    }

    // header names arrive lowercased, by Node and by any HTTP/2 hop in front of this server, so the UI sends them as
    // typed in a value. An older UI does not, and its headers go out lowercase as before
    const typedHeaderNames = new Map()
    try {
        for(const headerName of JSON.parse(req.headers['x-proxy-flag-header-names'] ?? '[]')) {
            typedHeaderNames.set(String(headerName).toLowerCase(), String(headerName))
        }
    } catch {}

    Object.keys(req.headers).forEach(header => {
        if(header.startsWith('x-proxy-req-header-')) {
            const headerName = header.replace('x-proxy-req-header-', '')
            headers[typedHeaderNames.get(headerName) ?? headerName] = req.headers[header]
        }
    })

    // For multipart, the user-configured content-type lacks the multipart boundary.
    // Use the actual incoming content-type (which includes the boundary) so the
    // target server can correctly parse the multipart body.
    if(req.is('multipart/*')) {
        headers['content-type'] = req.headers['content-type']
    }

    // Stream the request body directly to the target. No in-memory buffering.
    // This allows large file uploads without loading the file into RAM.
    const body = method !== 'GET' ? Readable.toWeb(req) : undefined
    const abortController = new AbortController()
    const abortUpstreamRequest = () => abortController.abort()
    let timedOut = false
    let timeoutId

    req.on('aborted', abortUpstreamRequest)
    res.on('close', () => {
        if(!res.writableEnded) {
            abortUpstreamRequest()
        }
    })

    if(requestTimeout > 0) {
        timeoutId = setTimeout(() => {
            timedOut = true
            abortUpstreamRequest()
        }, requestTimeout)
    }

    try {
        const proxyUrl = await getProxyForRequest(new URL(url), proxySettings)
        const { headers: headersToSend, token: proxyToken } = proxyUrl !== null ? takeProxyAuthorization(headers) : { headers, token: null }
        const agent = getAgentForRequest(new URL(url), disableSSLVerification, customCACertificatesId, proxyUrl, proxyToken)

        const startTime = new Date()

        const { result: response, headersSent } = await withSentHeadersCapture(() => fetch(url, {
            dispatcher: agent,
            method,
            headers: headersToSend,
            body,
            duplex: 'half',
            signal: abortController.signal,
        }))

        const headEndTime = new Date()

        const status = response.status
        const statusText = response.statusText
        const responseHeaders = [...response.headers.entries()]

        const responseBlob = await response.blob()

        const endTime = new Date()

        const mimeType = responseBlob.type
        const buffer = await responseBlob.arrayBuffer()

        const timeTaken = endTime - startTime
        const headTimeTaken = headEndTime - startTime
        const bodyTimeTaken = endTime - headEndTime

        const responseToSend = {
            status,
            statusText,
            headers: responseHeaders,
            mimeType,
            buffer: Array.from(new Uint8Array(buffer)),
            timeTaken,
            headTimeTaken,
            bodyTimeTaken,
            requestHeadersSent: proxyUrl !== null ? removeProxyCredentials(headersSent, headers) : headersSent,
        }

        if(!res.writableEnded && !res.destroyed) {
            res.send({
                event: 'response',
                eventData: responseToSend
            })
        }
    } catch(e) {
        if(!abortController.signal.aborted) {
            console.error('proxy error:', e)
        }
        if(!res.writableEnded && !res.destroyed) {
            res.send({
                event: 'responseError',
                // undici says only "fetch failed", the reason, such as a rejected certificate, is its cause
                eventData: timedOut ? `Request timed out after ${requestTimeout} ms` : (e.cause?.message ? `${e.message}: ${e.cause.message}` : e.message)
            })
        }
    } finally {
        if(timeoutId !== undefined) {
            clearTimeout(timeoutId)
        }
    }
})

// WebSocket and Socket.IO connections are made by the browser, which checks certificates itself, so with SSL verification
// disabled or custom CA certificates the UI connects through here instead:
// /proxy-socket/<true to disable ssl verification, ca-<id> for the registered CA certificates>/<encoded target origin><target path>
// Socket.IO starts with HTTP polling requests and then upgrades to a WebSocket, both come through this prefix
const SOCKET_PROXY_PREFIX = '/proxy-socket/'

// headers that describe the connection to this server or its origin rather than the target
const SOCKET_PROXY_SKIPPED_REQUEST_HEADERS = ['host', 'cookie', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'accept-encoding']
const SOCKET_PROXY_SKIPPED_RESPONSE_HEADERS = ['set-cookie', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'content-encoding']

function parseSocketProxyUrl(requestUrl) {
    if(!requestUrl.startsWith(SOCKET_PROXY_PREFIX)) {
        return null
    }

    const [verification, encodedOrigin, ...rest] = requestUrl.slice(SOCKET_PROXY_PREFIX.length).split('/')

    let targetOrigin
    try {
        targetOrigin = new URL(decodeURIComponent(encodedOrigin ?? ''))
    } catch {
        return null
    }

    if(!['http:', 'https:', 'ws:', 'wss:'].includes(targetOrigin.protocol)) {
        return null
    }

    // a WebSocket url is requested and upgraded over its HTTP counterpart
    const protocol = targetOrigin.protocol.replace(/^ws/, 'http')
    const url = new URL(`${protocol}//${targetOrigin.host}/${rest.join('/')}`)

    // the UI relays every socket to a host other than loopback, naming its settings as JSON, Settings > Proxy by id
    if(verification?.startsWith('%7B')) {
        try {
            const options = JSON.parse(decodeURIComponent(verification))
            return {
                url,
                disableSSLVerification: options.disableSSLVerification === true,
                customCACertificatesId: options.caCertificatesId ?? null,
                proxySettingsId: options.proxySettingsId ?? null,
            }
        } catch {
            return null
        }
    }

    // a secure socket to loopback, and every socket from an older UI, names only the verification. Without a proxy
    // setting the proxy is System, as for a request from an older UI
    return {
        url,
        disableSSLVerification: verification === 'true',
        customCACertificatesId: verification?.startsWith('ca-') ? verification.slice('ca-'.length) : null,
        proxySettingsId: null,
    }
}

// after a restart the server has forgotten the file, the UI registers it again on every connect
const SOCKET_PROXY_CA_CERTIFICATES_NOT_FOUND = 'The CA certificates are no longer registered with the server, connect again'

function isSocketProxyCACertificatesMissing(target) {
    return target.customCACertificatesId !== null && !customCACertificatesById.has(target.customCACertificatesId)
}

// after a restart the server has forgotten the setting, the UI registers it again on every connect
const SOCKET_PROXY_SETTINGS_NOT_FOUND = 'The proxy setting is no longer registered with the server, connect again'

function isSocketProxySettingsMissing(target) {
    return target.proxySettingsId !== null && !proxySettingsById.has(target.proxySettingsId)
}

// none named is System, this server's HTTP_PROXY, HTTPS_PROXY and NO_PROXY
function getSocketProxySettings(target) {
    return target.proxySettingsId !== null ? proxySettingsById.get(target.proxySettingsId) : null
}

function getSocketProxyRequestHeaders(incomingHeaders, skippedHeaders) {
    const headers = {}

    for(const [name, value] of Object.entries(incomingHeaders)) {
        if(!skippedHeaders.includes(name)) {
            headers[name] = value
        }
    }

    return headers
}

app.all(`${SOCKET_PROXY_PREFIX}*`, async(req, res) => {
    const target = parseSocketProxyUrl(req.originalUrl)

    if(target === null) {
        res.status(400).send('Invalid socket proxy url')
        return
    }

    if(isSocketProxyCACertificatesMissing(target)) {
        res.status(502).send(SOCKET_PROXY_CA_CERTIFICATES_NOT_FOUND)
        return
    }

    if(isSocketProxySettingsMissing(target)) {
        res.status(502).send(SOCKET_PROXY_SETTINGS_NOT_FOUND)
        return
    }

    const abortController = new AbortController()
    res.on('close', () => {
        if(!res.writableEnded) {
            abortController.abort()
        }
    })

    try {
        const proxyUrl = await getProxyForRequest(target.url, getSocketProxySettings(target))
        const response = await fetch(target.url, {
            dispatcher: getAgentForRequest(target.url, target.disableSSLVerification, target.customCACertificatesId, proxyUrl),
            method: req.method,
            headers: getSocketProxyRequestHeaders(req.headers, SOCKET_PROXY_SKIPPED_REQUEST_HEADERS),
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : Readable.toWeb(req),
            duplex: 'half',
            redirect: 'manual',
            signal: abortController.signal,
        })

        res.status(response.status)

        for(const [name, value] of response.headers) {
            if(!SOCKET_PROXY_SKIPPED_RESPONSE_HEADERS.includes(name)) {
                res.setHeader(name, value)
            }
        }

        // pipeline rather than pipe, a browser that goes away mid-body aborts the upstream body, and that error would
        // otherwise have no listener and take the server down
        if(response.body) {
            await pipeline(Readable.fromWeb(response.body), res)
        } else {
            res.end()
        }
    } catch(e) {
        if(!abortController.signal.aborted && !res.headersSent) {
            res.status(502).send(e.cause?.message ?? e.message)
        }
    }
})

export function handleSocketProxyUpgrade(req, socket, head) {
    const target = parseSocketProxyUrl(req.url)

    if(target === null) {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
        return
    }

    if(isSocketProxyCACertificatesMissing(target)) {
        socket.end(`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n${SOCKET_PROXY_CA_CERTIFICATES_NOT_FOUND}`)
        return
    }

    if(isSocketProxySettingsMissing(target)) {
        socket.end(`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n${SOCKET_PROXY_SETTINGS_NOT_FOUND}`)
        return
    }

    getProxyForRequest(target.url, getSocketProxySettings(target)).then(proxyUrl => {
        if(proxyUrl === null) {
            relaySocketUpgradeDirectly(req, socket, head, target)
        } else {
            relaySocketUpgradeThroughProxy(req, socket, head, target, proxyUrl)
        }
    }, e => {
        console.error('socket proxy error:', e.message)
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
    })
}

// undici opens the tunnel, through HTTP, HTTPS and SOCKS5 proxies alike, and the target's answer goes to the browser
async function relaySocketUpgradeThroughProxy(req, socket, head, target, proxyUrl) {
    const customCACertificates = customCACertificatesById.get(target.customCACertificatesId)
    const tls = {
        rejectUnauthorized: !target.disableSSLVerification,
        ...(customCACertificates ? { ca: getCACertificatesWithCustom(customCACertificates) } : {}),
    }
    // a plain ws:// target too goes through a CONNECT tunnel, which proxies pass WebSocket traffic through
    const dispatcher = new ProxyAgent({ ...getProxyAgentOptions(proxyUrl, tls), proxyTunnel: true, requestTls: tls })

    socket.on('error', () => dispatcher.destroy().catch(() => {}))

    try {
        const { headers, socket: upstreamSocket } = await dispatcher.upgrade({
            origin: target.url.origin,
            path: `${target.url.pathname}${target.url.search}`,
            method: req.method,
            // undici writes the connection and upgrade headers itself
            headers: getSocketProxyRequestHeaders(req.headers, ['host', 'cookie', 'connection', 'upgrade']),
            protocol: req.headers.upgrade ?? 'websocket',
        })

        // the browser went away while the tunnel was being opened
        if(socket.destroyed) {
            upstreamSocket.destroy()
            return
        }

        const headerLines = Object.entries(headers).flatMap(([name, value]) => [value].flat().map(item => `${name}: ${item}\r\n`))
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headerLines.join('')}\r\n`)

        if(head.length > 0) {
            upstreamSocket.write(head)
        }

        upstreamSocket.on('error', () => socket.destroy())
        socket.on('error', () => upstreamSocket.destroy())
        upstreamSocket.pipe(socket).pipe(upstreamSocket)
    } catch(e) {
        console.error('socket proxy error:', e.message)
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
    } finally {
        // the upgraded socket no longer belongs to it
        dispatcher.close().catch(() => {})
    }
}

function relaySocketUpgradeDirectly(req, socket, head, target) {
    const customCACertificates = customCACertificatesById.get(target.customCACertificatesId)

    const upstreamRequest = (target.url.protocol === 'https:' ? https : http).request(target.url, {
        method: req.method,
        // the upgrade headers pass through as they are, so the browser and the target negotiate the protocol between them
        headers: getSocketProxyRequestHeaders(req.headers, ['host', 'cookie']),
        rejectUnauthorized: !target.disableSSLVerification,
        ...(customCACertificates ? { ca: getCACertificatesWithCustom(customCACertificates) } : {}),
    })

    upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
        const headerLines = []
        for(let i = 0; i < upstreamResponse.rawHeaders.length; i += 2) {
            headerLines.push(`${upstreamResponse.rawHeaders[i]}: ${upstreamResponse.rawHeaders[i + 1]}\r\n`)
        }

        socket.write(`HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\n${headerLines.join('')}\r\n`)

        if(upstreamHead.length > 0) {
            socket.write(upstreamHead)
        }

        if(head.length > 0) {
            upstreamSocket.write(head)
        }

        upstreamSocket.on('error', () => socket.destroy())
        socket.on('error', () => upstreamSocket.destroy())
        upstreamSocket.pipe(socket).pipe(upstreamSocket)
    })

    // the target answered without upgrading, the browser gets its status and the connection closes
    upstreamRequest.on('response', upstreamResponse => {
        socket.end(`HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\nConnection: close\r\n\r\n`)
        upstreamResponse.resume()
    })

    upstreamRequest.on('error', e => {
        console.error('socket proxy error:', e.message)
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
    })

    socket.on('error', () => upstreamRequest.destroy())

    upstreamRequest.end()
}

// Workspace / collection routes
app.post('/api/getWorkspaceAtLocation',           apiRoute(({ location, getEnvironments }) => db.getWorkspaceAtLocation(location, getEnvironments)))
app.post('/api/updateWorkspace',                  apiRoute(({ workspace, updatedFields }) => db.updateWorkspace(workspace, updatedFields)))
app.post('/api/ensureEmptyFolderOrEmptyWorkspace',apiRoute(({ location }) => db.ensureEmptyFolderOrEmptyWorkspace(location)))
app.post('/api/getCollectionForWorkspace',        apiRoute(({ workspace, type }) => db.getCollectionForWorkspace(workspace, type)))
app.post('/api/getCollectionById',                apiRoute(({ workspace, collectionId }) => db.getCollectionById(workspace, collectionId)))
app.post('/api/createCollection',                 apiRoute(({ workspace, collection }) => db.createCollection(workspace, collection)))
app.post('/api/createCollections',                apiRoute(({ workspace, collections }) => db.createCollections(workspace, collections)))
app.post('/api/updateCollection',                 apiRoute(({ workspace, collectionId, updatedFields }) => db.updateCollection(workspace, collectionId, updatedFields)))
app.post('/api/deleteCollectionsByWorkspaceId',   apiRoute(({ workspace }) => db.deleteCollectionsByWorkspaceId(workspace)))
app.post('/api/deleteCollectionsByIds',           apiRoute(({ workspace, collectionIds }) => db.deleteCollectionsByIds(workspace, collectionIds)))

// Response routes
app.post('/api/getResponsesByCollectionId',       apiRoute(({ workspace, collectionId }) => db.getResponsesByCollectionId(workspace, collectionId)))
app.post('/api/createResponse',                   apiRoute(({ workspace, response }) => db.createResponse(workspace, response)))
app.post('/api/updateResponse',                   apiRoute(({ workspace, collectionId, responseId, updatedFields }) => db.updateResponse(workspace, collectionId, responseId, updatedFields)))
app.post('/api/deleteResponse',                   apiRoute(({ workspace, collectionId, responseId }) => db.deleteResponse(workspace, collectionId, responseId)))
app.post('/api/deleteResponsesByIds',             apiRoute(({ workspace, collectionId, responseIds }) => db.deleteResponsesByIds(workspace, collectionId, responseIds)))
app.post('/api/deleteResponsesByCollectionIds',   apiRoute(({ workspace, collectionIds }) => db.deleteResponsesByCollectionIds(workspace, collectionIds)))
app.post('/api/deleteResponsesByCollectionId',    apiRoute(({ workspace, collectionId }) => db.deleteResponsesByCollectionId(workspace, collectionId)))

// Plugin routes
app.post('/api/getWorkspacePlugins',              apiRoute(({ workspace }) => db.getWorkspacePlugins(workspace)))
app.post('/api/createPlugin',                     apiRoute(({ workspace, plugin }) => db.createPlugin(workspace, plugin)))
app.post('/api/updatePlugin',                     apiRoute(({ workspace, collectionId, pluginId, updatedFields }) => db.updatePlugin(workspace, collectionId, pluginId, updatedFields)))
app.post('/api/deletePlugin',                     apiRoute(({ workspace, collectionId, pluginId }) => db.deletePlugin(workspace, collectionId, pluginId)))
app.post('/api/deletePluginsByWorkspace',         apiRoute(({ workspace }) => db.deletePluginsByWorkspace(workspace)))
app.post('/api/deletePluginsByCollectionIds',     apiRoute(({ workspace, collectionIds }) => db.deletePluginsByCollectionIds(workspace, collectionIds)))
app.post('/api/createPlugins',                    apiRoute(({ workspace, plugins }) => db.createPlugins(workspace, plugins)))

// File read route
app.post('/api/readFile',                         apiRoute(({ filePath, workspaceLocation }) => helpers.readFile(filePath, workspaceLocation)))

// Directory browse route (web-standalone only)
app.get('/api/browse', async (req, res) => {
    try {
        const result = await helpers.browseDirectory(req.query.path || null)
        res.json({ result })
    } catch (e) {
        console.error(e)
        res.status(500).json({ error: e.message })
    }
})

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const server = app.listen(port, () => {
        console.log(`Restfox running on port http://localhost:${port}`)
    })

    server.on('upgrade', handleSocketProxyUpgrade)
}

export default app
