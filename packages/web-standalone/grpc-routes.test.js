import fs from 'fs'
import path from 'path'
import net from 'net'
import test from 'node:test'
import assert from 'node:assert/strict'
import grpc from '@grpc/grpc-js'
import protobuf from 'protobufjs'
import { randomUUID } from 'crypto'
import app from './app.js'
import { startForwardProxy } from './test-forward-proxy.js'
import { startServer } from '../test-api-grpc/server.js'

const filesDir = path.join(import.meta.dirname, '..', 'test-api', 'files')

test('gRPC routes accept a 60 MB message, later stream message and proto file set', async() => {
    const text = 'syntax="proto3"; package large; service Raw { rpc Unary(Message) returns(Message); rpc Stream(stream Message) returns(stream Message); } message Message { string text = 1; }'
    const type = protobuf.parse(text).root.lookupType('large.Message')
    const server = new grpc.Server({ 'grpc.max_receive_message_length': -1, 'grpc.max_send_message_length': -1 })
    const received = []
    const passBuffer = buffer => buffer
    const method = (name, stream) => ({ path: `/large.Raw/${name}`, requestStream: stream, responseStream: stream, requestSerialize: passBuffer, requestDeserialize: passBuffer, responseSerialize: passBuffer, responseDeserialize: passBuffer })
    const reply = Buffer.from(type.encode({ text: 'accepted' }).finish())
    server.addService({ Unary: method('Unary', false), Stream: method('Stream', true) }, {
        Unary(call, callback) {
            received.push(type.decode(call.request).text.length)
            callback(null, reply)
        },
        Stream(call) {
            call.on('data', buffer => {
                received.push(type.decode(buffer).text.length)
                call.write(reply)
            })
            call.on('end', () => call.end())
        },
    })
    const port = await new Promise((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, boundPort) => error ? reject(error) : resolve(boundPort)))
    const appServer = await listenApp()
    const largeSize = 60 * 1024 * 1024
    const spec = { target: plaintextTarget(port), service: 'large.Raw', protoFiles: [{ path: 'large.proto', text }] }
    try {
        const unary = await startCall(appServer, { ...spec, method: 'Unary', messages: [JSON.stringify({ text: 'x'.repeat(largeSize) })] })
        assert.equal(unary.response.status, 200)
        assert.equal(unary.response.headers.get('content-type'), 'application/x-ndjson', unary.response.headers.get('content-type') === 'application/x-ndjson' ? '' : await unary.response.text())
        assert.equal((await readEvents(unary.response).untilEnd()).at(-1).name, 'OK')
        const stream = await startCall(appServer, { ...spec, method: 'Stream' })
        const reader = readEvents(stream.response)
        assert.equal((await post(appServer, `/grpc/call/${stream.callId}/send`, { json: JSON.stringify({ text: 'x'.repeat(largeSize) }) })).status, 200)
        await post(appServer, `/grpc/call/${stream.callId}/end`, {})
        assert.equal((await reader.untilEnd()).at(-1).name, 'OK')
        const proto = await startCall(appServer, { ...spec, method: 'Unary', messages: ['{"text":"small"}'], protoFiles: [{ path: 'large.proto', text: `${text}\n/*${'x'.repeat(largeSize)}*/` }] })
        assert.equal(proto.response.status, 200)
        assert.equal((await readEvents(proto.response).untilEnd()).at(-1).name, 'OK')
        assert.deepEqual(received, [largeSize, largeSize, 5])
    } finally {
        closeServer(appServer)
        server.forceShutdown()
    }
})

function listenApp() {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server))
    })
}

function closeServer(server) {
    server.closeAllConnections()
    server.close()
}

function post(appServer, route, body) {
    return fetch(`http://127.0.0.1:${appServer.address().port}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })
}

function plaintextTarget(port, host = '127.0.0.1') {
    return { address: `${host}:${port}`, host, port, tls: false }
}

// the reply's events as they arrive, next() waits for the next one
function readEvents(response) {
    const events = []
    const waiting = []
    let closed = false

    ;(async() => {
        const decoder = new TextDecoder()
        let pending = ''
        try {
            for await (const chunk of response.body) {
                const lines = (pending + decoder.decode(chunk, { stream: true })).split('\n')
                pending = lines.pop()
                for(const line of lines.filter(line => line !== '')) {
                    events.push(JSON.parse(line))
                    waiting.shift()?.()
                }
            }
        } catch {}
        closed = true
        waiting.splice(0).forEach(resolve => resolve())
    })()

    let taken = 0

    return {
        events,
        async next() {
            while(taken >= events.length) {
                if(closed) {
                    throw new Error(`the reply closed after ${JSON.stringify(events)}`)
                }
                await new Promise(resolve => waiting.push(resolve))
            }
            return events[taken++]
        },
        async untilEnd() {
            while(!closed) {
                await new Promise(resolve => waiting.push(resolve))
            }
            return events
        },
    }
}

async function startCall(appServer, spec) {
    const callId = randomUUID()
    const response = await post(appServer, '/grpc/call', { metadata: [], protoFiles: null, deadlineMs: 0, messages: [], disableSSLVerification: false, ...spec, callId })
    return { callId, response }
}

test('/grpc/schema loads the services by server reflection, and names a server without it by its code', async() => {
    const grpcServer = await startServer({ reflection: true })
    const grpcServerWithoutReflection = await startServer({ reflection: false })
    const appServer = await listenApp()

    try {
        const reply = await (await post(appServer, '/grpc/schema', { target: plaintextTarget(grpcServer.port), metadata: [], protoFiles: null })).json()
        const demo = reply.schema.services.find(service => service.name === 'demo.v1.Demo')
        assert.equal(reply.schema.source, 'reflection')
        assert.deepEqual(demo.methods.map(method => method.name).sort(), ['Chat', 'Count', 'Everything', 'Fail', 'SayHello', 'Sum'])

        const failure = await (await post(appServer, '/grpc/schema', { target: plaintextTarget(grpcServerWithoutReflection.port), metadata: [], protoFiles: null })).json()
        // with the copy history saves after a send that took a masked prompt value, the same text where it names no server
        assert.deepEqual(failure, { error: 'The server does not offer server reflection', errorWithoutValues: 'The server does not offer server reflection', code: 'REFLECTION_UNIMPLEMENTED' })

        // a server that cannot be reached comes with the status a call to it ends with
        const closed = await startServer({ reflection: true })
        closed.close()
        const unreachable = await (await post(appServer, '/grpc/schema', { target: plaintextTarget(closed.port), metadata: [], protoFiles: null })).json()
        assert.deepEqual(unreachable, { error: `127.0.0.1:${closed.port} refused the connection`, errorWithoutValues: '****** refused the connection', code: 'CONNECTION_FAILED', grpcStatus: { code: 14, name: 'UNAVAILABLE' } })
    } finally {
        closeServer(appServer)
        grpcServer.close()
        grpcServerWithoutReflection.close()
    }
})

test('CA certificates and a proxy setting the server does not know are refused with codes the UI registers them again for', async() => {
    const appServer = await listenApp()

    try {
        const target = plaintextTarget(1)
        assert.deepEqual(await (await post(appServer, '/grpc/schema', { target, caCertificatesId: 'forgotten' })).json(), {
            error: 'The CA certificates are no longer registered with the server',
            code: 'CA_CERTIFICATES_NOT_FOUND',
        })

        const { response } = await startCall(appServer, { target, service: 'demo.v1.Demo', method: 'SayHello', proxySettingsId: 'forgotten' })
        assert.match(response.headers.get('content-type'), /^application\/json/)
        assert.deepEqual(await response.json(), {
            error: 'The proxy setting is no longer registered with the server',
            code: 'PROXY_SETTINGS_NOT_FOUND',
        })
    } finally {
        closeServer(appServer)
    }
})

test('/grpc/call streams a unary call\'s events as lines, ending with its status', async() => {
    const grpcServer = await startServer()
    const appServer = await listenApp()

    try {
        const { response } = await startCall(appServer, {
            target: plaintextTarget(grpcServer.port),
            metadata: [['X-Echo-Trace', 'abc']],
            service: 'demo.v1.Demo',
            method: 'SayHello',
            messages: ['{"name":"Restfox"}'],
        })

        assert.equal(response.headers.get('content-type'), 'application/x-ndjson')
        const events = await readEvents(response).untilEnd()

        assert.deepEqual(events.map(grpcEvent => grpcEvent.type), ['connected', 'sentMetadata', 'sent', 'headers', 'received', 'status'])
        assert.deepEqual(events.find(grpcEvent => grpcEvent.type === 'sentMetadata').indexes, [0])
        assert.deepEqual(JSON.parse(events.find(grpcEvent => grpcEvent.type === 'received').json), { message: 'Hello Restfox' })
        assert.deepEqual(events.find(grpcEvent => grpcEvent.type === 'headers').metadata.find(([name]) => name === 'x-echo-trace'), ['x-echo-trace', 'abc'])
        assert.equal(events.at(-1).name, 'OK')
        assert.ok(events.every(grpcEvent => typeof grpcEvent.time === 'number'))
    } finally {
        closeServer(appServer)
        grpcServer.close()
    }
})

test('a bidi stream takes its messages and its end through the call\'s routes, which answer 404 once it has ended', async() => {
    const grpcServer = await startServer()
    const appServer = await listenApp()

    try {
        const { callId, response } = await startCall(appServer, { target: plaintextTarget(grpcServer.port), service: 'demo.v1.Demo', method: 'Chat' })
        const reader = readEvents(response)

        assert.equal((await post(appServer, `/grpc/call/${callId}/send`, { json: '{"text":"one"}' })).status, 200)
        assert.equal((await post(appServer, `/grpc/call/${callId}/send`, { json: '{"text":"two"}' })).status, 200)
        assert.equal((await post(appServer, `/grpc/call/${callId}/end`, {})).status, 200)

        const events = await reader.untilEnd()
        assert.deepEqual(events.filter(grpcEvent => grpcEvent.type === 'received').map(grpcEvent => JSON.parse(grpcEvent.json).text), ['echo: one', 'echo: two'])
        assert.deepEqual(events.filter(grpcEvent => grpcEvent.type === 'sent').map(grpcEvent => JSON.parse(grpcEvent.json).text), ['one', 'two'])
        assert.equal(events.at(-1).name, 'OK')

        const late = await post(appServer, `/grpc/call/${callId}/send`, { json: '{"text":"late"}' })
        assert.equal(late.status, 404)
        assert.deepEqual(await late.json(), { error: 'The call has ended' })
    } finally {
        closeServer(appServer)
        grpcServer.close()
    }
})

test('a call id already running is refused', async() => {
    const grpcServer = await startServer()
    const appServer = await listenApp()

    try {
        const callId = randomUUID()
        const spec = { target: plaintextTarget(grpcServer.port), metadata: [], protoFiles: null, service: 'demo.v1.Demo', method: 'Chat', deadlineMs: 0, messages: [], callId }
        const first = await post(appServer, '/grpc/call', spec)
        const reader = readEvents(first)
        const second = await post(appServer, '/grpc/call', spec)

        assert.equal(second.status, 409)
        await post(appServer, `/grpc/call/${callId}/cancel`, {})
        assert.equal((await reader.untilEnd()).at(-1).name, 'CANCELLED')
    } finally {
        closeServer(appServer)
        grpcServer.close()
    }
})

test('cancel ends an endless server stream with CANCELLED', async() => {
    const grpcServer = await startServer()
    const appServer = await listenApp()

    try {
        const { callId, response } = await startCall(appServer, { target: plaintextTarget(grpcServer.port), service: 'demo.v1.Demo', method: 'Count', messages: ['{"to":0,"intervalMs":10}'] })
        const reader = readEvents(response)

        while((await reader.next()).type !== 'received') {
            // until the first number
        }

        assert.equal((await post(appServer, `/grpc/call/${callId}/cancel`, {})).status, 200)
        const events = await reader.untilEnd()
        assert.deepEqual(events.at(-1), { ...events.at(-1), type: 'status', code: 1, name: 'CANCELLED' })
        assert.equal(events.filter(grpcEvent => grpcEvent.type === 'status').length, 1)
    } finally {
        closeServer(appServer)
        grpcServer.close()
    }
})

test('a UI that goes away cancels its call', async() => {
    const grpcServer = await startServer()
    const appServer = await listenApp()

    try {
        const callId = randomUUID()
        const abortController = new AbortController()
        const response = await fetch(`http://127.0.0.1:${appServer.address().port}/grpc/call`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ target: plaintextTarget(grpcServer.port), metadata: [], protoFiles: null, service: 'demo.v1.Demo', method: 'Count', deadlineMs: 0, messages: ['{"to":0,"intervalMs":10}'], callId }),
            signal: abortController.signal,
        })
        const reader = readEvents(response)

        while((await reader.next()).type !== 'received') {
            // until the first number
        }

        abortController.abort()

        // the call is gone once the engine has given its status
        let status = 200
        for(let attempt = 0; attempt < 50 && status === 200; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 20))
            status = (await post(appServer, `/grpc/call/${callId}/end`, {})).status
        }
        assert.equal(status, 404)
    } finally {
        closeServer(appServer)
        grpcServer.close()
    }
})

test('a UI that goes away stops its methods load and closes the connection', async() => {
    // a server that takes the connection and never answers, so the load runs until something stops it
    const sockets = new Set()
    const silentServer = net.createServer(socket => {
        socket.resume()
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', () => {})
    })
    await new Promise(resolve => silentServer.listen(0, '127.0.0.1', resolve))
    const appServer = await listenApp()

    const waitUntil = async check => {
        const end = Date.now() + 3000
        while(!check() && Date.now() < end) {
            await new Promise(resolve => setTimeout(resolve, 20))
        }
        return check()
    }

    try {
        const abortController = new AbortController()
        const reply = fetch(`http://127.0.0.1:${appServer.address().port}/grpc/schema`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ target: plaintextTarget(silentServer.address().port), metadata: [], protoFiles: null }),
            signal: abortController.signal,
        }).catch(() => {})

        assert.equal(await waitUntil(() => sockets.size > 0), true)
        abortController.abort()
        await reply
        assert.equal(await waitUntil(() => sockets.size === 0), true)
    } finally {
        closeServer(appServer)
        for(const socket of sockets) {
            socket.destroy()
        }
        silentServer.close()
    }
})

test('a TLS server is trusted through the registered CA certificates or with SSL verification disabled', async() => {
    const grpcServer = await startServer({ tls: true })
    const appServer = await listenApp()
    const target = { address: `localhost:${grpcServer.port}`, host: 'localhost', port: grpcServer.port, tls: true }
    const spec = { target, service: 'demo.v1.Demo', method: 'SayHello', messages: ['{"name":"tls"}'] }

    try {
        const untrusted = await readEvents((await startCall(appServer, spec)).response).untilEnd()
        // the schema comes by server reflection first, whose connection already fails
        assert.equal(untrusted.at(-1).name, 'UNAVAILABLE')
        assert.match(untrusted.at(-1).details, /self-signed certificate/)

        const { id: caCertificatesId } = await (await fetch(`http://127.0.0.1:${appServer.address().port}/proxy-ca-certificates`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: fs.readFileSync(path.join(filesDir, 'localhost.crt'), 'utf8'),
        })).json()
        const trusted = await readEvents((await startCall(appServer, { ...spec, caCertificatesId })).response).untilEnd()
        assert.equal(trusted.at(-1).name, 'OK')

        const unverified = await readEvents((await startCall(appServer, { ...spec, disableSSLVerification: true })).response).untilEnd()
        assert.equal(unverified.at(-1).name, 'OK')
    } finally {
        closeServer(appServer)
        grpcServer.close()
    }
})

test('Settings > Proxy > Custom tunnels the call and its server reflection through CONNECT', async() => {
    const proxy = await startForwardProxy()
    const grpcServer = await startServer()
    const appServer = await listenApp()

    try {
        const { id: proxySettingsId } = await (await fetch(`http://127.0.0.1:${appServer.address().port}/proxy-settings`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'custom', url: proxy.url }),
        })).json()
        // a made-up host that only the proxy reaches
        const target = plaintextTarget(grpcServer.port, 'grpc.proxy-test.test')

        const reply = await (await post(appServer, '/grpc/schema', { target, metadata: [], protoFiles: null, proxySettingsId })).json()
        assert.ok(reply.schema.services.some(service => service.name === 'demo.v1.Demo'), JSON.stringify(reply))

        const events = await readEvents((await startCall(appServer, { target, service: 'demo.v1.Demo', method: 'SayHello', messages: ['{"name":"proxied"}'], proxySettingsId })).response).untilEnd()
        assert.equal(events.at(-1).name, 'OK', JSON.stringify(events))
        assert.ok(proxy.received.length >= 2)
        assert.ok(proxy.received.every(({ requestLine }) => requestLine === `CONNECT grpc.proxy-test.test:${grpcServer.port} HTTP/1.1`))
    } finally {
        closeServer(appServer)
        grpcServer.close()
        proxy.close()
    }
})

test('Settings > Proxy > System takes this server\'s HTTPS_PROXY for a plaintext call too, and HTTP_PROXY when it is unset', async() => {
    const httpsProxy = await startForwardProxy()
    const httpProxy = await startForwardProxy()
    const grpcServer = await startServer()
    const appServer = await listenApp()
    // the lowercase names win, so ones set on this machine are put aside
    const savedEnv = Object.fromEntries(['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY'].map(name => [name, process.env[name]]))
    for(const name of Object.keys(savedEnv)) {
        delete process.env[name]
    }
    process.env.HTTPS_PROXY = httpsProxy.url
    process.env.HTTP_PROXY = httpProxy.url

    try {
        // a made-up host that only a proxy reaches
        const target = plaintextTarget(grpcServer.port, 'grpc.proxy-test.test')
        const loadSchema = async() => {
            const reply = await (await post(appServer, '/grpc/schema', { target, metadata: [], protoFiles: null })).json()
            assert.ok(reply.schema?.services.some(service => service.name === 'demo.v1.Demo'), JSON.stringify(reply))
        }

        await loadSchema()
        assert.ok(httpsProxy.received.length >= 1)
        assert.equal(httpProxy.received.length, 0)

        delete process.env.HTTPS_PROXY
        await loadSchema()
        assert.ok(httpProxy.received.length >= 1)
    } finally {
        for(const [name, value] of Object.entries(savedEnv)) {
            if(value === undefined) {
                delete process.env[name]
            } else {
                process.env[name] = value
            }
        }
        closeServer(appServer)
        grpcServer.close()
        httpsProxy.close()
        httpProxy.close()
    }
})

test('/grpc/insomnia-message rewrites a message from an Insomnia export into ProtoJSON, and names what it could not read', async() => {
    const exported = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'test-data', 'insomnia-import', 'grpc-address-in-environment.v4.json'), 'utf8'))
    const protoFile = exported.resources.find(resource => resource._type === 'proto_file')
    const request = exported.resources.find(resource => resource.name === 'ModificarTarea (PATCH)')
    const protoFiles = [{ path: protoFile.name, text: protoFile.protoText }]
    const appServer = await listenApp()

    try {
        const converted = await (await post(appServer, '/grpc/insomnia-message', { protoFiles, service: 'tareas.ServicioTareas', method: 'ModificarTarea', text: request.body.text })).json()
        assert.deepEqual(JSON.parse(converted.text), { id: '{{ _.tarea_id_ejemplo }}', completada: true, prioridad: 2 })

        const unknown = await (await post(appServer, '/grpc/insomnia-message', { protoFiles, service: 'tareas.ServicioTareas', method: 'Gone', text: '{}' })).json()
        assert.equal(typeof unknown.error, 'string', JSON.stringify(unknown))
    } finally {
        closeServer(appServer)
    }
})
