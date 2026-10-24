import fs from 'fs'
import path from 'path'
import net from 'net'
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import grpc from '@grpc/grpc-js'
import protobuf from 'protobufjs'
import descriptor from 'protobufjs/ext/descriptor/index.js'
import { limits, loadSchema, startCall, describeConnectionFailure } from './src/grpc.js'
import { loadProtoFiles } from './src/grpc-schema.js'
import { createExample, decodeMessage, decodeReceivedMessage, encodeMessage, convertObjectJsonToProtoJson } from './src/grpc-json.js'
import { openTunnel } from './src/proxy-tunnel.js'
import { startForwardProxy } from './test-forward-proxy.js'
import { startServer } from '../test-api-grpc/server.js'

const protosDir = path.join(import.meta.dirname, '..', 'test-api-grpc', 'protos')
const certificate = fs.readFileSync(path.join(import.meta.dirname, '..', 'test-api', 'files', 'localhost.crt'), 'utf8')

const readProto = name => ({ path: name, text: fs.readFileSync(path.join(protosDir, name), 'utf8') })
const demoProtoFiles = [readProto('demo/v1/demo.proto'), readProto('demo/v1/types.proto')]

const servers = {}

before(async() => {
    servers.plaintext = await startServer({})
    servers.tls = await startServer({ tls: true })
    servers.v1alpha = await startServer({ reflection: 'v1alpha' })
    servers.noReflection = await startServer({ reflection: false })
})

after(() => {
    for(const server of Object.values(servers)) {
        server.close()
    }
})

const plaintextTarget = server => ({ address: `127.0.0.1:${server.port}`, host: '127.0.0.1', port: server.port, tls: false })
const tlsTarget = server => ({ address: `localhost:${server.port}`, host: 'localhost', port: server.port, tls: true })
const trusting = { rejectUnauthorized: true, caCertificates: [] }

// runs a call to its terminal event. onEvent(event, call, events) can drive it, such as sending or cancelling, and is
// first called with { type: 'started' }
function runCall(spec, onEvent = () => {}) {
    return new Promise(resolve => {
        const events = []
        const call = startCall({
            target: plaintextTarget(servers.plaintext),
            connection: trusting,
            metadata: [],
            protoFiles: null,
            service: 'demo.v1.Demo',
            deadlineMs: 0,
            ...spec,
        }, event => {
            events.push(event)
            onEvent(event, call, events)
            if(event.type === 'status' || event.type === 'error') {
                resolve(events)
            }
        })
        onEvent({ type: 'started' }, call, events)
    })
}

const ofType = (events, type) => events.filter(event => event.type === type)
const lastOf = events => events[events.length - 1]
const receivedJson = events => ofType(events, 'received').map(event => JSON.parse(event.json))

test('server reflection v1 lists the services and their methods, without the reflection services', async() => {
    const schema = await loadSchema({ target: plaintextTarget(servers.plaintext), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 })

    assert.equal(schema.source, 'reflection')
    assert.deepEqual(schema.services.map(service => service.name), ['demo.v1.Demo'])
    assert.deepEqual(schema.services[0].methods.map(method => [method.name, method.requestStream, method.responseStream]), [
        ['SayHello', false, false],
        ['Fail', false, false],
        ['Count', false, true],
        ['Sum', true, false],
        ['Chat', true, true],
        ['Everything', false, false],
    ])
    const sayHello = schema.services[0].methods[0]
    assert.equal(sayHello.path, '/demo.v1.Demo/SayHello')
    assert.equal(sayHello.inputType, 'demo.v1.HelloRequest')
    assert.equal(sayHello.example, '{\n  "name": ""\n}')
})

test('server reflection falls back to v1alpha', async() => {
    const schema = await loadSchema({ target: plaintextTarget(servers.v1alpha), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 })
    assert.ok(schema.services[0].methods.some(method => method.name === 'Everything'))
})

test('a server without reflection says so', async() => {
    await assert.rejects(
        loadSchema({ target: plaintextTarget(servers.noReflection), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }),
        { message: 'The server does not offer server reflection', code: 'REFLECTION_UNIMPLEMENTED' },
    )
})

test('proto files load with their imports and the well-known types, and calls use them', async() => {
    const schema = await loadSchema({ target: plaintextTarget(servers.noReflection), connection: trusting, metadata: [], protoFiles: demoProtoFiles, timeoutMs: 0 })
    assert.equal(schema.source, 'proto')
    assert.equal(schema.services[0].methods.length, 6)

    const events = await runCall({ target: plaintextTarget(servers.noReflection), protoFiles: demoProtoFiles, method: 'SayHello', messages: ['{"name":"proto"}'] })
    assert.deepEqual(receivedJson(events), [{ message: 'Hello proto' }])
})

test('a syntax error names the file and the line, a missing import names both files', () => {
    assert.throws(() => loadProtoFiles([{ path: 'broken/bad.proto', text: 'syntax = "proto3";\n\nmessage A {\n    string name = 1\n}\n' }]), /broken\/bad\.proto.*line 5/)
    assert.throws(() => loadProtoFiles([readProto('demo/v1/demo.proto')]), { message: 'demo/v1/demo.proto imports demo/v1/types.proto, which is not among the proto files' })
})

test('every call type', async() => {
    const unary = await runCall({ method: 'SayHello', messages: ['{"name":"Restfox"}'] })
    assert.deepEqual(unary.map(event => event.type), ['connected', 'sentMetadata', 'sent', 'headers', 'received', 'status'])
    assert.deepEqual(receivedJson(unary), [{ message: 'Hello Restfox' }])

    const serverStream = await runCall({ method: 'Count', messages: ['{"to":3,"intervalMs":5}'] })
    assert.deepEqual(receivedJson(serverStream), [{ n: 1 }, { n: 2 }, { n: 3 }])

    const clientStream = await runCall({ method: 'Sum' }, (event, call) => {
        if(event.type === 'started') {
            call.send('{"value":"9007199254740993"}')
            call.send('{"value":1}')
            call.end()
        }
    })
    assert.deepEqual(receivedJson(clientStream), [{ total: '9007199254740994', count: 2 }])

    const bidi = await runCall({ method: 'Chat', messages: ['{"text":"first"}'] }, (event, call, events) => {
        if(event.type === 'started') {
            call.send('{"txet":"typo"}')
        }
        if(event.type === 'received' && ofType(events, 'received').length === 1) {
            call.send('{"text":"second"}')
            call.end()
        }
    })
    assert.deepEqual(ofType(bidi, 'sendError').map(event => event.message), ['demo.v1.ChatMessage: unknown field: "txet"'])
    assert.deepEqual(receivedJson(bidi), [{ text: 'echo: first' }, { text: 'echo: second' }])

    for(const events of [unary, serverStream, clientStream, bidi]) {
        assert.equal(lastOf(events).name, 'OK')
    }
})

test('cancel gives CANCELLED, a deadline DEADLINE_EXCEEDED', async() => {
    const cancelled = await runCall({ method: 'Count', messages: ['{"to":0,"intervalMs":5}'] }, (event, call) => {
        if(event.type === 'received') {
            call.cancel()
        }
    })
    assert.equal(lastOf(cancelled).name, 'CANCELLED')

    const timedOut = await runCall({ method: 'SayHello', messages: ['{"name":"slow"}'], deadlineMs: 300 })
    assert.equal(lastOf(timedOut).name, 'DEADLINE_EXCEEDED')
})

test('metadata goes out, headers and trailers come back, -bin values as base64', async() => {
    const binary = Buffer.from([0, 1, 250, 255]).toString('base64')
    const events = await runCall({ method: 'SayHello', metadata: [['X-Echo-Name', 'value'], ['x-echo-data-bin', binary], ['content-type', 'text/plain'], ['grpc-timeout', '1S'], ['user-agent', 'restfox-test']] })
    assert.deepEqual(ofType(events, 'sentMetadata')[0]?.indexes, [0, 1, 4])
    const headers = ofType(events, 'headers')[0].metadata
    assert.deepEqual(headers.filter(([name]) => name.startsWith('x-echo-')), [['x-echo-name', 'value'], ['x-echo-data-bin', binary]])
    assert.deepEqual(lastOf(events).trailers.filter(([name]) => name.startsWith('x-echo-')), [['x-echo-name', 'value'], ['x-echo-data-bin', binary]])
})

test('error details in grpc-status-details-bin are decoded', async() => {
    const events = await runCall({ method: 'Fail', messages: ['{"code":5,"message":"user 42 not found"}'] })
    assert.equal(lastOf(events).name, 'NOT_FOUND')
    assert.deepEqual(JSON.parse(lastOf(events).errorDetails), {
        code: 5,
        message: 'user 42 not found',
        details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'code', description: 'asked for status 5', reason: '' }] }],
    })
})

test('TLS fails without trusting the certificate, passes with it as a CA certificate or with verification off', async() => {
    const target = tlsTarget(servers.tls)
    await assert.rejects(loadSchema({ target, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }), /^Error: The server's certificate is not trusted /)

    const withCA = await runCall({ target, connection: { rejectUnauthorized: true, caCertificates: [certificate] }, method: 'SayHello', messages: ['{"name":"tls"}'] })
    assert.deepEqual(receivedJson(withCA), [{ message: 'Hello tls' }])

    const unverified = await runCall({ target, connection: { rejectUnauthorized: false, caCertificates: [] }, method: 'SayHello', messages: ['{"name":"insecure"}'] })
    assert.deepEqual(receivedJson(unverified), [{ message: 'Hello insecure' }])

    // an IP address, which Node 26 refuses as a TLS server name
    const byIp = { address: `127.0.0.1:${servers.tls.port}`, host: '127.0.0.1', port: servers.tls.port, tls: true }
    const unverifiedByIp = await runCall({ target: byIp, connection: { rejectUnauthorized: false, caCertificates: [] }, method: 'SayHello', messages: ['{"name":"by ip"}'] })
    assert.deepEqual(receivedJson(unverifiedByIp), [{ message: 'Hello by ip' }])
})

test('Everything round trips every kind of field, and an empty one shows its defaults', async() => {
    const message = {
        int64Value: '9007199254740993',
        uint64Value: '18446744073709551615',
        doubleValue: 1.5,
        boolValue: true,
        bytesValue: Buffer.from('hi').toString('base64'),
        color: 'COLOR_GREEN',
        tags: ['a'],
        counts: { one: 1 },
        point: { x: 3, y: -4 },
        choiceNumber: 7,
        maybe: '',
        createdAt: '2026-10-20T10:00:00.500Z',
        timeout: '1.500s',
        attributes: { name: 'restfox', list: [1, true, null] },
        extra: { '@type': 'type.googleapis.com/demo.v1.Point', x: 1, y: 2 },
        nickname: 'fox',
        bigWrapper: '-9007199254740993',
        snakeCaseName: 'snake',
        points: [{ x: 1, y: 0 }],
    }
    const events = await runCall({ method: 'Everything', messages: [JSON.stringify({ ...message, snakeCaseName: undefined, snake_case_name: 'snake' })] })
    assert.deepEqual(receivedJson(events), [message])

    const empty = await runCall({ method: 'Everything', messages: ['{}'] })
    assert.deepEqual(receivedJson(empty), [{
        int64Value: '0', uint64Value: '0', doubleValue: 0, boolValue: false, bytesValue: '', color: 'COLOR_UNSPECIFIED',
        tags: [], counts: {}, snakeCaseName: '', points: [],
    }])
})

test('the example has every field and one oneof member, and encodes', () => {
    const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
    const example = createExample(type)
    assert.equal(example.choiceText, '')
    assert.equal('choiceNumber' in example, false)
    assert.deepEqual(example.counts, { key: 0 })
    assert.deepEqual(example.points, [{ x: 0, y: 0 }])
    assert.equal(example.timeout, '1s')
    assert.match(example.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    encodeMessage(type, JSON.stringify(example))
})

test('the example stays small for messages that each hold two of the next, level after level, its top filled in', async() => {
    const levels = 20
    let text = 'syntax = "proto3";\nservice Tree {\n    rpc Get(Level0) returns (Level0);\n}\n'
    for(let level = 0; level < levels - 1; level++) {
        text += `message Level${level} {\n    Level${level + 1} a = 1;\n    Level${level + 1} b = 2;\n}\n`
    }
    text += `message Level${levels - 1} {\n    string leaf = 1;\n}\n`

    const schema = await loadSchema({ target: plaintextTarget(servers.noReflection), connection: trusting, metadata: [], protoFiles: [{ path: 'tree.proto', text }], timeoutMs: 0 })
    const example = schema.services[0].methods[0].example

    assert.ok(example.length < 100000, `the example has ${example.length} characters`)
    assert.deepEqual(Object.keys(JSON.parse(example).b.b.b.b), ['a', 'b'])
    assert.equal(example.includes('"leaf"'), false)
})

test('an error for a message that cannot be encoded has a form that quotes nothing the user wrote, in sendError and error events', async() => {
    const unary = await runCall({ method: 'SayHello', messages: ['{"name":{"token":"private-first"}}'] })
    assert.deepEqual(unary.map(event => [event.type, event.message, event.messageWithoutValues]), [
        ['sendError', 'demo.v1.HelloRequest.name: expected string: {"token":"private-first"}', 'demo.v1.HelloRequest.name: expected string'],
        ['error', 'demo.v1.HelloRequest.name: expected string: {"token":"private-first"}', 'demo.v1.HelloRequest.name: expected string'],
    ])

    const bidi = await runCall({ method: 'Chat' }, (event, call) => {
        if(event.type === 'started') {
            call.send('{"text": {"token": "private-second"}}')
            call.send('{"text": private-third}')
            call.send('{"private-fourth": ""}')
            call.end()
        }
    })
    const sendErrors = ofType(bidi, 'sendError')
    assert.deepEqual(sendErrors.map(event => [event.index, event.messageWithoutValues]), [
        [0, 'demo.v1.ChatMessage.text: expected string'],
        [1, 'The message is not valid JSON'],
        [2, 'demo.v1.ChatMessage: unknown field'],
    ])
    assert.ok(sendErrors.every(event => event.message.includes('private-')))
    assert.equal(lastOf(bidi).name, 'OK')
})

test('an encode error has a copy for history that quotes none of the message, its own text when it quotes nothing', () => {
    const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
    const errorFor = text => {
        try {
            encodeMessage(type, text)
        } catch(e) {
            return e
        }
        throw new Error(`${text} encoded`)
    }

    const withoutValues = [
        ['{"int64Value": "secret"}', 'demo.v1.Everything.int64_value: invalid integer'],
        ['{"color": "SECRET"}', 'demo.v1.Everything.color: unknown enum value'],
        ['{"counts": {"key": "secret"}}', 'demo.v1.Everything.counts: invalid integer'],
        ['{"createdAt": "secret"}', 'google.protobuf.Timestamp: invalid timestamp'],
        ['{"nickname": {"secret": 1}}', 'google.protobuf.StringValue.value: expected string'],
        ['{"secret": 1}', 'demo.v1.Everything: unknown field'],
        ['{"extra": {"@type": "type.googleapis.com/secret.Type"}}', 'The message does not fit demo.v1.Everything'],
        ['{"nickname": "secret" x}', 'The message is not valid JSON at position 22 (line 1 column 23)'],
        ['{"nickname": secret}', 'The message is not valid JSON'],
        // the quoted text is the user's, a position written in it is not the parser's
        ['x at position 123456', 'The message is not valid JSON'],
    ]
    for(const [text, messageWithoutValues] of withoutValues) {
        assert.equal(errorFor(text).messageWithoutValues, messageWithoutValues, text)
    }

    const oneofError = errorFor('{"choiceText": "a", "choiceNumber": 1}')
    assert.equal(oneofError.message, 'demo.v1.Everything: multiple values for oneof choice')
    assert.equal(oneofError.messageWithoutValues, oneofError.message)
})

test('reflection and calls go through openTunnel, a host only the proxy reaches', async() => {
    const proxy = await startForwardProxy()
    try {
        const proxyUrl = new URL(proxy.url)
        const connection = { rejectUnauthorized: true, caCertificates: [], openTunnel: (host, port) => openTunnel(proxyUrl, host, port, {}) }
        const target = { address: `grpc.restfox.invalid:${servers.plaintext.port}`, host: 'grpc.restfox.invalid', port: servers.plaintext.port, tls: false }

        // without the proxy a made-up host does not resolve. A malformed one, as the system's resolver fails it at
        // once where an unknown name can take seconds
        const unresolved = { address: `grpc..invalid:${servers.plaintext.port}`, host: 'grpc..invalid', port: servers.plaintext.port, tls: false }
        await assert.rejects(loadSchema({ target: unresolved, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }), { message: 'Could not look up grpc..invalid', code: 'CONNECTION_FAILED' })

        // and a proxy that cannot be reached is named as the proxy, not the server
        const unused = await startServer({})
        unused.close()
        const downProxyUrl = new URL(`http://127.0.0.1:${unused.port}`)
        await assert.rejects(loadSchema({ target, connection: { ...trusting, openTunnel: (host, port) => openTunnel(downProxyUrl, host, port, {}) }, metadata: [], protoFiles: null, timeoutMs: 5000 }), { message: `Could not connect to the proxy: connect ECONNREFUSED 127.0.0.1:${unused.port}` })

        const schema = await loadSchema({ target, connection, metadata: [], protoFiles: null, timeoutMs: 5000 })
        assert.equal(schema.services[0].name, 'demo.v1.Demo')

        const events = await runCall({ target, connection, method: 'SayHello', messages: ['{"name":"proxied"}'] })
        assert.deepEqual(receivedJson(events), [{ message: 'Hello proxied' }])
        assert.ok(proxy.received.some(request => request.requestLine === `CONNECT grpc.restfox.invalid:${servers.plaintext.port} HTTP/1.1`))
    } finally {
        proxy.close()
    }
})

// a proxy that tunnels each CONNECT to 127.0.0.1 and keeps its own end of each tunnel, in the order they opened, so a
// test can reset one
function startTunnellingProxy() {
    const tunnels = []
    const sockets = new Set()
    const server = net.createServer(socket => {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', () => {})
        socket.once('data', chunk => {
            const target = chunk.toString('latin1').split(' ')[1]
            const upstream = net.connect(Number(target.slice(target.lastIndexOf(':') + 1)), '127.0.0.1', () => {
                tunnels.push(socket)
                socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
                upstream.pipe(socket)
                socket.pipe(upstream)
            })
            sockets.add(upstream)
            upstream.on('close', () => sockets.delete(upstream))
            upstream.on('error', () => socket.destroy())
            socket.on('close', () => upstream.destroy())
        })
    })
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
        url: new URL(`http://127.0.0.1:${server.address().port}`),
        tunnels,
        close() {
            for(const socket of sockets) {
                socket.destroy()
            }
            server.close()
        },
    })))
}

test('a tunnel the proxy resets and closes before the relay gets it is not given to the client, which gets a new one', async() => {
    const proxy = await startTunnellingProxy()
    try {
        const connection = {
            ...trusting,
            openTunnel: async(host, port) => {
                const tunnel = await openTunnel(proxy.url, host, port, {})
                if(proxy.tunnels.length === 1) {
                    tunnel.on('error', () => {})
                    const closed = new Promise(resolve => tunnel.once('close', resolve))
                    proxy.tunnels[0].resetAndDestroy()
                    await closed
                }
                return tunnel
            },
        }

        const events = await runCall({ connection, protoFiles: demoProtoFiles, method: 'SayHello', messages: ['{"name":"again"}'], deadlineMs: 5000 })
        assert.equal(lastOf(events).name, 'OK')
        assert.deepEqual(receivedJson(events), [{ message: 'Hello again' }])
        assert.equal(proxy.tunnels.length, 2)
    } finally {
        proxy.close()
    }
})

test('a proxy that cannot be reached for a later tunnel is named as the proxy too, in reflection and calls', async() => {
    // the first tunnel is reset before the client gets it, and the proxy is gone when the relay opens the next one
    const connectThroughVanishingProxy = async() => {
        const proxy = await startTunnellingProxy()
        return {
            proxyPort: proxy.url.port,
            connection: {
                ...trusting,
                openTunnel: async(host, port) => {
                    const tunnel = await openTunnel(proxy.url, host, port, {})
                    tunnel.on('error', () => {})
                    const closed = new Promise(resolve => tunnel.once('close', resolve))
                    proxy.tunnels[0].resetAndDestroy()
                    await closed
                    proxy.close()
                    return tunnel
                },
            },
        }
    }

    const reflection = await connectThroughVanishingProxy()
    await assert.rejects(loadSchema({ target: plaintextTarget(servers.plaintext), connection: reflection.connection, metadata: [], protoFiles: null, timeoutMs: 5000 }), {
        message: `Could not connect to the proxy: connect ECONNREFUSED 127.0.0.1:${reflection.proxyPort}`,
        code: 'CONNECTION_FAILED',
    })

    const call = await connectThroughVanishingProxy()
    const events = await runCall({ connection: call.connection, protoFiles: demoProtoFiles, method: 'SayHello', deadlineMs: 5000 })
    assert.equal(lastOf(events).name, 'UNAVAILABLE')
    assert.equal(lastOf(events).details, `Could not connect to the proxy: connect ECONNREFUSED 127.0.0.1:${call.proxyPort}`)
})

test('a tunnel the proxy resets while the relay holds it, before the client connects, is not given to the client and does not crash the server', async() => {
    const proxy = await startTunnellingProxy()
    const tunnels = []
    const uncaught = []
    const onUncaught = error => uncaught.push(error)
    process.on('uncaughtException', onUncaught)
    // the relay listens right after it takes the first tunnel, and the client connects only once it listens, so the
    // proxy resets that tunnel, with no listener of this test on it, between the two
    let held = false
    const listen = net.Server.prototype.listen
    net.Server.prototype.listen = function(...args) {
        if(held || !String(args[0]).includes('restfox-grpc-')) {
            return listen.apply(this, args)
        }
        held = true
        const closed = new Promise(resolve => tunnels[0].once('close', resolve))
        proxy.tunnels[0].resetAndDestroy()
        closed.then(() => listen.apply(this, args))
        return this
    }
    try {
        const connection = {
            ...trusting,
            openTunnel: async(host, port) => {
                const tunnel = await openTunnel(proxy.url, host, port, {})
                tunnels.push(tunnel)
                return tunnel
            },
        }

        const events = await runCall({ connection, protoFiles: demoProtoFiles, method: 'SayHello', messages: ['{"name":"again"}'], deadlineMs: 5000 })
        assert.equal(held, true)
        assert.deepEqual(uncaught, [])
        assert.equal(lastOf(events).name, 'OK')
        assert.equal(tunnels.length, 2)
    } finally {
        net.Server.prototype.listen = listen
        process.removeListener('uncaughtException', onUncaught)
        proxy.close()
    }
})

// a proxy that opens each tunnel, to nowhere, and resets one once the client's first bytes come through it
function startResettingProxy() {
    const server = net.createServer(socket => {
        socket.on('error', () => {})
        socket.once('data', () => {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
            socket.once('data', () => socket.resetAndDestroy())
        })
    })
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
        port: server.address().port,
        close: () => server.close(),
    })))
}

test('a tunnel the proxy resets while the client uses it fails the call at once', async() => {
    const proxy = await startResettingProxy()
    try {
        const proxyUrl = new URL(`http://127.0.0.1:${proxy.port}`)
        const connection = { ...trusting, openTunnel: (host, port) => openTunnel(proxyUrl, host, port, {}) }

        const started = Date.now()
        const events = await runCall({ connection, protoFiles: demoProtoFiles, method: 'SayHello', messages: ['{}'], deadlineMs: 5000 })
        const elapsed = Date.now() - started
        assert.equal(lastOf(events).type, 'status')
        assert.equal(lastOf(events).name, 'UNAVAILABLE')
        assert.ok(elapsed < 2000, `took ${elapsed} ms`)
    } finally {
        proxy.close()
    }
})

// a server that takes connections, reads and never answers, as a stuck server or a proxy that never answers CONNECT
function startSilentServer() {
    const sockets = new Set()
    const server = net.createServer(socket => {
        socket.resume()
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', () => {})
    })
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({
            port: server.address().port,
            sockets,
            close() {
                for(const socket of sockets) {
                    socket.destroy()
                }
                server.close()
            },
        }))
    })
}

async function waitUntil(check, timeoutMs = 3000) {
    const end = Date.now() + timeoutMs
    while(!check() && Date.now() < end) {
        await new Promise(resolve => setTimeout(resolve, 20))
    }
    return check()
}

test('connection-specific metadata names are left out, a -bin value that is not base64 is an error', async() => {
    const metadata = ['keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'http2-settings'].map(name => [name, 'x'])
    const events = await runCall({ method: 'SayHello', messages: ['{"name":"meta"}'], metadata, deadlineMs: 3000 })
    assert.equal(lastOf(events).name, 'OK')

    const notBase64 = await runCall({ method: 'SayHello', metadata: [['x-trace-bin', 'hello world']] })
    assert.equal(lastOf(notBase64).type, 'error')
    assert.equal(lastOf(notBase64).message, 'Metadata x-trace-bin: a -bin value is base64, such as aGVsbG8=')
    // letters base64 uses, but a length whose last letter decodes to no whole byte, which would send other bytes
    for(const value of ['A', 'AAAAA', 'AA=']) {
        const cutShort = await runCall({ method: 'SayHello', metadata: [['x-trace-bin', value]] })
        assert.equal(lastOf(cutShort).message, 'Metadata x-trace-bin: a -bin value is base64, such as aGVsbG8=', value)
    }

    // two Metadata rows of one -bin name, which the UI joins with a comma as HTTP headers are
    const joined = await runCall({ method: 'SayHello', messages: ['{}'], metadata: [['x-echo-data-bin', 'AAE=, +v8=']] })
    assert.equal(lastOf(joined).name, 'OK')
    assert.deepEqual(ofType(joined, 'headers')[0].metadata.filter(([name]) => name === 'x-echo-data-bin'), [['x-echo-data-bin', 'AAE='], ['x-echo-data-bin', '+v8=']])
})

test('a metadata name or value gRPC cannot carry is an error naming it, which quotes nothing else the user wrote', async() => {
    // gRPC would quote the name lowercased, where a masked prompt value in it could no longer be found to hide
    const badName = await runCall({ method: 'SayHello', metadata: [['x-ABC?', 'v']] })
    assert.equal(lastOf(badName).type, 'error')
    assert.equal(lastOf(badName).message, 'Metadata x-ABC?: a name has only letters, digits, -, _ and .')
    assert.equal(lastOf(badName).messageWithoutValues, 'Metadata ******: a name has only letters, digits, -, _ and .')

    const badValue = await runCall({ method: 'SayHello', metadata: [['x-note', 'line one\nline two']] })
    assert.equal(lastOf(badValue).message, 'Metadata x-note: a value has only printable ASCII characters, a -bin name takes any bytes as base64')
})

test('a proxy that never answers ends the call at its deadline, Stop during reflection closes the connection', { timeout: 8000 }, async() => {
    const silentProxy = await startSilentServer()
    const silent = await startSilentServer()
    try {
        const proxyUrl = new URL(`http://127.0.0.1:${silentProxy.port}`)
        const connection = { rejectUnauthorized: true, caCertificates: [], openTunnel: (host, port) => openTunnel(proxyUrl, host, port, {}) }
        const target = { address: 'grpc.restfox.invalid:50051', host: 'grpc.restfox.invalid', port: 50051, tls: false }
        const timedOut = await runCall({ target, connection, protoFiles: demoProtoFiles, method: 'SayHello', deadlineMs: 500 })
        assert.equal(lastOf(timedOut).name, 'DEADLINE_EXCEEDED')
        assert.ok(lastOf(timedOut).time < 2000)
        // the same with the methods loaded by reflection
        const reflected = await runCall({ target, connection, method: 'SayHello', deadlineMs: 500 })
        assert.equal(lastOf(reflected).name, 'DEADLINE_EXCEEDED')

        const direct = { address: `127.0.0.1:${silent.port}`, host: '127.0.0.1', port: silent.port, tls: false }
        const stopped = await runCall({ target: direct, method: 'Chat' }, (event, call) => {
            if(event.type === 'started') {
                setTimeout(() => call.cancel(), 300)
            }
        })
        assert.equal(lastOf(stopped).name, 'CANCELLED')
        assert.equal(await waitUntil(() => silent.sockets.size === 0), true)

        // a methods load stops when its signal aborts, as when the page that asked is gone
        const abortController = new AbortController()
        setTimeout(() => abortController.abort(), 300)
        const aborted = await loadSchema({ target: direct, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 0, signal: abortController.signal }).catch(e => e)
        assert.ok(aborted instanceof Error)
        assert.equal(await waitUntil(() => silent.sockets.size === 0), true)

        // with no Request Timeout, the wait for the tunnel ends and names the proxy, not the server
        const tunnelTimeoutMs = limits.tunnelTimeoutMs
        limits.tunnelTimeoutMs = 300
        try {
            const unanswered = await loadSchema({ target, connection, metadata: [], protoFiles: null, timeoutMs: 0 }).catch(e => e)
            assert.equal(unanswered.message, 'Could not connect to the proxy: The proxy did not answer within 0.3 s')
        } finally {
            limits.tunnelTimeoutMs = tunnelTimeoutMs
        }
    } finally {
        silentProxy.close()
        silent.close()
    }
})

test('a methods load stopped, or a call past its deadline, while the proxy has not answered closes the connection to the proxy', { timeout: 8000 }, async() => {
    const proxy = await startSilentServer()
    try {
        const proxyUrl = new URL(`http://127.0.0.1:${proxy.port}`)
        const connection = { rejectUnauthorized: true, caCertificates: [], openTunnel: (host, port, signal) => openTunnel(proxyUrl, host, port, {}, signal) }
        const target = { address: 'grpc.restfox.invalid:50051', host: 'grpc.restfox.invalid', port: 50051, tls: false }

        const abortController = new AbortController()
        setTimeout(() => abortController.abort(), 300)
        const aborted = await loadSchema({ target, connection, metadata: [], protoFiles: null, timeoutMs: 0, signal: abortController.signal }).catch(e => e)
        assert.ok(aborted instanceof Error)
        // well before the proxy's own limit of limits.tunnelTimeoutMs
        assert.equal(await waitUntil(() => proxy.sockets.size === 0, 2000), true)

        const timedOut = await runCall({ target, connection, protoFiles: demoProtoFiles, method: 'SayHello', deadlineMs: 300 })
        assert.equal(lastOf(timedOut).name, 'DEADLINE_EXCEEDED')
        assert.equal(await waitUntil(() => proxy.sockets.size === 0, 2000), true)
    } finally {
        proxy.close()
    }
})

test('a methods load stopped, or a call past its deadline, while the proxy has not answered a later tunnel closes the connection to the proxy', { timeout: 8000 }, async() => {
    // a proxy that opens the first tunnel and closes it at once, then never answers, as one that drops idle tunnels and
    // then hangs does
    const sockets = new Set()
    let connections = 0
    const proxy = net.createServer(socket => {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', () => {})
        if(++connections === 1) {
            socket.once('data', () => socket.end('HTTP/1.1 200 Connection established\r\n\r\n'))
        } else {
            socket.resume()
        }
    })
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
    try {
        const proxyUrl = new URL(`http://127.0.0.1:${proxy.address().port}`)
        // the first tunnel goes to the relay only once its close has arrived, so the client's connection always needs a
        // later one, whichever comes first on the system, the close or the client's connection
        let tunnelsOpened = 0
        const openTunnelAfterFirstClosed = async(host, port, signal) => {
            const socket = await openTunnel(proxyUrl, host, port, {}, signal)
            if(++tunnelsOpened === 1 && !socket.destroyed) {
                await new Promise(resolve => socket.once('close', resolve))
            }
            return socket
        }
        const connection = { rejectUnauthorized: true, caCertificates: [], openTunnel: openTunnelAfterFirstClosed }
        const target = { address: 'grpc.restfox.invalid:50051', host: 'grpc.restfox.invalid', port: 50051, tls: false }

        const abortController = new AbortController()
        setTimeout(() => abortController.abort(), 500)
        const aborted = await loadSchema({ target, connection, metadata: [], protoFiles: null, timeoutMs: 0, signal: abortController.signal }).catch(e => e)
        assert.ok(aborted instanceof Error)
        assert.ok(connections > 1)
        // well before the proxy's own limit of limits.tunnelTimeoutMs
        assert.equal(await waitUntil(() => sockets.size === 0, 2000), true)

        connections = 0
        tunnelsOpened = 0
        const timedOut = await runCall({ target, connection, protoFiles: demoProtoFiles, method: 'SayHello', deadlineMs: 500 })
        assert.equal(lastOf(timedOut).name, 'DEADLINE_EXCEEDED')
        assert.ok(connections > 1)
        assert.equal(await waitUntil(() => sockets.size === 0, 2000), true)
    } finally {
        for(const socket of sockets) {
            socket.destroy()
        }
        proxy.close()
    }
})

test('a relay that cannot listen, as in a temp folder that cannot be written, fails the load and closes the connection', { timeout: 8000 }, async() => {
    const silent = await startSilentServer()
    const listen = net.Server.prototype.listen
    net.Server.prototype.listen = function(...args) {
        if(!String(args[0]).includes('restfox-grpc-')) {
            return listen.apply(this, args)
        }
        process.nextTick(() => this.emit('error', Object.assign(new Error(`listen EACCES: permission denied ${args[0]}`), { code: 'EACCES', syscall: 'listen' })))
        return this
    }
    try {
        const target = { address: `127.0.0.1:${silent.port}`, host: '127.0.0.1', port: silent.port, tls: false }
        const error = await loadSchema({ target, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 0 }).catch(e => e)
        assert.ok(error instanceof Error)
        assert.match(error.message, /EACCES/)
        assert.equal(await waitUntil(() => silent.sockets.size === 0), true)
    } finally {
        net.Server.prototype.listen = listen
        silent.close()
    }
})

test('a connection that fails says why in plain words', async() => {
    const untrusted = await loadSchema({ target: tlsTarget(servers.tls), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    // Electron's Node writes self signed, without the hyphen
    assert.match(untrusted.message, /^The server's certificate is not trusted \(self[- ]signed certificate\)\. Add its CA certificate in Settings > CA Certificates, or turn on Disable SSL Verification$/)
    assert.equal(untrusted.code, 'CONNECTION_FAILED')

    const unused = await startServer({})
    unused.close()
    const refused = await runCall({ target: plaintextTarget(unused), protoFiles: demoProtoFiles, method: 'SayHello' })
    // nothing was sent to a server that could not be reached
    assert.deepEqual(refused.map(event => event.type), ['status'])
    assert.equal(lastOf(refused).details, `127.0.0.1:${unused.port} refused the connection`)
    // the copy history saves after a send that took a masked prompt value names the server as ******
    assert.equal(lastOf(refused).detailsWithoutValues, '****** refused the connection')
    // a call that loads its methods by reflection ends as one with proto files does
    const refusedReflected = await runCall({ target: plaintextTarget(unused), method: 'SayHello' })
    assert.equal(lastOf(refusedReflected).name, 'UNAVAILABLE')
    assert.equal(lastOf(refusedReflected).detailsWithoutValues, '****** refused the connection')
    const refusedLoad = await loadSchema({ target: plaintextTarget(unused), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    assert.equal(refusedLoad.messageWithoutValues, '****** refused the connection')

    // the server's text, which history keeps as it came
    const failed = await runCall({ method: 'Fail', messages: ['{"code":5,"message":"user 42 not found"}'] })
    assert.equal(lastOf(failed).details, 'user 42 not found')
    assert.equal('detailsWithoutValues' in lastOf(failed), false)
    // also when it quotes a connection error
    const quoting = 'Database down. Last error: connect ECONNREFUSED 10.0.0.1:5432'
    const unavailable = await runCall({ method: 'Fail', messages: [JSON.stringify({ code: 14, message: quoting })] })
    assert.equal(lastOf(unavailable).name, 'UNAVAILABLE')
    assert.equal(lastOf(unavailable).details, quoting)
    assert.equal('detailsWithoutValues' in lastOf(unavailable), false)

    // localhost has two addresses, so Node reports the refusal as an AggregateError with an empty message
    const refusedByName = await runCall({ target: { address: `localhost:${unused.port}`, host: 'localhost', port: unused.port, tls: false }, protoFiles: demoProtoFiles, method: 'SayHello' })
    assert.equal(lastOf(refusedByName).details, `localhost:${unused.port} refused the connection`)
})

test('a TLS address that reaches a plaintext server says so, in OpenSSL\'s wording and in BoringSSL\'s, which Electron\'s Node uses', () => {
    const target = { address: 'localhost:50051', host: 'localhost', port: 50051, tls: true }
    const notTls = 'The server did not answer with TLS. For a server without TLS, start the address with grpc://'
    assert.equal(describeConnectionFailure('No connection established. Last error: Error: C0EC0000:error:0A00010B:SSL routines:ssl3_get_record:wrong version number:openssl\\ssl\\record\\ssl3_record.c:354:. Resolution note: ', target), notTls)
    assert.equal(describeConnectionFailure('No connection established. Last error: Error: 105984:error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER:..\\..\\third_party\\boringssl\\src\\ssl\\tls_record.cc:127:. Resolution note: ', target), notTls)
})

test('a sent message shows its default values and its number, connected comes first', async() => {
    const events = await runCall({ method: 'Count', messages: ['{"to":2,"intervalMs":0}'] })
    assert.deepEqual(events.slice(0, 3).map(event => event.type), ['connected', 'sentMetadata', 'sent'])
    assert.deepEqual(JSON.parse(ofType(events, 'sent')[0].json), { to: 2, intervalMs: 0 })
    assert.equal(ofType(events, 'sent')[0].index, 0)
})

test('an Any of an unknown type is shown as its type and bytes, a large integer outside 64-bit fields stays a number', () => {
    const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
    const buffer = type.encode(type.fromObject({ int64_value: '5', extra: { type_url: 'type.googleapis.com/other.v1.Unknown', value: Buffer.from([8, 1]) } })).finish()
    const json = JSON.parse(decodeMessage(type, buffer))
    assert.equal(json.int64Value, '5')
    assert.deepEqual(json.extra, { '@type': 'type.googleapis.com/other.v1.Unknown', value: 'CAE=' })

    const sent = JSON.parse(encodeMessage(type, '{"int64Value": 9223372036854775807, "attributes": {"n": 12345678901234567890}}').json)
    assert.equal(sent.int64Value, '9223372036854775807')
    assert.equal(typeof sent.attributes.n, 'number')

    // with a decimal point or an exponent, as text and as a JSON number
    const exponents = JSON.parse(encodeMessage(type, '{"int64Value": "9.007199254740993e15", "bigWrapper": 9007199254740993E0, "uint64Value": "1e3"}').json)
    assert.deepEqual([exponents.int64Value, exponents.bigWrapper, exponents.uint64Value], ['9007199254740993', '9007199254740993', '1000'])
    assert.throws(() => encodeMessage(type, '{"int64Value": 1e300}'), /out of range for int64/)
    assert.throws(() => encodeMessage(type, '{"int64Value": "1.5"}'), /not an integer/)
    // a fraction is refused rather than rounded, in maps and lists too
    assert.throws(() => encodeMessage(type, '{"int64Value": "9007199254740993.1"}'), { message: 'demo.v1.Everything.int64_value: not an integer: "9007199254740993.1"', messageWithoutValues: 'demo.v1.Everything.int64_value: not an integer' })
    assert.throws(() => encodeMessage(type, '{"int64Value": 9007199254740993.5}'), { message: 'demo.v1.Everything.int64_value: not an integer: 9007199254740993.5' })
    const int64Holder = loadProtoFiles([{ path: 'h.proto', text: 'syntax = "proto3";\npackage h;\nmessage Holder {\n    map<string, int64> counts = 1;\n    repeated uint64 ids = 2;\n}\n' }]).lookupType('h.Holder')
    assert.throws(() => encodeMessage(int64Holder, '{"counts": {"k": "2.5"}}'), /h\.Holder\.counts: not an integer: "2\.5"/)
    assert.throws(() => encodeMessage(int64Holder, '{"ids": [1, "1e-999"]}'), /h\.Holder\.ids: not an integer/)

    // under a 64-bit map key, and from a well-known type protobufjs ships only as a file
    const holder = loadProtoFiles([{ path: 'map.proto', text: 'syntax = "proto3";\nimport "google/protobuf/any.proto";\nmessage Holder {\n    map<int64, google.protobuf.Any> anys = 1;\n    map<fixed64, google.protobuf.Any> unsigned_anys = 2;\n}\n' }]).lookupType('Holder')
    const any = { type_url: 'type.googleapis.com/other.v1.Unknown', value: Buffer.from([8, 1]) }
    const shown = { '@type': 'type.googleapis.com/other.v1.Unknown', value: 'CAE=' }
    const holderBuffer = holder.encode(holder.fromObject({ anys: { '-5': any }, unsigned_anys: { '18446744073709551615': any } })).finish()
    assert.deepEqual(JSON.parse(decodeMessage(holder, holderBuffer)), { anys: { '-5': shown }, unsignedAnys: { '18446744073709551615': shown } })
    const outer = loadProtoFiles([{ path: 'a.proto', text: 'syntax = "proto3";\npackage a;\nimport "google/protobuf/any.proto";\nmessage Inner {\n    map<string, int64> counts = 1;\n}\nmessage Outer {\n    google.protobuf.Any any = 1;\n    map<string, int64> counts = 2;\n}\n' }]).lookupType('a.Outer')
    const packed = JSON.parse(encodeMessage(outer, '{"any": {"@type": "type.googleapis.com/a.Inner", "counts": {"k": 9007199254740993}}}').json)
    assert.equal(packed.any.counts.k, '9007199254740993')
    const uses = loadProtoFiles([{ path: 'uses.proto', text: 'syntax = "proto3";\nimport "google/protobuf/type.proto";\nimport "google/protobuf/api.proto";\nmessage Uses {\n    google.protobuf.Type type = 1;\n    google.protobuf.Api api = 2;\n}\n' }]).lookupType('Uses')
    assert.equal(uses.fields.api.resolvedType.fullName, '.google.protobuf.Api')
})

test('a call connects through a named pipe or socket file, which other users of the machine cannot send through, not a loopback port', async() => {
    const listen = net.Server.prototype.listen
    const listenedOn = []
    net.Server.prototype.listen = function(...args) {
        listenedOn.push(args[0])
        return listen.apply(this, args)
    }
    try {
        const events = await runCall({ method: 'SayHello', messages: ['{}'] })
        assert.equal(lastOf(events).name, 'OK')
        assert.ok(listenedOn.length > 0)
        for(const where of listenedOn) {
            assert.match(where, process.platform === 'win32' ? /^\\\\\.\\pipe\\restfox-grpc-/ : /\/restfox-grpc-[^/]+\/relay\.sock$/)
        }
    } finally {
        net.Server.prototype.listen = listen
    }
})

test('a methods load that ends after a newer one does not replace the methods the newer one found', async() => {
    // the server's api.Api gains Walk between the two loads
    const describeApi = methods => {
        const root = new protobuf.Root()
        protobuf.parse(`syntax = "proto3";\npackage api;\nmessage Step { string id = 1; }\nservice Api { ${methods.map(name => `rpc ${name}(Step) returns (Step);`).join(' ')} }\n`, root, { keepCase: true })
        root.resolveAll()
        return descriptor.FileDescriptorProto.encode(root.toDescriptor('proto3').file[0]).finish()
    }
    const files = [describeApi(['Run']), describeApi(['Run', 'Walk'])]
    const reflection = protobuf.parse(`
syntax = "proto3";
message Request { oneof message_request { string file_containing_symbol = 4; string list_services = 7; } }
message Response { oneof message_response { Files file_descriptor_response = 4; Services list_services_response = 6; } }
message Files { repeated bytes file_descriptor_proto = 1; }
message Services { repeated Service service = 1; }
message Service { string name = 1; }
`, { keepCase: true }).root
    const Request = reflection.lookupType('Request')
    const Response = reflection.lookupType('Response')

    // the first reflection stream's list of services waits until released
    let releaseFirst
    const firstHeld = new Promise(resolve => releaseFirst = resolve)
    let firstAsked = false
    let streamCount = 0
    const server = new grpc.Server()
    const passBuffer = buffer => buffer
    server.addService({
        ServerReflectionInfo: {
            path: '/grpc.reflection.v1.ServerReflection/ServerReflectionInfo',
            requestStream: true,
            responseStream: true,
            requestSerialize: passBuffer,
            requestDeserialize: passBuffer,
            responseSerialize: passBuffer,
            responseDeserialize: passBuffer,
        },
    }, {
        ServerReflectionInfo(call) {
            const stream = streamCount++
            let answered = Promise.resolve()
            call.on('data', buffer => {
                const request = Request.decode(buffer)
                answered = answered.then(async() => {
                    if(request.message_request === 'list_services') {
                        if(stream === 0) {
                            firstAsked = true
                            await firstHeld
                        }
                        return { list_services_response: { service: [{ name: 'api.Api' }] } }
                    }
                    return { file_descriptor_response: { file_descriptor_proto: [files[Math.min(stream, 1)]] } }
                }).then(response => call.write(Buffer.from(Response.encode(Response.fromObject(response)).finish())))
            })
            call.on('end', () => answered.then(() => call.end()))
        },
    })
    const port = await new Promise((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, boundPort) => error ? reject(error) : resolve(boundPort)))
    const target = plaintextTarget({ port })

    try {
        const load = () => loadSchema({ target, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 })
        const older = load()
        assert.equal(await waitUntil(() => firstAsked), true)
        const newer = await load()
        assert.deepEqual(newer.services[0].methods.map(method => method.name), ['Run', 'Walk'])
        releaseFirst()
        assert.deepEqual((await older).services[0].methods.map(method => method.name), ['Run'])

        // a call reads the methods the newer load found, so Walk reaches the server, which does not implement it
        const events = await runCall({ target, service: 'api.Api', method: 'Walk', messages: ['{}'] })
        assert.equal(lastOf(events).name, 'UNIMPLEMENTED', JSON.stringify(lastOf(events)))
    } finally {
        server.forceShutdown()
    }
})

test('a User-Agent value gRPC cannot carry is an error naming it, as for other metadata', async() => {
    const events = await runCall({ method: 'SayHello', metadata: [['User-Agent', 'café']] })
    assert.equal(lastOf(events).type, 'error')
    assert.equal(lastOf(events).message, 'Metadata User-Agent: a value has only printable ASCII characters, a -bin name takes any bytes as base64')
    assert.equal(lastOf(events).messageWithoutValues, 'Metadata ******: a value has only printable ASCII characters, a -bin name takes any bytes as base64')
})

test('a well-known type written as protobufjs\'s object, as in Insomnia, is refused with how to write it, quoting nothing the user wrote', () => {
    const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
    const hint = 'demo.v1.Everything.created_at: a google.protobuf.Timestamp is written as text, such as "2026-10-23T10:00:00Z", not as {"seconds": ...}'
    assert.throws(() => encodeMessage(type, '{"createdAt": {"seconds": 1}}'), { message: hint, messageWithoutValues: hint })
    assert.throws(() => encodeMessage(type, '{"nickname": {"value": "s3cret"}}'), { message: 'demo.v1.Everything.nickname: a google.protobuf.StringValue is written as its value, such as "text", not as {"value": ...}' })
    // an object with a key that is no field of the type is another mistake, which ProtoJSON names
    assert.throws(() => encodeMessage(type, '{"nickname": {"secret": 1}}'), { messageWithoutValues: 'google.protobuf.StringValue.value: expected string' })
})


for(const [packedName, packedValue, packedJson] of [
    ['google.protobuf.Timestamp', 'CAE=', { value: '1970-01-01T00:00:01Z' }],
    ['demo.v1.Point', 'CAEQAg==', { x: 1, y: 2 }],
]) {
    test(`an imported Any packing ${packedName} is rewritten without changing its bytes`, () => {
        const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
        const typeUrl = `type.googleapis.com/${packedName}`
        const original = { extra: { type_url: typeUrl, value: packedValue } }
        const converted = convertObjectJsonToProtoJson(type, JSON.stringify(original))
        assert.deepEqual(JSON.parse(converted), { extra: { '@type': typeUrl, ...packedJson } })
        assert.deepEqual(encodeMessage(type, converted).buffer, Buffer.from(type.encode(type.fromObject(original)).finish()))
    })
}

const anyHolderFiles = [{ path: 'any-holder.proto', text: `syntax = "proto3";
package a;
import "google/protobuf/any.proto";
message Holder {
    google.protobuf.Any extra = 1;
    repeated google.protobuf.Any extras = 2;
    map<string, google.protobuf.Any> by_name = 3;
}
` }]

for(const [field, wrap] of [
    ['extra', value => ({ extra: value })],
    ['extras', value => ({ extras: [value] })],
    ['by_name', value => ({ by_name: { k: value } })],
]) {
    for(const [value, problem] of [
        [{ type_url: 'type.googleapis.com/a.Holder', value: '' }, 'is written as its "@type" and the fields of the message it holds, not as {"type_url": ..., "value": ...}'],
        [{ foo: 1 }, 'needs "@type", naming the message it holds'],
        [{ '@type': 1 }, 'needs "@type", naming the message it holds'],
    ]) {
        test(`an Any without a string @type in ${field} is refused with ${Object.keys(value)[0]}`, () => {
            const type = loadProtoFiles(anyHolderFiles).lookupType('a.Holder')
            const message = `a.Holder.${field}: a google.protobuf.Any ${problem}`
            assert.throws(() => encodeMessage(type, JSON.stringify(wrap(value))), { message, messageWithoutValues: message })
        })
    }
}

test('an Any inside a packed message also needs @type, and an empty Any still encodes', () => {
    const root = loadProtoFiles(anyHolderFiles)
    const type = root.lookupType('a.Holder')
    const message = 'a.Holder.extra: a google.protobuf.Any needs "@type", naming the message it holds'
    assert.throws(() => encodeMessage(type, '{"extra": {"@type": "type.googleapis.com/a.Holder", "extra": {"foo": 1}}}'), { message, messageWithoutValues: message })
    const anyType = root.lookupType('google.protobuf.Any')
    const rootMessage = 'google.protobuf.Any: a google.protobuf.Any needs "@type", naming the message it holds'
    assert.throws(() => encodeMessage(anyType, '{"foo": 1}'), { message: rootMessage, messageWithoutValues: rootMessage })
    assert.deepEqual(encodeMessage(type, '{"extra": {}}').buffer, Buffer.from(type.encode(type.fromObject({ extra: {} })).finish()))
})

test('an imported Any with an unknown packed type is kept as written and refused on send', () => {
    const type = loadProtoFiles(anyHolderFiles).lookupType('a.Holder')
    const text = '{"extra": {"type_url": "type.googleapis.com/unknown.Message", "value": "CAE="}}'
    assert.equal(convertObjectJsonToProtoJson(type, text), text)
    const message = 'a.Holder.extra: a google.protobuf.Any needs "@type", naming the message it holds'
    assert.throws(() => encodeMessage(type, text), { message, messageWithoutValues: message })
})


for(const number of ['9007199254740991.1', '1.0000000000000001', '1e-1000']) {
    for(const [field, json] of [
        ['int64_value', `{"int64Value": ${number}}`],
        ['big_wrapper', `{"bigWrapper": ${number}}`],
    ]) {
        test(`a fraction rounded by JavaScript is refused in ${field}: ${number}`, () => {
            const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
            assert.throws(() => encodeMessage(type, json), {
                message: `demo.v1.Everything.${field}: not an integer: ${number}`,
                messageWithoutValues: `demo.v1.Everything.${field}: not an integer`,
            })
        })
    }
    for(const [field, json] of [
        ['ids', `{"ids": [${number}]}`],
        ['counts', `{"counts": {"k": ${number}}}`],
    ]) {
        test(`a fraction rounded by JavaScript is refused in ${field}: ${number}`, () => {
            const type = loadProtoFiles([{ path: 'holder.proto', text: 'syntax = "proto3";\npackage h;\nmessage Holder {\n    repeated int64 ids = 1;\n    map<string, int64> counts = 2;\n}\n' }]).lookupType('h.Holder')
            assert.throws(() => encodeMessage(type, json), {
                message: `h.Holder.${field}: not an integer: ${number}`,
                messageWithoutValues: `h.Holder.${field}: not an integer`,
            })
        })
    }
}

test('decimal and exponent numbers that are integers still encode in every 64-bit field type', () => {
    const type = loadProtoFiles([{ path: 'integers.proto', text: `syntax = "proto3";
package i;
import "google/protobuf/wrappers.proto";
message Holder {
    int64 signed = 1;
    uint64 unsigned = 2;
    sint64 zigzag = 3;
    fixed64 fixed = 4;
    sfixed64 signed_fixed = 5;
    google.protobuf.Int64Value signed_wrapper = 6;
    google.protobuf.UInt64Value unsigned_wrapper = 7;
    repeated int64 ids = 8;
    map<string, int64> counts = 9;
}
` }]).lookupType('i.Holder')
    for(const [number, digits] of [['1.0', '1'], ['1e3', '1000'], ['2.50e1', '25'], ['-0e5', '0']]) {
        const json = `{"signed": ${number}, "unsigned": ${number}, "zigzag": ${number}, "fixed": ${number}, "signedFixed": ${number}, "signedWrapper": ${number}, "unsignedWrapper": ${number}, "ids": [${number}], "counts": {"k": ${number}}}`
        const expected = Object.fromEntries(['signed', 'unsigned', 'zigzag', 'fixed', 'signedFixed', 'signedWrapper', 'unsignedWrapper'].map(field => [field, digits]))
        assert.deepEqual(JSON.parse(encodeMessage(type, json).json), { ...expected, ids: [digits], counts: { k: digits } })
    }
    for(const field of ['signed', 'unsigned', 'zigzag', 'fixed', 'signedFixed', 'signedWrapper', 'unsignedWrapper']) {
        const name = type.fieldsArray.find(item => item.jsonName === field).fullName.slice(1)
        assert.throws(() => encodeMessage(type, `{"${field}": 1.0000000000000001}`), { message: `${name}: not an integer: 1.0000000000000001`, messageWithoutValues: `${name}: not an integer` })
    }
})

test('fractions keep their numeric values in doubles, Struct, Value and ListValue', () => {
    const type = loadProtoFiles([{ path: 'numbers.proto', text: `syntax = "proto3";
import "google/protobuf/struct.proto";
message Numbers {
    double number = 1;
    google.protobuf.Struct attributes = 2;
    google.protobuf.Value value = 3;
    google.protobuf.ListValue list = 4;
}
` }]).lookupType('Numbers')
    for(const number of ['1.50', '9007199254740991.1', '1.0000000000000001', '1e-1000']) {
        const value = Number(number)
        const json = `{"number": ${number}, "attributes": {"n": ${number}, "list": [${number}]}, "value": ${number}, "list": [${number}]}`
        assert.deepEqual(JSON.parse(encodeMessage(type, json).json), { number: value, attributes: { n: value, list: [value] }, value, list: [value] })
    }
})

test('an import rewrite of a wrapper keeps a sibling decimal number as written', () => {
    const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
    const converted = convertObjectJsonToProtoJson(type, '{"nickname": {"value": "text"}, "doubleValue": 1.50}')
    assert.equal(converted, '{\n    "nickname": "text",\n    "doubleValue": 1.50\n}')
})


test('a relay folder that cannot be created fails the load and closes the connection', async() => {
    const server = await startSilentServer()
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    const mkdtempSync = fs.mkdtempSync
    const listen = net.Server.prototype.listen
    let requestedPrefix = null
    Object.defineProperty(process, 'platform', { value: 'linux' })
    fs.mkdtempSync = prefix => {
        requestedPrefix = prefix
        throw Object.assign(new Error('mkdtemp EACCES: permission denied'), { code: 'EACCES', syscall: 'mkdtemp' })
    }
    net.Server.prototype.listen = function() {
        process.nextTick(() => this.emit('error', Object.assign(new Error('listen EACCES: permission denied'), { code: 'EACCES', syscall: 'listen' })))
        return this
    }
    try {
        const target = plaintextTarget(server)
        const error = await loadSchema({ target, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 1000 }).catch(e => e)
        assert.equal(await waitUntil(() => server.sockets.size === 0), true)
        assert.equal(error.message, 'mkdtemp EACCES: permission denied')
        assert.equal(path.basename(requestedPrefix), 'restfox-grpc-')
    } finally {
        Object.defineProperty(process, 'platform', platform)
        fs.mkdtempSync = mkdtempSync
        net.Server.prototype.listen = listen
        server.close()
    }
})

test('a relay that cannot listen removes its private folder and closes the connection', async() => {
    const server = await startSilentServer()
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    const mkdtempSync = fs.mkdtempSync
    const listen = net.Server.prototype.listen
    const folders = []
    Object.defineProperty(process, 'platform', { value: 'linux' })
    fs.mkdtempSync = prefix => {
        const folder = mkdtempSync(prefix)
        folders.push(folder)
        return folder
    }
    net.Server.prototype.listen = function() {
        process.nextTick(() => this.emit('error', Object.assign(new Error('listen EACCES: permission denied'), { code: 'EACCES', syscall: 'listen' })))
        return this
    }
    try {
        const error = await loadSchema({ target: plaintextTarget(server), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 1000 }).catch(e => e)
        assert.equal(error.message, 'listen EACCES: permission denied')
        assert.equal(await waitUntil(() => server.sockets.size === 0), true)
        assert.equal(folders.length, 1)
        assert.equal(fs.existsSync(folders[0]), false)
    } finally {
        Object.defineProperty(process, 'platform', platform)
        fs.mkdtempSync = mkdtempSync
        net.Server.prototype.listen = listen
        for(const folder of folders) {
            fs.rmSync(folder, { recursive: true, force: true })
        }
        server.close()
    }
})

test('a Unix relay uses a private folder and removes it after the call', { skip: process.platform === 'win32' }, async() => {
    const listen = net.Server.prototype.listen
    const folders = new Set()
    net.Server.prototype.listen = function(...args) {
        if(typeof args[0] === 'string') {
            folders.add(path.dirname(args[0]))
        }
        return listen.apply(this, args)
    }
    try {
        const events = await runCall({ protoFiles: demoProtoFiles, method: 'Count', messages: ['{"to":1,"intervalMs":100}'] }, event => {
            if(event.type === 'connected') {
                assert.ok(folders.size > 0)
                for(const folder of folders) {
                    assert.match(path.basename(folder), /^restfox-grpc-/)
                    assert.equal(fs.statSync(folder).mode & 0o077, 0)
                }
            }
        })
        assert.equal(lastOf(events).name, 'OK')
        assert.ok(folders.size > 0)
        for(const folder of folders) {
            assert.equal(await waitUntil(() => !fs.existsSync(folder)), true)
        }
    } finally {
        net.Server.prototype.listen = listen
    }
})

test('an undecodable reply is kept as bytes and the call carries on to the server status', async() => {
    const server = new grpc.Server()
    const passBuffer = buffer => buffer
    const invalid = Buffer.from([10, 5, 65])
    const unknown = Buffer.from([10, 2, 104, 105, 80, 7])
    const normal = Buffer.from([10, 2, 111, 107])
    server.addService({ Watch: {
        path: '/demo.v1.Raw/Watch', requestStream: false, responseStream: true,
        requestSerialize: passBuffer, requestDeserialize: passBuffer, responseSerialize: passBuffer, responseDeserialize: passBuffer,
    } }, { Watch(call) {
        call.write(invalid)
        call.write(unknown)
        call.write(normal)
        call.end()
    } })
    const port = await new Promise((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, boundPort) => error ? reject(error) : resolve(boundPort)))
    try {
        const events = await runCall({
            target: plaintextTarget({ port }), service: 'demo.v1.Raw', method: 'Watch', messages: ['{}'],
            protoFiles: [{ path: 'raw.proto', text: 'syntax="proto3"; package demo.v1; service Raw { rpc Watch(HelloReply) returns(stream HelloReply); } message HelloReply { string text = 1; }' }],
        })
        assert.equal(lastOf(events).name, 'OK')
        const received = ofType(events, 'received')
        assert.equal(received.length, 3)
        assert.equal(received[0].bytes, invalid.toString('base64'))
        assert.equal(received[0].json, undefined)
        assert.match(received[0].decodeError, /^Not a demo.v1.HelloReply: /)
        assert.equal(received[1].bytes, unknown.toString('base64'))
        assert.deepEqual(received[1].unknownFields, ['10'])
        assert.deepEqual(JSON.parse(received[1].json), { text: 'hi' })
        assert.equal(received[2].bytes, undefined)
        assert.deepEqual(JSON.parse(received[2].json), { text: 'ok' })
    } finally {
        server.forceShutdown()
    }
})

for(const [name, message, unknownFields] of [
    ['top-level fields', { newer: 'kept' }, ['10']],
    ['nested messages', { child: { text: 'known', newer: 'kept' } }, ['child.10']],
    ['repeated elements', { children: [{ newer: 'kept' }, { newer: 'also kept' }] }, ['children.10']],
    ['map values', { values: { first: { newer: 'kept' }, second: { newer: 'also kept' } } }, ['values.value.10']],
    ['Any payloads', { extra: { type_url: 'type.googleapis.com/h.Inner', value: Buffer.from([82, 4, 107, 101, 112, 116]) } }, ['extra.10']],
]) {
    test(`received bytes name unknown fields in ${name}`, () => {
        const oldText = 'syntax="proto3"; package h; import "google/protobuf/any.proto"; message Inner { string text = 1; } message Reply { Inner child = 1; repeated Inner children = 2; map<string, Inner> values = 3; google.protobuf.Any extra = 4; }'
        const oldType = loadProtoFiles([{ path: 'reply.proto', text: oldText }]).lookupType('h.Reply')
        const newerText = oldText.replace('string text = 1;', 'string text = 1; string newer = 10;').replace('message Reply {', 'message Reply { string newer = 10;')
        const newerType = loadProtoFiles([{ path: 'reply.proto', text: newerText }]).lookupType('h.Reply')
        const bytes = Buffer.from(newerType.encode(newerType.fromObject(message)).finish())
        const received = decodeReceivedMessage(oldType, bytes)
        assert.deepEqual(received.unknownFields, unknownFields)
        assert.equal(received.bytes, bytes.toString('base64'))
        assert.equal(typeof received.json, 'string')
    })
}

test('unknown field paths are unique and follow wire order across Any payloads and messages', () => {
    const text = 'syntax="proto3"; import "google/protobuf/any.proto"; message Inner { string text = 1; } message Reply { Inner child = 1; google.protobuf.Any extra = 2; }'
    const type = loadProtoFiles([{ path: 'reply.proto', text }]).lookupType('Reply')
    const any = Buffer.from(type.encode({ extra: { type_url: 'type.googleapis.com/Inner', value: Buffer.from([40, 1, 24, 2, 40, 3]) } }).finish())
    const bytes = Buffer.concat([Buffer.from([80, 1]), any, Buffer.from([10, 4, 48, 1, 40, 2, 72, 1, 80, 2, 10, 2, 48, 2])])
    const received = decodeReceivedMessage(type, bytes)
    assert.deepEqual(received.unknownFields, ['10', 'extra.5', 'extra.3', 'child.6', 'child.5', '9'])
    assert.equal(received.bytes, bytes.toString('base64'))
})

test('unknown fields of well-known messages and map entries are named without reading scalar bytes as messages', () => {
    const text = 'syntax="proto3"; import "google/protobuf/empty.proto"; message Inner { string text = 1; } message Reply { google.protobuf.Empty empty = 1; map<string, Inner> values = 2; bytes data = 3; }'
    const type = loadProtoFiles([{ path: 'reply.proto', text }]).lookupType('Reply')
    for(const [bytes, unknownFields] of [
        [Buffer.from([10, 2, 8, 1]), ['empty.1']],
        [Buffer.from([18, 9, 10, 1, 107, 18, 2, 10, 0, 24, 1]), ['values.3']],
    ]) {
        assert.deepEqual(decodeReceivedMessage(type, bytes).unknownFields, unknownFields)
    }
    const bytes = Buffer.from(type.encode({ data: Buffer.from([80, 1]) }).finish())
    assert.equal(decodeReceivedMessage(type, bytes).bytes, undefined)
    assert.equal(decodeReceivedMessage(type, Buffer.alloc(0)).unknownFields, undefined)
})

test('an invalid Any payload keeps the bytes and decoding error', () => {
    const text = 'syntax="proto3"; import "google/protobuf/any.proto"; message Inner { string text = 1; } message Reply { google.protobuf.Any extra = 1; }'
    const type = loadProtoFiles([{ path: 'reply.proto', text }]).lookupType('Reply')
    const bytes = Buffer.from(type.encode({ extra: { type_url: 'type.googleapis.com/Inner', value: Buffer.from([10, 5, 65]) } }).finish())
    const received = decodeReceivedMessage(type, bytes)
    assert.equal(received.json, undefined)
    assert.match(received.decodeError, /^Not a Reply: /)
})

test('a field whose JSON name is __proto__ keeps its value', () => {
    const text = 'syntax="proto3"; message Inner { string b = 1 [json_name="__proto__"]; } message Reply { string a = 1 [json_name="__proto__"]; Inner child = 2; map<string, Inner> values = 3; }'
    const type = loadProtoFiles([{ path: 'reply.proto', text }]).lookupType('Reply')
    const bytes = Buffer.from(type.encode(type.fromObject({ a: 'kept', child: { b: 'nested' }, values: { first: { b: 'mapped' } } })).finish())
    const json = JSON.parse(decodeReceivedMessage(type, bytes).json)
    assert.equal(Object.hasOwn(json, '__proto__'), true)
    assert.equal(json['__proto__'], 'kept')
    assert.equal(Object.hasOwn(json.child, '__proto__') && json.child['__proto__'], 'nested')
    assert.equal(Object.hasOwn(json.values.first, '__proto__') && json.values.first['__proto__'], 'mapped')
})

test('an empty Any decodes as a whole message', () => {
    const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
    const bytes = Buffer.from(type.encode({ extra: {} }).finish())
    const received = decodeReceivedMessage(type, bytes)
    assert.equal(received.decodeError, undefined)
    assert.equal(received.bytes, undefined)
    assert.deepEqual(JSON.parse(received.json).extra, {})
})

test('closed enum values the schema cannot describe keep the received bytes', () => {
    const type = protobuf.parse('syntax="proto2"; message Reply { enum Choice { ZERO = 0; } optional Choice choice = 1; repeated Choice choices = 2; }').root.lookupType('Reply')
    for(const [bytes, unknownFields] of [[Buffer.from([8, 1]), ['1']], [Buffer.from([18, 2, 0, 1]), ['2']]]) {
        const received = decodeReceivedMessage(type, bytes)
        assert.deepEqual(received.unknownFields, unknownFields)
        assert.equal(received.bytes, bytes.toString('base64'))
    }
})

for(const position of ['root', 'nested', 'repeated', 'map', 'oneof', 'packed']) {
    test(`an Any with an empty type URL keeps its payload bytes at ${position}`, () => {
        const root = loadProtoFiles([{ path: 'reply.proto', text: 'syntax="proto3"; import "google/protobuf/any.proto"; message Reply { google.protobuf.Any extra = 1; repeated google.protobuf.Any extras = 2; map<string, google.protobuf.Any> values = 3; oneof choice { google.protobuf.Any chosen = 4; } }' }])
        const anyType = root.lookupType('google.protobuf.Any')
        const any = { type_url: '', value: Buffer.from([8, 1]) }
        const type = position === 'root' || position === 'packed' ? anyType : root.lookupType('Reply')
        const message = {
            root: any, nested: { extra: any }, repeated: { extras: [any] }, map: { values: { key: any } }, oneof: { chosen: any },
            packed: { type_url: 'type.googleapis.com/google.protobuf.Any', value: anyType.encode(any).finish() },
        }[position]
        const bytes = Buffer.from(type.encode(message).finish())
        const received = decodeReceivedMessage(type, bytes)
        assert.equal(received.json, undefined)
        assert.equal(received.bytes, bytes.toString('base64'))
        assert.match(received.decodeError, /an Any with a payload needs a type URL/)
    })
}
