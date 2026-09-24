const { File } = require('node:buffer')
const { fetch, Agent, ProxyAgent, FormData } = require('undici')
const { Socket } = require('net')
const dnsPromises = require('dns').promises
const { withSentHeadersCapture } = require('./sent-headers-capture.js')
const { getCACertificatesWithCustom } = require('./ca-certificates.js')
const { getProxyForRequest, takeProxyAuthorization, getProxyAgentOptions, removeProxyCredentials } = require('./proxy.js')

let abortController = {}
let cancelledRequestIds = new Set()

async function checkReachability(host, port) {
    return new Promise((resolve) => {
        const socket = new Socket()

        socket.once('connect', () => {
            socket.end()
            resolve(true)
        })

        socket.once('error', () => {
            resolve(false)
        })

        socket.connect(port, host)
    })
}

const localhostTds = [
    'test', // all domain names ending with .test
    'localhost', // all domain names ending with .localhost
    'local', // all domain names ending with .local
]

const agents = new Map()

// Settings > CA Certificates, sent by the renderer
let customCACertificates = []

function setCustomCACertificates(certificates) {
    customCACertificates = certificates

    // a pooled connection keeps the certificates it was verified with
    for(const agent of agents.values()) {
        agent.close().catch(() => {})
    }
    agents.clear()
}

function getCustomCACertificates() {
    return customCACertificates
}

// Settings > Proxy, sent by the renderer, and Electron's session.resolveProxy for its System choice
let proxySettings = null
let resolveSystemProxy = null

function setProxySettings(settings, systemProxyResolver) {
    proxySettings = settings
    resolveSystemProxy = systemProxyResolver

    for(const agent of agents.values()) {
        agent.close().catch(() => {})
    }
    agents.clear()
}

function getAgentForRequest(urlParsed, disableSSLVerification, proxyUrl = null, proxyToken = null) {
    const key = `${urlParsed.hostname}:${urlParsed.port}:${disableSSLVerification}:${proxyUrl}:${proxyToken}`

    if(!agents.has(key) && proxyUrl !== null) {
        const tls = {
            rejectUnauthorized: disableSSLVerification ? false : true,
            ...(customCACertificates.length > 0 ? { ca: getCACertificatesWithCustom(customCACertificates) } : {}),
        }

        agents.set(key, new ProxyAgent({
            ...getProxyAgentOptions(proxyUrl, tls, proxyToken),
            // plain HTTP goes to the proxy as a full URL, like browsers and curl send it, HTTPS through a CONNECT tunnel
            proxyTunnel: false,
            requestTls: { ...tls, allowH2: true },
            allowH2: true,
            headersTimeout: 0,
            bodyTimeout: 0,
        }))
    }

    if(!agents.has(key)) {
        const agent = new Agent({
            connect: {
                rejectUnauthorized: disableSSLVerification ? false : true,
                ...(customCACertificates.length > 0 ? { ca: getCACertificatesWithCustom(customCACertificates) } : {}),
                lookup: async(hostname, _opts, callback) => {
                    try {
                        console.log('lookup', hostname)
                        const addresses = await dnsPromises.lookup(hostname, { all: true })

                        let address = null

                        if (addresses.length > 1) {
                            console.log('addresses found', addresses)

                            while(addresses.length > 0) {
                                address = addresses.shift()
                                let isReachable = true
                                const urlPort = urlParsed.port !== '' ? urlParsed.port : (urlParsed.protocol === 'https:' ? 443 : 80)
                                const tld = hostname.substring(hostname.lastIndexOf('.') + 1)

                                if (hostname === 'localhost' || localhostTds.includes(tld)) {
                                    isReachable = await checkReachability(address.address, urlPort)
                                    console.log(`address ${address.address} is ${isReachable ? 'reachable' : 'not reachable'} on port ${urlPort}`)
                                } else {
                                    console.log(`reachability test skipped for non-localhost address ${address.address} and picked as the address to use for the request`)
                                }
                                if(isReachable) {
                                    break
                                }
                            }
                        } else {
                            address = addresses[0]
                        }

                        if(!address) {
                            throw new Error('No reachable address found')
                        }

                        callback(null, [address])
                    } catch(err) {
                        callback(err)
                    }
                },
            },
            allowH2: true,
            headersTimeout: 0,
            bodyTimeout: 0,
        })

        agents.set(key, agent)
    }

    return agents.get(key)
}

async function handleSendRequest(data) {
    try {
        const { requestId, url, method, headers, bodyHint, disableSSLVerification } = data
        let { body } = data

        const requestAbortController = new AbortController()
        abortController[requestId] = requestAbortController

        if(cancelledRequestIds.has(requestId)) {
            requestAbortController.abort()
            cancelledRequestIds.delete(requestId)
        }

        if(bodyHint === 'FormData') {
            const formData = new FormData()
            for(const item of body) {
                const value = typeof item[1] !== 'object' ? item[1] : new File([new Uint8Array(item[1].buffer)], item[1].name, { type: item[1].type })
                formData.append(item[0], value)
            }
            body = formData
        }

        if(bodyHint === 'File') {
            body = new File([new Uint8Array(body.buffer)], body.name, { type: body.type })
        }

        const urlParsed = new URL(url)
        // before the clock starts, a PAC script can take a while
        const proxyUrl = await getProxyForRequest(urlParsed, proxySettings, resolveSystemProxy)
        const { headers: headersToSend, token: proxyToken } = proxyUrl !== null ? takeProxyAuthorization(headers) : { headers, token: null }

        const startTime = new Date()

        console.log({
            disableSSLVerification
        })

        const { result: response, headersSent } = await withSentHeadersCapture(() => fetch(url, {
            method,
            headers: headersToSend,
            body: method !== 'GET' ? body : undefined,
            signal: requestAbortController.signal,
            dispatcher: getAgentForRequest(urlParsed, disableSSLVerification, proxyUrl, proxyToken),
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
        return {
            event: 'response',
            eventData: responseToSend
        }
    } catch(e) {
        console.error('request failed', e)
        return {
            event: 'responseError',
            eventData: e.stack + (e.cause ? '\n' + e.cause?.stack : '')
        }
    } finally {
        delete abortController[data.requestId]
        cancelledRequestIds.delete(data.requestId)
    }
}

function cancelRequest(requestId) {
    if(abortController[requestId]) {
        abortController[requestId].abort()
        delete abortController[requestId]
    } else {
        cancelledRequestIds.add(requestId)
    }
}

module.exports = {
    handleSendRequest,
    cancelRequest,
    setCustomCACertificates,
    getCustomCACertificates,
    setProxySettings,
}
