import { createGzip, constants as zlibConstants } from 'zlib'

// Responses that arrive over time, to check the live response view: event streams shaped like LLM APIs, JSON lines,
// a JSON body sent in pieces and a slow binary download. Each route stops writing when the client goes away.

// 19 words, the text of /sse and /sse-gzip
const SSE_ANSWER_WORDS = 'Streaming lets a client show each part of an answer as soon as the server sends it, not later.'.split(' ')
// 9 words, the text of /ndjson
const NDJSON_ANSWER_WORDS = 'Lines arrive one by one, each a JSON object.'.split(' ')

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// a response that gets written over time, and whether the client has gone away
function startTimedResponse(res, status, headers) {
    const state = { closed: false }
    res.on('close', () => {
        state.closed = true
    })
    res.writeHead(status, {
        'Cache-Control': 'no-cache',
        ...headers,
    })
    res.flushHeaders()
    return state
}

function openAIChunk(index, content, finishReason = null) {
    return {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1700000000,
        model: 'gpt-test',
        choices: [{ index: 0, delta: index === 0 ? { role: 'assistant', content } : { content }, finish_reason: finishReason }],
    }
}

// the answer split into 20 chunks, the last one empty with finish_reason stop, as OpenAI ends a stream
function openAIChunks() {
    return [
        ...SSE_ANSWER_WORDS.map((word, index) => openAIChunk(index, (index === 0 ? '' : ' ') + word)),
        openAIChunk(19, '', 'stop'),
    ]
}

async function sendOpenAIStream(req, res) {
    const response = startTimedResponse(res, 200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
    for(const chunk of openAIChunks()) {
        if(response.closed) {
            return
        }
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        await sleep(100)
    }
    if(!response.closed) {
        res.end('data: [DONE]\n\n')
    }
}

export function addStreamingRoutes(app) {
    // a browser preflight does not count Authorization in Access-Control-Allow-Headers: *, so it is named here
    app.options(['/sse', '/sse-endless', '/sse-gzip', '/ndjson', '/chunked-json', '/slow-large', '/mcp'], (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*')
        res.sendStatus(204)
    })

    // an OpenAI chat completion stream: 20 chunks 100 ms apart, then data: [DONE]
    app.get('/sse', sendOpenAIStream)

    // the same stream for a POST, which needs Authorization: Bearer test, as an API key would
    app.post('/sse', (req, res) => {
        if(req.headers.authorization !== 'Bearer test') {
            res.status(401).send({ error: { message: 'Send Authorization: Bearer test', type: 'invalid_request_error' } })
            return
        }
        sendOpenAIStream(req, res)
    })

    // an event that never ends: a numbered event every 300 ms and a keepalive comment every 2 s
    app.get('/sse-endless', (req, res) => {
        startTimedResponse(res, 200, { 'Content-Type': 'text/event-stream' })
        let count = 0
        const eventTimer = setInterval(() => {
            count++
            res.write(`id: ${count}\nevent: tick\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `tick ${count} ` } }] })}\n\n`)
        }, 300)
        const keepaliveTimer = setInterval(() => {
            res.write(': keepalive\n\n')
        }, 2000)
        res.on('close', () => {
            clearInterval(eventTimer)
            clearInterval(keepaliveTimer)
        })
    })

    // the OpenAI stream gzip-compressed, each event flushed through the compressor so it still arrives as sent
    app.get('/sse-gzip', async(req, res) => {
        const response = startTimedResponse(res, 200, {
            'Content-Type': 'text/event-stream',
            'Content-Encoding': 'gzip',
        })
        const gzip = createGzip()
        gzip.pipe(res)
        res.on('close', () => gzip.destroy())
        for(const chunk of openAIChunks()) {
            if(response.closed) {
                return
            }
            gzip.write(`data: ${JSON.stringify(chunk)}\n\n`)
            gzip.flush(zlibConstants.Z_SYNC_FLUSH)
            await sleep(100)
        }
        if(!response.closed) {
            gzip.end('data: [DONE]\n\n')
        }
    })

    // an Ollama /api/chat stream: 10 JSON lines 200 ms apart, the last one with done: true
    app.get('/ndjson', async(req, res) => {
        const response = startTimedResponse(res, 200, { 'Content-Type': 'application/x-ndjson' })
        for(let index = 0; index < 10; index++) {
            if(response.closed) {
                return
            }
            const done = index === 9
            const line = {
                model: 'llama-test',
                created_at: new Date().toISOString(),
                message: { role: 'assistant', content: done ? '' : (index === 0 ? '' : ' ') + NDJSON_ANSWER_WORDS[index] },
                done,
                ...(done ? { done_reason: 'stop', total_duration: 1800000000, eval_count: 9 } : {}),
            }
            res.write(JSON.stringify(line) + '\n')
            if(!done) {
                await sleep(200)
            }
        }
        res.end()
    })

    // a plain JSON body written in pieces over 2 s, as a slow API would send it
    app.get('/chunked-json', async(req, res) => {
        const response = startTimedResponse(res, 200, { 'Content-Type': 'application/json; charset=utf-8' })
        const body = JSON.stringify({
            items: Array.from({ length: 40 }, (_, index) => ({ id: index + 1, name: `Item ${index + 1}` })),
        }, null, 4)
        const pieces = 10
        const pieceLength = Math.ceil(body.length / pieces)
        for(let index = 0; index < pieces; index++) {
            if(response.closed) {
                return
            }
            res.write(body.slice(index * pieceLength, (index + 1) * pieceLength))
            if(index < pieces - 1) {
                await sleep(2000 / (pieces - 1))
            }
        }
        res.end()
    })

    // 20 MB of binary at about 2 MB/s, ?size=<MB> changes the size
    app.get('/slow-large', async(req, res) => {
        const sizeInMB = parseInt(req.query.size) || 20
        const totalBytes = sizeInMB * 1024 * 1024
        const response = startTimedResponse(res, 200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': totalBytes,
        })
        // 200 KB every 100 ms
        const pieceBytes = 200 * 1024
        let sent = 0
        while(sent < totalBytes && !response.closed) {
            const length = Math.min(pieceBytes, totalBytes - sent)
            const piece = Buffer.alloc(length)
            for(let index = 0; index < length; index++) {
                piece[index] = (sent + index) % 256
            }
            sent += length
            if(!res.write(piece)) {
                await new Promise(resolve => {
                    res.once('drain', resolve)
                    res.once('close', resolve)
                })
            }
            await sleep(100)
        }
        if(!response.closed) {
            res.end()
        }
    })

    // an MCP server over Streamable HTTP: a JSON-RPC POST answered as an event stream, tools/call sends two progress
    // notifications before its result
    app.post('/mcp', async(req, res) => {
        const message = req.body ?? {}
        if(message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
            res.status(400).send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } })
            return
        }

        // a notification gets no answer
        if(message.id === undefined) {
            res.status(202).end()
            return
        }

        let result = {}
        const notifications = []
        if(message.method === 'initialize') {
            result = {
                protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'restfox-test-api', version: '1.0.0' },
            }
        } else if(message.method === 'tools/list') {
            result = { tools: [{ name: 'echo', description: 'Returns its text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] }
        } else if(message.method === 'tools/call') {
            const progressToken = message.params?._meta?.progressToken ?? 'progress'
            notifications.push(
                { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress: 1, total: 2 } },
                { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress: 2, total: 2 } },
            )
            result = { content: [{ type: 'text', text: String(message.params?.arguments?.text ?? '') }] }
        } else {
            res.status(200).send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
            return
        }

        const response = startTimedResponse(res, 200, {
            'Content-Type': 'text/event-stream',
            'Mcp-Session-Id': 'test-session',
            // a browser reads the session id only when the response itself exposes it
            'Access-Control-Expose-Headers': 'Content-Disposition, Mcp-Session-Id',
        })
        for(const notification of notifications) {
            if(response.closed) {
                return
            }
            res.write(`event: message\ndata: ${JSON.stringify(notification)}\n\n`)
            await sleep(200)
        }
        if(!response.closed) {
            res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`)
        }
    })
}
