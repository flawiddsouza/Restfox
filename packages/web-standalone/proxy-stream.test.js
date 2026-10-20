import { once } from 'events'
import http from 'http'
import net from 'net'
import { randomBytes } from 'crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import app from './app.js'
import { encodeProxyFrame, PROXY_FRAMES_CONTENT_TYPE } from './src/proxy-frames.js'

function listenServer(server) {
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve(server))
    })
}

function listenApp() {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server))
    })
}

function closeServer(server) {
    server.closeAllConnections?.()
    server.close()
}

// the proxy first, so it sees its client go away before the upstream closes, which it would log as an upstream failure
async function closeServers(proxy, upstream) {
    closeServer(proxy)
    await delay(20)
    closeServer(upstream)
}

function failAfter(ms, what = 'it') {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out after ${ms} ms waiting for ${what}`)), ms).unref()
    })
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// every byte value, so a decoding step anywhere on the way would change some of them
const ALL_BYTE_VALUES = Buffer.from(Array.from({ length: 256 }, (_, i) => i))

// reads [type: uint8][length: uint32 big-endian][payload] frames from chunks split anywhere
function createFrameDecoder() {
    let pending = Buffer.alloc(0)
    return {
        push(chunk) {
            pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk])
            const frames = []
            while(pending.length >= 5) {
                const length = pending.readUInt32BE(1)
                if(pending.length < 5 + length) {
                    break
                }
                frames.push({ type: pending[0], payload: Buffer.from(pending.subarray(5, 5 + length)) })
                pending = pending.subarray(5 + length)
            }
            return frames
        },
        get pendingBytes() {
            return pending.length
        },
    }
}

function decodeFrames(bytes) {
    const decoder = createFrameDecoder()
    const frames = decoder.push(bytes)
    assert.equal(decoder.pendingBytes, 0, 'the reply ends on a frame boundary')
    return frames
}

function frameJson(frame) {
    return JSON.parse(frame.payload.toString('utf8'))
}

function dataOf(frames) {
    return Buffer.concat(frames.filter(frame => frame.type === 2).map(frame => frame.payload))
}

// POSTs to /proxy and resolves with the reply as it starts. onFrame sees each frame as it arrives
function proxyRequest(proxy, headers, { onFrame, method = 'POST' } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port: proxy.address().port,
            path: '/proxy',
            method,
            headers,
        }, res => {
            const decoder = createFrameDecoder()
            const chunks = []
            const frames = []
            const done = new Promise((resolveDone, rejectDone) => {
                res.on('data', chunk => {
                    chunks.push(chunk)
                    for(const frame of decoder.push(chunk)) {
                        frames.push(frame)
                        onFrame?.(frame)
                    }
                })
                res.on('end', () => resolveDone({ raw: Buffer.concat(chunks), frames, pendingBytes: decoder.pendingBytes }))
                res.on('error', rejectDone)
                res.on('aborted', () => rejectDone(new Error('aborted')))
            })
            // a test that does not wait for the end leaves the rejection of a closed reply unhandled
            done.catch(() => {})
            resolve({ req, res, frames, done })
        })
        req.on('error', reject)
        req.end()
    })
}

function streamHeaders(url, extra = {}) {
    return {
        'x-proxy-req-url': url,
        'x-proxy-req-method': 'GET',
        'x-proxy-flag-disable-ssl-verification': 'false',
        'x-proxy-flag-stream': '1',
        ...extra,
    }
}

// resolves once a frame matching the test has arrived
function waitForFrame(frames, matches, ms, what) {
    return Promise.race([
        (async() => {
            while(!frames.some(matches)) {
                await delay(5)
            }
            return frames.find(matches)
        })(),
        failAfter(ms, what),
    ])
}

test('encodeProxyFrame writes the type, a big-endian uint32 length and the payload', () => {
    assert.deepEqual(encodeProxyFrame(2, ALL_BYTE_VALUES), Buffer.concat([Buffer.from([2, 0, 0, 1, 0]), ALL_BYTE_VALUES]))
    assert.deepEqual(encodeProxyFrame(3, new Uint8Array(0)), Buffer.from([3, 0, 0, 0, 0]))

    // a length past 16 bits, and a payload that is a view into a larger buffer
    const large = randomBytes(70000 + 10)
    const frame = encodeProxyFrame(2, large.subarray(10))
    assert.deepEqual(frame.subarray(0, 5), Buffer.from([2, 0x00, 0x01, 0x11, 0x70]))
    assert.deepEqual(frame.subarray(5), large.subarray(10))
})

test('a flagged proxy request sends head and data frames while the upstream body is still open', async() => {
    const upstream = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'x-custom': 'Value' })
        res.write('data: one\n\n')
    })

    await listenServer(upstream)
    const proxy = await listenApp()

    try {
        const { res, frames } = await Promise.race([
            proxyRequest(proxy, streamHeaders(`http://127.0.0.1:${upstream.address().port}/sse`)),
            failAfter(1000, 'the reply head'),
        ])

        assert.equal(res.statusCode, 200)
        assert.equal(res.headers['content-type'], PROXY_FRAMES_CONTENT_TYPE)
        assert.equal(res.headers['cache-control'], 'no-cache, no-transform')
        assert.equal(res.headers['x-accel-buffering'], 'no')

        await waitForFrame(frames, frame => frame.type === 2, 1000, 'a data frame')

        assert.equal(frames[0].type, 1)
        const head = frameJson(frames[0])
        assert.deepEqual(Object.keys(head), ['status', 'statusText', 'headers', 'headTimeTaken', 'requestHeadersSent'])
        assert.equal(head.status, 200)
        assert.equal(head.statusText, 'OK')
        assert.deepEqual(head.headers.find(([name]) => name === 'x-custom'), ['x-custom', 'Value'])
        assert.equal(typeof head.headTimeTaken, 'number')
        assert.ok(Array.isArray(head.requestHeadersSent))

        assert.equal(frames[1].type, 2)
        assert.equal(frames[1].payload.toString('utf8'), 'data: one\n\n')
    } finally {
        await closeServers(proxy, upstream)
    }
})

test('data frames carry every byte value exactly, while the upstream body is open and after it ends', async() => {
    let upstreamRes
    const upstream = http.createServer((req, res) => {
        upstreamRes = res
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.write(ALL_BYTE_VALUES)
    })

    await listenServer(upstream)
    const proxy = await listenApp()

    try {
        const { frames, done } = await proxyRequest(proxy, streamHeaders(`http://127.0.0.1:${upstream.address().port}/bytes`))

        await Promise.race([
            (async() => {
                while(dataOf(frames).length < 256) {
                    await delay(5)
                }
            })(),
            failAfter(1000, 'the first 256 bytes'),
        ])
        assert.deepEqual(dataOf(frames), ALL_BYTE_VALUES)
        assert.ok(!frames.some(frame => frame.type === 3), 'no end frame while upstream is open')

        // the same bytes reversed, so each value also lands at a different offset
        const reversed = Buffer.from(ALL_BYTE_VALUES).reverse()
        upstreamRes.end(reversed)

        const { raw, pendingBytes } = await Promise.race([done, failAfter(1000, 'the reply to end')])
        assert.equal(pendingBytes, 0)

        const allFrames = decodeFrames(raw)
        assert.deepEqual(allFrames.map(frame => frame.type).filter((type, i, types) => type !== types[i - 1]), [1, 2, 3])
        assert.deepEqual(dataOf(allFrames), Buffer.concat([ALL_BYTE_VALUES, reversed]))
        assert.ok(allFrames.every(frame => frame.type !== 2 || frame.payload.length > 0), 'no empty data frame')

        const end = frameJson(allFrames.at(-1))
        assert.deepEqual(Object.keys(end), ['timeTaken', 'bodyTimeTaken'])
        assert.ok(end.timeTaken >= end.bodyTimeTaken)
    } finally {
        await closeServers(proxy, upstream)
    }
})

test('a multi-megabyte binary body arrives byte-exact, and a client that stops reading holds back the upstream', async() => {
    const total = 64 * 1024 * 1024
    const body = randomBytes(total)
    let upstreamWritten = 0
    let upstreamDone = false

    const upstream = http.createServer(async(req, res) => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        for(let offset = 0; offset < total; offset += 65536) {
            const chunk = body.subarray(offset, offset + 65536)
            upstreamWritten += chunk.length
            if(!res.write(chunk)) {
                await once(res, 'drain')
            }
        }
        res.end()
        upstreamDone = true
    })

    await listenServer(upstream)
    const proxy = await listenApp()

    try {
        const { res, done } = await proxyRequest(proxy, streamHeaders(`http://127.0.0.1:${upstream.address().port}/large`))

        // stop reading for a while: the proxy must wait for drain instead of reading the whole upstream into memory
        // (socket buffers alone hold several megabytes on Windows loopback)
        res.pause()
        await delay(1000)
        assert.ok(!upstreamDone, 'upstream finished while the client was not reading')
        assert.ok(upstreamWritten < 16 * 1024 * 1024, `upstream wrote ${upstreamWritten} of ${total} bytes while the client was not reading`)
        res.resume()

        const { raw } = await Promise.race([done, failAfter(30000, 'the reply to end')])
        const frames = decodeFrames(raw)
        assert.equal(frames[0].type, 1)
        assert.equal(frames.at(-1).type, 3)
        assert.ok(dataOf(frames).equals(body), 'the body arrived byte-exact')
    } finally {
        await closeServers(proxy, upstream)
    }
})

test('the frames reply decodes the same when it arrives split at any byte boundary', async() => {
    const upstream = http.createServer(async(req, res) => {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        for(const line of ['{"a":1}\n', ALL_BYTE_VALUES, '{"b":2}\n']) {
            res.write(line)
            await delay(20)
        }
        res.end()
    })

    await listenServer(upstream)
    const proxy = await listenApp()

    try {
        const { done } = await proxyRequest(proxy, streamHeaders(`http://127.0.0.1:${upstream.address().port}/ndjson`))
        const { raw } = await Promise.race([done, failAfter(2000, 'the reply to end')])
        const expected = decodeFrames(raw)
        assert.ok(expected.filter(frame => frame.type === 2).length >= 3, 'each upstream chunk is its own data frame')

        // one split at every offset
        for(let split = 0; split <= raw.length; split++) {
            const decoder = createFrameDecoder()
            const frames = [...decoder.push(raw.subarray(0, split)), ...decoder.push(raw.subarray(split))]
            assert.deepEqual(frames, expected, `split at ${split}`)
            assert.equal(decoder.pendingBytes, 0)
        }

        // a byte at a time, and random sizes
        for(const sizes of [() => 1, () => 1 + Math.floor(Math.random() * 13)]) {
            const decoder = createFrameDecoder()
            const frames = []
            for(let offset = 0; offset < raw.length;) {
                const size = sizes()
                frames.push(...decoder.push(raw.subarray(offset, offset + size)))
                offset += size
            }
            assert.deepEqual(frames, expected)
        }
    } finally {
        await closeServers(proxy, upstream)
    }
})

test('a client abort mid-body closes the upstream connection and logs nothing', async t => {
    const consoleError = t.mock.method(console, 'error', () => {})
    let upstreamClosedResolve
    const upstreamClosed = new Promise(resolve => {
        upstreamClosedResolve = resolve
    })

    const upstream = http.createServer((req, res) => {
        req.socket.on('close', upstreamClosedResolve)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: pending\n\n')
    })

    await listenServer(upstream)
    const proxy = await listenApp()

    try {
        const { req, frames } = await proxyRequest(proxy, streamHeaders(`http://127.0.0.1:${upstream.address().port}/sse`))
        await waitForFrame(frames, frame => frame.type === 2, 1000, 'a data frame')

        req.destroy()

        await Promise.race([upstreamClosed, failAfter(1000, 'the upstream connection to close')])
        await delay(50)
        assert.equal(consoleError.mock.callCount(), 0)
    } finally {
        await closeServers(proxy, upstream)
    }
})

test('the request timeout covers the body: an open body ends with a timed out error frame and closes upstream', async t => {
    const consoleError = t.mock.method(console, 'error', () => {})
    let upstreamClosedResolve
    const upstreamClosed = new Promise(resolve => {
        upstreamClosedResolve = resolve
    })

    const upstream = http.createServer((req, res) => {
        req.socket.on('close', upstreamClosedResolve)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: kept\n\n')
    })

    await listenServer(upstream)
    const proxy = await listenApp()

    try {
        const startTime = Date.now()
        const { done } = await proxyRequest(proxy, streamHeaders(`http://127.0.0.1:${upstream.address().port}/sse`, { 'x-proxy-flag-timeout': '300' }))
        const { raw } = await Promise.race([done, failAfter(2000, 'the reply to end')])
        assert.ok(Date.now() - startTime >= 290, 'the timeout counts from the start of the request')

        const frames = decodeFrames(raw)
        assert.deepEqual(frames.map(frame => frame.type), [1, 2, 4])
        assert.equal(frames[1].payload.toString('utf8'), 'data: kept\n\n')
        assert.deepEqual(frameJson(frames[2]), { message: 'Request timed out after 300 ms', timedOut: true })

        await Promise.race([upstreamClosed, failAfter(1000, 'the upstream connection to close')])
        assert.equal(consoleError.mock.callCount(), 0)
    } finally {
        await closeServers(proxy, upstream)
    }
})

test('the request timeout also ends a reply held back by a client that stopped reading', async t => {
    const consoleError = t.mock.method(console, 'error', () => {})
    const body = randomBytes(64 * 1024 * 1024)
    const upstream = http.createServer(async(req, res) => {
        const closed = new AbortController()
        res.on('close', () => closed.abort())
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        for(let offset = 0; offset < body.length && !res.destroyed; offset += 65536) {
            if(!res.write(body.subarray(offset, offset + 65536))) {
                await once(res, 'drain', { signal: closed.signal }).catch(() => {})
            }
        }
        res.end()
    })

    await listenServer(upstream)
    const proxy = await listenApp()

    try {
        const { res, done } = await proxyRequest(proxy, streamHeaders(`http://127.0.0.1:${upstream.address().port}/large`, { 'x-proxy-flag-timeout': '300' }))
        res.pause()
        await delay(800)
        res.resume()

        const { raw } = await Promise.race([done, failAfter(5000, 'the reply to end')])
        const frames = decodeFrames(raw)
        assert.equal(frames[0].type, 1)
        assert.deepEqual(frameJson(frames.at(-1)), { message: 'Request timed out after 300 ms', timedOut: true })
        assert.ok(frames.slice(1, -1).every(frame => frame.type === 2))

        // what arrived is the start of the body, byte-exact
        const data = dataOf(frames)
        assert.ok(data.length > 0 && data.length < body.length)
        assert.ok(data.equals(body.subarray(0, data.length)))
        assert.equal(consoleError.mock.callCount(), 0)
    } finally {
        await closeServers(proxy, upstream)
    }
})

test('the request timeout does not fire for a body that ends in time', async() => {
    const upstream = http.createServer(async(req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.write('a')
        await delay(50)
        res.end('b')
    })

    await listenServer(upstream)
    const proxy = await listenApp()

    try {
        const { done } = await proxyRequest(proxy, streamHeaders(`http://127.0.0.1:${upstream.address().port}/`, { 'x-proxy-flag-timeout': '2000' }))
        const { raw } = await Promise.race([done, failAfter(2000, 'the reply to end')])
        const frames = decodeFrames(raw)
        assert.equal(frames.at(-1).type, 3)
        assert.equal(dataOf(frames).toString('utf8'), 'ab')
    } finally {
        await closeServers(proxy, upstream)
    }
})

test('an upstream reset mid-body ends the frames with an error that did not time out', async t => {
    const consoleError = t.mock.method(console, 'error', () => {})
    const upstream = net.createServer(socket => {
        socket.once('data', async() => {
            socket.write('HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n')
            socket.write('b\r\ndata: one\n\n\r\n')
            await delay(50)
            socket.resetAndDestroy()
        })
    })

    await listenServer(upstream)
    const proxy = await listenApp()

    try {
        const { done } = await proxyRequest(proxy, streamHeaders(`http://127.0.0.1:${upstream.address().port}/sse`))
        const { raw } = await Promise.race([done, failAfter(2000, 'the reply to end')])

        const frames = decodeFrames(raw)
        assert.deepEqual(frames.map(frame => frame.type), [1, 2, 4])
        assert.equal(frames[1].payload.toString('utf8'), 'data: one\n\n')
        const error = frameJson(frames[2])
        assert.deepEqual(Object.keys(error), ['message', 'timedOut'])
        assert.equal(error.timedOut, false)
        assert.ok(error.message.length > 0)

        // the reason stays in the server log, as for a request that fails before its head
        assert.equal(consoleError.mock.callCount(), 1)
        assert.equal(consoleError.mock.calls[0].arguments[0], 'proxy error:')
    } finally {
        await closeServers(proxy, upstream)
    }
})

test('a flagged response without a body sends head and end only', async() => {
    const upstream = http.createServer((req, res) => {
        res.writeHead(204)
        res.end()
    })

    await listenServer(upstream)
    const proxy = await listenApp()

    try {
        const { done } = await proxyRequest(proxy, streamHeaders(`http://127.0.0.1:${upstream.address().port}/`))
        const { raw } = await Promise.race([done, failAfter(2000, 'the reply to end')])
        const frames = decodeFrames(raw)
        assert.deepEqual(frames.map(frame => frame.type), [1, 3])
        assert.equal(frameJson(frames[0]).status, 204)
    } finally {
        await closeServers(proxy, upstream)
    }
})

test('before the upstream head a flagged request still gets the JSON replies', async t => {
    t.mock.method(console, 'error', () => {})
    const proxy = await listenApp()

    try {
        const notFound = await proxyRequest(proxy, streamHeaders('http://127.0.0.1:1/', { 'x-proxy-flag-ca-certificates-id': 'not-registered' }))
        assert.equal(notFound.res.headers['content-type'], 'application/json; charset=utf-8')
        assert.equal((await notFound.done).raw.toString('utf8'), '{"event":"caCertificatesNotFound"}')

        const dnsFailure = await proxyRequest(proxy, streamHeaders('http://restfox-proxy-stream-test.invalid/'))
        assert.equal(dnsFailure.res.headers['content-type'], 'application/json; charset=utf-8')
        const reply = JSON.parse((await dnsFailure.done).raw.toString('utf8'))
        assert.deepEqual(Object.keys(reply), ['event', 'eventData'])
        assert.equal(reply.event, 'responseError')
        assert.match(reply.eventData, /restfox-proxy-stream-test\.invalid/)
    } finally {
        closeServer(proxy)
    }
})

test('without the flag a response gets the JSON envelope, byte for byte as before', async() => {
    const sse = 'data: one\n\ndata: two\n\n'
    const upstream = http.createServer((req, res) => {
        if(req.url === '/bytes') {
            res.writeHead(200, { 'content-type': 'text/HTML; Charset=UTF-8' })
            res.end(ALL_BYTE_VALUES)
            return
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(sse)
    })

    await listenServer(upstream)
    const proxy = await listenApp()

    try {
        // no flag, and a flag value other than 1, which older or other clients might send
        for(const [path, flag, body] of [['/sse', undefined, Buffer.from(sse)], ['/bytes', undefined, ALL_BYTE_VALUES], ['/sse', 'true', Buffer.from(sse)]]) {
            const headers = streamHeaders(`http://127.0.0.1:${upstream.address().port}${path}`)
            delete headers['x-proxy-flag-stream']
            if(flag !== undefined) {
                headers['x-proxy-flag-stream'] = flag
            }

            const { res, done } = await proxyRequest(proxy, headers)
            const raw = (await done).raw.toString('utf8')
            assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
            assert.equal(res.headers['content-length'], String(Buffer.byteLength(raw)))

            // rebuilt in the order the reply has always used, only the timings and sent headers taken from the reply
            const { eventData } = JSON.parse(raw)
            const upstreamHeaders = eventData.headers
            assert.deepEqual(upstreamHeaders.find(([name]) => name === 'content-type'), ['content-type', path === '/bytes' ? 'text/HTML; Charset=UTF-8' : 'text/event-stream'])
            assert.equal(raw, JSON.stringify({
                event: 'response',
                eventData: {
                    status: 200,
                    statusText: 'OK',
                    headers: upstreamHeaders,
                    mimeType: path === '/bytes' ? 'text/html;charset=utf-8' : 'text/event-stream',
                    buffer: Array.from(body),
                    timeTaken: eventData.timeTaken,
                    headTimeTaken: eventData.headTimeTaken,
                    bodyTimeTaken: eventData.bodyTimeTaken,
                    requestHeadersSent: eventData.requestHeadersSent,
                },
            }))
        }
    } finally {
        await closeServers(proxy, upstream)
    }
})

test('the head frame has the same headers as the JSON envelope for any content type, the UI works out mimeType from them', async() => {
    const contentTypes = ['text/HTML; Charset=UTF-8', 'garbage', null, 'application/json; charset="utf-8"; x=1', 'text/plain, application/json']
    const upstream = http.createServer((req, res) => {
        const contentType = contentTypes[Number(req.url.slice(1))]
        res.writeHead(200, contentType === null ? {} : { 'content-type': contentType })
        res.end('x')
    })

    await listenServer(upstream)
    const proxy = await listenApp()

    try {
        for(let i = 0; i < contentTypes.length; i++) {
            const url = `http://127.0.0.1:${upstream.address().port}/${i}`
            const headers = streamHeaders(url)
            delete headers['x-proxy-flag-stream']

            const envelope = JSON.parse((await (await proxyRequest(proxy, headers)).done).raw.toString('utf8'))
            const frames = decodeFrames((await (await proxyRequest(proxy, streamHeaders(url))).done).raw)

            assert.deepEqual(frameJson(frames[0]).headers, envelope.eventData.headers, `content type ${contentTypes[i]}`)
        }
    } finally {
        await closeServers(proxy, upstream)
    }
})
