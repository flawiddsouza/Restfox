const { File } = require('node:buffer')
const { fetch, Agent, FormData, ProxyAgent } = require('undici')
const { Socket } = require('net')
const dnsPromises = require('dns').promises

let abortController = {}

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
const proxyAgents = new Map()

function getAgentForRequest(urlParsed, disableSSLVerification) {
    const key = `${urlParsed.hostname}:${urlParsed.port}:${disableSSLVerification}`

    if(!agents.has(key)) {
        const agent = new Agent({
            connect: {
                rejectUnauthorized: disableSSLVerification ? false : true,
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
        })

        agents.set(key, agent)
    }

    return agents.get(key)
}

function getProxyAgent(proxyHost, proxyPort, disableSSLVerification) {
    const key = `${proxyHost}:${proxyPort}:${disableSSLVerification}`

    if (!proxyAgents.has(key)) {
        const proxyAgent = new ProxyAgent({
            uri: `http://${proxyHost}:${proxyPort}`,
            requestTls: {
                rejectUnauthorized: disableSSLVerification ? false : true,
            },
        })
        proxyAgents.set(key, proxyAgent)
    }

    return proxyAgents.get(key)
}

async function handleSendRequest(data) {
    try {
        const { requestId, url, method, headers, bodyHint, disableSSLVerification, proxyEnabled, proxyHost, proxyPort } = data
        let { body } = data

        abortController[requestId] = new AbortController()

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

        const startTime = new Date()

        const urlParsed = new URL(url)

        console.log({
            disableSSLVerification,
            proxyEnabled,
            proxyHost,
            proxyPort,
        })

        // Determine which dispatcher to use (proxy or direct)
        let dispatcher
        if (proxyEnabled && proxyHost && proxyPort) {
            console.log(`Using proxy: ${proxyHost}:${proxyPort}`)
            dispatcher = getProxyAgent(proxyHost, proxyPort, disableSSLVerification)
        } else {
            dispatcher = getAgentForRequest(urlParsed, disableSSLVerification)
        }

        const response = await fetch(url, {
            method,
            headers,
            body: method !== 'GET' ? body : undefined,
            signal: abortController[requestId].signal,
            dispatcher,
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
    }
}

function cancelRequest(requestId) {
    if(abortController[requestId]) {
        abortController[requestId].abort()
        delete abortController[requestId]
    }
}

module.exports = {
    handleSendRequest,
    cancelRequest,
}
