import net from 'net'
import http2 from 'http2'
import fs from 'fs'
import path from 'path'
import test from 'node:test'
import assert from 'node:assert/strict'
import app from './app.js'

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

// a bare TCP server that records the exact bytes the proxy sends upstream
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
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received: () => parseWireRequest(raw) }))
    })
}

function startHttp2Server() {
    const filesDir = path.join(import.meta.dirname, '..', 'test-api', 'files')
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
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received: () => receivedHeaders }))
    })
}

function listenApp() {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server))
    })
}

async function proxyRequest(proxy, { url, method = 'GET', headers = {}, body, disableSSLVerification = false }) {
    const proxyHeaders = {
        'x-proxy-req-url': url,
        'x-proxy-req-method': method,
        'x-proxy-flag-disable-ssl-verification': String(disableSSLVerification),
    }
    for(const [name, value] of Object.entries(headers)) {
        proxyHeaders[`x-proxy-req-header-${name}`] = value
    }
    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/proxy`, { method: 'POST', headers: proxyHeaders, body })
    return response.json()
}

test('proxy reports the upstream request headers exactly as sent for HTTP/1.1', async() => {
    const upstream = await startRawServer('HTTP/1.1 200 OK\r\nCONTENT-LENGTH:4\r\n\r\nBODY')
    const proxy = await listenApp()

    try {
        const result = await proxyRequest(proxy, {
            url: `http://127.0.0.1:${upstream.port}/path?x=1`,
            headers: { 'user-agent': 'Restfox/test' },
        })

        assert.equal(result.event, 'response')
        const wire = upstream.received()
        assert.equal(wire.requestLine, 'GET /path?x=1 HTTP/1.1')
        assert.ok(wire.headers.some(([name]) => name === 'connection'))
        assert.deepEqual(result.eventData.requestHeadersSent, wire.headers)
    } finally {
        proxy.close()
        upstream.server.close()
    }
})

// the proxy streams the body upstream without forwarding content-length, so undici sends it chunked
test('proxy reports the transfer-encoding added for a streamed request body', async() => {
    const upstream = await startRawServer('HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok')
    const proxy = await listenApp()

    try {
        const result = await proxyRequest(proxy, {
            url: `http://127.0.0.1:${upstream.port}/submit`,
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: 'hello',
        })

        assert.equal(result.event, 'response')
        const wire = upstream.received()
        assert.ok(wire.headers.some(([name, value]) => name === 'transfer-encoding' && value === 'chunked'))
        assert.deepEqual(result.eventData.requestHeadersSent, wire.headers)
    } finally {
        proxy.close()
        upstream.server.close()
    }
})

test('proxy reports the header block sent on an HTTP/2 connection', async() => {
    const upstream = await startHttp2Server()
    const proxy = await listenApp()

    try {
        const result = await proxyRequest(proxy, {
            url: `https://localhost:${upstream.port}/h2`,
            headers: { 'user-agent': 'Restfox/test' },
            disableSSLVerification: true,
        })

        assert.equal(result.event, 'response')
        const received = upstream.received()
        assert.equal(received[':path'], '/h2')
        const sent = Object.fromEntries(result.eventData.requestHeadersSent)
        assert.equal(sent[':path'], '/h2')
        assert.equal(sent[':method'], 'GET')
        for(const [name, value] of Object.entries(received)) {
            if(name.startsWith(':') || ['user-agent', 'accept', 'accept-encoding', 'accept-language', 'sec-fetch-mode'].includes(name)) {
                assert.equal(sent[name], value, `header ${name}`)
            }
        }
    } finally {
        proxy.close()
        upstream.server.close()
    }
})
