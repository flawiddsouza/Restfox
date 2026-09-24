// test proxies for the transport and relay specs, closed by closeTestProxies after each test
import net from 'node:net'
import tls from 'node:tls'

const proxies = []

export function closeTestProxies() {
    for(const proxy of proxies.splice(0)) {
        proxy.close()
    }
}

// splits a raw HTTP/1.1 request into its request line, header pairs and body
export function parseWireRequest(raw) {
    const headerEnd = raw.indexOf('\r\n\r\n')
    const [requestLine, ...headerLines] = raw.slice(0, headerEnd).split('\r\n')
    const headers = headerLines.map(line => {
        const separator = line.indexOf(': ')
        return [line.slice(0, separator), line.slice(separator + 2)]
    })
    return { requestLine, headers, body: raw.slice(headerEnd + 4) }
}

// a forward proxy like a company's: answers a plain HTTP request itself, which arrives as a full URL, and tunnels a
// CONNECT to 127.0.0.1, so the target's host name only has to resolve at the proxy, as on a network behind one. With
// tlsOptions it is an https:// proxy
export function startForwardProxy(tlsOptions = null) {
    const received = []
    const onConnection = socket => {
        let raw = ''
        const onData = chunk => {
            raw += chunk.toString('latin1')
            if(!raw.includes('\r\n\r\n')) {
                return
            }
            socket.removeListener('data', onData)
            const request = parseWireRequest(raw)
            received.push(request)
            const [method, target] = request.requestLine.split(' ')
            if(method === 'CONNECT') {
                const upstream = net.connect(Number(target.slice(target.lastIndexOf(':') + 1)), '127.0.0.1', () => {
                    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
                    upstream.pipe(socket)
                    socket.pipe(upstream)
                })
                upstream.on('error', () => socket.destroy())
                return
            }
            const body = `proxied ${request.requestLine}`
            socket.end(`HTTP/1.1 200 OK\r\ncontent-length: ${body.length}\r\n\r\n${body}`)
        }
        socket.on('data', onData)
        socket.on('error', () => {})
    }
    const server = tlsOptions ? tls.createServer(tlsOptions, onConnection) : net.createServer(onConnection)
    proxies.push(server)
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ url: `${tlsOptions ? 'https' : 'http'}://${tlsOptions ? 'localhost' : '127.0.0.1'}:${server.address().port}`, received }))
    })
}

// a SOCKS5 proxy asking for a username and password (RFC 1929), tunnelling to 127.0.0.1 whatever host it is asked for
export function startSocks5Proxy() {
    const logins = []
    // the address part of each CONNECT, its type byte first
    const addresses = []
    const server = net.createServer(socket => {
        socket.on('error', () => {})
        let stage = 'greeting'
        socket.on('data', function onData(chunk) {
            if(stage === 'greeting') {
                socket.write(Buffer.from([5, 2]))
                stage = 'login'
                return
            }
            if(stage === 'login') {
                const usernameLength = chunk[1]
                const username = chunk.subarray(2, 2 + usernameLength).toString()
                const password = chunk.subarray(3 + usernameLength, 3 + usernameLength + chunk[2 + usernameLength]).toString()
                logins.push({ username, password })
                socket.write(Buffer.from([1, 0]))
                stage = 'connect'
                return
            }
            // CONNECT: 5 1 0, the address, the port
            addresses.push([...chunk.subarray(3, chunk.length - 2)])
            const port = chunk.readUInt16BE(chunk.length - 2)
            socket.removeListener('data', onData)
            const upstream = net.connect(port, '127.0.0.1', () => {
                socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
                upstream.pipe(socket)
                socket.pipe(upstream)
            })
            upstream.on('error', () => socket.destroy())
        })
    })
    proxies.push(server)
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ url: `socks5://127.0.0.1:${server.address().port}`, logins, addresses }))
    })
}
