import { test, expect, afterEach } from 'vitest'
import net from 'node:net'
import http2 from 'node:http2'
import fs from 'node:fs'
import path from 'node:path'
import { fetch as undiciFetch } from 'undici'
import { handleSendRequest, cancelRequest, setProxySettings } from './request.js'
import { collectRequestEvents } from './collect-request-events.js'
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

async function send(overrides) {
    const { result } = await collectRequestEvents({
        requestId: 'spec',
        method: 'GET',
        headers: { 'user-agent': 'Restfox/spec' },
        body: null,
        bodyHint: null,
        disableSSLVerification: false,
        ...overrides,
    })
    return result
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

for(const [method, body] of [['HEAD', null], ['HEAD', 'hello'], ['head', 'hello'], ['get', 'hello'], [undefined, 'hello']]) {
    test(`sends ${method}${body ? ' with a body set' : ''} without a body`, async() => {
        const server = await startRawServer(method?.toUpperCase() === 'HEAD' ? 'HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n' : 'HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok')

        const result = await send({ url: `http://127.0.0.1:${server.port}/`, method, headers: { 'content-type': 'text/plain' }, body })

        expect(result.event).toBe('response')
        const wire = server.received()
        expect(wire.requestLine).toBe(`${(method ?? 'GET').toUpperCase()} / HTTP/1.1`)
        expect(wire.body).toBe('')
        expect(wire.headers.map(([name]) => name)).not.toContain('content-length')
        expect(wire.headers.map(([name]) => name)).not.toContain('transfer-encoding')
    })
}

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

// a bare TCP server that answers the first request with head, then lets the test write the rest and watch the socket
function startStreamingServer(head) {
    const connections = []
    let connected
    const firstConnection = new Promise(resolve => { connected = resolve })
    const server = net.createServer(socket => {
        const connection = { socket, closed: new Promise(resolve => socket.once('close', resolve)) }
        connections.push(connection)
        socket.on('error', () => {})
        socket.once('data', () => {
            socket.write(head)
            connected(connection)
        })
    })
    servers.push({ close: () => { for(const { socket } of connections) { socket.destroy() } server.close() } })
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, firstConnection }))
    })
}

const sseHead = 'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n'
const httpChunk = bytes => Buffer.concat([Buffer.from(`${Buffer.from(bytes).length.toString(16)}\r\n`), Buffer.from(bytes), Buffer.from('\r\n')])
const lastHttpChunk = '0\r\n\r\n'

function withinOneSecond(promise, what) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} not within 1 s`)), 1000))])
}

function streamRequest(requestId, url) {
    return { requestId, url, method: 'GET', headers: {}, body: null, bodyHint: null, disableSSLVerification: false }
}

// writes the bytes in slices of varying size, each on its own turn of the event loop, so they reach the client as many chunks
async function writeInSlices(socket, bytes) {
    let offset = 0
    let size = 1
    while(offset < bytes.length) {
        const slice = bytes.subarray(offset, offset + size)
        offset += slice.length
        size = size * 7 % 70000 + 1
        if(!socket.write(slice)) {
            await new Promise(resolve => socket.once('drain', resolve))
        }
        await new Promise(resolve => setImmediate(resolve))
    }
}

test('pushes the head and the first data while an event stream stays open', async() => {
    const server = await startStreamingServer(Buffer.concat([Buffer.from(sseHead), httpChunk('data: 1\n\n')]))
    const events = []
    let sawData
    const dataSeen = new Promise(resolve => { sawData = resolve })

    const sending = handleSendRequest(streamRequest('open-sse', server.url), message => {
        events.push(message)
        if(message.event === 'data') {
            sawData()
        }
    })

    await withinOneSecond(dataSeen, 'data')
    expect(events.map(message => message.event)).toEqual(['head', 'data'])
    expect(events[0].eventData.status).toBe(200)
    expect(events[0].eventData.headers).toContainEqual(['content-type', 'text/event-stream'])
    expect(Buffer.from(events[1].eventData).toString()).toBe('data: 1\n\n')

    cancelRequest('open-sse')
    await sending
})

test('pushes the head before the rest of the body is written, and the body joins in order', async() => {
    const server = await startStreamingServer(Buffer.concat([Buffer.from(sseHead), httpChunk('data: 1\n\n')]))
    let headSeen
    const head = new Promise(resolve => { headSeen = resolve })

    const collecting = collectRequestEvents(streamRequest('head-first', server.url), message => {
        if(message.event === 'head') {
            headSeen()
        }
    })

    await withinOneSecond(head, 'head')
    const { socket } = await server.firstConnection
    socket.write(httpChunk('data: 2\n\n'))
    socket.end(lastHttpChunk)

    const { events, result } = await collecting
    expect(events[0].event).toBe('head')
    expect(events.at(-1).event).toBe('end')
    expect(result.event).toBe('response')
    expect(Buffer.from(result.eventData.buffer).toString()).toBe('data: 1\n\ndata: 2\n\n')
    expect(result.eventData.timeTaken).toBe(result.eventData.headTimeTaken + result.eventData.bodyTimeTaken)
})

test('every byte value and a 5 MB binary body arrive byte-identical through the pushed data', async() => {
    const allBytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index))
    const bigBody = Buffer.alloc(5 * 1024 * 1024)
    let seed = 12345
    for(let index = 0; index < bigBody.length; index++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        bigBody[index] = seed >> 16
    }
    const body = Buffer.concat([allBytes, Buffer.from(allBytes).reverse(), bigBody, allBytes])

    const server = await startStreamingServer(`HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: ${body.length}\r\n\r\n`)
    const collecting = collectRequestEvents(streamRequest('bytes', server.url))
    const { socket } = await server.firstConnection
    await writeInSlices(socket, body)
    socket.end()

    const { events, result } = await collecting
    expect(result.event).toBe('response')
    expect(result.eventData.buffer.length).toBe(body.length)
    expect(Buffer.compare(Buffer.from(result.eventData.buffer), body)).toBe(0)
    expect(events.filter(message => message.event === 'data').length).toBeGreaterThan(1)

    const small = await startRawServer(Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\ncontent-length: 256\r\n\r\n'), allBytes]))
    const smallResult = await send({ url: `http://127.0.0.1:${small.port}/` })
    expect(Buffer.compare(Buffer.from(smallResult.eventData.buffer), allBytes)).toBe(0)
}, 30000)

test('gathers small chunks into fewer data messages, each in an ArrayBuffer of its own', async() => {
    const pieces = Array.from({ length: 600 }, (_, index) => Buffer.alloc(1000, index % 256))
    const expected = Buffer.concat(pieces)
    const head = 'HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n\r\n'

    async function writePieces(socket) {
        for(const piece of pieces) {
            socket.write(httpChunk(piece))
            await new Promise(resolve => setImmediate(resolve))
        }
        socket.end(lastHttpChunk)
    }

    // the same server read with undici directly gives the chunk count the transport sees
    const direct = await startStreamingServer(head)
    const directResponse = undiciFetch(direct.url)
    writePieces((await direct.firstConnection).socket)
    let undiciChunks = 0
    const reader = (await directResponse).body.getReader()
    while(!(await reader.read()).done) {
        undiciChunks++
    }

    const server = await startStreamingServer(head)
    const collecting = collectRequestEvents(streamRequest('coalesce', server.url))
    writePieces((await server.firstConnection).socket)
    const { events, result } = await collecting

    const dataMessages = events.filter(message => message.event === 'data')
    expect(Buffer.compare(Buffer.from(result.eventData.buffer), expected)).toBe(0)
    expect(undiciChunks).toBeGreaterThan(20)
    expect(dataMessages.length).toBeLessThan(undiciChunks)
    for(const message of dataMessages) {
        expect(message.eventData.byteOffset).toBe(0)
        expect(message.eventData.buffer.byteLength).toBe(message.eventData.length)
    }
})

test('cancelRequest mid-body pushes nothing more and closes the upstream connection', async() => {
    const server = await startStreamingServer(Buffer.concat([Buffer.from(sseHead), httpChunk('data: 1\n\n')]))
    const events = []
    let sawData
    const dataSeen = new Promise(resolve => { sawData = resolve })

    const sending = handleSendRequest(streamRequest('cancel-mid-body', server.url), message => {
        events.push(message)
        if(message.event === 'data') {
            sawData()
        }
    })

    await withinOneSecond(dataSeen, 'data')
    const { socket, closed } = await server.firstConnection
    // bytes still being gathered when the cancel comes are dropped with it
    socket.write(httpChunk('data: 2\n\n'))
    await new Promise(resolve => setTimeout(resolve, 10))
    cancelRequest('cancel-mid-body')

    expect(await sending).toBe(undefined)
    expect(events.map(message => message.event)).toEqual(['head', 'data'])
    await withinOneSecond(closed, 'upstream close')

    // a late timed flush must not push either
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(events.length).toBe(2)
})

test('a connection reset mid-body pushes the bytes received, then bodyError', async() => {
    const server = await startStreamingServer(Buffer.concat([Buffer.from(sseHead), httpChunk('data: 1\n\n')]))
    let headSeen
    const head = new Promise(resolve => { headSeen = resolve })

    const collecting = collectRequestEvents(streamRequest('reset', server.url), message => {
        if(message.event === 'head') {
            headSeen()
        }
    })

    await withinOneSecond(head, 'head')
    const { socket } = await server.firstConnection
    // past the 50 ms gathering delay, so the first bytes are already pushed and the reset is its own event
    await new Promise(resolve => setTimeout(resolve, 100))
    socket.resetAndDestroy()

    const { events, result } = await collecting
    expect(events.map(message => message.event)).toEqual(['head', 'data', 'bodyError'])
    expect(result.event).toBe('bodyError')
    expect(Buffer.from(result.eventData.buffer).toString()).toBe('data: 1\n\n')
    expect(result.eventData.message).toMatch(/terminated|ECONNRESET|other side closed/)
    expect(result.eventData.timeTaken).toBeGreaterThanOrEqual(result.eventData.bodyTimeTaken)
})

test('a DNS failure pushes only responseError with the stack text', async() => {
    const { events, result } = await collectRequestEvents(streamRequest('dns', 'http://restfox-spec.invalid/'))

    expect(events.length).toBe(1)
    expect(result.event).toBe('responseError')
    expect(result.eventData).toContain('TypeError: fetch failed')
    expect(result.eventData).toContain('ENOTFOUND restfox-spec.invalid')
})

test('an empty body pushes head and end with no data', async() => {
    const server = await startRawServer('HTTP/1.1 204 No Content\r\n\r\n')
    const { events, result } = await collectRequestEvents(streamRequest('empty', `http://127.0.0.1:${server.port}/`))

    expect(events.map(message => message.event)).toEqual(['head', 'end'])
    expect(result.eventData.status).toBe(204)
    expect(result.eventData.buffer.length).toBe(0)
})

test('the end message carries the timings only, the UI works out mimeType from the head', async() => {
    const server = await startRawServer('HTTP/1.1 200 OK\r\nContent-Type: text/HTML; Charset=UTF-8\r\nContent-Length: 2\r\n\r\nok')
    const { events } = await collectRequestEvents(streamRequest('end-keys', `http://127.0.0.1:${server.port}/`))

    expect(Object.keys(events.at(-1).eventData).sort()).toEqual(['bodyTimeTaken', 'timeTaken'])
    expect(events[0].eventData.headers).toContainEqual(['content-type', 'text/HTML; Charset=UTF-8'])
})
