const http = require('http')
const https = require('https')
const net = require('net')
const tls = require('tls')

// Settings > Proxy > Custom for Chromium's own connections: WebSocket, Socket.IO and Chromium fetch. Chromium cannot log
// in to a SOCKS5 proxy, checks an https:// proxy's certificate only against the operating system's, and does not ask
// the app for a WebSocket's proxy login. So Chromium uses this plain proxy on loopback, which passes each connection on
// the way requests go, with the proxy's login, SOCKS5 and Settings > CA Certificates

function getProxyAuthorization(proxyUrl) {
    if(!proxyUrl.username) {
        return null
    }

    return `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64')}`
}

function connectToProxy(proxyUrl, tlsOptions) {
    const port = Number(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : proxyUrl.protocol === 'http:' ? 80 : 1080)

    if(proxyUrl.protocol === 'https:') {
        return tls.connect({ host: proxyUrl.hostname, port, servername: net.isIP(proxyUrl.hostname) ? undefined : proxyUrl.hostname, ...tlsOptions })
    }

    return net.connect(port, proxyUrl.hostname)
}

// reads a SOCKS5 answer a byte count at a time, keeping what follows for the tunnel
function createSocketReader(socket) {
    let buffer = Buffer.alloc(0)
    let pending = null

    const settle = () => {
        if(pending && buffer.length >= pending.length) {
            const chunk = buffer.subarray(0, pending.length)
            buffer = buffer.subarray(pending.length)
            const { resolve } = pending
            pending = null
            resolve(chunk)
        }
    }

    const onData = chunk => {
        buffer = Buffer.concat([buffer, chunk])
        settle()
    }
    const onEnd = () => pending?.reject(new Error('The SOCKS5 proxy closed the connection'))
    const onError = error => pending?.reject(error)

    socket.on('data', onData)
    socket.on('end', onEnd)
    socket.on('error', onError)

    return {
        read: length => new Promise((resolve, reject) => {
            pending = { length, resolve, reject }
            settle()
        }),
        release() {
            socket.pause()
            socket.removeListener('data', onData)
            socket.removeListener('end', onEnd)
            socket.removeListener('error', onError)
            if(buffer.length > 0) {
                socket.unshift(buffer)
            }
        },
    }
}

// SOCKS5's address of a target: an IPv4 or IPv6 address as one, anything else as a name for the proxy to look up
function getSocks5Address(host) {
    if(net.isIP(host) === 4) {
        return Buffer.from([1, ...host.split('.').map(Number)])
    }

    // an IPv6 address with an IPv4 part, such as ::ffff:10.0.0.1, goes as a name
    if(net.isIP(host) === 6 && !host.includes('.')) {
        const [head, tail = ''] = host.split('::')
        const headGroups = head === '' ? [] : head.split(':')
        const tailGroups = tail === '' ? [] : tail.split(':')
        const groups = [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill('0'), ...tailGroups]
        return Buffer.from([4, ...groups.flatMap(group => [parseInt(group, 16) >> 8, parseInt(group, 16) & 255])])
    }

    const name = Buffer.from(host)
    return Buffer.concat([Buffer.from([3, name.length]), name])
}

// RFC 1928 with a username and password login from RFC 1929
async function openSocks5Tunnel(proxyUrl, host, port) {
    const socket = net.connect(Number(proxyUrl.port) || 1080, proxyUrl.hostname)
    await new Promise((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('error', reject)
    })

    const reader = createSocketReader(socket)

    try {
        const username = proxyUrl.username ? Buffer.from(decodeURIComponent(proxyUrl.username)) : null
        const password = Buffer.from(decodeURIComponent(proxyUrl.password))

        socket.write(Buffer.from(username ? [5, 2, 0, 2] : [5, 1, 0]))
        const [, method] = await reader.read(2)

        if(method === 2 && username) {
            socket.write(Buffer.concat([Buffer.from([1, username.length]), username, Buffer.from([password.length]), password]))
            const [, status] = await reader.read(2)
            if(status !== 0) {
                throw Object.assign(new Error('The SOCKS5 proxy refused the login'), { statusCode: 407 })
            }
        } else if(method !== 0) {
            throw Object.assign(new Error('The SOCKS5 proxy wants a login'), { statusCode: 407 })
        }

        const portBuffer = Buffer.alloc(2)
        portBuffer.writeUInt16BE(Number(port))
        socket.write(Buffer.concat([Buffer.from([5, 1, 0]), getSocks5Address(host), portBuffer]))

        const [, reply, , addressType] = await reader.read(4)
        const addressLength = addressType === 1 ? 4 : addressType === 4 ? 16 : (await reader.read(1))[0]
        await reader.read(addressLength + 2)

        if(reply !== 0) {
            throw Object.assign(new Error(`The SOCKS5 proxy could not connect, reply ${reply}`), { statusCode: 502 })
        }

        reader.release()
        return socket
    } catch(e) {
        socket.destroy()
        throw e
    }
}

// a socket to host:port, through the proxy or, bypassed, directly
function openTunnel(proxyUrl, host, port, tlsOptions) {
    if(proxyUrl === null) {
        return new Promise((resolve, reject) => {
            const socket = net.connect(Number(port), host, () => resolve(socket))
            socket.once('error', reject)
        })
    }

    if(proxyUrl.protocol === 'socks5:' || proxyUrl.protocol === 'socks:') {
        return openSocks5Tunnel(proxyUrl, host, port)
    }

    return new Promise((resolve, reject) => {
        const authorization = getProxyAuthorization(proxyUrl)
        const authority = net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`
        const connectRequest = http.request({
            method: 'CONNECT',
            path: authority,
            headers: { host: authority, ...(authorization ? { 'proxy-authorization': authorization } : {}) },
            createConnection: () => connectToProxy(proxyUrl, tlsOptions),
        })

        connectRequest.once('connect', (response, socket, head) => {
            if(response.statusCode !== 200) {
                socket.destroy()
                reject(Object.assign(new Error(`The proxy answered ${response.statusCode}`), { statusCode: response.statusCode }))
                return
            }
            if(head.length > 0) {
                socket.unshift(head)
            }
            resolve(socket)
        })
        connectRequest.once('error', reject)
        connectRequest.end()
    })
}

// "host:port" or "[::1]:port" of a CONNECT request
function splitHostAndPort(authority) {
    const separator = authority.lastIndexOf(':')
    return [authority.slice(0, separator).replace(/^\[(.*)\]$/, '$1'), authority.slice(separator + 1)]
}

function withoutProxyHeaders(headers) {
    return Object.fromEntries(Object.entries(headers).filter(([name]) => !name.startsWith('proxy-')))
}

// getProxyUrl(url) gives the proxy for a target as a URL string, or null to connect directly, getTlsOptions() the
// certificate checks for an https:// proxy. Resolves with the port Chromium is pointed at
function startProxyRelay(getProxyUrl, getTlsOptions) {
    // Chromium fetch sends plain HTTP to a proxy as a full URL
    const server = http.createServer(async(req, res) => {
        try {
            const url = new URL(req.url)
            const targetHost = url.hostname.replace(/^\[(.*)\]$/, '$1')
            const proxyUrlText = await getProxyUrl(url)
            const proxyUrl = proxyUrlText !== null ? new URL(proxyUrlText) : null
            const headers = withoutProxyHeaders(req.headers)
            let upstreamRequest

            if(proxyUrl !== null && (proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:')) {
                const authorization = getProxyAuthorization(proxyUrl)
                upstreamRequest = (proxyUrl.protocol === 'https:' ? https : http).request({
                    host: proxyUrl.hostname,
                    port: Number(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80),
                    method: req.method,
                    path: req.url,
                    headers: { ...headers, ...(authorization ? { 'proxy-authorization': authorization } : {}) },
                    ...(proxyUrl.protocol === 'https:' ? { servername: net.isIP(proxyUrl.hostname) ? undefined : proxyUrl.hostname, ...getTlsOptions() } : {}),
                    agent: false,
                })
            } else {
                upstreamRequest = http.request({
                    host: targetHost,
                    port: Number(url.port) || 80,
                    method: req.method,
                    path: `${url.pathname}${url.search}`,
                    headers,
                    // a SOCKS5 tunnel comes paused, so nothing the proxy sent is lost, and Node's client does not resume
                    // it, once the client listens it can flow
                    createConnection: (_options, callback) => {
                        openTunnel(proxyUrl, targetHost, Number(url.port) || 80, getTlsOptions()).then(socket => {
                            callback(null, socket)
                            setImmediate(() => socket.resume())
                        }, callback)
                    },
                })
            }

            upstreamRequest.once('response', response => {
                res.writeHead(response.statusCode, response.statusMessage, response.headers)
                response.pipe(res)
            })
            upstreamRequest.once('error', e => {
                if(!res.headersSent) {
                    res.writeHead(e.statusCode ?? 502).end(e.message)
                } else {
                    res.destroy()
                }
            })
            req.pipe(upstreamRequest)
        } catch(e) {
            res.writeHead(502).end(e.message)
        }
    })

    // HTTPS, and WebSocket whether ws:// or wss://, go through a tunnel
    server.on('connect', async(req, clientSocket, head) => {
        clientSocket.on('error', () => {})

        try {
            const [host, port] = splitHostAndPort(req.url)
            const proxyUrlText = await getProxyUrl(new URL(`https://${req.url}`))
            const upstreamSocket = await openTunnel(proxyUrlText !== null ? new URL(proxyUrlText) : null, host, port, getTlsOptions())

            if(clientSocket.destroyed) {
                upstreamSocket.destroy()
                return
            }

            upstreamSocket.on('error', () => clientSocket.destroy())
            clientSocket.on('close', () => upstreamSocket.destroy())
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
            if(head.length > 0) {
                upstreamSocket.write(head)
            }
            upstreamSocket.pipe(clientSocket)
            clientSocket.pipe(upstreamSocket)
        } catch(e) {
            clientSocket.end(`HTTP/1.1 ${e.statusCode ?? 502} ${e.statusCode === 407 ? 'Proxy Authentication Required' : 'Bad Gateway'}\r\nConnection: close\r\n\r\n`)
        }
    })

    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }))
    })
}

module.exports = {
    startProxyRelay,
}
