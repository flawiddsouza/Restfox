import express from 'express'
import { fetch, Agent } from 'undici'
import { Readable } from 'stream'
import { pathToFileURL } from 'url'
import * as db from './src/db.js'
import * as helpers from './src/helpers.js'
import TaskQueue from './src/task-queue.js'

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

const agents = new Map()

function getAgentForRequest(urlParsed, disableSSLVerification) {
    const key = `${urlParsed.hostname}:${urlParsed.port}:${disableSSLVerification}`

    if(!agents.has(key)) {
        const agent = new Agent({
            connect: {
                rejectUnauthorized: disableSSLVerification ? false : true,
            },
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
    const headers = {}

    const agent = getAgentForRequest(new URL(url), disableSSLVerification)

    Object.keys(req.headers).forEach(header => {
        if(header.startsWith('x-proxy-req-header-')) {
            headers[header.replace('x-proxy-req-header-', '')] = req.headers[header]
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
        const startTime = new Date()

        const response = await fetch(url, {
            dispatcher: agent,
            method,
            headers,
            body,
            duplex: 'half',
            signal: abortController.signal,
        })

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
                eventData: timedOut ? `Request timed out after ${requestTimeout} ms` : e.message
            })
        }
    } finally {
        if(timeoutId !== undefined) {
            clearTimeout(timeoutId)
        }
    }
})

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
    app.listen(port, () => {
        console.log(`Restfox running on port http://localhost:${port}`)
    })
}

export default app
