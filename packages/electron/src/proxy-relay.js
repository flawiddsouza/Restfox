const http = require('http')
const https = require('https')
const net = require('net')
const { getProxyAuthorization, openTunnel } = require('./proxy-tunnel')

// Settings > Proxy > Custom for Chromium's own connections: WebSocket, Socket.IO and Chromium fetch. Chromium cannot log
// in to a SOCKS5 proxy, checks an https:// proxy's certificate only against the operating system's, and does not ask
// the app for a WebSocket's proxy login. So Chromium uses this plain proxy on loopback, which passes each connection on
// the way requests go, with the proxy's login, SOCKS5 and Settings > CA Certificates

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
