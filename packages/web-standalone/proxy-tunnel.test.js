import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'net'
import { limits, openTunnel } from './src/proxy-tunnel.js'

test('a proxy that takes the connection and never answers fails the tunnel after the time limit, through CONNECT and SOCKS5', async() => {
    const sockets = new Set()
    const silent = net.createServer(socket => {
        sockets.add(socket)
        socket.on('error', () => {})
        socket.on('close', () => sockets.delete(socket))
    })
    await new Promise(resolve => silent.listen(0, '127.0.0.1', resolve))
    const { port } = silent.address()
    limits.tunnelTimeoutMs = 300

    try {
        await assert.rejects(openTunnel(new URL(`http://127.0.0.1:${port}`), 'api.tunnel-test.test', 443), { message: 'The proxy did not answer within 0.3 s' })
        await assert.rejects(openTunnel(new URL(`socks5://127.0.0.1:${port}`), 'api.tunnel-test.test', 443), { message: 'The SOCKS5 proxy did not answer within 0.3 s' })
    } finally {
        limits.tunnelTimeoutMs = 10000
        for(const socket of sockets) {
            socket.destroy()
        }
        silent.close()
    }
})

test('a tunnel whose signal aborts while the proxy has not answered closes the connection to the proxy, through CONNECT and SOCKS5', async() => {
    const sockets = new Set()
    const silent = net.createServer(socket => {
        // reads what comes, so it sees the other side close
        socket.resume()
        sockets.add(socket)
        socket.on('error', () => {})
        socket.on('close', () => sockets.delete(socket))
    })
    await new Promise(resolve => silent.listen(0, '127.0.0.1', resolve))
    const { port } = silent.address()

    try {
        for(const protocol of ['http', 'socks5']) {
            const abortController = new AbortController()
            const opening = openTunnel(new URL(`${protocol}://127.0.0.1:${port}`), 'api.tunnel-test.test', 443, {}, abortController.signal)
            await new Promise(resolve => setTimeout(resolve, 100))
            assert.equal(sockets.size, 1, protocol)
            abortController.abort()
            await assert.rejects(opening, { code: 'ABORT_ERR' })
            // well before the proxy's own limit of limits.tunnelTimeoutMs
            const end = Date.now() + 1000
            while(sockets.size > 0 && Date.now() < end) {
                await new Promise(resolve => setTimeout(resolve, 20))
            }
            assert.equal(sockets.size, 0, protocol)
        }
    } finally {
        for(const socket of sockets) {
            socket.destroy()
        }
        silent.close()
    }
})
