import net from 'net'

// a forward proxy like a company's: answers a plain HTTP request itself, which arrives as a full URL, and tunnels a
// CONNECT to 127.0.0.1, so the target's host name only has to resolve at the proxy, as on a network behind one
export async function startForwardProxy() {
    const received = []
    const sockets = new Set()
    const server = net.createServer(socket => {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', () => {})
        let raw = ''
        const onData = chunk => {
            raw += chunk.toString('latin1')
            if(!raw.includes('\r\n\r\n')) {
                return
            }
            socket.removeListener('data', onData)
            const [requestLine, ...headerLines] = raw.slice(0, raw.indexOf('\r\n\r\n')).split('\r\n')
            received.push({ requestLine, headers: headerLines.map(line => line.split(': ')) })
            const [method, target] = requestLine.split(' ')
            if(method === 'CONNECT') {
                const upstream = net.connect(Number(target.split(':')[1]), '127.0.0.1', () => {
                    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
                    upstream.pipe(socket)
                    socket.pipe(upstream)
                })
                sockets.add(upstream)
                upstream.on('error', () => socket.destroy())
                return
            }
            const body = `proxied ${requestLine}`
            socket.end(`HTTP/1.1 200 OK\r\ncontent-length: ${body.length}\r\n\r\n${body}`)
        }
        socket.on('data', onData)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        received,
        close: () => {
            sockets.forEach(socket => socket.destroy())
            server.close()
        },
    }
}
