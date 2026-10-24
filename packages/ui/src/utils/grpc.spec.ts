// @vitest-environment edge-runtime

import { test, expect } from 'vitest'
import {
    getGrpcCallKind,
    getGrpcEndedMessage,
    getGrpcMessagePreview,
    getGrpcStatusColor,
    getGrpcStatusLabel,
    getGrpcStopLabel,
    getShortServiceName,
    describeGrpcSchema,
    mergeGrpcProtoFiles,
    parseGrpcTarget,
    readGrpcProtoFiles,
    searchGrpcMethods,
    type GrpcSchema,
} from './grpc'

test('parseGrpcTarget: plaintext for this machine and TLS for any other host when no scheme is given', () => {
    expect(parseGrpcTarget('localhost:50051')).toEqual({ address: 'localhost:50051', host: 'localhost', port: 50051, tls: false })
    expect(parseGrpcTarget('api.localhost:9000')).toEqual({ address: 'api.localhost:9000', host: 'api.localhost', port: 9000, tls: false })
    expect(parseGrpcTarget('127.0.0.1:50051')).toEqual({ address: '127.0.0.1:50051', host: '127.0.0.1', port: 50051, tls: false })
    expect(parseGrpcTarget('127.10.0.3')).toEqual({ address: '127.10.0.3:80', host: '127.10.0.3', port: 80, tls: false })
    expect(parseGrpcTarget('[::1]:50051')).toEqual({ address: '[::1]:50051', host: '::1', port: 50051, tls: false })
    expect(parseGrpcTarget('::1')).toEqual({ address: '[::1]:80', host: '::1', port: 80, tls: false })
    expect(parseGrpcTarget('grpc.example.com')).toEqual({ address: 'grpc.example.com:443', host: 'grpc.example.com', port: 443, tls: true })
    expect(parseGrpcTarget('  grpc.example.com:8443  ')).toEqual({ address: 'grpc.example.com:8443', host: 'grpc.example.com', port: 8443, tls: true })
    // a name that only starts like this machine's is another host
    expect(parseGrpcTarget('localhost.example.com:50051')).toMatchObject({ tls: true })
    expect(parseGrpcTarget('128.0.0.1:50051')).toMatchObject({ tls: true })
})

test('parseGrpcTarget: the scheme decides TLS and the default port', () => {
    expect(parseGrpcTarget('grpcs://localhost:50052')).toEqual({ address: 'localhost:50052', host: 'localhost', port: 50052, tls: true })
    expect(parseGrpcTarget('https://localhost')).toEqual({ address: 'localhost:443', host: 'localhost', port: 443, tls: true })
    expect(parseGrpcTarget('grpc://grpc.example.com')).toEqual({ address: 'grpc.example.com:80', host: 'grpc.example.com', port: 80, tls: false })
    expect(parseGrpcTarget('HTTP://grpc.example.com:8080')).toEqual({ address: 'grpc.example.com:8080', host: 'grpc.example.com', port: 8080, tls: false })
    expect(parseGrpcTarget('grpcs://[2001:db8::1]:443')).toEqual({ address: '[2001:db8::1]:443', host: '2001:db8::1', port: 443, tls: true })
    // a pasted url's trailing slash is no path
    expect(parseGrpcTarget('https://grpc.example.com/')).toEqual({ address: 'grpc.example.com:443', host: 'grpc.example.com', port: 443, tls: true })
})

test('parseGrpcTarget: an address it cannot call says why', () => {
    expect(parseGrpcTarget('')).toEqual({ error: 'Enter the server address, such as localhost:50051' })
    expect(parseGrpcTarget('localhost:50051/demo.v1.Demo')).toEqual({ error: 'A gRPC server address has no path, such as localhost:50051' })
    expect(parseGrpcTarget('https://grpc.example.com/api')).toEqual({ error: 'A gRPC server address has no path, such as localhost:50051' })
    expect(parseGrpcTarget('localhost:50051?a=1')).toEqual({ error: 'A gRPC server address has no path, such as localhost:50051' })
    expect(parseGrpcTarget('localhost:50051#x')).toEqual({ error: 'A gRPC server address has no path, such as localhost:50051' })
    expect(parseGrpcTarget('localhost:port')).toEqual({ error: 'The port is a number from 1 to 65535, such as localhost:50051' })
    expect(parseGrpcTarget('localhost:0')).toEqual({ error: 'The port is a number from 1 to 65535, such as localhost:50051' })
    expect(parseGrpcTarget('localhost:65536')).toEqual({ error: 'The port is a number from 1 to 65535, such as localhost:50051' })
    expect(parseGrpcTarget('ws://localhost:50051')).toHaveProperty('error')
    expect(parseGrpcTarget('[::1:50051')).toHaveProperty('error')
    expect(parseGrpcTarget(':50051')).toHaveProperty('error')
    expect(parseGrpcTarget('local host:50051')).toHaveProperty('error')
    expect(parseGrpcTarget('user@localhost:50051')).toEqual({ error: 'A gRPC server address has no user name. Send credentials in Metadata or Auth' })
})

test('parseGrpcTarget: a variable left in the address names itself as having no value', () => {
    expect(parseGrpcTarget('{{ nothere }}')).toEqual({ error: 'The variable nothere has no value in the environment' })
    expect(parseGrpcTarget('grpcs://{{ _.grpc_host }}:443')).toEqual({ error: 'The variable _.grpc_host has no value in the environment' })
})

test('the action button says Cancel for a unary call and Stop for a stream, Cancel while the kind is not known', () => {
    expect(getGrpcStopLabel('unary')).toBe('Cancel')
    expect(getGrpcStopLabel(null)).toBe('Cancel')
    expect(getGrpcStopLabel('serverStream')).toBe('Stop')
    expect(getGrpcStopLabel('bidiStream')).toBe('Stop')
})

test('getGrpcCallKind: the four kinds from whether each side streams', () => {
    expect(getGrpcCallKind({ requestStream: false, responseStream: false })).toBe('unary')
    expect(getGrpcCallKind({ requestStream: false, responseStream: true })).toBe('serverStream')
    expect(getGrpcCallKind({ requestStream: true, responseStream: false })).toBe('clientStream')
    expect(getGrpcCallKind({ requestStream: true, responseStream: true })).toBe('bidiStream')
})

test('status labels and colors: OK green, CANCELLED grey with no number, any other red with its number', () => {
    expect(getGrpcStatusLabel({ code: 0, name: 'OK' })).toBe('OK')
    expect(getGrpcStatusLabel({ code: 5, name: 'NOT_FOUND' })).toBe('NOT_FOUND (5)')
    expect(getGrpcStatusLabel({ code: 1, name: 'CANCELLED' })).toBe('CANCELLED')
    expect(getGrpcStatusColor({ code: 0 })).toBe('green')
    expect(getGrpcStatusColor({ code: 1 })).toBe('')
    expect(getGrpcStatusColor({ code: 14 })).toBe('red')
    expect(getGrpcStatusColor(null, 'The server does not offer server reflection')).toBe('red')
})

test('getGrpcEndedMessage: says how a call ended, and nothing for one that ended well', () => {
    const base = { kind: 'unary' as const, method: 'SayHello', events: [{ type: 'received' as const, json: '{}', time: 1 }], status: null, timeTaken: 4200, ended: 'completed' as const }
    expect(getGrpcEndedMessage({ ...base, status: { code: 0, name: 'OK', details: '' } })).toBeNull()
    expect(getGrpcEndedMessage({ ...base, status: { code: 5, name: 'NOT_FOUND', details: 'user 42 not found' } })).toBe('NOT_FOUND (5): user 42 not found')
    expect(getGrpcEndedMessage({ ...base, status: { code: 13, name: 'INTERNAL', details: '' } })).toBe('INTERNAL (13)')
    expect(getGrpcEndedMessage({ ...base, ended: 'cancelled', status: { code: 1, name: 'CANCELLED', details: 'Cancelled on client' } })).toBe('Cancelled after 4.2 s')
    expect(getGrpcEndedMessage({ ...base, kind: 'bidiStream', ended: 'cancelled' })).toBe('Stopped after 4.2 s')
    // stopped before its method was known, when the button said Cancel
    expect(getGrpcEndedMessage({ method: 'SayHello', events: [], status: null, timeTaken: 4200, ended: 'cancelled' })).toBe('Cancelled after 4.2 s')
    expect(getGrpcEndedMessage({ ...base, ended: 'timedOut', timeTaken: 30000, status: { code: 4, name: 'DEADLINE_EXCEEDED', details: 'Deadline exceeded' } })).toBe('Timed out after 30 s')
    expect(getGrpcEndedMessage({ ...base, ended: 'failed', error: 'The server does not offer server reflection' })).toBe('The server does not offer server reflection')
    // a failure that came with no reason still says it failed
    expect(getGrpcEndedMessage({ ...base, ended: 'failed', error: '' })).toBe('The call failed')
    expect(getGrpcEndedMessage({ ...base, ended: 'failed' })).toBe('The call failed')
})

test('getGrpcEndedMessage: a call whose method returns one message, ended OK with none or more, says so beside the OK the server sent', () => {
    const reply = { type: 'received' as const, json: '{}', time: 1 }
    const sent = { type: 'sent' as const, json: '{}', time: 0 }
    const ok = { code: 0, name: 'OK', details: '' }
    const base = { method: 'SayHello', status: ok, timeTaken: 5, ended: 'completed' as const }

    expect(getGrpcEndedMessage({ ...base, kind: 'unary', events: [sent, reply] })).toBeNull()
    expect(getGrpcEndedMessage({ ...base, kind: 'unary', events: [sent] })).toBe('SayHello returns one message. The server sent none.')
    expect(getGrpcEndedMessage({ ...base, kind: 'unary', events: [sent, reply, reply] })).toBe('SayHello returns one message. The server sent 2.')
    expect(getGrpcEndedMessage({ ...base, kind: 'clientStream', events: [sent, sent] })).toBe('SayHello returns one message. The server sent none.')
    // a streamed reply may be any number of messages, and a status other than OK says the call failed
    expect(getGrpcEndedMessage({ ...base, kind: 'serverStream', events: [sent] })).toBeNull()
    expect(getGrpcEndedMessage({ ...base, kind: 'bidiStream', events: [] })).toBeNull()
    expect(getGrpcEndedMessage({ ...base, kind: 'unary', events: [sent], status: { code: 5, name: 'NOT_FOUND', details: '' } })).toBe('NOT_FOUND (5)')
    // a method not known yet
    expect(getGrpcEndedMessage({ ...base, events: [] })).toBeNull()
})

const schema: GrpcSchema = {
    source: 'reflection',
    services: [
        {
            name: 'demo.v1.Demo',
            methods: ['SayHello', 'Fail', 'Count', 'Sum', 'Chat', 'Everything'].map(name => ({ name, path: `/demo.v1.Demo/${name}`, requestStream: false, responseStream: false, inputType: 'demo.v1.In', outputType: 'demo.v1.Out', example: '{}' })),
        },
        {
            name: 'shop.v2.Orders',
            methods: ['ListOrders', 'GetOrder', 'Order10', 'Order2', 'say_goodbye'].map(name => ({ name, path: `/shop.v2.Orders/${name}`, requestStream: false, responseStream: false, inputType: 'shop.v2.In', outputType: 'shop.v2.Out', example: '{}' })),
        },
    ],
}

const names = (query: string) => searchGrpcMethods(schema, query).map(result => result.method.name)

test('searchGrpcMethods: an empty query keeps the schema order', () => {
    expect(names('')).toEqual(['SayHello', 'Fail', 'Count', 'Sum', 'Chat', 'Everything', 'ListOrders', 'GetOrder', 'Order10', 'Order2', 'say_goodbye'])
})

test('searchGrpcMethods: the start of the name first, then the start of a word, then inside a word, numbers in order', () => {
    // Order2 and Order10 start with it, ListOrders and GetOrder have it at a word's start, say_goodbye only in its service
    expect(names('order')).toEqual(['Order2', 'Order10', 'GetOrder', 'ListOrders', 'say_goodbye'])
    // hello starts a word in SayHello, ello is inside it
    expect(names('hello')).toEqual(['SayHello'])
    expect(names('ello')).toEqual(['SayHello'])
    // a word after an underscore is a word
    expect(names('goodbye')).toEqual(['say_goodbye'])
    expect(names('say')).toEqual(['say_goodbye', 'SayHello'])
})

test('searchGrpcMethods: a full name, as the picker button shows it, and the name a request takes from its method find it', () => {
    expect(names('demo.v1.Demo/SayHello')).toEqual(['SayHello'])
    expect(names('Demo.SayHello')).toEqual(['SayHello'])
    expect(names('Orders.GetOrder')).toEqual(['GetOrder'])
})

test('searchGrpcMethods: every word must match, in any order, and a match in the service name alone comes last', () => {
    expect(names('order get')).toEqual(['GetOrder'])
    expect(names('get order')).toEqual(['GetOrder'])
    // shop matches only the service name of every Orders method, list matches a name
    expect(names('list shop')).toEqual(['ListOrders'])
    expect(names('demo')).toEqual(['Chat', 'Count', 'Everything', 'Fail', 'SayHello', 'Sum'])
    expect(names('nothing like this')).toEqual([])
})

test('describeGrpcSchema: counts services and methods and names the source', () => {
    expect(describeGrpcSchema(schema)).toBe('2 services, 11 methods from server reflection')
    expect(describeGrpcSchema({ source: 'proto', services: [schema.services[0]] })).toBe('1 service, 6 methods from .proto files')
    expect(describeGrpcSchema({ source: 'proto', services: [] })).toBe('0 services, 0 methods from .proto files')
})

test('getShortServiceName and message previews', () => {
    expect(getShortServiceName('demo.v1.Greeter')).toBe('Greeter')
    expect(getShortServiceName('Greeter')).toBe('Greeter')
    expect(getGrpcMessagePreview({ json: '{\n  "name": "Ada",\n  "n": 1\n}' })).toBe('{ "name": "Ada", "n": 1 }')
    expect(getGrpcMessagePreview({ omitted: true })).toBe('(left out, a masked prompt value went into it)')
    expect(getGrpcMessagePreview({ json: 'x'.repeat(600) })).toHaveLength(500)
})

test('readGrpcProtoFiles: keeps .proto files only, a folder\'s with their path inside it', async() => {
    const file = (name: string, text: string, relativePath = '') => {
        const picked = new File([text], name)
        Object.defineProperty(picked, 'webkitRelativePath', { value: relativePath })
        return picked
    }

    expect(await readGrpcProtoFiles([file('demo.proto', 'syntax = "proto3";'), file('notes.txt', 'x')], false)).toEqual([
        { path: 'demo.proto', text: 'syntax = "proto3";' },
    ])

    expect(await readGrpcProtoFiles([
        file('demo.proto', 'a', 'protos/demo/v1/demo.proto'),
        file('types.PROTO', 'b', 'protos/demo/v1/types.PROTO'),
        file('README.md', 'c', 'protos/README.md'),
    ], true)).toEqual([
        { path: 'demo/v1/demo.proto', text: 'a' },
        { path: 'demo/v1/types.PROTO', text: 'b' },
    ])
})

test('mergeGrpcProtoFiles: a file added again replaces the one with its path, sorted by path', () => {
    expect(mergeGrpcProtoFiles(
        [{ path: 'b.proto', text: 'old' }, { path: 'a10.proto', text: 'a10' }],
        [{ path: 'b.proto', text: 'new' }, { path: 'a2.proto', text: 'a2' }],
    )).toEqual([
        { path: 'a2.proto', text: 'a2' },
        { path: 'a10.proto', text: 'a10' },
        { path: 'b.proto', text: 'new' },
    ])
})
