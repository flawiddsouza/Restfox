import { test, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import grpc from '@grpc/grpc-js'
import protobuf from 'protobufjs'
import descriptor from 'protobufjs/ext/descriptor'
import { limits, loadSchema, startCall, describeConnectionFailure, convertInsomniaMessage } from './grpc.js'
import { loadProtoFiles } from './grpc-schema.js'
import { createExample, decodeMessage, decodeReceivedMessage, encodeMessage, convertObjectJsonToProtoJson } from './grpc-json.js'
import { openTunnel } from './proxy-tunnel.js'
import { startForwardProxy, startSocks5Proxy, closeTestProxies } from './test-proxies.js'
import { startServer } from '../../test-api-grpc/server.js'

const protosDir = path.join(__dirname, '..', '..', 'test-api-grpc', 'protos')
const certificate = fs.readFileSync(path.join(__dirname, '..', '..', 'test-api', 'files', 'localhost.crt'), 'utf8')

const readProto = name => ({ path: name, text: fs.readFileSync(path.join(protosDir, name), 'utf8') })
const demoProtoFiles = [readProto('demo/v1/demo.proto'), readProto('demo/v1/types.proto')]

const servers = {}

beforeAll(async() => {
    servers.plaintext = await startServer({})
    servers.tls = await startServer({ tls: true })
    servers.v1alpha = await startServer({ reflection: 'v1alpha' })
    servers.noReflection = await startServer({ reflection: false })
})

afterAll(() => {
    for(const server of Object.values(servers)) {
        server.close()
    }
})

afterEach(() => closeTestProxies())

const plaintextTarget = server => ({ address: `127.0.0.1:${server.port}`, host: '127.0.0.1', port: server.port, tls: false })
const tlsTarget = server => ({ address: `localhost:${server.port}`, host: 'localhost', port: server.port, tls: true })
const trusting = { rejectUnauthorized: true, caCertificates: [] }

// runs a call to its terminal event. onEvent(event, call, events) can drive it, such as sending or cancelling
function runCall(spec, onEvent = () => {}) {
    return new Promise(resolve => {
        const events = []
        let call = null
        const queued = []
        call = startCall({
            target: plaintextTarget(servers.plaintext),
            connection: trusting,
            metadata: [],
            protoFiles: null,
            service: 'demo.v1.Demo',
            deadlineMs: 0,
            ...spec,
        }, event => {
            events.push(event)
            if(call === null) {
                queued.push(event)
            } else {
                onEvent(event, call, events)
            }
            if(event.type === 'status' || event.type === 'error') {
                resolve(events)
            }
        })
        for(const event of queued) {
            onEvent(event, call, events)
        }
        onEvent({ type: 'started' }, call, events)
    })
}

const ofType = (events, type) => events.filter(event => event.type === type)
const lastOf = events => events[events.length - 1]

test('server reflection v1 lists the services and their methods, without the reflection services', async() => {
    const schema = await loadSchema({ target: plaintextTarget(servers.plaintext), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 })

    expect(schema.source).toBe('reflection')
    expect(schema.services.map(service => service.name)).toEqual(['demo.v1.Demo'])
    const methods = schema.services[0].methods
    expect(methods.map(method => [method.name, method.requestStream, method.responseStream])).toEqual([
        ['SayHello', false, false],
        ['Fail', false, false],
        ['Count', false, true],
        ['Sum', true, false],
        ['Chat', true, true],
        ['Everything', false, false],
    ])
    expect(methods[0]).toMatchObject({ path: '/demo.v1.Demo/SayHello', inputType: 'demo.v1.HelloRequest', outputType: 'demo.v1.HelloReply' })
    expect(JSON.parse(methods[0].example)).toEqual({ name: '' })
    expect(methods[0].example).toBe('{\n  "name": ""\n}')
})

test('server reflection falls back to v1alpha', async() => {
    const schema = await loadSchema({ target: plaintextTarget(servers.v1alpha), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 })
    expect(schema.services[0].methods.map(method => method.name)).toContain('Everything')

    const events = await runCall({ target: plaintextTarget(servers.v1alpha), method: 'SayHello', messages: ['{"name":"old"}'] })
    expect(JSON.parse(ofType(events, 'received')[0].json)).toEqual({ message: 'Hello old' })
})

test('a server without reflection says so', async() => {
    const error = await loadSchema({ target: plaintextTarget(servers.noReflection), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    expect(error.message).toBe('The server does not offer server reflection')
    expect(error.code).toBe('REFLECTION_UNIMPLEMENTED')

    const events = await runCall({ target: plaintextTarget(servers.noReflection), method: 'SayHello' })
    expect(lastOf(events)).toMatchObject({ type: 'error', message: 'The server does not offer server reflection' })
})

test('a server that is not running fails reflection with the reason', async() => {
    const unused = await startServer({})
    unused.close()
    const error = await loadSchema({ target: plaintextTarget(unused), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    expect(error.message).toBe(`127.0.0.1:${unused.port} refused the connection`)
    expect(error.code).toBe('CONNECTION_FAILED')
})

test('proto files load with their imports and the well-known types, and calls use them', async() => {
    const schema = await loadSchema({ target: plaintextTarget(servers.noReflection), connection: trusting, metadata: [], protoFiles: demoProtoFiles, timeoutMs: 0 })
    expect(schema.source).toBe('proto')
    expect(schema.services[0].methods.map(method => method.name)).toEqual(['SayHello', 'Fail', 'Count', 'Sum', 'Chat', 'Everything'])

    const events = await runCall({ target: plaintextTarget(servers.noReflection), protoFiles: demoProtoFiles, method: 'SayHello', messages: ['{"name":"proto"}'] })
    expect(JSON.parse(ofType(events, 'received')[0].json)).toEqual({ message: 'Hello proto' })
    expect(lastOf(events)).toMatchObject({ type: 'status', code: 0, name: 'OK' })
})

test('imports resolve when the folder picked is below the import root', () => {
    const root = loadProtoFiles([readProto('demo/v1/demo.proto'), readProto('demo/v1/types.proto')].map(file => ({ ...file, path: path.basename(file.path) })))
    expect(root.lookupService('demo.v1.Demo').methodsArray).toHaveLength(6)
})

test('an import missing from the proto files is named', () => {
    expect(() => loadProtoFiles([readProto('demo/v1/demo.proto')])).toThrow('demo/v1/demo.proto imports demo/v1/types.proto, which is not among the proto files')
})

test('a syntax error names the file and the line', async() => {
    const protoFiles = [{ path: 'broken/bad.proto', text: 'syntax = "proto3";\n\nmessage A {\n    string name = 1\n}\n' }]
    const error = await loadSchema({ target: plaintextTarget(servers.plaintext), connection: trusting, metadata: [], protoFiles, timeoutMs: 0 }).catch(e => e)
    expect(error.message).toContain('broken/bad.proto')
    expect(error.message).toContain('line 5')
})

test('a type defined twice names the file', () => {
    const text = 'syntax = "proto3";\nmessage A {}\n'
    expect(() => loadProtoFiles([{ path: 'one.proto', text }, { path: 'two.proto', text }])).toThrow(/two\.proto/)
})

test('unary call: sent, headers, received, OK status', async() => {
    const events = await runCall({ method: 'SayHello', messages: ['{"name":"Restfox"}'] })

    expect(events.map(event => event.type)).toEqual(['connected', 'sentMetadata', 'sent', 'headers', 'received', 'status'])
    expect(JSON.parse(ofType(events, 'sent')[0].json)).toEqual({ name: 'Restfox' })
    expect(JSON.parse(ofType(events, 'received')[0].json)).toEqual({ message: 'Hello Restfox' })
    expect(lastOf(events)).toMatchObject({ code: 0, name: 'OK' })
    for(const event of events) {
        expect(typeof event.time).toBe('number')
    }
})

test('server streaming call receives every message, then the status', async() => {
    const events = await runCall({ method: 'Count', messages: ['{"to":3,"intervalMs":5}'] })
    expect(ofType(events, 'received').map(event => JSON.parse(event.json))).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
    expect(lastOf(events)).toMatchObject({ type: 'status', name: 'OK' })
})

test('client streaming call sends each message, then gets one reply', async() => {
    const events = await runCall({ method: 'Sum' }, (event, call) => {
        if(event.type === 'started') {
            call.send('{"value":"9007199254740993"}')
            call.send('{"value":1}')
            call.end()
        }
    })
    expect(ofType(events, 'sent').map(event => JSON.parse(event.json))).toEqual([{ value: '9007199254740993' }, { value: '1' }])
    expect(JSON.parse(ofType(events, 'received')[0].json)).toEqual({ total: '9007199254740994', count: 2 })
    expect(lastOf(events)).toMatchObject({ type: 'status', name: 'OK' })
})

test('bidi call: a message that cannot be encoded is a sendError and the stream stays open', async() => {
    const events = await runCall({ method: 'Chat', messages: ['{"text":"first"}'] }, (event, call, all) => {
        if(event.type === 'started') {
            call.send('{"text": ')
            call.send('{"txet":"typo"}')
            call.send('{"text":5}')
        }
        if(event.type === 'received' && ofType(all, 'received').length === 1) {
            call.send('{"text":"second"}')
        }
        if(event.type === 'received' && ofType(all, 'received').length === 2) {
            call.end()
        }
    })

    const sendErrors = ofType(events, 'sendError').map(event => event.message)
    expect(sendErrors).toHaveLength(3)
    expect(sendErrors[0]).toMatch(/^The message is not valid JSON: /)
    expect(sendErrors[1]).toBe('demo.v1.ChatMessage: unknown field: "txet"')
    expect(sendErrors[2]).toMatch(/^demo\.v1\.ChatMessage\.text: expected string/)
    expect(ofType(events, 'received').map(event => JSON.parse(event.json).text)).toEqual(['echo: first', 'echo: second'])
    expect(lastOf(events)).toMatchObject({ type: 'status', name: 'OK' })
})

test('a unary request that cannot be encoded fails before connecting', async() => {
    const events = await runCall({ method: 'SayHello', messages: ['{"name":1}'] })
    expect(events.map(event => event.type)).toEqual(['sendError', 'error'])
})

test('no event comes before startCall returns, even with the schema cached', async() => {
    await loadSchema({ target: plaintextTarget(servers.plaintext), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 })
    const events = []
    let returned = false
    const done = new Promise(resolve => {
        startCall({ target: plaintextTarget(servers.plaintext), connection: trusting, metadata: [], protoFiles: null, service: 'demo.v1.Demo', method: 'SayHello', deadlineMs: 0, messages: ['{"name":1}'] }, event => {
            events.push({ type: event.type, returned })
            if(event.type === 'error') {
                resolve()
            }
        })
        returned = true
    })
    await done
    expect(events).toEqual([{ type: 'sendError', returned: true }, { type: 'error', returned: true }])
})

test('an unknown method is an error', async() => {
    const events = await runCall({ method: 'Nope' })
    expect(events).toEqual([expect.objectContaining({ type: 'error', message: 'demo.v1.Demo has no method Nope' })])
    const otherEvents = await runCall({ service: 'demo.v1.Missing', method: 'Nope' })
    expect(lastOf(otherEvents)).toMatchObject({ type: 'error', message: 'The schema has no service demo.v1.Missing' })
})

test('cancel ends the call with CANCELLED, before and after it connects', async() => {
    const events = await runCall({ method: 'Count', messages: ['{"to":0,"intervalMs":5}'] }, (event, call) => {
        if(event.type === 'received') {
            call.cancel()
        }
    })
    expect(lastOf(events)).toMatchObject({ type: 'status', code: 1, name: 'CANCELLED' })
    expect(ofType(events, 'status')).toHaveLength(1)

    const early = await runCall({ method: 'Count', messages: ['{"to":0}'] }, (event, call) => {
        if(event.type === 'started') {
            call.cancel()
        }
    })
    expect(early).toEqual([expect.objectContaining({ type: 'status', code: 1, name: 'CANCELLED' })])
})

test('a deadline ends the call with DEADLINE_EXCEEDED', async() => {
    const events = await runCall({ method: 'SayHello', messages: ['{"name":"slow"}'], deadlineMs: 300 })
    expect(lastOf(events)).toMatchObject({ type: 'status', code: 4, name: 'DEADLINE_EXCEEDED' })
    expect(lastOf(events).time).toBeLessThan(2000)
})

test('metadata goes out, headers and trailers come back, -bin values as base64', async() => {
    const binary = Buffer.from([0, 1, 2, 250, 255]).toString('base64')
    const events = await runCall({
        method: 'SayHello',
        messages: ['{}'],
        metadata: [['X-Echo-Name', 'value'], ['x-echo-data-bin', binary], ['content-type', 'text/plain'], ['grpc-timeout', '1S'], ['user-agent', 'restfox-test']],
    })

    expect(ofType(events, 'sentMetadata')[0]?.indexes).toEqual([0, 1, 4])
    const headers = ofType(events, 'headers')[0].metadata
    expect(headers).toContainEqual(['x-echo-name', 'value'])
    expect(headers).toContainEqual(['x-echo-data-bin', binary])
    expect(lastOf(events).trailers).toContainEqual(['x-echo-name', 'value'])
    expect(lastOf(events).trailers).toContainEqual(['x-echo-data-bin', binary])
    expect(lastOf(events).name).toBe('OK')
})

test('metadata grpc-js refuses is an error naming it', async() => {
    const events = await runCall({ method: 'SayHello', metadata: [['x-bad', 'caf\u00e9']] })
    expect(lastOf(events)).toMatchObject({ type: 'error' })
    expect(lastOf(events).message).toMatch(/^Metadata x-bad: /)
})

test('error details in grpc-status-details-bin are decoded', async() => {
    const events = await runCall({ method: 'Fail', messages: ['{"code":5,"message":"user 42 not found"}'] })
    const status = lastOf(events)

    expect(status).toMatchObject({ type: 'status', code: 5, name: 'NOT_FOUND', details: 'user 42 not found' })
    // the server's text, which history keeps as it came
    expect(status).not.toHaveProperty('detailsWithoutValues')
    expect(JSON.parse(status.errorDetails)).toEqual({
        code: 5,
        message: 'user 42 not found',
        details: [{
            '@type': 'type.googleapis.com/google.rpc.BadRequest',
            fieldViolations: [{ field: 'code', description: 'asked for status 5', reason: '' }],
        }],
    })
})

test('an UNAVAILABLE status the server sent is kept as it came, even when it quotes a connection error', async() => {
    const details = 'Database down. Last error: connect ECONNREFUSED 10.0.0.1:5432'
    const events = await runCall({ method: 'Fail', messages: [JSON.stringify({ code: 14, message: details })] })
    expect(lastOf(events)).toMatchObject({ type: 'status', name: 'UNAVAILABLE', details })
    expect(lastOf(events)).not.toHaveProperty('detailsWithoutValues')
})

test('TLS fails without trusting the certificate, passes with it as a CA certificate or with verification off', async() => {
    const target = tlsTarget(servers.tls)

    const refused = await loadSchema({ target, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    expect(refused.message).toMatch(/^The server's certificate is not trusted /)
    const refusedCall = await runCall({ target, protoFiles: demoProtoFiles, method: 'SayHello' })
    expect(lastOf(refusedCall)).toMatchObject({ type: 'status', name: 'UNAVAILABLE' })

    const withCA = { rejectUnauthorized: true, caCertificates: [certificate] }
    const schema = await loadSchema({ target, connection: withCA, metadata: [], protoFiles: null, timeoutMs: 5000 })
    expect(schema.services[0].name).toBe('demo.v1.Demo')
    const trustedCall = await runCall({ target, connection: withCA, method: 'SayHello', messages: ['{"name":"tls"}'] })
    expect(JSON.parse(ofType(trustedCall, 'received')[0].json)).toEqual({ message: 'Hello tls' })

    // the address by IP, which the certificate does not name, passes too when verification is off
    const byIp = { address: `127.0.0.1:${servers.tls.port}`, host: '127.0.0.1', port: servers.tls.port, tls: true }
    const unverifiedCall = await runCall({ target: byIp, connection: { rejectUnauthorized: false, caCertificates: [] }, method: 'SayHello', messages: ['{"name":"insecure"}'] })
    expect(JSON.parse(ofType(unverifiedCall, 'received')[0].json)).toEqual({ message: 'Hello insecure' })
})

test('Everything round trips every kind of field', async() => {
    const message = {
        int64Value: '9007199254740993',
        uint64Value: '18446744073709551615',
        doubleValue: 1.5,
        boolValue: true,
        bytesValue: Buffer.from('hi there').toString('base64'),
        color: 'COLOR_GREEN',
        tags: ['a', 'b'],
        counts: { one: 1, two: 2 },
        point: { x: 3, y: -4 },
        choiceNumber: 7,
        maybe: '',
        createdAt: '2026-10-20T10:00:00.500Z',
        timeout: '1.500s',
        attributes: { name: 'restfox', list: [1, true, null] },
        extra: { '@type': 'type.googleapis.com/demo.v1.Point', x: 1, y: 2 },
        nickname: 'fox',
        bigWrapper: '-9007199254740993',
        snake_case_name: 'snake',
        points: [{ x: 1 }],
    }

    const events = await runCall({ method: 'Everything', messages: [JSON.stringify(message)] })
    const received = JSON.parse(ofType(events, 'received')[0].json)

    expect(received).toEqual({
        int64Value: '9007199254740993',
        uint64Value: '18446744073709551615',
        doubleValue: 1.5,
        boolValue: true,
        bytesValue: Buffer.from('hi there').toString('base64'),
        color: 'COLOR_GREEN',
        tags: ['a', 'b'],
        counts: { one: 1, two: 2 },
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
    })
})

test('a large integer typed as a JSON number keeps its digits', async() => {
    const events = await runCall({ method: 'Everything', messages: ['{"int64Value": 9007199254740993}'] })
    expect(JSON.parse(ofType(events, 'sent')[0].json).int64Value).toBe('9007199254740993')
    expect(JSON.parse(ofType(events, 'received')[0].json).int64Value).toBe('9007199254740993')
})

test('a received message shows its default values, but not absent messages, oneofs or optional fields', async() => {
    const events = await runCall({ method: 'Everything', messages: ['{}'] })
    expect(JSON.parse(ofType(events, 'sent')[0].json)).toEqual({ int64Value: '0', uint64Value: '0', doubleValue: 0, boolValue: false, bytesValue: '', color: 'COLOR_UNSPECIFIED', tags: [], counts: {}, snakeCaseName: '', points: [] })
    expect(JSON.parse(ofType(events, 'received')[0].json)).toEqual({
        int64Value: '0',
        uint64Value: '0',
        doubleValue: 0,
        boolValue: false,
        bytesValue: '',
        color: 'COLOR_UNSPECIFIED',
        tags: [],
        counts: {},
        snakeCaseName: '',
        points: [],
    })
})

test('the example has every field, one oneof member, and encodes', () => {
    const root = loadProtoFiles(demoProtoFiles)
    const type = root.lookupType('demo.v1.Everything')
    const example = createExample(type)

    expect(example).toMatchObject({
        int64Value: '0',
        uint64Value: '0',
        doubleValue: 0,
        boolValue: false,
        bytesValue: '',
        color: 'COLOR_UNSPECIFIED',
        tags: [''],
        counts: { key: 0 },
        point: { x: 0, y: 0 },
        choiceText: '',
        maybe: '',
        timeout: '1s',
        attributes: {},
        extra: {},
        nickname: '',
        bigWrapper: '0',
        snakeCaseName: '',
        points: [{ x: 0, y: 0 }],
    })
    expect(example).not.toHaveProperty('choiceNumber')
    expect(example.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    expect(() => encodeMessage(type, JSON.stringify(example))).not.toThrow()
})

test('the example stops a type that holds itself at its second appearance', () => {
    const root = loadProtoFiles([{ path: 'tree.proto', text: 'syntax = "proto3";\nmessage Node {\n    string name = 1;\n    Node child = 2;\n    repeated Node children = 3;\n    map<int32, Node> by_id = 4;\n}\n' }])
    expect(createExample(root.lookupType('Node'))).toEqual({ name: '', child: {}, children: [{}], byId: { 0: {} } })
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

    expect(example.length).toBeLessThan(100000)
    expect(Object.keys(JSON.parse(example).b.b.b.b)).toEqual(['a', 'b'])
    expect(example).not.toContain('"leaf"')
})

test('an error for a message that cannot be encoded has a form that quotes nothing the user wrote, in sendError and error events', async() => {
    const unary = await runCall({ method: 'SayHello', messages: ['{"name":{"token":"private-first"}}'] })
    expect(unary.map(event => [event.type, event.message, event.messageWithoutValues])).toEqual([
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
    expect(sendErrors.map(event => [event.index, event.messageWithoutValues])).toEqual([
        [0, 'demo.v1.ChatMessage.text: expected string'],
        [1, 'The message is not valid JSON'],
        [2, 'demo.v1.ChatMessage: unknown field'],
    ])
    expect(sendErrors.every(event => event.message.includes('private-'))).toBe(true)
    expect(lastOf(bidi)).toMatchObject({ type: 'status', name: 'OK' })
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
    expect(withoutValues.map(([text]) => [text, errorFor(text).messageWithoutValues])).toEqual(withoutValues)

    const oneofError = errorFor('{"choiceText": "a", "choiceNumber": 1}')
    expect(oneofError.message).toBe('demo.v1.Everything: multiple values for oneof choice')
    expect(oneofError.messageWithoutValues).toBe(oneofError.message)
})

test('reflection and calls go through openTunnel, a host only the proxy reaches', async() => {
    const proxy = await startForwardProxy()
    const proxyUrl = new URL(proxy.url)
    const connection = { rejectUnauthorized: true, caCertificates: [], openTunnel: (host, port) => openTunnel(proxyUrl, host, port, {}) }
    const target = { address: `grpc.restfox.invalid:${servers.plaintext.port}`, host: 'grpc.restfox.invalid', port: servers.plaintext.port, tls: false }

    // without the proxy a made-up host does not resolve. A malformed one, as the system's resolver fails it at once
    // where an unknown name can take seconds
    const unresolved = { address: `grpc..invalid:${servers.plaintext.port}`, host: 'grpc..invalid', port: servers.plaintext.port, tls: false }
    const direct = await loadSchema({ target: unresolved, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    expect(direct.message).toBe('Could not look up grpc..invalid')

    const schema = await loadSchema({ target, connection, metadata: [], protoFiles: null, timeoutMs: 5000 })
    expect(schema.services[0].name).toBe('demo.v1.Demo')

    const events = await runCall({ target, connection, method: 'Chat' }, (event, call) => {
        if(event.type === 'started') {
            call.send('{"text":"through the proxy"}')
            call.end()
        }
    })
    expect(JSON.parse(ofType(events, 'received')[0].json)).toEqual({ text: 'echo: through the proxy' })
    expect(lastOf(events)).toMatchObject({ type: 'status', name: 'OK' })
    expect(proxy.received.map(request => request.requestLine)).toContain(`CONNECT grpc.restfox.invalid:${servers.plaintext.port} HTTP/1.1`)
})

test('TLS goes through a SOCKS5 tunnel and checks the certificate against the target host', async() => {
    const proxy = await startSocks5Proxy()
    const proxyUrl = new URL(proxy.url)
    proxyUrl.username = 'user'
    proxyUrl.password = 'pass'
    const connection = { rejectUnauthorized: true, caCertificates: [certificate], openTunnel: (host, port) => openTunnel(proxyUrl, host, port, {}) }

    const events = await runCall({ target: tlsTarget(servers.tls), connection, method: 'SayHello', messages: ['{"name":"socks"}'] })
    expect(JSON.parse(ofType(events, 'received')[0].json)).toEqual({ message: 'Hello socks' })
    expect(proxy.logins).toEqual([{ username: 'user', password: 'pass' }])
})

test('openTunnel giving null connects directly', async() => {
    const connection = { ...trusting, openTunnel: async() => null }
    const events = await runCall({ connection, method: 'SayHello', messages: ['{"name":"direct"}'] })
    expect(JSON.parse(ofType(events, 'received')[0].json)).toEqual({ message: 'Hello direct' })
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
        expect(lastOf(events)).toMatchObject({ type: 'status', name: 'OK' })
        expect(JSON.parse(ofType(events, 'received')[0].json)).toEqual({ message: 'Hello again' })
        expect(proxy.tunnels.length).toBe(2)
    } finally {
        proxy.close()
    }
}, 8000)

test('a tunnel the proxy resets while the relay holds it, before the client connects, is not given to the client and does not crash the app', async() => {
    const proxy = await startTunnellingProxy()
    const tunnels = []
    const uncaught = []
    const onUncaught = error => uncaught.push(error)
    process.on('uncaughtException', onUncaught)
    // the relay listens right after it takes the first tunnel, and the client connects only once it listens, so the
    // proxy resets that tunnel, with no listener of this test on it, between the two
    let held = false
    const listen = net.Server.prototype.listen
    const listenSpy = vi.spyOn(net.Server.prototype, 'listen').mockImplementation(function(...args) {
        if(held || !String(args[0]).includes('restfox-grpc-')) {
            return listen.apply(this, args)
        }
        held = true
        const closed = new Promise(resolve => tunnels[0].once('close', resolve))
        proxy.tunnels[0].resetAndDestroy()
        closed.then(() => listen.apply(this, args))
        return this
    })
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
        expect(held).toBe(true)
        expect(uncaught).toEqual([])
        expect(lastOf(events)).toMatchObject({ type: 'status', name: 'OK' })
        expect(tunnels.length).toBe(2)
    } finally {
        listenSpy.mockRestore()
        process.removeListener('uncaughtException', onUncaught)
        proxy.close()
    }
}, 8000)

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
        expect(lastOf(events)).toMatchObject({ type: 'status', name: 'UNAVAILABLE' })
        expect(Date.now() - started).toBeLessThan(2000)
    } finally {
        proxy.close()
    }
}, 8000)

// a server that takes connections and never answers, as a stuck server or a proxy that never answers CONNECT does
function startSilentServer() {
    const sockets = new Set()
    const server = net.createServer(socket => {
        // reads what comes, so it sees the other side close
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

test('connection-specific metadata names, which HTTP/2 refuses, are left out and the call goes through', async() => {
    const metadata = ['keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'http2-settings', 'te'].map(name => [name, 'x'])
    const events = await runCall({ method: 'SayHello', messages: ['{"name":"meta"}'], metadata, deadlineMs: 3000 })
    expect(lastOf(events)).toMatchObject({ type: 'status', name: 'OK' })
})

test('a -bin metadata value that is not base64 is an error naming it', async() => {
    const events = await runCall({ method: 'SayHello', metadata: [['x-trace-bin', 'hello world']] })
    expect(lastOf(events)).toMatchObject({ type: 'error', message: 'Metadata x-trace-bin: a -bin value is base64, such as aGVsbG8=' })

    // letters base64 uses, but a length whose last letter decodes to no whole byte, which would send other bytes
    for(const value of ['A', 'AAAAA', 'AA=']) {
        const cutShort = await runCall({ method: 'SayHello', metadata: [['x-trace-bin', value]] })
        expect(lastOf(cutShort)).toMatchObject({ type: 'error', message: 'Metadata x-trace-bin: a -bin value is base64, such as aGVsbG8=' })
    }
    // unpadded base64, which gRPC also takes
    const unpadded = await runCall({ method: 'SayHello', messages: ['{}'], metadata: [['x-echo-data-bin', 'aGVsbG8']] })
    expect(ofType(unpadded, 'headers')[0].metadata).toContainEqual(['x-echo-data-bin', 'aGVsbG8='])
})

test('a metadata name or value gRPC cannot carry is an error naming it, which quotes nothing else the user wrote', async() => {
    // gRPC would quote the name lowercased, where a masked prompt value in it could no longer be found to hide
    const badName = await runCall({ method: 'SayHello', metadata: [['x-ABC?', 'v']] })
    expect(lastOf(badName)).toMatchObject({ type: 'error', message: 'Metadata x-ABC?: a name has only letters, digits, -, _ and .', messageWithoutValues: 'Metadata ******: a name has only letters, digits, -, _ and .' })

    const badValue = await runCall({ method: 'SayHello', metadata: [['x-note', 'line one\nline two']] })
    expect(lastOf(badValue)).toMatchObject({ type: 'error', message: 'Metadata x-note: a value has only printable ASCII characters, a -bin name takes any bytes as base64' })

    // User-Agent goes out from a channel option, and is checked as the other names are
    const badUserAgent = await runCall({ method: 'SayHello', metadata: [['User-Agent', 'café']] })
    expect(lastOf(badUserAgent)).toMatchObject({ type: 'error', message: 'Metadata User-Agent: a value has only printable ASCII characters, a -bin name takes any bytes as base64', messageWithoutValues: 'Metadata ******: a value has only printable ASCII characters, a -bin name takes any bytes as base64' })
})

test('a -bin name in two Metadata rows, which the UI joins with a comma as HTTP headers are, sends both values', async() => {
    const events = await runCall({ method: 'SayHello', messages: ['{}'], metadata: [['x-echo-data-bin', 'AAE=, +v8=']] })
    expect(lastOf(events)).toMatchObject({ type: 'status', name: 'OK' })
    expect(ofType(events, 'headers')[0].metadata.filter(([name]) => name === 'x-echo-data-bin')).toEqual([['x-echo-data-bin', 'AAE='], ['x-echo-data-bin', '+v8=']])
})

test('a proxy that never answers ends the call at its deadline and reflection at its timeout', async() => {
    const proxy = await startSilentServer()
    try {
        const proxyUrl = new URL(`http://127.0.0.1:${proxy.port}`)
        const connection = { rejectUnauthorized: true, caCertificates: [], openTunnel: (host, port) => openTunnel(proxyUrl, host, port, {}) }
        const target = { address: 'grpc.restfox.invalid:50051', host: 'grpc.restfox.invalid', port: 50051, tls: false }

        const events = await runCall({ target, connection, protoFiles: demoProtoFiles, method: 'SayHello', deadlineMs: 500 })
        expect(lastOf(events)).toMatchObject({ type: 'status', code: 4, name: 'DEADLINE_EXCEEDED' })
        expect(lastOf(events).time).toBeLessThan(2000)

        // the same with the methods loaded by reflection
        const reflected = await runCall({ target, connection, method: 'SayHello', deadlineMs: 500 })
        expect(lastOf(reflected)).toMatchObject({ type: 'status', code: 4, name: 'DEADLINE_EXCEEDED' })

        const startedAt = Date.now()
        const error = await loadSchema({ target, connection, metadata: [], protoFiles: null, timeoutMs: 500 }).catch(e => e)
        expect(error).toBeInstanceOf(Error)
        expect(Date.now() - startedAt).toBeLessThan(2000)

        // with no Request Timeout, the wait for the tunnel ends and names the proxy, not the server
        const tunnelTimeoutMs = limits.tunnelTimeoutMs
        limits.tunnelTimeoutMs = 300
        try {
            const unanswered = await loadSchema({ target, connection, metadata: [], protoFiles: null, timeoutMs: 0 }).catch(e => e)
            expect(unanswered.message).toBe('Could not connect to the proxy: The proxy did not answer within 0.3 s')
        } finally {
            limits.tunnelTimeoutMs = tunnelTimeoutMs
        }
    } finally {
        proxy.close()
    }
}, 8000)

test('reflection with no Request Timeout still gives up on a server that never answers', async() => {
    const server = await startSilentServer()
    const reflectionTimeoutMs = limits.reflectionTimeoutMs
    limits.reflectionTimeoutMs = 500
    try {
        const target = { address: `127.0.0.1:${server.port}`, host: '127.0.0.1', port: server.port, tls: false }
        const error = await loadSchema({ target, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 0 }).catch(e => e)
        expect(error).toBeInstanceOf(Error)
        expect(await waitUntil(() => server.sockets.size === 0)).toBe(true)
    } finally {
        limits.reflectionTimeoutMs = reflectionTimeoutMs
        server.close()
    }
}, 8000)

test('a methods load stops when its signal aborts, as when the page that asked is gone, and closes the connection', async() => {
    const server = await startSilentServer()
    try {
        const target = { address: `127.0.0.1:${server.port}`, host: '127.0.0.1', port: server.port, tls: false }
        const abortController = new AbortController()
        setTimeout(() => abortController.abort(), 300)
        const startedAt = Date.now()
        const error = await loadSchema({ target, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 0, signal: abortController.signal }).catch(e => e)
        expect(error).toBeInstanceOf(Error)
        expect(Date.now() - startedAt).toBeLessThan(2000)
        expect(await waitUntil(() => server.sockets.size === 0)).toBe(true)
    } finally {
        server.close()
    }
}, 8000)

test('a methods load stopped, or a call past its deadline, while the proxy has not answered closes the connection to the proxy', async() => {
    const proxy = await startSilentServer()
    try {
        const proxyUrl = new URL(`http://127.0.0.1:${proxy.port}`)
        const connection = { rejectUnauthorized: true, caCertificates: [], openTunnel: (host, port, signal) => openTunnel(proxyUrl, host, port, {}, signal) }
        const target = { address: 'grpc.restfox.invalid:50051', host: 'grpc.restfox.invalid', port: 50051, tls: false }

        const abortController = new AbortController()
        setTimeout(() => abortController.abort(), 300)
        const error = await loadSchema({ target, connection, metadata: [], protoFiles: null, timeoutMs: 0, signal: abortController.signal }).catch(e => e)
        expect(error).toBeInstanceOf(Error)
        // well before the proxy's own limit of limits.tunnelTimeoutMs
        expect(await waitUntil(() => proxy.sockets.size === 0, 2000)).toBe(true)

        const events = await runCall({ target, connection, protoFiles: demoProtoFiles, method: 'SayHello', deadlineMs: 300 })
        expect(lastOf(events)).toMatchObject({ type: 'status', name: 'DEADLINE_EXCEEDED' })
        expect(await waitUntil(() => proxy.sockets.size === 0, 2000)).toBe(true)
    } finally {
        proxy.close()
    }
}, 8000)

test('a methods load stopped, or a call past its deadline, while the proxy has not answered a later tunnel closes the connection to the proxy', async() => {
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
        const error = await loadSchema({ target, connection, metadata: [], protoFiles: null, timeoutMs: 0, signal: abortController.signal }).catch(e => e)
        expect(error).toBeInstanceOf(Error)
        expect(connections).toBeGreaterThan(1)
        // well before the proxy's own limit of limits.tunnelTimeoutMs
        expect(await waitUntil(() => sockets.size === 0, 2000)).toBe(true)

        connections = 0
        tunnelsOpened = 0
        const events = await runCall({ target, connection, protoFiles: demoProtoFiles, method: 'SayHello', deadlineMs: 500 })
        expect(lastOf(events)).toMatchObject({ type: 'status', name: 'DEADLINE_EXCEEDED' })
        expect(connections).toBeGreaterThan(1)
        expect(await waitUntil(() => sockets.size === 0, 2000)).toBe(true)
    } finally {
        for(const socket of sockets) {
            socket.destroy()
        }
        proxy.close()
    }
}, 8000)

test('Stop while the methods load by reflection closes the connection', async() => {
    const server = await startSilentServer()
    try {
        const target = { address: `127.0.0.1:${server.port}`, host: '127.0.0.1', port: server.port, tls: false }
        const events = await runCall({ target, method: 'Chat' }, (event, call) => {
            if(event.type === 'started') {
                setTimeout(() => call.cancel(), 300)
            }
        })
        expect(lastOf(events)).toMatchObject({ type: 'status', name: 'CANCELLED' })
        expect(await waitUntil(() => server.sockets.size === 0)).toBe(true)
    } finally {
        server.close()
    }
}, 8000)

test('a relay that cannot listen, as in a temp folder that cannot be written, fails the load and closes the connection', async() => {
    const server = await startSilentServer()
    const listen = net.Server.prototype.listen
    const listenSpy = vi.spyOn(net.Server.prototype, 'listen').mockImplementation(function(...args) {
        if(!String(args[0]).includes('restfox-grpc-')) {
            return listen.apply(this, args)
        }
        process.nextTick(() => this.emit('error', Object.assign(new Error(`listen EACCES: permission denied ${args[0]}`), { code: 'EACCES', syscall: 'listen' })))
        return this
    })
    try {
        const target = { address: `127.0.0.1:${server.port}`, host: '127.0.0.1', port: server.port, tls: false }
        const error = await loadSchema({ target, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 0 }).catch(e => e)
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toMatch(/EACCES/)
        expect(await waitUntil(() => server.sockets.size === 0)).toBe(true)
    } finally {
        listenSpy.mockRestore()
        server.close()
    }
}, 8000)

test('a connection that fails says why in plain words and is not a reflection failure', async() => {
    const untrusted = await loadSchema({ target: tlsTarget(servers.tls), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    // Electron's Node writes self signed, without the hyphen
    expect(untrusted.message).toMatch(/^The server's certificate is not trusted \(self[- ]signed certificate\)\. Add its CA certificate in Settings > CA Certificates, or turn on Disable SSL Verification$/)
    expect(untrusted.code).toBe('CONNECTION_FAILED')
    // the copy history saves after a send that took a masked prompt value names the server as ******
    expect(untrusted.messageWithoutValues).toBe(untrusted.message)

    const untrustedCall = await runCall({ target: tlsTarget(servers.tls), protoFiles: demoProtoFiles, method: 'SayHello' })
    expect(lastOf(untrustedCall)).toMatchObject({ type: 'status', name: 'UNAVAILABLE', details: untrusted.message })

    const unused = await startServer({})
    unused.close()
    const refused = await loadSchema({ target: plaintextTarget(unused), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    expect(refused.message).toBe(`127.0.0.1:${unused.port} refused the connection`)
    expect(refused.messageWithoutValues).toBe('****** refused the connection')
    // a call that loads its methods by reflection ends as one with proto files does
    const refusedCall = await runCall({ target: plaintextTarget(unused), method: 'SayHello' })
    expect(lastOf(refusedCall)).toMatchObject({ type: 'status', name: 'UNAVAILABLE', details: refused.message, detailsWithoutValues: '****** refused the connection' })
    const refusedCallWithProtoFiles = await runCall({ target: plaintextTarget(unused), protoFiles: demoProtoFiles, method: 'SayHello' })
    expect(lastOf(refusedCallWithProtoFiles)).toMatchObject({ type: 'status', name: 'UNAVAILABLE', details: refused.message, detailsWithoutValues: '****** refused the connection' })

    // localhost has two addresses, so Node reports the refusal as an AggregateError with an empty message
    const refusedByName = await loadSchema({ target: { address: `localhost:${unused.port}`, host: 'localhost', port: unused.port, tls: false }, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    expect(refusedByName.message).toBe(`localhost:${unused.port} refused the connection`)
    expect(refusedByName.code).toBe('CONNECTION_FAILED')
    expect(refusedByName.messageWithoutValues).toBe('****** refused the connection')

    const plaintextAsTls = { address: `localhost:${servers.plaintext.port}`, host: 'localhost', port: servers.plaintext.port, tls: true }
    const notTls = await loadSchema({ target: plaintextAsTls, connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    expect(notTls.message).toBe('The server did not answer with TLS. For a server without TLS, start the address with grpc://')

    const byIp = { address: `127.0.0.1:${servers.tls.port}`, host: '127.0.0.1', port: servers.tls.port, tls: true }
    const otherName = await loadSchema({ target: byIp, connection: { rejectUnauthorized: true, caCertificates: [certificate] }, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    expect(otherName.message).toBe('The server\'s certificate is not for 127.0.0.1. Turn on Disable SSL Verification to connect anyway')
    expect(otherName.messageWithoutValues).toBe('The server\'s certificate is not for ******. Turn on Disable SSL Verification to connect anyway')
})

test('a TLS address that reaches a plaintext server says so, in OpenSSL\'s wording and in BoringSSL\'s, which Electron\'s Node uses', () => {
    const target = { address: 'localhost:50051', host: 'localhost', port: 50051, tls: true }
    const notTls = 'The server did not answer with TLS. For a server without TLS, start the address with grpc://'
    expect(describeConnectionFailure('No connection established. Last error: Error: C0EC0000:error:0A00010B:SSL routines:ssl3_get_record:wrong version number:openssl\\ssl\\record\\ssl3_record.c:354:. Resolution note: ', target)).toBe(notTls)
    expect(describeConnectionFailure('No connection established. Last error: Error: 105984:error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER:..\\..\\third_party\\boringssl\\src\\ssl\\tls_record.cc:127:. Resolution note: ', target)).toBe(notTls)
})

test('a message counts as sent only once it leaves, and connected comes first', async() => {
    const unused = await startServer({})
    unused.close()
    const refused = await runCall({ target: plaintextTarget(unused), protoFiles: demoProtoFiles, method: 'SayHello', messages: ['{"name":"x"}'] })
    expect(refused.map(event => event.type)).toEqual(['status'])

    const events = await runCall({ method: 'SayHello', messages: ['{"name":"a"}'] })
    expect(events.map(event => event.type)).toEqual(['connected', 'sentMetadata', 'sent', 'headers', 'received', 'status'])
    expect(ofType(events, 'sent')[0].index).toBe(0)
})

test('a sent message shows its default values, as a received one does', async() => {
    const events = await runCall({ method: 'Count', messages: ['{"to":2,"intervalMs":0}'] })
    expect(JSON.parse(ofType(events, 'sent')[0].json)).toEqual({ to: 2, intervalMs: 0 })
})

test('messages and send errors carry the number of the message they are about', async() => {
    const events = await runCall({ method: 'Chat' }, (event, call) => {
        if(event.type === 'started') {
            call.send('{"text":"one"}')
            call.send('{"nope":1}')
            call.send('{"text":"three"}')
            call.end()
        }
    })
    expect(ofType(events, 'sent').map(event => event.index)).toEqual([0, 2])
    expect(ofType(events, 'sendError').map(event => event.index)).toEqual([1])
})

test('an Any of a type the schema lacks is shown as its type and bytes, the rest of the message as usual', () => {
    const root = loadProtoFiles(demoProtoFiles)
    const type = root.lookupType('demo.v1.Everything')
    const buffer = type.encode(type.fromObject({
        int64_value: '5',
        created_at: { seconds: 1700000000, nanos: 0 },
        extra: { type_url: 'type.googleapis.com/other.v1.Unknown', value: Buffer.from([8, 1]) },
    })).finish()

    const json = JSON.parse(decodeMessage(type, buffer))
    expect(json.int64Value).toBe('5')
    expect(json.createdAt).toBe('2023-11-14T22:13:20Z')
    expect(json.extra).toEqual({ '@type': 'type.googleapis.com/other.v1.Unknown', value: 'CAE=' })
    expect(json).not.toHaveProperty('int64_value')
})

test('an Any of an unknown type in a map with 64-bit keys stays under its key', () => {
    const type = loadProtoFiles([{ path: 'map.proto', text: 'syntax = "proto3";\nimport "google/protobuf/any.proto";\nmessage Holder {\n    map<int64, google.protobuf.Any> anys = 1;\n    map<fixed64, google.protobuf.Any> unsigned_anys = 2;\n}\n' }]).lookupType('Holder')
    const any = { type_url: 'type.googleapis.com/other.v1.Unknown', value: Buffer.from([8, 1]) }
    const buffer = type.encode(type.fromObject({ anys: { '-5': any }, unsigned_anys: { '18446744073709551615': any } })).finish()
    const shown = { '@type': 'type.googleapis.com/other.v1.Unknown', value: 'CAE=' }
    expect(JSON.parse(decodeMessage(type, buffer))).toEqual({ anys: { '-5': shown }, unsignedAnys: { '18446744073709551615': shown } })
})

test('the well-known types protobufjs ships only as files, such as type.proto, resolve too', () => {
    const root = loadProtoFiles([{ path: 'uses.proto', text: 'syntax = "proto3";\nimport "google/protobuf/type.proto";\nimport "google/protobuf/api.proto";\nmessage Uses {\n    google.protobuf.Type type = 1;\n    google.protobuf.Api api = 2;\n}\n' }])
    expect(root.lookupType('Uses').fields.api.resolvedType.fullName).toBe('.google.protobuf.Api')
})

test('a proxy that cannot be reached is named as the proxy, not the server', async() => {
    const unused = await startServer({})
    unused.close()
    const proxyUrl = new URL(`http://127.0.0.1:${unused.port}`)
    const connection = { ...trusting, openTunnel: (host, port) => openTunnel(proxyUrl, host, port, {}) }
    const target = { address: 'grpc.example.com:443', host: 'grpc.example.com', port: 443, tls: true }

    const error = await loadSchema({ target, connection, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    expect(error.message).toBe(`Could not connect to the proxy: connect ECONNREFUSED 127.0.0.1:${unused.port}`)
    expect(error.code).toBe('CONNECTION_FAILED')
    const events = await runCall({ target, connection, protoFiles: demoProtoFiles, method: 'SayHello' })
    expect(lastOf(events)).toMatchObject({ type: 'status', name: 'UNAVAILABLE', details: error.message })
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
    const error = await loadSchema({ target: plaintextTarget(servers.plaintext), connection: reflection.connection, metadata: [], protoFiles: null, timeoutMs: 5000 }).catch(e => e)
    expect(error.message).toBe(`Could not connect to the proxy: connect ECONNREFUSED 127.0.0.1:${reflection.proxyPort}`)
    expect(error.code).toBe('CONNECTION_FAILED')

    const call = await connectThroughVanishingProxy()
    const events = await runCall({ connection: call.connection, protoFiles: demoProtoFiles, method: 'SayHello', deadlineMs: 5000 })
    expect(lastOf(events)).toMatchObject({ type: 'status', name: 'UNAVAILABLE', details: `Could not connect to the proxy: connect ECONNREFUSED 127.0.0.1:${call.proxyPort}` })
}, 15000)

test('a large integer keeps its digits in a map inside an Any, as outside one', () => {
    const type = loadProtoFiles([{ path: 'a.proto', text: 'syntax = "proto3";\npackage a;\nimport "google/protobuf/any.proto";\nmessage Inner {\n    map<string, int64> counts = 1;\n}\nmessage Outer {\n    google.protobuf.Any any = 1;\n    map<string, int64> counts = 2;\n}\n' }]).lookupType('a.Outer')
    const sent = JSON.parse(encodeMessage(type, '{"any": {"@type": "type.googleapis.com/a.Inner", "counts": {"k": 9007199254740993}}, "counts": {"k": 9007199254740993}}').json)
    expect(sent.any.counts.k).toBe('9007199254740993')
    expect(sent.counts.k).toBe('9007199254740993')
})

test('a large integer keeps its digits in a 64-bit field and stays a number elsewhere', () => {
    const root = loadProtoFiles(demoProtoFiles)
    const type = root.lookupType('demo.v1.Everything')
    const { json } = encodeMessage(type, '{"int64Value": 9223372036854775807, "bigWrapper": 9007199254740993, "attributes": {"n": 12345678901234567890, "list": [9007199254740993]}}')
    const sent = JSON.parse(json)
    expect(sent.int64Value).toBe('9223372036854775807')
    expect(sent.bigWrapper).toBe('9007199254740993')
    expect(typeof sent.attributes.n).toBe('number')
    expect(typeof sent.attributes.list[0]).toBe('number')
})

test('a 64-bit integer written with a decimal point or an exponent keeps its digits, as text and as a JSON number', () => {
    const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
    const sentFor = (int64Value, bigWrapper) => JSON.parse(encodeMessage(type, JSON.stringify({ int64Value, bigWrapper }).replace(/"#([^"]*)"/g, '$1')).json)
    expect(sentFor('9.007199254740993e15', '9007199254740993.0')).toMatchObject({ int64Value: '9007199254740993', bigWrapper: '9007199254740993' })
    expect(sentFor('#9.007199254740993e15', '#9007199254740993E0')).toMatchObject({ int64Value: '9007199254740993', bigWrapper: '9007199254740993' })
    expect(sentFor('-90071992547409930e-1', '1e3')).toMatchObject({ int64Value: '-9007199254740993', bigWrapper: '1000' })
    expect(() => encodeMessage(type, '{"int64Value": 1e300}')).toThrow('out of range for int64')
    expect(() => encodeMessage(type, '{"int64Value": "1.5"}')).toThrow('not an integer')
})

test('a well-known type written as protobufjs\'s object, as in Insomnia, is refused with how to write it, quoting nothing the user wrote', () => {
    const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
    const refusal = text => {
        try {
            encodeMessage(type, text)
        } catch(e) {
            return [e.message, e.messageWithoutValues]
        }
        return null
    }
    const both = message => [message, message]
    expect(refusal('{"nickname": {"value": "s3cret"}}')).toEqual(both('demo.v1.Everything.nickname: a google.protobuf.StringValue is written as its value, such as "text", not as {"value": ...}'))
    expect(refusal('{"bigWrapper": {"value": 5}}')).toEqual(both('demo.v1.Everything.big_wrapper: a google.protobuf.Int64Value is written as its value, such as 2, not as {"value": ...}'))
    expect(refusal('{"createdAt": {"seconds": 1}}')).toEqual(both('demo.v1.Everything.created_at: a google.protobuf.Timestamp is written as text, such as "2026-10-23T10:00:00Z", not as {"seconds": ...}'))
    expect(refusal('{"timeout": {"seconds": 90}}')).toEqual(both('demo.v1.Everything.timeout: a google.protobuf.Duration is written as text, such as "1.5s", not as {"seconds": ...}'))
    // in a list too, and other mistakes keep their own text
    expect(refusal('{"points": [{"x": 1}], "nickname": "ok", "createdAt": "2026-10-23T10:00:00Z"}')).toBeNull()
    expect(refusal('{"nickname": 5}')?.[0]).toBe('google.protobuf.StringValue.value: expected string: 5')
})

test('a 64-bit integer with a fraction is refused, not rounded, as text and as a JSON number, in maps and lists too', () => {
    const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
    const refusal = text => {
        try {
            encodeMessage(type, text)
        } catch(e) {
            return [e.message, e.messageWithoutValues]
        }
        return null
    }
    expect(refusal('{"int64Value": "9007199254740993.1"}')).toEqual(['demo.v1.Everything.int64_value: not an integer: "9007199254740993.1"', 'demo.v1.Everything.int64_value: not an integer'])
    expect(refusal('{"int64Value": 9007199254740993.5}')).toEqual(['demo.v1.Everything.int64_value: not an integer: 9007199254740993.5', 'demo.v1.Everything.int64_value: not an integer'])
    expect(refusal('{"bigWrapper": "1e-999"}')?.[1]).toBe('demo.v1.Everything.big_wrapper: not an integer')
    expect(refusal('{"int64Value": "-0e5"}')).toBeNull()

    const holder = loadProtoFiles([{ path: 'h.proto', text: 'syntax = "proto3";\npackage h;\nmessage Holder {\n    map<string, int64> counts = 1;\n    repeated uint64 ids = 2;\n}\n' }]).lookupType('h.Holder')
    expect(() => encodeMessage(holder, '{"counts": {"k": "2.5"}}')).toThrow('h.Holder.counts: not an integer: "2.5"')
    expect(() => encodeMessage(holder, '{"ids": [1, 9007199254740993.5]}')).toThrow('h.Holder.ids: not an integer: 9007199254740993.5')
    expect(JSON.parse(encodeMessage(holder, '{"counts": {"k": "9.007199254740993e15"}, "ids": [9007199254740993E0]}').json)).toEqual({ counts: { k: '9007199254740993' }, ids: ['9007199254740993'] })
})

// a reflection server that lists api.Api, whose file imports ops/ops.proto with a service it does not list, and
// missing.Gone, which it cannot describe
async function startPartialReflectionServer() {
    const root = new protobuf.Root()
    protobuf.parse.filename = 'ops/ops.proto'
    protobuf.parse('syntax = "proto3";\npackage ops;\nmessage Op { string id = 1; }\nservice Operations { rpc Get(Op) returns (Op); }\n', root, { keepCase: true })
    protobuf.parse.filename = 'api/api.proto'
    protobuf.parse('syntax = "proto3";\npackage api;\nimport "ops/ops.proto";\nservice Api { rpc Run(ops.Op) returns (ops.Op); }\n', root, { keepCase: true })
    protobuf.parse.filename = null
    root.resolveAll()
    const files = {}
    for(const file of root.toDescriptor('proto3').file) {
        // toDescriptor names a file by its base name and leaves out its imports
        if(file.name === 'api.proto') {
            file.name = 'api/api.proto'
            file.dependency = ['ops/ops.proto']
        } else {
            file.name = 'ops/ops.proto'
        }
        files[file.name] = descriptor.FileDescriptorProto.encode(file).finish()
    }

    return startReflectionServer(request => {
        if(request.message_request === 'list_services') {
            return { list_services_response: { service: [{ name: 'api.Api' }, { name: 'missing.Gone' }] } }
        }
        if(request.file_containing_symbol === 'api.Api') {
            return { file_descriptor_response: { file_descriptor_proto: [files['api/api.proto']] } }
        }
        if(request.file_by_filename && files[request.file_by_filename]) {
            return { file_descriptor_response: { file_descriptor_proto: [files[request.file_by_filename]] } }
        }
        return { error_response: { error_code: 5, error_message: 'not found' } }
    })
}

// a server that offers only server reflection v1, answering each request with what answer(request, stream) gives or
// resolves to, stream counting the reflection streams from 0
async function startReflectionServer(answer) {
    const reflection = protobuf.parse(`
syntax = "proto3";
message Request {
    oneof message_request {
        string file_by_filename = 3;
        string file_containing_symbol = 4;
        string list_services = 7;
    }
}
message Response {
    oneof message_response {
        Files file_descriptor_response = 4;
        Services list_services_response = 6;
        Failure error_response = 7;
    }
}
message Files { repeated bytes file_descriptor_proto = 1; }
message Services { repeated Service service = 1; }
message Service { string name = 1; }
message Failure { int32 error_code = 1; string error_message = 2; }
`, { keepCase: true }).root
    const Request = reflection.lookupType('Request')
    const Response = reflection.lookupType('Response')

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
            // answers go out in the order their requests came
            let answered = Promise.resolve()
            call.on('data', buffer => {
                const request = Request.decode(buffer)
                answered = answered.then(() => answer(request, stream))
                    .then(response => call.write(Buffer.from(Response.encode(Response.fromObject(response)).finish())))
            })
            call.on('end', () => answered.then(() => call.end()))
        },
    })
    const port = await new Promise((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, boundPort) => error ? reject(error) : resolve(boundPort)))
    return { port, close: () => server.forceShutdown() }
}

test('reflection lists only the services the server lists, and names those it could not describe', async() => {
    const server = await startPartialReflectionServer()
    try {
        const schema = await loadSchema({ target: plaintextTarget(server), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 })
        expect(schema.services.map(service => service.name)).toEqual(['api.Api'])
        expect(schema.missingServices).toEqual(['missing.Gone'])
    } finally {
        server.close()
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
    let releaseFirst
    const firstHeld = new Promise(resolve => releaseFirst = resolve)
    let firstAsked = false
    const server = await startReflectionServer(async(request, stream) => {
        if(request.message_request === 'list_services') {
            if(stream === 0) {
                firstAsked = true
                await firstHeld
            }
            return { list_services_response: { service: [{ name: 'api.Api' }] } }
        }
        return { file_descriptor_response: { file_descriptor_proto: [files[Math.min(stream, 1)]] } }
    })
    try {
        const load = () => loadSchema({ target: plaintextTarget(server), connection: trusting, metadata: [], protoFiles: null, timeoutMs: 5000 })
        const older = load()
        expect(await waitUntil(() => firstAsked)).toBe(true)
        const newer = await load()
        expect(newer.services[0].methods.map(method => method.name)).toEqual(['Run', 'Walk'])
        releaseFirst()
        expect((await older).services[0].methods.map(method => method.name)).toEqual(['Run'])

        // a call reads the methods the newer load found, so Walk reaches the server, which does not implement it
        const events = await runCall({ target: plaintextTarget(server), service: 'api.Api', method: 'Walk', messages: ['{}'] })
        expect(lastOf(events)).toMatchObject({ type: 'status', name: 'UNIMPLEMENTED' })
    } finally {
        server.close()
    }
})

test('a call connects through a named pipe or socket file, which other users of the machine cannot send through, not a loopback port', async() => {
    const listen = vi.spyOn(net.Server.prototype, 'listen')
    try {
        const events = await runCall({ method: 'SayHello', messages: ['{}'] })
        expect(lastOf(events)).toMatchObject({ type: 'status', name: 'OK' })
        const listenedOn = listen.mock.calls.map(args => args[0])
        expect(listenedOn.length).toBeGreaterThan(0)
        for(const where of listenedOn) {
            expect(where).toMatch(process.platform === 'win32' ? /^\\\\\.\\pipe\\restfox-grpc-/ : /\/restfox-grpc-[^/]+\/relay\.sock$/)
        }
    } finally {
        listen.mockRestore()
    }
})

test('a message from an Insomnia export, a wrapper written as {"value": true}, is rewritten into ProtoJSON and sends, the rest kept as written', () => {
    const exported = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'test-data', 'insomnia-import', 'grpc-address-in-environment.v4.json'), 'utf8'))
    const protoFile = exported.resources.find(resource => resource._type === 'proto_file')
    const protoFiles = [{ path: protoFile.name, text: protoFile.protoText }]
    const convert = name => {
        const request = exported.resources.find(resource => resource.name === name)
        const [service, method] = request.protoMethodName.split('/')
        return { written: request.body.text, converted: convertInsomniaMessage({ protoFiles, service, method, text: request.body.text }) }
    }

    const patch = convert('ModificarTarea (PATCH)')
    // the template tag stays, and so does the export's indent
    expect(patch.converted).toBe('{\n  "id": "{{ _.tarea_id_ejemplo }}",\n  "completada": true,\n  "prioridad": 2\n}')
    const requestType = loadProtoFiles(protoFiles).lookupType('tareas.ModificarTareaRequest')
    expect(JSON.parse(encodeMessage(requestType, patch.converted.replace('{{ _.tarea_id_ejemplo }}', '7')).json)).toMatchObject({ completada: true, prioridad: 2 })

    // a message ProtoJSON reads as written comes back as written
    const create = convert('CrearTarea')
    expect(create.converted).toBe(create.written)
})

test('an Insomnia message\'s well-known types are rewritten where ProtoJSON cannot read them, at any depth, and kept where it can or a tag stands in them', () => {
    const protoFiles = [{ path: 'a.proto', text: `syntax = "proto3";
package a;
import "google/protobuf/wrappers.proto";
import "google/protobuf/timestamp.proto";
import "google/protobuf/duration.proto";
import "google/protobuf/field_mask.proto";
import "google/protobuf/struct.proto";
import "google/protobuf/any.proto";
message Inner {
    google.protobuf.BoolValue flag = 1;
}
message Outer {
    google.protobuf.Timestamp at = 1;
    google.protobuf.Duration wait = 2;
    google.protobuf.FieldMask mask = 3;
    google.protobuf.Int64Value big = 4;
    repeated Inner inners = 5;
    map<string, Inner> by_name = 6;
    google.protobuf.Any any = 7;
    google.protobuf.Struct attributes = 8;
    google.protobuf.Timestamp tagged = 9;
    google.protobuf.StringValue name = 10;
}
service S { rpc Call(Outer) returns (Outer); }
` }]
    const convert = text => convertInsomniaMessage({ protoFiles, service: 'a.S', method: 'Call', text })

    expect(JSON.parse(convert(JSON.stringify({
        at: { seconds: 1, nanos: 500000000 },
        wait: { seconds: 90 },
        mask: { paths: ['a_b', 'c'] },
        inners: [{ flag: { value: true } }, { flag: false }],
        by_name: { k: { flag: { value: false } } },
        any: { '@type': 'type.googleapis.com/a.Inner', flag: { value: true } },
        attributes: { fields: 1 },
        tagged: { seconds: '{{ when }}' },
        name: { value: '{% uuid() %}' },
    })))).toEqual({
        at: '1970-01-01T00:00:01.500Z',
        wait: '90s',
        mask: 'aB,c',
        inners: [{ flag: true }, { flag: false }],
        by_name: { k: { flag: false } },
        any: { '@type': 'type.googleapis.com/a.Inner', flag: true },
        attributes: { fields: 1 },
        tagged: { seconds: '{{ when }}' },
        name: '{% uuid() %}',
    })

    // a large integer keeps its digits, a text that is not JSON comes back as it is
    expect(convert('{"big": {"value": 9223372036854775807}}')).toBe('{\n    "big": 9223372036854775807\n}')
    expect(convert('{"name": {{ name }}}')).toBe('{"name": {{ name }}}')
    // an object with a key that is no field of the type is another mistake, which ProtoJSON names
    expect(convert('{"at": {"secs": 1}}')).toBe('{"at": {"secs": 1}}')
})

// what encoding throws, as its text and the copy history saves, null when it encodes
function encodeError(encode) {
    try {
        encode()
    } catch(e) {
        return [e.message, e.messageWithoutValues]
    }
    return null
}

for(const [packedName, packedValue, packedJson] of [
    ['google.protobuf.Timestamp', 'CAE=', { value: '1970-01-01T00:00:01Z' }],
    ['demo.v1.Point', 'CAEQAg==', { x: 1, y: 2 }],
]) {
    test(`an imported Any packing ${packedName} is rewritten without changing its bytes`, () => {
        const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
        const typeUrl = `type.googleapis.com/${packedName}`
        const original = { extra: { type_url: typeUrl, value: packedValue } }
        const converted = convertObjectJsonToProtoJson(type, JSON.stringify(original))
        expect(JSON.parse(converted)).toEqual({ extra: { '@type': typeUrl, ...packedJson } })
        expect(encodeMessage(type, converted).buffer).toEqual(Buffer.from(type.encode(type.fromObject(original)).finish()))
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
            expect(encodeError(() => encodeMessage(type, JSON.stringify(wrap(value))))).toEqual([message, message])
        })
    }
}

test('an Any inside a packed message also needs @type, and an empty Any still encodes', () => {
    const root = loadProtoFiles(anyHolderFiles)
    const type = root.lookupType('a.Holder')
    const message = 'a.Holder.extra: a google.protobuf.Any needs "@type", naming the message it holds'
    expect(encodeError(() => encodeMessage(type, '{"extra": {"@type": "type.googleapis.com/a.Holder", "extra": {"foo": 1}}}'))).toEqual([message, message])
    const anyType = root.lookupType('google.protobuf.Any')
    const rootMessage = 'google.protobuf.Any: a google.protobuf.Any needs "@type", naming the message it holds'
    expect(encodeError(() => encodeMessage(anyType, '{"foo": 1}'))).toEqual([rootMessage, rootMessage])
    expect(encodeMessage(type, '{"extra": {}}').buffer).toEqual(Buffer.from(type.encode(type.fromObject({ extra: {} })).finish()))
})

test('an imported Any with an unknown packed type is kept as written and refused on send', () => {
    const type = loadProtoFiles(anyHolderFiles).lookupType('a.Holder')
    const text = '{"extra": {"type_url": "type.googleapis.com/unknown.Message", "value": "CAE="}}'
    expect(convertObjectJsonToProtoJson(type, text)).toBe(text)
    const message = 'a.Holder.extra: a google.protobuf.Any needs "@type", naming the message it holds'
    expect(encodeError(() => encodeMessage(type, text))).toEqual([message, message])
})

for(const number of ['9007199254740991.1', '1.0000000000000001', '1e-1000']) {
    for(const [field, json] of [
        ['int64_value', `{"int64Value": ${number}}`],
        ['big_wrapper', `{"bigWrapper": ${number}}`],
    ]) {
        test(`a fraction rounded by JavaScript is refused in ${field}: ${number}`, () => {
            const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
            expect(encodeError(() => encodeMessage(type, json))).toEqual([`demo.v1.Everything.${field}: not an integer: ${number}`, `demo.v1.Everything.${field}: not an integer`])
        })
    }
    for(const [field, json] of [
        ['ids', `{"ids": [${number}]}`],
        ['counts', `{"counts": {"k": ${number}}}`],
    ]) {
        test(`a fraction rounded by JavaScript is refused in ${field}: ${number}`, () => {
            const type = loadProtoFiles([{ path: 'holder.proto', text: 'syntax = "proto3";\npackage h;\nmessage Holder {\n    repeated int64 ids = 1;\n    map<string, int64> counts = 2;\n}\n' }]).lookupType('h.Holder')
            expect(encodeError(() => encodeMessage(type, json))).toEqual([`h.Holder.${field}: not an integer: ${number}`, `h.Holder.${field}: not an integer`])
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
        expect(JSON.parse(encodeMessage(type, json).json)).toEqual({ ...expected, ids: [digits], counts: { k: digits } })
    }
    for(const field of ['signed', 'unsigned', 'zigzag', 'fixed', 'signedFixed', 'signedWrapper', 'unsignedWrapper']) {
        const name = type.fieldsArray.find(item => item.jsonName === field).fullName.slice(1)
        expect(encodeError(() => encodeMessage(type, `{"${field}": 1.0000000000000001}`))).toEqual([`${name}: not an integer: 1.0000000000000001`, `${name}: not an integer`])
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
        expect(JSON.parse(encodeMessage(type, json).json)).toEqual({ number: value, attributes: { n: value, list: [value] }, value, list: [value] })
    }
})

test('an import rewrite of a wrapper keeps a sibling decimal number as written', () => {
    const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
    const converted = convertObjectJsonToProtoJson(type, '{"nickname": {"value": "text"}, "doubleValue": 1.50}')
    expect(converted).toBe('{\n    "nickname": "text",\n    "doubleValue": 1.50\n}')
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
        expect(await waitUntil(() => server.sockets.size === 0)).toBe(true)
        expect(error.message).toBe('mkdtemp EACCES: permission denied')
        expect(path.basename(requestedPrefix)).toBe('restfox-grpc-')
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
        expect(error.message).toBe('listen EACCES: permission denied')
        expect(await waitUntil(() => server.sockets.size === 0)).toBe(true)
        expect(folders.length).toBe(1)
        expect(fs.existsSync(folders[0])).toBe(false)
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

test.skipIf(process.platform === 'win32')('a Unix relay uses a private folder and removes it after the call', async() => {
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
                expect(folders.size).toBeGreaterThan(0)
                for(const folder of folders) {
                    expect(path.basename(folder)).toMatch(/^restfox-grpc-/)
                    expect(fs.statSync(folder).mode & 0o077).toBe(0)
                }
            }
        })
        expect(lastOf(events).name).toBe('OK')
        expect(folders.size).toBeGreaterThan(0)
        for(const folder of folders) {
            expect(await waitUntil(() => !fs.existsSync(folder))).toBe(true)
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
        expect(lastOf(events).name).toBe('OK')
        const received = ofType(events, 'received')
        expect(received).toHaveLength(3)
        expect(received[0]).toMatchObject({ bytes: invalid.toString('base64') })
        expect(received[0].json).toBeUndefined()
        expect(received[0].decodeError).toMatch(/^Not a demo.v1.HelloReply: /)
        expect(received[1]).toMatchObject({ bytes: unknown.toString('base64'), unknownFields: ['10'] })
        expect(JSON.parse(received[1].json)).toEqual({ text: 'hi' })
        expect(received[2].bytes).toBeUndefined()
        expect(JSON.parse(received[2].json)).toEqual({ text: 'ok' })
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
        expect(received.unknownFields).toEqual(unknownFields)
        expect(received.bytes).toBe(bytes.toString('base64'))
        expect(typeof received.json).toBe('string')
    })
}

test('unknown field paths are unique and follow wire order across Any payloads and messages', () => {
    const text = 'syntax="proto3"; import "google/protobuf/any.proto"; message Inner { string text = 1; } message Reply { Inner child = 1; google.protobuf.Any extra = 2; }'
    const type = loadProtoFiles([{ path: 'reply.proto', text }]).lookupType('Reply')
    const any = Buffer.from(type.encode({ extra: { type_url: 'type.googleapis.com/Inner', value: Buffer.from([40, 1, 24, 2, 40, 3]) } }).finish())
    const bytes = Buffer.concat([Buffer.from([80, 1]), any, Buffer.from([10, 4, 48, 1, 40, 2, 72, 1, 80, 2, 10, 2, 48, 2])])
    const received = decodeReceivedMessage(type, bytes)
    expect(received.unknownFields).toEqual(['10', 'extra.5', 'extra.3', 'child.6', 'child.5', '9'])
    expect(received.bytes).toBe(bytes.toString('base64'))
})

test('unknown fields of well-known messages and map entries are named without reading scalar bytes as messages', () => {
    const text = 'syntax="proto3"; import "google/protobuf/empty.proto"; message Inner { string text = 1; } message Reply { google.protobuf.Empty empty = 1; map<string, Inner> values = 2; bytes data = 3; }'
    const type = loadProtoFiles([{ path: 'reply.proto', text }]).lookupType('Reply')
    for(const [bytes, unknownFields] of [
        [Buffer.from([10, 2, 8, 1]), ['empty.1']],
        [Buffer.from([18, 9, 10, 1, 107, 18, 2, 10, 0, 24, 1]), ['values.3']],
    ]) {
        expect(decodeReceivedMessage(type, bytes).unknownFields).toEqual(unknownFields)
    }
    const bytes = Buffer.from(type.encode({ data: Buffer.from([80, 1]) }).finish())
    expect(decodeReceivedMessage(type, bytes).bytes).toBeUndefined()
    expect(decodeReceivedMessage(type, Buffer.alloc(0)).unknownFields).toBeUndefined()
})

test('an invalid Any payload keeps the bytes and decoding error', () => {
    const text = 'syntax="proto3"; import "google/protobuf/any.proto"; message Inner { string text = 1; } message Reply { google.protobuf.Any extra = 1; }'
    const type = loadProtoFiles([{ path: 'reply.proto', text }]).lookupType('Reply')
    const bytes = Buffer.from(type.encode({ extra: { type_url: 'type.googleapis.com/Inner', value: Buffer.from([10, 5, 65]) } }).finish())
    const received = decodeReceivedMessage(type, bytes)
    expect(received.json).toBeUndefined()
    expect(received.decodeError).toMatch(/^Not a Reply: /)
})

test('a field whose JSON name is __proto__ keeps its value', () => {
    const text = 'syntax="proto3"; message Inner { string b = 1 [json_name="__proto__"]; } message Reply { string a = 1 [json_name="__proto__"]; Inner child = 2; map<string, Inner> values = 3; }'
    const type = loadProtoFiles([{ path: 'reply.proto', text }]).lookupType('Reply')
    const bytes = Buffer.from(type.encode(type.fromObject({ a: 'kept', child: { b: 'nested' }, values: { first: { b: 'mapped' } } })).finish())
    const json = JSON.parse(decodeReceivedMessage(type, bytes).json)
    expect(Object.hasOwn(json, '__proto__')).toBe(true)
    expect(json['__proto__']).toBe('kept')
    expect(Object.hasOwn(json.child, '__proto__') && json.child['__proto__']).toBe('nested')
    expect(Object.hasOwn(json.values.first, '__proto__') && json.values.first['__proto__']).toBe('mapped')
})

test('an empty Any decodes as a whole message', () => {
    const type = loadProtoFiles(demoProtoFiles).lookupType('demo.v1.Everything')
    const bytes = Buffer.from(type.encode({ extra: {} }).finish())
    const received = decodeReceivedMessage(type, bytes)
    expect(received.decodeError).toBeUndefined()
    expect(received.bytes).toBeUndefined()
    expect(JSON.parse(received.json).extra).toEqual({})
})

test('closed enum values the schema cannot describe keep the received bytes', () => {
    const type = protobuf.parse('syntax="proto2"; message Reply { enum Choice { ZERO = 0; } optional Choice choice = 1; repeated Choice choices = 2; }').root.lookupType('Reply')
    for(const [bytes, unknownFields] of [[Buffer.from([8, 1]), ['1']], [Buffer.from([18, 2, 0, 1]), ['2']]]) {
        const received = decodeReceivedMessage(type, bytes)
        expect(received).toMatchObject({ unknownFields, bytes: bytes.toString('base64') })
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
        expect(received.json).toBeUndefined()
        expect(received.bytes).toBe(bytes.toString('base64'))
        expect(received.decodeError).toContain('an Any with a payload needs a type URL')
    })
}
