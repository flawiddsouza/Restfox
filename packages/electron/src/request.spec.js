import { test, expect, afterEach } from 'vitest'
import net from 'node:net'
import http2 from 'node:http2'
import fs from 'node:fs'
import path from 'node:path'
import { handleSendRequest } from './request.js'

const servers = []

afterEach(() => {
    for(const server of servers.splice(0)) {
        server.close()
    }
})

// splits a raw HTTP/1.1 request into its request line, header pairs and body
function parseWireRequest(raw) {
    const headerEnd = raw.indexOf('\r\n\r\n')
    const [requestLine, ...headerLines] = raw.slice(0, headerEnd).split('\r\n')
    const headers = headerLines.map(line => {
        const separator = line.indexOf(': ')
        return [line.slice(0, separator), line.slice(separator + 2)]
    })
    return { requestLine, headers, body: raw.slice(headerEnd + 4) }
}

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
