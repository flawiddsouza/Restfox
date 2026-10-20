import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { gunzipSync } from 'node:zlib'
import express from 'express'
import { addStreamingRoutes } from './streaming-routes.js'

let server
let baseUrl

before(async() => {
    const app = express()
    app.use(express.json())
    addStreamingRoutes(app)
    server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => {
    server.closeAllConnections()
    server.close()
})

// the raw body chunks as they arrive, with the ms since the request when each came, without decoding
function getChunks(path, { method = 'GET', headers = {}, body = null, stopAfterMs = null } = {}) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now()
        const req = request(`${baseUrl}${path}`, { method, headers }, res => {
            const chunks = []
            const times = []
            const finish = () => resolve({ status: res.statusCode, headers: res.headers, chunks, times, body: Buffer.concat(chunks) })
            res.on('data', chunk => {
                chunks.push(chunk)
                times.push(Date.now() - startedAt)
            })
            res.on('end', finish)
            if(stopAfterMs !== null) {
                setTimeout(() => {
                    req.destroy()
                    finish()
                }, stopAfterMs)
            }
        })
        req.on('error', error => {
            if(stopAfterMs === null) {
                reject(error)
            }
        })
        req.end(body)
    })
}

function sseData(text) {
    return text.split('\n\n').filter(event => event.startsWith('data: ')).map(event => event.slice('data: '.length))
}

function openAIText(dataLines) {
    return dataLines.filter(data => data !== '[DONE]').map(data => JSON.parse(data).choices[0].delta.content).join('')
}

test('GET /sse sends 20 OpenAI chunks over time, then [DONE]', async() => {
    const { status, headers, body, times } = await getChunks('/sse')
    assert.equal(status, 200)
    assert.match(headers['content-type'], /^text\/event-stream/)
    const data = sseData(body.toString())
    assert.equal(data.length, 21)
    assert.equal(data.at(-1), '[DONE]')
    assert.equal(openAIText(data), 'Streaming lets a client show each part of an answer as soon as the server sends it, not later.')
    assert.ok(times.at(-1) - times[0] >= 1500, `the body arrived over ${times.at(-1) - times[0]} ms`)
})

test('POST /sse needs Authorization: Bearer test', async() => {
    const refused = await getChunks('/sse', { method: 'POST' })
    assert.equal(refused.status, 401)
    const accepted = await getChunks('/sse', { method: 'POST', headers: { Authorization: 'Bearer test' } })
    assert.equal(accepted.status, 200)
    assert.equal(sseData(accepted.body.toString()).at(-1), '[DONE]')
})

test('the preflight allows Authorization by name', async() => {
    const { status, headers } = await getChunks('/sse', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
    })
    assert.equal(status, 204)
    assert.equal(headers['access-control-allow-origin'], '*')
    assert.equal(headers['access-control-allow-headers'], 'authorization,content-type')
})

test('/sse-endless keeps sending events and stops when the client goes away', async() => {
    const { status, body } = await getChunks('/sse-endless', { stopAfterMs: 1000 })
    assert.equal(status, 200)
    const events = body.toString().split('\n\n').filter(Boolean)
    assert.ok(events.length >= 2, `${events.length} events in 1 s`)
    assert.match(events[0], /^id: 1\nevent: tick\ndata: /)
})

test('/sse-gzip arrives compressed in more than one piece and unzips to the OpenAI stream', async() => {
    const { headers, chunks, body } = await getChunks('/sse-gzip', { headers: { 'Accept-Encoding': 'gzip' } })
    assert.equal(headers['content-encoding'], 'gzip')
    assert.ok(chunks.length > 5, `${chunks.length} pieces`)
    const data = sseData(gunzipSync(body).toString())
    assert.equal(data.at(-1), '[DONE]')
    assert.equal(openAIText(data), 'Streaming lets a client show each part of an answer as soon as the server sends it, not later.')
})

test('/ndjson sends 10 Ollama chat lines, the last one done', async() => {
    const { headers, body, times } = await getChunks('/ndjson')
    assert.equal(headers['content-type'], 'application/x-ndjson')
    const lines = body.toString().split('\n').filter(Boolean).map(line => JSON.parse(line))
    assert.equal(lines.length, 10)
    assert.equal(lines.at(-1).done, true)
    assert.equal(lines.map(line => line.message.content).join(''), 'Lines arrive one by one, each a JSON object.')
    assert.ok(times.at(-1) - times[0] >= 1500)
})

test('/chunked-json sends one JSON body in pieces over about 2 s', async() => {
    const { headers, chunks, body, times } = await getChunks('/chunked-json')
    assert.match(headers['content-type'], /^application\/json/)
    assert.ok(chunks.length > 1)
    assert.equal(JSON.parse(body.toString()).items.length, 40)
    assert.ok(times.at(-1) - times[0] >= 1500)
})

test('/slow-large sends a binary body slowly', async() => {
    const { headers, body, times } = await getChunks('/slow-large?size=1')
    assert.equal(headers['content-type'], 'application/octet-stream')
    assert.equal(body.length, 1024 * 1024)
    assert.equal(body[257], 1)
    assert.ok(times.at(-1) >= 300, `1 MB took ${times.at(-1)} ms`)
})

test('POST /mcp answers a JSON-RPC call as an event stream, with progress before the result', async() => {
    const call = (message) => getChunks('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify(message),
    })

    const initialize = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    assert.equal(initialize.headers['content-type'], 'text/event-stream')
    assert.equal(initialize.headers['mcp-session-id'], 'test-session')
    // a browser ignores Expose-Headers on the preflight, the response itself must name the session id
    assert.match(initialize.headers['access-control-expose-headers'], /Mcp-Session-Id/)
    const [initializeData] = sseData(initialize.body.toString().replaceAll('event: message\n', ''))
    assert.equal(JSON.parse(initializeData).result.serverInfo.name, 'restfox-test-api')

    const toolCall = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } })
    const messages = sseData(toolCall.body.toString().replaceAll('event: message\n', '')).map(data => JSON.parse(data))
    assert.deepEqual(messages.map(message => message.method ?? 'result'), ['notifications/progress', 'notifications/progress', 'result'])
    assert.equal(messages.at(-1).result.content[0].text, 'hi')

    const notification = await call({ jsonrpc: '2.0', method: 'notifications/initialized' })
    assert.equal(notification.status, 202)
})
