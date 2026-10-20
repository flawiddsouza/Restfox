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

// a data message carries the chunks gathered until DATA_FLUSH_BYTES or DATA_FLUSH_DELAY ms after the first of them
const DATA_FLUSH_BYTES = 256 * 1024
const DATA_FLUSH_DELAY = 50

// copies body chunks into fresh Uint8Arrays of their own, so a pushed message never carries a larger pooled buffer
function createDataCoalescer(send) {
    let pending = []
    let pendingBytes = 0
    let timer = null

    function flush() {
        clearTimeout(timer)
        timer = null
        if(pendingBytes === 0) {
            return
        }
        const bytes = new Uint8Array(pendingBytes)
        let offset = 0
        for(const chunk of pending) {
            bytes.set(chunk, offset)
            offset += chunk.length
        }
        pending = []
        pendingBytes = 0
        send(bytes)
    }

    return {
        push(chunk) {
            if(chunk.length === 0) {
                return
            }
            pending.push(chunk)
            pendingBytes += chunk.length
            if(pendingBytes >= DATA_FLUSH_BYTES) {
                flush()
            } else if(timer === null) {
                timer = setTimeout(flush, DATA_FLUSH_DELAY)
            }
        },
        flush,
        discard() {
            clearTimeout(timer)
            timer = null
            pending = []
            pendingBytes = 0
        },
    }
}

// pushes head, then data messages, then end through emit. Before the head a failure pushes responseError, after it
// bodyError, and a cancel after it pushes nothing more, since the renderer has already settled the send.
async function handleSendRequest(data, emit) {
    let requestAbortController = null
    let startTime = null
    let headEndTime = null
    let coalescer = null

    try {
        const { requestId, url, method, headers, bodyHint, disableSSLVerification } = data
        let { body } = data

        requestAbortController = new AbortController()
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

        startTime = new Date()

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

        headEndTime = new Date()

        emit({
            event: 'head',
            eventData: {
                status: response.status,
                statusText: response.statusText,
                headers: [...response.headers.entries()],
                headTimeTaken: headEndTime - startTime,
                requestHeadersSent: proxyUrl !== null ? removeProxyCredentials(headersSent, headers) : headersSent,
            },
        })

        coalescer = createDataCoalescer(bytes => {
            // a timed flush can fire between a cancel and the body read failing on it
            if(!requestAbortController.signal.aborted) {
                emit({ event: 'data', eventData: bytes })
            }
        })

        if(response.body) {
            for await (const chunk of response.body) {
                coalescer.push(chunk)
            }
        }

        coalescer.flush()

        const endTime = new Date()

        emit({
            event: 'end',
            eventData: {
                timeTaken: endTime - startTime,
                bodyTimeTaken: endTime - headEndTime,
            },
        })
    } catch(e) {
        if(headEndTime === null) {
            console.error('request failed', e)
            emit({
                event: 'responseError',
                eventData: e.stack + (e.cause ? '\n' + e.cause?.stack : '')
            })
            return
        }

        if(requestAbortController.signal.aborted) {
            return
        }

        console.error('response body failed', e)
        coalescer?.flush()
        const endTime = new Date()
        emit({
            event: 'bodyError',
            eventData: {
                message: e.message + (e.cause?.message ? ': ' + e.cause.message : ''),
                timeTaken: endTime - startTime,
                bodyTimeTaken: endTime - headEndTime,
            },
        })
    } finally {
        coalescer?.discard()
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
