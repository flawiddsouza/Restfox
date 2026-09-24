import { test, expect, afterEach } from 'vitest'
import net from 'node:net'
import http2 from 'node:http2'
import fs from 'node:fs'
import path from 'node:path'
import { handleSendRequest, setProxySettings } from './request.js'
import { parseWireRequest, startForwardProxy, startSocks5Proxy, closeTestProxies } from './test-proxies.js'

const servers = []

afterEach(() => {
    setProxySettings(null, null)
    closeTestProxies()
    for(const server of servers.splice(0)) {
        server.close()
    }
})

// a bare TCP server that records the exact bytes the client sends, like the reporter's nc -l
function startRawServer(responseBytes) {
    let raw = ''
    const server = net.createServer(socket => {
        socket.on('data', chunk => {
            raw += chunk.toString('latin1')
            const parsed = parseWireRequest(raw)
            const contentLength = Number(parsed.headers.find(([name]) => name === 'content-length')?.[1] ?? 0)
            if(raw.includes('\r\n\r\n') && parsed.body.length >= contentLength) {
                socket.end(responseBytes)
            }
        })
    })
    servers.push(server)
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, received: () => parseWireRequest(raw) }))
    })
}

function startHttp2Server() {
    const filesDir = path.join(__dirname, '..', '..', 'test-api', 'files')
    const server = http2.createSecureServer({
        key: fs.readFileSync(path.join(filesDir, 'localhost.key')),
        cert: fs.readFileSync(path.join(filesDir, 'localhost.crt')),
    })
    let receivedHeaders = null
    server.on('stream', (stream, headers) => {
        receivedHeaders = headers
        stream.respond({ ':status': 200, 'content-type': 'text/plain' })
        stream.end('ok')
    })
    servers.push(server)
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, received: () => receivedHeaders }))
    })
}

function send(overrides) {
    return handleSendRequest({
        requestId: 'spec',
        method: 'GET',
        headers: { 'user-agent': 'Restfox/spec' },
        body: null,
        bodyHint: null,
        disableSSLVerification: false,
        ...overrides,
    })
}

test('reports the request headers exactly as they went over the wire for HTTP/1.1', async() => {
    const server = await startRawServer('HTTP/1.1 200 OK\r\nCONTENT-LENGTH:4\r\n\r\nBODY')

    const result = await send({ url: `http://127.0.0.1:${server.port}/path?x=1` })

    expect(result.event).toBe('response')
    const wire = server.received()
    expect(wire.requestLine).toBe('GET /path?x=1 HTTP/1.1')
    expect(wire.headers.map(([name]) => name)).toContain('connection')
    expect(result.eventData.requestHeadersSent).toEqual(wire.headers)
})

test('includes the content-length the transport adds for a request body', async() => {
    const server = await startRawServer('HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok')

    const result = await send({
        url: `http://127.0.0.1:${server.port}/submit`,
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'hello',
    })

    expect(result.event).toBe('response')
    const wire = server.received()
    expect(wire.body).toBe('hello')
    expect(wire.headers).toContainEqual(['content-length', '5'])
    expect(result.eventData.requestHeadersSent).toEqual(wire.headers)
})

test('reports the header block sent on an HTTP/2 connection', async() => {
    const server = await startHttp2Server()

    const result = await send({ url: `https://localhost:${server.port}/h2`, disableSSLVerification: true })

    expect(result.event).toBe('response')
    const received = server.received()
    expect(received[':path']).toBe('/h2')
    const sent = Object.fromEntries(result.eventData.requestHeadersSent)
    expect(sent[':path']).toBe('/h2')
    expect(sent[':method']).toBe('GET')
    for(const [name, value] of Object.entries(received)) {
        if(name.startsWith(':') || ['user-agent', 'accept', 'accept-encoding', 'accept-language', 'sec-fetch-mode'].includes(name)) {
            expect(sent[name]).toBe(value)
        }
    }
})

test('Settings > Proxy > Custom sends plain HTTP to the proxy as a full URL with its credentials', async() => {
    const proxy = await startForwardProxy()
    setProxySettings({ mode: 'custom', url: proxy.url, username: 'user', password: 'p@ss' }, null)

    const result = await send({ url: 'http://api.proxy-spec.test/path?x=1' })

    expect(result.event).toBe('response')
    expect(Buffer.from(result.eventData.buffer).toString()).toBe('proxied GET http://api.proxy-spec.test/path?x=1 HTTP/1.1')
    // undici 7 dropped the proxy's status text here, scripts' fetchSync then failed and the response panel showed none
    expect(result.eventData.statusText).toBe('OK')
    expect(proxy.received[0].headers).toContainEqual(['proxy-authorization', `Basic ${Buffer.from('user:p@ss').toString('base64')}`])
    // the timeline and response history do not keep the proxy's password
    expect(result.eventData.requestHeadersSent).toEqual(proxy.received[0].headers.filter(([name]) => name !== 'proxy-authorization'))
})

test('Settings > Proxy > Custom tunnels HTTPS through CONNECT, still over HTTP/2, and reports the headers sent to the server, not to the proxy', async() => {
    const proxy = await startForwardProxy()
    const server = await startHttp2Server()
    setProxySettings({ mode: 'custom', url: proxy.url, username: 'user', password: 'secret' }, null)

    const result = await send({ url: `https://api.proxy-spec.test:${server.port}/h2`, disableSSLVerification: true })

    expect(result.event).toBe('response')
    expect(proxy.received[0].requestLine).toBe(`CONNECT api.proxy-spec.test:${server.port} HTTP/1.1`)
    expect(server.received()[':path']).toBe('/h2')
    const sent = Object.fromEntries(result.eventData.requestHeadersSent)
    expect(sent[':path']).toBe('/h2')
    expect(sent['proxy-authorization']).toBe(undefined)
})

test('Settings > Proxy > System uses the proxy Electron resolves, and Off connects directly', async() => {
    const proxy = await startForwardProxy()
    const resolved = []
    const resolveSystemProxy = async url => {
        resolved.push(url)
        return `PROXY ${proxy.url.replace('http://', '')}; DIRECT`
    }

    setProxySettings(null, resolveSystemProxy)
    const system = await send({ url: 'http://api.proxy-spec.test/system' })
    expect(Buffer.from(system.eventData.buffer).toString()).toBe('proxied GET http://api.proxy-spec.test/system HTTP/1.1')
    expect(resolved).toEqual(['http://api.proxy-spec.test/system'])

    setProxySettings({ mode: 'off' }, resolveSystemProxy)
    // the host resolves only at the proxy, so going direct fails to find it
    const off = await send({ url: 'http://api.proxy-spec.test/off' })
    expect(off.event).toBe('responseError')
    expect(off.eventData).toContain('ENOTFOUND api.proxy-spec.test')
    expect(proxy.received).toHaveLength(1)
    expect(resolved).toHaveLength(1)
})

test('Settings > Proxy > Custom logs in to a SOCKS5 proxy with the username and password as typed', async() => {
    const socks = await startSocks5Proxy()
    const server = await startRawServer('HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok')
    setProxySettings({ mode: 'custom', url: socks.url, username: 'dom user@x', password: 'p@ss:word' }, null)

    const result = await send({ url: `http://api.proxy-spec.test:${server.port}/` })

    expect(result.event).toBe('response')
    expect(socks.logins).toEqual([{ username: 'dom user@x', password: 'p@ss:word' }])
})

test('a request\'s own Proxy-Authorization goes to the proxy when one applies, and stays in the timeline', async() => {
    const proxy = await startForwardProxy()
    setProxySettings({ mode: 'custom', url: proxy.url }, null)

    const result = await send({ url: 'http://api.proxy-spec.test/own', headers: { 'Proxy-Authorization': 'Bearer own-token' } })

    expect(result.event).toBe('response')
    expect(proxy.received[0].headers).toContainEqual(['proxy-authorization', 'Bearer own-token'])
    expect(result.eventData.requestHeadersSent).toContainEqual(['proxy-authorization', 'Bearer own-token'])
})
