// @vitest-environment edge-runtime

import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive, toRaw, watch } from 'vue'
import type { CollectionItem, GrpcFinalResponse } from '@/global'
import type { GrpcCallEvent, GrpcCallSpec, GrpcSchema, GrpcSchemaSpec } from '@/utils/grpc-transport'
import { forgetPromptValues } from '@/utils/prompt-tag'

const transport = vi.hoisted(() => ({
    isGrpcAvailable: vi.fn(() => true),
    loadGrpcSchema: vi.fn(),
    startGrpcCall: vi.fn(),
}))

vi.mock('@/utils/grpc-transport', () => transport)

const responseTag = vi.hoisted(() => ({ handleResponseTag: vi.fn() }))

vi.mock('@/utils/tag', async(importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/tag')>(),
    handleResponseTag: responseTag.handleResponseTag,
}))

import {
    cancelGrpcCallForItem,
    endGrpcCallStream,
    forgetFailedGrpcSchemaLoads,
    forgetGrpcCallsForItems,
    forgetGrpcCallsForWorkspace,
    moveGrpcCallsToNewItemIds,
    getGrpcItemKey,
    getGrpcSchemaKey,
    grpcCalls,
    grpcItemSchemaKeys,
    grpcSchemas,
    loadGrpcSchemaForItem,
    resetGrpcCalls,
    sendGrpcCallMessage,
    startGrpcCallForItem,
} from './grpc-calls'

const schema: GrpcSchema = {
    source: 'reflection',
    services: [{
        name: 'demo.v1.Demo',
        methods: [
            { name: 'SayHello', path: '/demo.v1.Demo/SayHello', requestStream: false, responseStream: false, inputType: 'demo.v1.HelloRequest', outputType: 'demo.v1.HelloReply', example: '{\n  "name": ""\n}' },
            { name: 'Count', path: '/demo.v1.Demo/Count', requestStream: false, responseStream: true, inputType: 'demo.v1.CountRequest', outputType: 'demo.v1.CountReply', example: '{}' },
            { name: 'Sum', path: '/demo.v1.Demo/Sum', requestStream: true, responseStream: false, inputType: 'demo.v1.SumRequest', outputType: 'demo.v1.SumReply', example: '{}' },
            { name: 'Chat', path: '/demo.v1.Demo/Chat', requestStream: true, responseStream: true, inputType: 'demo.v1.ChatMessage', outputType: 'demo.v1.ChatMessage', example: '{}' },
        ],
    }],
}

// an engine event, its time optional
type EmittedEvent = GrpcCallEvent extends infer Event ? Event extends GrpcCallEvent ? Omit<Event, 'time'> & { time?: number } : never : never

type StartedCall = { spec: GrpcCallSpec, emit: (event: EmittedEvent) => void, send: ReturnType<typeof vi.fn>, end: ReturnType<typeof vi.fn>, cancel: ReturnType<typeof vi.fn> }

let startedCalls: StartedCall[]
let savedResponses: GrpcFinalResponse[]
let environment: Record<string, any>
let parentHeaders: Record<string, string[]>
let localStorageValues: Map<string, string>

function createStore() {
    const state = reactive({
        activeWorkspace: { _id: 'w1', location: null },
        flags: { disableSSLVerification: false },
        requestResponses: {} as Record<string, any>,
        requestResponseStatus: {} as Record<string, string>,
        responses: {} as Record<string, any[]>,
    })
    const dispatch = vi.fn(async(action: string, payload: any) => {
        if(action === 'getEnvironmentForRequest') {
            return { environment, parentHeaders, parentAuthentication: undefined, requestParentArray: [] }
        }
        if(action === 'saveResponse') {
            // as the store's saveResponse copies it
            savedResponses.push(structuredClone(toRaw(payload.response)))
            return
        }
        throw new Error(`unexpected action ${action}`)
    })
    return { state, dispatch } as any
}

function grpcItem(fields: Partial<CollectionItem> = {}): CollectionItem {
    return reactive({
        _id: 'item1',
        _type: 'grpc',
        name: 'Demo/SayHello',
        parentId: null,
        workspaceId: 'w1',
        url: 'localhost:50051',
        grpc: { service: 'demo.v1.Demo', method: 'SayHello' },
        body: { mimeType: 'application/json', text: '{ "name": "{{ name }}" }' },
        headers: [],
        ...fields,
    }) as CollectionItem
}

// what grpc-calls keeps an item's call and schema by
const itemKey = (id: string, workspaceId = 'w1') => getGrpcItemKey({ workspaceId, _id: id })

// lets the awaited steps of a send run
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
    resetGrpcCalls()
    forgetPromptValues()
    startedCalls = []
    savedResponses = []
    environment = { name: 'Ada', host: 'localhost:50051' }
    parentHeaders = {}
    localStorageValues = new Map()
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => localStorageValues.get(key) ?? null,
        setItem: (key: string, value: string) => localStorageValues.set(key, value),
        removeItem: (key: string) => localStorageValues.delete(key),
    })
    transport.isGrpcAvailable.mockReturnValue(true)
    transport.loadGrpcSchema.mockReset()
    transport.loadGrpcSchema.mockResolvedValue(schema)
    transport.startGrpcCall.mockReset()
    transport.startGrpcCall.mockImplementation((spec: GrpcCallSpec, onEvent: (event: GrpcCallEvent) => void) => {
        const started: StartedCall = {
            spec,
            emit: event => onEvent({ time: 5, ...event } as GrpcCallEvent),
            send: vi.fn(),
            end: vi.fn(),
            cancel: vi.fn(),
        }
        startedCalls.push(started)
        onEvent({ type: 'sentMetadata', indexes: spec.metadata.map((_pair, index) => index), time: 0 })
        return { send: started.send, end: started.end, cancel: started.cancel }
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as any).createPrompt
})

test('a unary call sends the resolved message with metadata, inherited headers and auth, and is saved once it ends', async() => {
    const store = createStore()
    parentHeaders = { 'X-Folder': ['f1'] }
    localStorageValues.set('Restfox-RequestTimeout', '30000')
    const item = grpcItem({
        url: '{{ host }}',
        headers: [{ name: 'x-echo-user', value: '{{ name }}' }, { name: 'x-off', value: '1', disabled: true }],
        authentication: { type: 'bearer', token: 't0k' },
    })

    await startGrpcCallForItem(store, item)

    expect(startedCalls).toHaveLength(1)
    const { spec } = startedCalls[0]
    expect(spec.target).toEqual({ address: 'localhost:50051', host: 'localhost', port: 50051, tls: false })
    expect(spec.metadata).toEqual([['x-echo-user', 'Ada'], ['X-Folder', 'f1'], ['Authorization', 'Bearer t0k'], ['user-agent', expect.stringMatching(/^Restfox\//)]])
    expect(spec.messages).toEqual(['{ "name": "Ada" }'])
    expect(spec.service).toBe('demo.v1.Demo')
    expect(spec.method).toBe('SayHello')
    expect(spec.deadlineMs).toBe(30000)
    expect(spec.protoFiles).toBeNull()
    expect(spec.disableSSLVerification).toBe(false)
    expect(grpcCalls[itemKey('item1')].phase).toBe('connecting')
    expect(grpcCalls[itemKey('item1')].kind).toBe('unary')

    startedCalls[0].emit({ type: 'connected' })
    startedCalls[0].emit({ type: 'sent', json: '{\n  "name": "Ada"\n}', index: 0, time: 1 })
    startedCalls[0].emit({ type: 'headers', metadata: [['x-echo-user', 'Ada']] })
    startedCalls[0].emit({ type: 'received', json: '{\n  "message": "Hello Ada"\n}', time: 9 })
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [['x-echo-user', 'Ada']], time: 10 })
    await settle()

    expect(grpcCalls[itemKey('item1')].phase).toBe('ended')
    expect(savedResponses).toHaveLength(1)
    const saved = savedResponses[0]
    expect(saved._id).toBe(grpcCalls[itemKey('item1')].id)
    expect(saved.collectionId).toBe('item1')
    expect(saved.grpc).toMatchObject({
        url: 'localhost:50051',
        service: 'demo.v1.Demo',
        method: 'SayHello',
        kind: 'unary',
        sentMetadata: spec.metadata,
        events: [
            { type: 'sent', json: '{\n  "name": "Ada"\n}', time: 1 },
            { type: 'received', json: '{\n  "message": "Hello Ada"\n}', time: 9 },
        ],
        headers: [['x-echo-user', 'Ada']],
        trailers: [['x-echo-user', 'Ada']],
        status: { code: 0, name: 'OK', details: '' },
        ended: 'completed',
    })
    expect(saved.grpc.error).toBeUndefined()
    expect(store.state.requestResponses.item1._id).toBe(saved._id)
    // the schema loaded for the send is kept for the item's server
    expect(grpcItemSchemaKeys[itemKey('item1')]).toBe('reflection:plaintext:localhost:50051')
})

test('sent metadata stays in order on the live call and in history, but is absent before it resolves', async() => {
    const store = createStore()
    parentHeaders = { 'X-Folder': ['f1'] }
    localStorageValues.set('Restfox-GlobalUserAgent', 'MyAgent/1')
    const item = grpcItem({
        headers: [{ name: 'x-user', value: '{{ name }}' }, { name: 'x-off', value: '1', disabled: true }],
        authentication: { type: 'bearer', token: 't0k' },
    })

    await startGrpcCallForItem(store, item)
    const metadata = [['x-user', 'Ada'], ['X-Folder', 'f1'], ['Authorization', 'Bearer t0k'], ['user-agent', 'MyAgent/1']]
    expect(startedCalls[0].spec.metadata).toEqual(metadata)
    expect(grpcCalls[itemKey('item1')].sentMetadata).toEqual(metadata)
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()
    expect(savedResponses[0].grpc.sentMetadata).toEqual(metadata)

    await startGrpcCallForItem(store, grpcItem({ url: 'localhost:50051/invalid' }))
    expect(savedResponses[1].grpc).not.toHaveProperty('sentMetadata')

    window.createPrompt = vi.fn(async() => {
        throw new Error('Cancelled')
    })
    await startGrpcCallForItem(store, grpcItem({ headers: [{ name: 'x-secret', value: `{% prompt(title='Secret', mask=1) %}` }] }))
    expect(savedResponses[2].grpc).not.toHaveProperty('sentMetadata')
})

test('a second Send stops the running call, which is not saved and whose late events change nothing', async() => {
    const store = createStore()
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Count' } })

    await startGrpcCallForItem(store, item)
    const firstCallId = grpcCalls[itemKey('item1')].id
    startedCalls[0].emit({ type: 'received', json: '{"n":1}' })

    await startGrpcCallForItem(store, item)
    expect(startedCalls[0].cancel).toHaveBeenCalledTimes(1)
    expect(grpcCalls[itemKey('item1')].id).not.toBe(firstCallId)

    startedCalls[0].emit({ type: 'received', json: '{"n":2}' })
    startedCalls[0].emit({ type: 'status', code: 1, name: 'CANCELLED', details: 'Cancelled on client', trailers: [] })
    await settle()

    expect(grpcCalls[itemKey('item1')].events).toEqual([])
    expect(grpcCalls[itemKey('item1')].phase).toBe('connecting')
    expect(savedResponses).toHaveLength(0)

    startedCalls[1].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()
    expect(savedResponses.map(response => response._id)).toEqual([grpcCalls[itemKey('item1')].id])
})

test('Stop on a server stream keeps what arrived and saves it as cancelled', async() => {
    const store = createStore()
    localStorageValues.set('Restfox-RequestTimeout', '5000')
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Count' } })

    await startGrpcCallForItem(store, item)
    expect(startedCalls[0].spec.deadlineMs).toBe(5000)
    startedCalls[0].emit({ type: 'sent', json: '{}' })
    startedCalls[0].emit({ type: 'received', json: '{"n":1}' })

    cancelGrpcCallForItem(store, item)
    expect(startedCalls[0].cancel).toHaveBeenCalledTimes(1)
    startedCalls[0].emit({ type: 'status', code: 1, name: 'CANCELLED', details: 'Cancelled on client', trailers: [] })
    await settle()

    expect(savedResponses[0].grpc.ended).toBe('cancelled')
    expect(savedResponses[0].grpc.events.map(event => event.type)).toEqual(['sent', 'received'])
})

test('a call past its deadline ends as timed out', async() => {
    const store = createStore()
    localStorageValues.set('Restfox-RequestTimeout', '1000')

    await startGrpcCallForItem(store, grpcItem())
    startedCalls[0].emit({ type: 'status', code: 4, name: 'DEADLINE_EXCEEDED', details: 'Deadline exceeded', trailers: [], time: 1001 })
    await settle()

    expect(savedResponses[0].grpc.ended).toBe('timedOut')
})

test('a client stream starts with no message and no deadline, then sends each message resolved, and End stream half-closes', async() => {
    const store = createStore()
    localStorageValues.set('Restfox-RequestTimeout', '1000')
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Sum' }, body: { mimeType: 'application/json', text: `{ "value": "{% prompt(title='never asked') %}" }` } })
    window.createPrompt = vi.fn(async() => 'x')

    await startGrpcCallForItem(store, item)

    // the message in the editor waits for Send message, so its prompt does not ask at Start
    expect(window.createPrompt).not.toHaveBeenCalled()
    expect(startedCalls[0].spec.messages).toEqual([])
    expect(startedCalls[0].spec.deadlineMs).toBe(0)
    expect(grpcCalls[itemKey('item1')].liveShown).toBe(true)

    // no message goes out while the call connects
    await sendGrpcCallMessage(grpcItem(), '{ "value": "early" }')
    expect(startedCalls[0].send).not.toHaveBeenCalled()
    startedCalls[0].emit({ type: 'connected' })

    await sendGrpcCallMessage(grpcItem(), '{ "value": "{{ name }}" }')
    expect(startedCalls[0].send).toHaveBeenCalledWith('{ "value": "Ada" }')
    startedCalls[0].emit({ type: 'sent', json: '{\n  "value": "Ada"\n}', index: 0 })

    // a message the engine could not encode leaves the stream open
    await sendGrpcCallMessage(grpcItem(), '{ "nope": 1 }')
    startedCalls[0].emit({ type: 'sendError', message: 'Unknown field "nope"', index: 1 })
    expect(grpcCalls[itemKey('item1')].sendError).toBe('Unknown field "nope"')
    expect(grpcCalls[itemKey('item1')].phase).toBe('open')

    await endGrpcCallStream(grpcItem())
    expect(startedCalls[0].end).toHaveBeenCalledTimes(1)
    expect(grpcCalls[itemKey('item1')].halfClosed).toBe(true)

    // no more messages once the stream is half-closed
    await sendGrpcCallMessage(grpcItem(), '{}')
    expect(startedCalls[0].send).toHaveBeenCalledTimes(2)

    startedCalls[0].emit({ type: 'received', json: '{"total":"1","count":1}' })
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()
    expect(savedResponses[0].grpc.events).toHaveLength(2)
    expect(savedResponses[0].grpc.kind).toBe('clientStream')
})

test('a message that took a masked prompt value is left out of history, the others are kept', async() => {
    const store = createStore()
    window.createPrompt = vi.fn(async() => 's3cret')
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Chat' } })

    await startGrpcCallForItem(store, item)
    startedCalls[0].emit({ type: 'connected' })
    await sendGrpcCallMessage(grpcItem(), `{ "text": "{% prompt(title='Secret', mask=1) %}" }`)
    expect(startedCalls[0].send).toHaveBeenCalledWith('{ "text": "s3cret" }')
    await sendGrpcCallMessage(grpcItem(), '{ "text": "hi" }')

    startedCalls[0].emit({ type: 'sent', json: '{\n  "text": "s3cret"\n}', index: 0, time: 1 })
    startedCalls[0].emit({ type: 'sent', json: '{\n  "text": "hi"\n}', index: 1, time: 2 })
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()

    expect(savedResponses[0].grpc.events).toEqual([
        { type: 'sent', omitted: true, time: 1 },
        { type: 'sent', json: '{\n  "text": "hi"\n}', time: 2 },
    ])
    expect(JSON.stringify(savedResponses[0])).not.toContain('s3cret')
})

test('a unary message with a masked prompt value is sent and left out, and the address is saved with it hidden', async() => {
    const store = createStore()
    window.createPrompt = vi.fn(async() => '50051')
    const item = grpcItem({
        url: `localhost:{% prompt(title='Port', mask=1) %}`,
        body: { mimeType: 'application/json', text: `{ "name": "{% prompt(title='Port', mask=1) %}" }` },
    })

    await startGrpcCallForItem(store, item)
    // asked once for the whole send
    expect(window.createPrompt).toHaveBeenCalledTimes(1)
    expect(startedCalls[0].spec.messages).toEqual(['{ "name": "50051" }'])
    startedCalls[0].emit({ type: 'sent', json: '{\n  "name": "50051"\n}', index: 0 })
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()

    expect(savedResponses[0].grpc.url).toBe('localhost:******')
    expect(savedResponses[0].grpc.events).toEqual([{ type: 'sent', omitted: true, time: 5 }])
})

test('a call that cannot start is saved as failed with the reason', async() => {
    const store = createStore()

    await startGrpcCallForItem(store, grpcItem({ url: 'localhost:50051/demo' }))
    await settle()
    expect(savedResponses[0].grpc).toMatchObject({ ended: 'failed', error: 'A gRPC server address has no path, such as localhost:50051', status: null })
    // its method was never known, so neither is its kind
    expect('kind' in savedResponses[0].grpc).toBe(false)

    await startGrpcCallForItem(store, grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Gone' } }))
    await settle()
    expect(savedResponses[1].grpc.error).toBe('The server offers no method demo.v1.Demo/Gone')
    expect('kind' in savedResponses[1].grpc).toBe(false)

    transport.loadGrpcSchema.mockRejectedValueOnce(Object.assign(new Error('The server does not offer server reflection'), { code: 'REFLECTION_UNIMPLEMENTED' }))
    await startGrpcCallForItem(store, grpcItem({ url: 'localhost:50053' }))
    await settle()
    expect(savedResponses[2].grpc.error).toBe('The server does not offer server reflection')
    expect(grpcSchemas['reflection:plaintext:localhost:50053'].errorCode).toBe('REFLECTION_UNIMPLEMENTED')
    expect(startedCalls).toHaveLength(0)
})

test('a call whose methods could not load because the server could not be reached ends with that status, as a call that cannot connect does', async() => {
    const store = createStore()

    transport.loadGrpcSchema.mockRejectedValueOnce(Object.assign(new Error('localhost:50059 refused the connection'), { code: 'CONNECTION_FAILED', grpcStatus: { code: 14, name: 'UNAVAILABLE' } }))
    await startGrpcCallForItem(store, grpcItem({ url: 'localhost:50059' }))
    await settle()
    expect(savedResponses[0].grpc).toMatchObject({ ended: 'completed', status: { code: 14, name: 'UNAVAILABLE', details: 'localhost:50059 refused the connection' } })
    expect('error' in savedResponses[0].grpc).toBe(false)

    transport.loadGrpcSchema.mockRejectedValueOnce(Object.assign(new Error('Deadline exceeded while connecting to localhost:50058'), { code: 'CONNECTION_FAILED', grpcStatus: { code: 4, name: 'DEADLINE_EXCEEDED' } }))
    await startGrpcCallForItem(store, grpcItem({ url: 'localhost:50058' }))
    await settle()
    expect(savedResponses[1].grpc).toMatchObject({ ended: 'timedOut', status: { code: 4, name: 'DEADLINE_EXCEEDED' } })

    // a failure that is not about reaching the server, such as one with no status, still fails as before
    transport.loadGrpcSchema.mockRejectedValueOnce(Object.assign(new Error('The proxy answered 407'), { code: 'CONNECTION_FAILED' }))
    await startGrpcCallForItem(store, grpcItem({ url: 'localhost:50057' }))
    await settle()
    expect(savedResponses[2].grpc).toMatchObject({ ended: 'failed', error: 'The proxy answered 407', status: null })
    expect(startedCalls).toHaveLength(0)
})

test('a call stopped while it is being set up is saved as cancelled and never reaches the server', async() => {
    const store = createStore()
    let finishLoad: (value: GrpcSchema) => void = () => undefined
    transport.loadGrpcSchema.mockImplementationOnce(() => new Promise(resolve => {
        finishLoad = resolve
    }))
    const item = grpcItem()

    const sending = startGrpcCallForItem(store, item)
    await settle()
    expect(grpcCalls[itemKey('item1')].phase).toBe('connecting')
    cancelGrpcCallForItem(store, item)
    finishLoad(schema)
    await sending
    await settle()

    expect(startedCalls).toHaveLength(0)
    expect(savedResponses[0].grpc.ended).toBe('cancelled')
    expect(savedResponses[0].grpc.error).toBeUndefined()
})

test('items calling the same server share one schema, an automatic load reuses it', async() => {
    const store = createStore()

    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'a' }), { automatic: true })
    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'b', url: 'grpc://localhost:50051' }), { automatic: true })

    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(1)
    const spec: GrpcSchemaSpec = transport.loadGrpcSchema.mock.calls[0][0]
    expect(spec.target.address).toBe('localhost:50051')
    expect(grpcItemSchemaKeys[itemKey('a')]).toBe(grpcItemSchemaKeys[itemKey('b')])
    expect(grpcSchemas[grpcItemSchemaKeys[itemKey('a')]!].schema).toEqual(schema)

    // Reload always loads again
    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'a' }), { force: true })
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(2)

    // TLS to the same address is another server
    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'c', url: 'grpcs://localhost:50051' }), { automatic: true })
    expect(grpcItemSchemaKeys[itemKey('c')]).toBe('reflection:tls:localhost:50051')
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(3)
})

test('an automatic load reads a response tag from the saved response and never sends its request, Load methods does', async() => {
    const store = createStore()
    responseTag.handleResponseTag.mockReset()
    responseTag.handleResponseTag.mockResolvedValue('localhost:50051')
    const item = grpcItem({ url: '{% response(request=\'req_1\', path=\'$.address\', behavior=\'always\') %}' })

    await loadGrpcSchemaForItem(store, item, { automatic: true })
    await loadGrpcSchemaForItem(store, item, { automatic: true })
    // the address preview reads it too, also without sending
    expect(responseTag.handleResponseTag.mock.calls.length).toBeGreaterThan(0)
    expect(responseTag.handleResponseTag.mock.calls.every(([, tagTrigger]) => tagTrigger === false)).toBe(true)
    expect(grpcItemSchemaKeys[itemKey('item1')]).toBe('reflection:plaintext:localhost:50051')

    await loadGrpcSchemaForItem(store, item, { force: true })
    expect(responseTag.handleResponseTag.mock.calls.at(-1)![1]).toBe(true)
})

test('a failed load is reused when the picker opens, until a connection setting changes, then the next open loads again', async() => {
    const store = createStore()
    transport.loadGrpcSchema.mockRejectedValueOnce(new Error('The certificate of the server is not trusted'))

    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'a' }), { automatic: true })
    const key = grpcItemSchemaKeys[itemKey('a')]!
    expect(grpcSchemas[key].error).toContain('not trusted')

    // opening the picker again does not ask the server again
    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'a' }), { automatic: true })
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(1)

    // such as a CA certificate added in Settings
    forgetFailedGrpcSchemaLoads()
    expect(grpcSchemas[key].error).toBeNull()
    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'a' }), { automatic: true })
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(2)
    expect(grpcSchemas[key].schema).toEqual(schema)
})

test('a load that fails after a connection setting changed is not kept, so the next open tries the new setting', async() => {
    const store = createStore()
    let failLoad: ((error: Error) => void) | null = null
    transport.loadGrpcSchema.mockReturnValueOnce(new Promise((_, reject) => {
        failLoad = reject
    }))

    const loading = loadGrpcSchemaForItem(store, grpcItem({ _id: 'a' }), { automatic: true })
    await settle()
    const key = grpcItemSchemaKeys[itemKey('a')]!
    expect(grpcSchemas[key].loading).toBe(true)

    // such as Settings > Proxy set while the methods load through no proxy
    forgetFailedGrpcSchemaLoads()
    failLoad!(new Error('localhost:50051 refused the connection'))
    await loading
    expect(grpcSchemas[key].loading).toBe(false)
    expect(grpcSchemas[key].error).toBeNull()

    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'a' }), { automatic: true })
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(2)
    expect(grpcSchemas[key].schema).toEqual(schema)
})

test('the running call of a deleted item is stopped and never saved', async() => {
    const store = createStore()
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Chat' } })

    await startGrpcCallForItem(store, item)
    startedCalls[0].emit({ type: 'connected' })
    startedCalls[0].emit({ type: 'received', json: '{"text":"hi"}' })

    forgetGrpcCallsForItems('w1', ['item1'])
    expect(startedCalls[0].cancel).toHaveBeenCalledTimes(1)
    expect(grpcCalls[itemKey('item1')]).toBeUndefined()
    expect(grpcItemSchemaKeys[itemKey('item1')]).toBeUndefined()

    startedCalls[0].emit({ type: 'status', code: 1, name: 'CANCELLED', details: 'Cancelled on client', trailers: [] })
    await settle()
    expect(savedResponses).toHaveLength(0)
    expect(store.state.requestResponses.item1).toBeUndefined()
})

test('a failure from one item is not taken by another item on the same server, which loads for itself', async() => {
    const store = createStore()
    // such as a prompt in its own metadata that the user cancelled, or auth only it lacks
    transport.loadGrpcSchema.mockRejectedValueOnce(new Error('UNAUTHENTICATED: no token'))

    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'a' }), { automatic: true })
    const key = grpcItemSchemaKeys[itemKey('a')]!
    expect(grpcSchemas[key].error).toContain('UNAUTHENTICATED')

    // the item that failed reuses its failure when its picker opens again
    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'a' }), { automatic: true })
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(1)

    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'b' }), { automatic: true })
    expect(grpcItemSchemaKeys[itemKey('b')]).toBe(key)
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(2)
    expect(grpcSchemas[key].schema).toEqual(schema)
    expect(grpcSchemas[key].error).toBeNull()
})

test('a server that could not be reached, or .proto files that do not load, fail the same for every item, which all reuse it', async() => {
    const store = createStore()
    transport.loadGrpcSchema.mockRejectedValueOnce(Object.assign(new Error('localhost:50051 refused the connection'), { code: 'CONNECTION_FAILED' }))
    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'a' }), { automatic: true })
    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'b' }), { automatic: true })
    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'a' }), { automatic: true })
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(1)

    const protoFiles = [{ path: 'broken.proto', text: 'syntax = ' }]
    transport.loadGrpcSchema.mockRejectedValueOnce(new Error('broken.proto: illegal token'))
    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'c', grpc: { protoFiles } }), { automatic: true })
    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'd', grpc: { protoFiles } }), { automatic: true })
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(2)
})

test('a running call follows its item renamed or moved in a file workspace, stays in reach and is saved under the new id', async() => {
    const store = createStore()
    await startGrpcCallForItem(store, grpcItem({ _id: 'Demo.Chat.json', grpc: { service: 'demo.v1.Demo', method: 'Chat' } }))
    await startGrpcCallForItem(store, grpcItem({ _id: 'Gone.json', grpc: { service: 'demo.v1.Demo', method: 'Chat' } }))
    startedCalls[0].emit({ type: 'connected' })
    startedCalls[0].emit({ type: 'received', json: '{"text":"before"}' })

    // as the reload after a rename gives it, the item whose file went away left out
    moveGrpcCallsToNewItemIds('w1', ['Demo.Chat.json', 'Gone.json'], new Map([['Demo.Chat.json', 'Talk.json']]))
    expect(grpcCalls[itemKey('Demo.Chat.json')]).toBeUndefined()
    expect(grpcCalls[itemKey('Talk.json')].events).toHaveLength(1)
    expect(grpcItemSchemaKeys[itemKey('Talk.json')]).toBe('reflection:plaintext:localhost:50051')
    expect(startedCalls[1].cancel).toHaveBeenCalledTimes(1)
    expect(grpcCalls[itemKey('Gone.json')]).toBeUndefined()

    // the reloaded tab reaches it under the new id
    await sendGrpcCallMessage(grpcItem({ _id: 'Talk.json' }), '{ "text": "after" }')
    expect(startedCalls[0].send).toHaveBeenCalledWith('{ "text": "after" }')
    await endGrpcCallStream(grpcItem({ _id: 'Talk.json' }))
    expect(startedCalls[0].end).toHaveBeenCalledTimes(1)

    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()
    expect(savedResponses.map(response => response.collectionId)).toEqual(['Talk.json'])
    expect(store.state.requestResponses['Talk.json'].grpc.events.map((event: any) => event.json)).toEqual(['{"text":"before"}'])
})

test('a reload of one file workspace leaves the running calls of other workspaces alone', async() => {
    const store = createStore()
    await startGrpcCallForItem(store, grpcItem({ _id: 'in-other-workspace', workspaceId: 'w2', grpc: { service: 'demo.v1.Demo', method: 'Chat' } }))
    await startGrpcCallForItem(store, grpcItem({ _id: 'Chat.json', grpc: { service: 'demo.v1.Demo', method: 'Chat' } }))

    moveGrpcCallsToNewItemIds('w1', ['Chat.json'], new Map([['Chat.json', 'Talk.json']]))
    expect(startedCalls[0].cancel).not.toHaveBeenCalled()
    expect(grpcCalls[itemKey('in-other-workspace', 'w2')].phase).toBe('connecting')
    expect(grpcCalls[itemKey('Talk.json')]).toBeDefined()
})

test('two items that trade names in one reload keep their own calls', async() => {
    const store = createStore()
    await startGrpcCallForItem(store, grpcItem({ _id: 'A.json', grpc: { service: 'demo.v1.Demo', method: 'Chat' } }))
    await startGrpcCallForItem(store, grpcItem({ _id: 'B.json', grpc: { service: 'demo.v1.Demo', method: 'Chat' } }))
    const callA = grpcCalls[itemKey('A.json')].id
    const callB = grpcCalls[itemKey('B.json')].id

    moveGrpcCallsToNewItemIds('w1', ['A.json', 'B.json'], new Map([['A.json', 'B.json'], ['B.json', 'A.json']]))
    expect(grpcCalls[itemKey('B.json')].id).toBe(callA)
    expect(grpcCalls[itemKey('A.json')].id).toBe(callB)
    expect(startedCalls.every(call => call.cancel.mock.calls.length === 0)).toBe(true)
})

test('the running calls of a deleted or closed workspace are stopped and never saved, those of others keep running', async() => {
    const store = createStore()
    await startGrpcCallForItem(store, grpcItem({ _id: 'a', workspaceId: 'w1', grpc: { service: 'demo.v1.Demo', method: 'Chat' } }))
    await startGrpcCallForItem(store, grpcItem({ _id: 'b', workspaceId: 'w2', grpc: { service: 'demo.v1.Demo', method: 'Chat' } }))

    forgetGrpcCallsForWorkspace('w1')
    expect(startedCalls[0].cancel).toHaveBeenCalledTimes(1)
    expect(startedCalls[1].cancel).not.toHaveBeenCalled()
    expect(grpcCalls[itemKey('a')]).toBeUndefined()
    expect(grpcCalls[itemKey('b', 'w2')].phase).toBe('connecting')

    startedCalls[0].emit({ type: 'status', code: 1, name: 'CANCELLED', details: 'Cancelled on client', trailers: [] })
    await settle()
    expect(savedResponses).toHaveLength(0)
})

test('a call whose save fails, such as for an item its file workspace no longer has, says so in Logs and stays shown', async() => {
    const store = createStore()
    store.dispatch.mockImplementation(async(action: string) => {
        if(action === 'getEnvironmentForRequest') {
            return { environment, parentHeaders, parentAuthentication: undefined, requestParentArray: [] }
        }
        throw new Error('Cannot read properties of undefined (reading \'replace\')')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    await startGrpcCallForItem(store, grpcItem())
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()
    await settle()

    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('The gRPC call could not be saved to history: Cannot read properties of undefined (reading \'replace\')')
    expect(grpcCalls[itemKey('item1')].phase).toBe('ended')
    expect(store.state.requestResponses.item1.grpc.status.name).toBe('OK')
    consoleError.mockRestore()
})

test('proto files are keyed by their text, whatever the address', async() => {
    const store = createStore()
    const protoFiles = [{ path: 'demo/v1/demo.proto', text: 'syntax = "proto3";' }]

    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'a', url: '', grpc: { protoFiles } }), { automatic: true })
    await loadGrpcSchemaForItem(store, grpcItem({ _id: 'b', url: 'grpcs://example.com', grpc: { protoFiles } }), { automatic: true })

    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(1)
    expect(transport.loadGrpcSchema.mock.calls[0][0].protoFiles).toEqual(protoFiles)
    expect(grpcItemSchemaKeys[itemKey('a')]).toBe(getGrpcSchemaKey(null, protoFiles))
    expect(grpcItemSchemaKeys[itemKey('b')]).toBe(grpcItemSchemaKeys[itemKey('a')])
    expect(getGrpcSchemaKey(null, [{ path: 'demo/v1/demo.proto', text: 'syntax = "proto2";' }])).not.toBe(grpcItemSchemaKeys[itemKey('a')])
})

test('an automatic load never asks a prompt, Load methods and Reload do', async() => {
    const store = createStore()
    window.createPrompt = vi.fn(async() => 't0k')
    const item = grpcItem({ headers: [{ name: 'authorization', value: `Bearer {% prompt(title='Token') %}` }] })

    await loadGrpcSchemaForItem(store, item, { automatic: true })
    expect(window.createPrompt).not.toHaveBeenCalled()
    expect(transport.loadGrpcSchema).not.toHaveBeenCalled()
    // the server is known, so the list can say its methods are not loaded yet
    expect(grpcItemSchemaKeys[itemKey('item1')]).toBe('reflection:plaintext:localhost:50051')

    // a variable holding a prompt is a prompt too
    environment.token = `{% prompt(title='Token') %}`
    await loadGrpcSchemaForItem(store, grpcItem({ headers: [{ name: 'authorization', value: 'Bearer {{ token }}' }] }), { automatic: true })
    expect(transport.loadGrpcSchema).not.toHaveBeenCalled()

    await loadGrpcSchemaForItem(store, item, { force: true })
    expect(window.createPrompt).toHaveBeenCalledTimes(1)
    expect(transport.loadGrpcSchema.mock.calls[0][0].metadata).toContainEqual(['authorization', 'Bearer t0k'])
})

test('a schema load answered after a newer one of the same server is dropped', async() => {
    const store = createStore()
    const older: GrpcSchema = { source: 'reflection', services: [] }
    let answerOlder: (value: GrpcSchema) => void = () => undefined
    transport.loadGrpcSchema.mockImplementationOnce(() => new Promise(resolve => {
        answerOlder = resolve
    }))

    const first = loadGrpcSchemaForItem(store, grpcItem(), { force: true })
    await settle()
    await loadGrpcSchemaForItem(store, grpcItem(), { force: true })
    answerOlder(older)
    await first

    const entry = grpcSchemas['reflection:plaintext:localhost:50051']
    expect(entry.schema).toEqual(schema)
    expect(entry.loading).toBe(false)
})

test('an address changed while its methods load keeps the item on the new server', async() => {
    const store = createStore()
    let answerFirst: (value: GrpcSchema) => void = () => undefined
    transport.loadGrpcSchema.mockImplementationOnce(() => new Promise(resolve => {
        answerFirst = resolve
    }))

    const first = loadGrpcSchemaForItem(store, grpcItem({ url: 'localhost:1111' }), { automatic: true })
    await settle()
    await loadGrpcSchemaForItem(store, grpcItem({ url: 'localhost:2222' }), { automatic: true })
    answerFirst(schema)
    await first

    expect(grpcItemSchemaKeys[itemKey('item1')]).toBe('reflection:plaintext:localhost:2222')
})

test('a call cancelled while its address waits on a response tag resolves nothing more, so no prompt asks and no other tag sends', async() => {
    const store = createStore()
    window.createPrompt = vi.fn(async() => 't0k')
    let answerAddress: (value: string) => void = () => undefined
    responseTag.handleResponseTag.mockReset()
    responseTag.handleResponseTag.mockImplementationOnce(() => new Promise(resolve => {
        answerAddress = resolve
    }))
    responseTag.handleResponseTag.mockResolvedValue('from-tag')
    const item = grpcItem({
        url: '{% response(request=\'req_1\', path=\'$.address\', behavior=\'always\') %}',
        headers: [
            { name: 'x-token', value: '{% prompt(title=\'Token\') %}' },
            { name: 'x-other', value: '{% response(request=\'req_2\', path=\'$.value\', behavior=\'always\') %}' },
        ],
    })

    const sending = startGrpcCallForItem(store, item)
    await settle()
    cancelGrpcCallForItem(store, item)
    answerAddress('localhost:50051')
    await sending
    await settle()

    expect(window.createPrompt).not.toHaveBeenCalled()
    expect(responseTag.handleResponseTag).toHaveBeenCalledTimes(1)
    expect(savedResponses.map(response => response.grpc.ended)).toEqual(['cancelled'])
    expect(transport.startGrpcCall).not.toHaveBeenCalled()
})

test('a Reload whose metadata waits on a response tag is dropped once the address changes, so the new server keeps its own methods', async() => {
    const store = createStore()
    let answerTag: (value: string) => void = () => undefined
    responseTag.handleResponseTag.mockReset()
    responseTag.handleResponseTag.mockImplementation((_tag: unknown, tagTrigger: boolean) => tagTrigger ? new Promise(resolve => {
        answerTag = resolve
    }) : Promise.resolve('saved-token'))
    transport.loadGrpcSchema.mockImplementation(async(spec: { target: { port: number } }) => ({ source: 'reflection', services: [{ name: `from.${spec.target.port}`, methods: [] }] }))
    const headers = [{ name: 'authorization', value: '{% response(request=\'req_1\', path=\'$.token\', behavior=\'always\') %}' }]

    const reload = loadGrpcSchemaForItem(store, grpcItem({ url: 'localhost:1111', headers }), { force: true })
    await settle()
    await loadGrpcSchemaForItem(store, grpcItem({ url: 'localhost:2222', headers }), { automatic: true })
    answerTag('sent-token')
    await reload

    expect(grpcSchemas['reflection:plaintext:localhost:2222'].schema?.services.map(service => service.name)).toEqual(['from.2222'])
    expect(transport.loadGrpcSchema.mock.calls.map(([spec]) => spec.target.port)).toEqual([2222])
})

test('a Reload whose metadata waits on a response tag still loads when an automatic load of the same server reuses the methods meanwhile', async() => {
    const store = createStore()
    let answerTag: (value: string) => void = () => undefined
    responseTag.handleResponseTag.mockReset()
    responseTag.handleResponseTag.mockImplementation((_tag: unknown, tagTrigger: boolean) => tagTrigger ? new Promise(resolve => {
        answerTag = resolve
    }) : Promise.resolve('saved-token'))
    const item = grpcItem({ headers: [{ name: 'authorization', value: '{% response(request=\'req_1\', path=\'$.token\', behavior=\'always\') %}' }] })
    await loadGrpcSchemaForItem(store, item, { automatic: true })
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(1)

    const reload = loadGrpcSchemaForItem(store, item, { force: true })
    await settle()
    await loadGrpcSchemaForItem(store, item, { automatic: true })
    answerTag('sent-token')
    await reload

    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(2)
    expect(transport.loadGrpcSchema.mock.calls[1][0].metadata).toContainEqual(['authorization', 'sent-token'])
})

test('a Reload whose response tag fails says so where the methods are, also when an automatic load of the same server reused them meanwhile', async() => {
    const store = createStore()
    let failTag: (error: Error) => void = () => undefined
    responseTag.handleResponseTag.mockReset()
    responseTag.handleResponseTag.mockImplementation((_tag: unknown, tagTrigger: boolean) => tagTrigger ? new Promise((_resolve, reject) => {
        failTag = reject
    }) : Promise.resolve('saved-token'))
    const item = grpcItem({ headers: [{ name: 'authorization', value: '{% response(request=\'req_1\', path=\'$.token\', behavior=\'always\') %}' }] })
    await loadGrpcSchemaForItem(store, item, { automatic: true })

    const reload = loadGrpcSchemaForItem(store, item, { force: true })
    await settle()
    await loadGrpcSchemaForItem(store, item, { automatic: true })
    failTag(new Error('The login request failed'))
    await reload

    expect(grpcSchemas['reflection:plaintext:localhost:50051'].error).toContain('The login request failed')
})

test('an error Restfox wrote with no copy for history is saved as a fixed text once the send took a masked prompt value', async() => {
    const store = createStore()
    window.createPrompt = vi.fn(async() => 'hunter2')
    const item = grpcItem({ body: { mimeType: 'application/json', text: `{ "name": {% prompt(title='Secret', mask=1) %} }` } })

    await startGrpcCallForItem(store, item)
    const message = 'The message is not valid JSON: Unexpected token \'h\', "{ "name": hunter2 }" is not valid JSON'
    startedCalls[0].emit({ type: 'sendError', message, index: 0 })
    startedCalls[0].emit({ type: 'error', message })
    await settle()

    expect(savedResponses[0].grpc.error).toBe('The call failed. Its error is not saved, as it may quote a masked prompt value')
    expect(JSON.stringify(savedResponses[0])).not.toContain('hunter2')
    // the screen shows the error, with the masked value hidden where it appears whole
    expect(store.state.requestResponses.item1.grpc.error).toBe('The message is not valid JSON: Unexpected token \'h\', "{ "name": ****** }" is not valid JSON')
})

test('the server\'s status is saved and shown as it came, also when it repeats a masked prompt value', async() => {
    const store = createStore()
    window.createPrompt = vi.fn(async() => 'hunter2')

    await startGrpcCallForItem(store, grpcItem({ headers: [{ name: 'x-token', value: `{% prompt(title='Token', mask=1) %}` }] }))
    startedCalls[0].emit({ type: 'status', code: 16, name: 'UNAUTHENTICATED', details: 'token hunter2 expired', trailers: [], errorDetails: '{"message": "token hunter2 expired"}' })
    await settle()

    expect(savedResponses[0].grpc.status).toEqual({ code: 16, name: 'UNAUTHENTICATED', details: 'token hunter2 expired', errorDetails: '{"message": "token hunter2 expired"}' })
    expect(store.state.requestResponses.item1.grpc.status).toEqual(savedResponses[0].grpc.status)
})

test('a status the engine wrote, which names the server, saves its copy once the send took a masked prompt value', async() => {
    const store = createStore()
    window.createPrompt = vi.fn(async() => 'internal.example')

    await startGrpcCallForItem(store, grpcItem({ url: `{% prompt(title='Server', mask=1) %}:50051` }))
    startedCalls[0].emit({ type: 'status', code: 14, name: 'UNAVAILABLE', details: 'internal.example:50051 refused the connection', detailsWithoutValues: '****** refused the connection', trailers: [] })
    await settle()

    expect(savedResponses[0].grpc.status?.details).toBe('****** refused the connection')
    expect(JSON.stringify(savedResponses[0])).not.toContain('internal.example')
    expect(store.state.requestResponses.item1.grpc.status?.details).toBe('internal.example:50051 refused the connection')

    // a send that took no masked prompt value saves the details as they came
    await startGrpcCallForItem(store, grpcItem({ url: 'internal.example:50051' }))
    startedCalls[1].emit({ type: 'status', code: 14, name: 'UNAVAILABLE', details: 'internal.example:50051 refused the connection', detailsWithoutValues: '****** refused the connection', trailers: [] })
    await settle()
    expect(savedResponses[1].grpc.status?.details).toBe('internal.example:50051 refused the connection')
})

test.each(['private-first', 'private-second'])('an error quoting part of a message that took a masked prompt value saves the form that quotes nothing, %s', async secret => {
    const store = createStore()
    window.createPrompt = vi.fn(async() => `{"name":{"token":"${secret}"}}`)
    const item = grpcItem({ body: { mimeType: 'application/json', text: `{% prompt(title='Message', mask=1) %}` } })

    await startGrpcCallForItem(store, item)
    expect(startedCalls[0].spec.messages).toEqual([`{"name":{"token":"${secret}"}}`])
    // the engine quotes the field's value, which is not the whole masked value hideMaskedValues knows
    const message = `demo.v1.HelloRequest.name: expected string: {"token":"${secret}"}`
    startedCalls[0].emit({ type: 'sendError', message, messageWithoutValues: 'demo.v1.HelloRequest.name: expected string', index: 0 })
    // the screen shows what the engine said while the call runs
    expect(grpcCalls[itemKey('item1')].sendError).toBe(message)
    startedCalls[0].emit({ type: 'error', message, messageWithoutValues: 'demo.v1.HelloRequest.name: expected string' })
    await settle()

    expect(savedResponses[0].grpc.error).toBe('demo.v1.HelloRequest.name: expected string')
    expect(JSON.stringify(savedResponses[0])).not.toContain(secret)
    expect(JSON.stringify(savedResponses[0])).not.toContain('token')
    expect(store.state.requestResponses.item1.grpc.error).toBe(message)
})

test('an error of a call whose messages took no masked prompt value is saved as the engine wrote it', async() => {
    const store = createStore()
    const item = grpcItem({ body: { mimeType: 'application/json', text: '{"name":{"token":"typed"}}' } })

    await startGrpcCallForItem(store, item)
    const message = 'demo.v1.HelloRequest.name: expected string: {"token":"typed"}'
    startedCalls[0].emit({ type: 'error', message, messageWithoutValues: 'demo.v1.HelloRequest.name: expected string' })
    await settle()

    expect(savedResponses[0].grpc.error).toBe(message)
})

test('a call is connecting until the engine connects, and only then counts messages as sent', async() => {
    const store = createStore()
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Count' } })

    await startGrpcCallForItem(store, item)
    expect(grpcCalls[itemKey('item1')].phase).toBe('connecting')

    startedCalls[0].emit({ type: 'connected' })
    expect(grpcCalls[itemKey('item1')].phase).toBe('open')
})

test('a sent message is matched to the masked prompt flag of its own number, whatever order the events come in', async() => {
    const store = createStore()
    window.createPrompt = vi.fn(async() => 's3cret')
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Chat' } })

    await startGrpcCallForItem(store, item)
    startedCalls[0].emit({ type: 'connected' })
    await sendGrpcCallMessage(grpcItem(), `{ "text": "{% prompt(title='Secret', mask=1) %}" }`)
    await sendGrpcCallMessage(grpcItem(), '{ "nope": 1 }')
    // the second could not be encoded, which is known before the first leaves
    startedCalls[0].emit({ type: 'sendError', message: 'unknown field "nope"', index: 1 })
    startedCalls[0].emit({ type: 'sent', json: '{\n  "text": "s3cret"\n}', index: 0, time: 1 })
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()

    expect(savedResponses[0].grpc.events).toEqual([{ type: 'sent', omitted: true, time: 1 }])
})

test('a stream\'s counts change with its messages on screen, once a tenth of a second however many arrive, and are exact when it ends', async() => {
    const store = createStore()
    await startGrpcCallForItem(store, grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Chat' } }))
    const call = grpcCalls[itemKey('item1')]
    // each change the panel would redraw for
    const countsShown = { sent: [] as number[], received: [] as number[] }
    const stopWatchingSent = watch(() => call.sentCount, count => countsShown.sent.push(count), { flush: 'sync' })
    const stopWatchingReceived = watch(() => call.receivedCount, count => countsShown.received.push(count), { flush: 'sync' })

    startedCalls[0].emit({ type: 'connected' })
    startedCalls[0].emit({ type: 'sent', json: '{}', index: 0 })
    for(let n = 0; n < 50; n++) {
        startedCalls[0].emit({ type: 'received', json: `{"n":${n}}` })
    }
    startedCalls[0].emit({ type: 'sent', json: '{}', index: 1 })
    expect(countsShown).toEqual({ sent: [], received: [] })

    await new Promise(resolve => setTimeout(resolve, 150))
    expect(call.revision).toBe(1)
    expect(countsShown).toEqual({ sent: [2], received: [50] })

    // ends before the next redraw, which then shows every message
    startedCalls[0].emit({ type: 'received', json: '{"n":50}' })
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    expect(countsShown).toEqual({ sent: [2], received: [50, 51] })
    expect(call.events).toHaveLength(53)
    stopWatchingSent()
    stopWatchingReceived()
})

test('stream messages go out in the order they were sent, though an earlier one waits on a response tag', async() => {
    const store = createStore()
    let answerTag: (value: string) => void = () => undefined
    responseTag.handleResponseTag.mockReset()
    responseTag.handleResponseTag.mockImplementation(() => new Promise(resolve => {
        answerTag = resolve
    }))
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Chat' } })

    await startGrpcCallForItem(store, item)
    startedCalls[0].emit({ type: 'connected' })
    const first = sendGrpcCallMessage(grpcItem(), `{ "text": "{% response(request='req_1', path='$.token', behavior='always') %}" }`)
    await settle()
    const second = sendGrpcCallMessage(grpcItem(), '{ "text": "second" }')
    await settle()
    answerTag('first')
    await Promise.all([first, second])

    expect(startedCalls[0].send.mock.calls.map(([json]) => json)).toEqual(['{ "text": "first" }', '{ "text": "second" }'])
})

test('End stream sends the messages still resolving first, then half-closes', async() => {
    const store = createStore()
    let answerTag: (value: string) => void = () => undefined
    responseTag.handleResponseTag.mockReset()
    responseTag.handleResponseTag.mockImplementation(() => new Promise(resolve => {
        answerTag = resolve
    }))
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Sum' } })

    await startGrpcCallForItem(store, item)
    startedCalls[0].emit({ type: 'connected' })
    const sending = sendGrpcCallMessage(grpcItem(), `{ "value": "{% response(request='req_1', path='$.value', behavior='always') %}" }`)
    await settle()
    const ending = endGrpcCallStream(grpcItem())
    // no more messages are taken once End stream is clicked
    expect(grpcCalls[itemKey('item1')].halfClosed).toBe(true)
    await sendGrpcCallMessage(grpcItem(), '{ "value": "after end" }')
    expect(startedCalls[0].end).not.toHaveBeenCalled()

    answerTag('1')
    await Promise.all([sending, ending])

    expect(startedCalls[0].send.mock.calls.map(([json]) => json)).toEqual(['{ "value": "1" }'])
    expect(startedCalls[0].end).toHaveBeenCalledTimes(1)
    expect(startedCalls[0].send.mock.invocationCallOrder[0]).toBeLessThan(startedCalls[0].end.mock.invocationCallOrder[0])
})

test('a message waiting behind a slow one is not resolved once the call is stopped, so its prompt never asks', async() => {
    const store = createStore()
    let answerTag: (value: string) => void = () => undefined
    responseTag.handleResponseTag.mockReset()
    responseTag.handleResponseTag.mockImplementation(() => new Promise(resolve => {
        answerTag = resolve
    }))
    window.createPrompt = vi.fn(async() => 'x')
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Chat' } })

    await startGrpcCallForItem(store, item)
    startedCalls[0].emit({ type: 'connected' })
    const first = sendGrpcCallMessage(grpcItem(), `{ "text": "{% response(request='req_1', path='$.token', behavior='always') %}" }`)
    await settle()
    const second = sendGrpcCallMessage(grpcItem(), `{ "text": "{% prompt(title='Next') %}" }`)
    await settle()

    cancelGrpcCallForItem(store, item)
    startedCalls[0].emit({ type: 'status', code: 1, name: 'CANCELLED', details: 'Cancelled on client', trailers: [] })
    answerTag('first')
    await Promise.all([first, second])

    expect(window.createPrompt).not.toHaveBeenCalled()
    expect(startedCalls[0].send).not.toHaveBeenCalled()
})

test('an end of stream that did not reach the call says why and leaves the stream open, so End stream can be clicked again', async() => {
    const store = createStore()
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Sum' } })
    await startGrpcCallForItem(store, item)
    startedCalls[0].emit({ type: 'connected' })

    await endGrpcCallStream(grpcItem())
    expect(grpcCalls[itemKey('item1')].halfClosed).toBe(true)
    startedCalls[0].emit({ type: 'endError', message: 'The server could not end the stream: 503 Service Unavailable' })

    expect(grpcCalls[itemKey('item1')].halfClosed).toBe(false)
    expect(grpcCalls[itemKey('item1')].endError).toBe('The server could not end the stream: 503 Service Unavailable')
    await endGrpcCallStream(grpcItem())
    expect(startedCalls[0].end).toHaveBeenCalledTimes(2)
})

test('a deleted or closed workspace leaves no call of its own behind, ended ones included, and keeps those of others', async() => {
    const store = createStore()
    await startGrpcCallForItem(store, grpcItem())
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await startGrpcCallForItem(store, grpcItem({ workspaceId: 'w2' }))
    startedCalls[1].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()
    expect(grpcCalls[itemKey('item1')]?.phase).toBe('ended')

    forgetGrpcCallsForWorkspace('w1')

    expect(grpcCalls[itemKey('item1')]).toBeUndefined()
    expect(grpcItemSchemaKeys[itemKey('item1')]).toBeUndefined()
    expect(grpcCalls[itemKey('item1', 'w2')]?.phase).toBe('ended')
    expect(grpcItemSchemaKeys[itemKey('item1', 'w2')]).toBe('reflection:plaintext:localhost:50051')
})

test('a methods load of a deleted item, still resolving its environment, does not move a new item of the same path to its server', async() => {
    const store = createStore()
    let answerEnvironment: (value: any) => void = () => undefined
    const dispatch = store.dispatch.getMockImplementation()
    store.dispatch.mockImplementationOnce((action: string) => action === 'getEnvironmentForRequest' ? new Promise(resolve => {
        answerEnvironment = resolve
    }) : dispatch(action))

    const deletedLoad = loadGrpcSchemaForItem(store, grpcItem({ url: 'localhost:1111' }), { automatic: true })
    await settle()
    forgetGrpcCallsForItems('w1', ['item1'])
    // a new item at the same path, for another server
    await loadGrpcSchemaForItem(store, grpcItem({ url: 'localhost:2222' }), { automatic: true })
    answerEnvironment({ environment, parentHeaders, parentAuthentication: undefined, requestParentArray: [] })
    await deletedLoad

    expect(grpcItemSchemaKeys[itemKey('item1')]).toBe('reflection:plaintext:localhost:2222')
})

test('a message stopped while its own response tag waits asks no prompt that comes after the tag in it', async() => {
    const store = createStore()
    let answerTag: (value: string) => void = () => undefined
    responseTag.handleResponseTag.mockReset()
    responseTag.handleResponseTag.mockImplementation(() => new Promise(resolve => {
        answerTag = resolve
    }))
    window.createPrompt = vi.fn(async() => 'x')
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Chat' } })

    await startGrpcCallForItem(store, item)
    startedCalls[0].emit({ type: 'connected' })
    const sending = sendGrpcCallMessage(grpcItem(), `{ "text": "{% response(request='req_1', path='$.token', behavior='always') %} {% prompt(title='Next') %}" }`)
    await settle()

    // Stop, while the server has not ended the call yet
    cancelGrpcCallForItem(store, item)
    answerTag('first')
    await sending

    expect(window.createPrompt).not.toHaveBeenCalled()
    expect(startedCalls[0].send).not.toHaveBeenCalled()
})

test('a call cancelled while a response tag in its address waits sends no other response tag of the address', async() => {
    const store = createStore()
    let answerTag: (value: string) => void = () => undefined
    responseTag.handleResponseTag.mockReset()
    responseTag.handleResponseTag.mockImplementationOnce(() => new Promise(resolve => {
        answerTag = resolve
    }))
    responseTag.handleResponseTag.mockResolvedValue('50051')
    const item = grpcItem({ url: '{% response(request=\'req_1\', path=\'$.host\', behavior=\'always\') %}:{% response(request=\'req_2\', path=\'$.port\', behavior=\'always\') %}' })

    const sending = startGrpcCallForItem(store, item)
    await settle()
    cancelGrpcCallForItem(store, item)
    answerTag('localhost')
    await sending
    await settle()

    expect(responseTag.handleResponseTag).toHaveBeenCalledTimes(1)
    expect(savedResponses.map(response => response.grpc.ended)).toEqual(['cancelled'])
})

test('a call stopped while it is set up keeps the kind of its method, known from the methods loaded before', async() => {
    const store = createStore()
    await loadGrpcSchemaForItem(store, grpcItem(), { automatic: true })
    let answerEnvironment: () => void = () => undefined
    const dispatch = store.dispatch
    store.dispatch = vi.fn(async(action: string, payload: any) => {
        if(action === 'getEnvironmentForRequest') {
            await new Promise<void>(resolve => {
                answerEnvironment = resolve
            })
        }
        return dispatch(action, payload)
    })
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Chat' } })

    const sending = startGrpcCallForItem(store, item)
    expect(grpcCalls[itemKey('item1')].kind).toBe('bidiStream')
    cancelGrpcCallForItem(store, item)
    answerEnvironment()
    await sending
    await settle()

    expect(savedResponses[0].grpc.kind).toBe('bidiStream')
})

test('a unary call shows that it waits at once, as an HTTP send does, and a client stream shows its messages at once', async() => {
    const store = createStore()
    await loadGrpcSchemaForItem(store, grpcItem(), { automatic: true })

    const unary = startGrpcCallForItem(store, grpcItem())
    expect(grpcCalls[itemKey('item1')].liveShown).toBe(false)
    await unary

    const stream = startGrpcCallForItem(store, grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Chat' } }))
    expect(grpcCalls[itemKey('item1')].liveShown).toBe(true)
    // its running time counts from when it goes out, not while its address, metadata and prompts resolve
    expect(grpcCalls[itemKey('item1')].startedAt).toBeNull()
    await stream
    expect(grpcCalls[itemKey('item1')].startedAt).toEqual(expect.any(Number))
})

test('a saved call is dated when it ended, as an HTTP response is', async() => {
    const store = createStore()
    const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'Count' } })
    // the clock is set rather than waited on, as a timer can fire a millisecond before Date.now has moved as far
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)

    await startGrpcCallForItem(store, item)
    now.mockReturnValue(1_000_030)
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()
    now.mockRestore()

    expect(savedResponses[0].createdAt).toBe(1_000_030)
})

test('DEADLINE_EXCEEDED the server sends long before Restfox\'s own deadline is the server\'s status, not a time out', async() => {
    const store = createStore()
    localStorageValues.set('Restfox-RequestTimeout', '30000')

    await startGrpcCallForItem(store, grpcItem())
    startedCalls[0].emit({ type: 'status', code: 4, name: 'DEADLINE_EXCEEDED', details: 'upstream timed out', trailers: [], time: 2000 })
    await settle()

    expect(savedResponses[0].grpc.ended).toBe('completed')
})

test('metadata carries Settings > Global User Agent, or Restfox\'s own, unless the item sets one', async() => {
    const store = createStore()
    localStorageValues.set('Restfox-GlobalUserAgent', 'MyAgent/1')

    await startGrpcCallForItem(store, grpcItem())
    expect(startedCalls[0].spec.metadata).toContainEqual(['user-agent', 'MyAgent/1'])

    await startGrpcCallForItem(store, grpcItem({ headers: [{ name: 'User-Agent', value: 'ItemAgent/2' }] }))
    expect(startedCalls[1].spec.metadata.filter(([name]) => name.toLowerCase() === 'user-agent')).toEqual([['User-Agent', 'ItemAgent/2']])

    localStorageValues.delete('Restfox-GlobalUserAgent')
    await startGrpcCallForItem(store, grpcItem())
    expect(startedCalls[2].spec.metadata).toContainEqual(['user-agent', expect.stringMatching(/^Restfox\//)])
})

// as the in any text of a send test in helpers.spec.ts does for HTTP: a masked prompt in each text a call reads, sent
// twice with two values, must leave saved copies that do not differ, though the server's status repeats what it was
// sent. As in HTTP history, the server's metadata and replies are kept as they came, so this server repeats nothing there
test('a masked prompt in any text of a gRPC send leaves no trace of its value in what Restfox saves', async() => {
    const masked = `{% prompt(title='Secret', mask=1) %}`
    const answers = ['first-value', 'second-value']
    const store = createStore()
    parentHeaders = { [`x-folder-${masked}`]: [`folder ${masked}`] }
    environment = { ...environment, GLOBAL_HEADERS: { 'x-global': `global ${masked}` } }
    const item = grpcItem({
        url: `${masked}:50051`,
        headers: [{ name: `x-name-${masked}`, value: `value ${masked}` }],
        authentication: { type: 'bearer', token: masked },
        body: { mimeType: 'application/json', text: `{ "name": "${masked}" }` },
    })
    // a server that says back nothing it was sent, as what it sends is saved as it came
    transport.startGrpcCall.mockImplementation((spec: GrpcCallSpec, onEvent: (event: GrpcCallEvent) => void) => {
        setTimeout(() => {
            onEvent({ type: 'connected', time: 1 })
            onEvent({ type: 'sentMetadata', indexes: spec.metadata.map((_pair, index) => index), time: 1 })
            onEvent({ type: 'sent', json: spec.messages[0], index: 0, time: 2 })
            onEvent({ type: 'headers', metadata: [['x-echo', 'none']], time: 3 })
            onEvent({ type: 'status', code: 3, name: 'INVALID_ARGUMENT', details: 'rejected', trailers: [], time: 4 })
        })
        return { send: vi.fn(), end: vi.fn(), cancel: vi.fn() }
    })

    for(const answer of answers) {
        forgetPromptValues()
        window.createPrompt = vi.fn(async() => answer)
        await startGrpcCallForItem(store, item)
        await new Promise(resolve => setTimeout(resolve, 5))
        await settle()
    }

    expect(savedResponses).toHaveLength(2)
    expect(savedResponses[0].grpc.sentMetadata).toEqual([
        ['x-global', 'global ******'],
        ['x-name-******', 'value ******'],
        ['x-folder-******', 'folder ******'],
        ['Authorization', 'Bearer ******'],
        ['user-agent', expect.stringMatching(/^Restfox\//)],
    ])
    const comparable = (entry: GrpcFinalResponse) => ({ ...entry.grpc, timeTaken: 0 })
    expect(comparable(savedResponses[0])).toEqual(comparable(savedResponses[1]))
    for(const answer of answers) {
        expect(JSON.stringify(savedResponses)).not.toContain(answer)
    }
})

test.each(['value', 'name'])('a masked metadata %s is shown live and saved with only the prompt text hidden', async part => {
    const masked = `{% prompt(title='Secret', mask=1) %}`
    const store = createStore()
    const item = grpcItem({ headers: [
        { name: part === 'name' ? `x-${masked}` : 'x-secret', value: part === 'value' ? `before ${masked} after` : 'public' },
        { name: 'x-literal', value: 'first-value' },
    ] })

    for(const answer of ['first-value', 'second-value']) {
        forgetPromptValues()
        window.createPrompt = vi.fn(async() => answer)
        await startGrpcCallForItem(store, item)
        const call = startedCalls[startedCalls.length - 1]
        call.emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
        await settle()
        expect(store.state.requestResponses.item1.grpc.sentMetadata).toEqual(call.spec.metadata)
        expect(window.createPrompt).toHaveBeenCalledTimes(1)
    }

    const metadata = savedResponses[0].grpc.sentMetadata
    expect(metadata).toEqual([
        [part === 'name' ? 'x-******' : 'x-secret', part === 'value' ? 'before ****** after' : 'public'],
        ['x-literal', 'first-value'],
        ['user-agent', expect.stringMatching(/^Restfox\//)],
    ])
    expect({ ...savedResponses[0].grpc, timeTaken: 0 }).toEqual({ ...savedResponses[1].grpc, timeTaken: 0 })
})

test('encoded masked metadata values are left out whole, with unmasked binary metadata kept', async() => {
    const masked = `{% prompt(title='Secret', mask=1) %}`
    const store = createStore()
    const item = grpcItem({
        headers: [
            { name: 'x-secret-bin', value: masked },
            { name: `x-${masked}-bin`, value: 'cHVibGlj' },
            { name: 'x-public-bin', value: 'cHVibGlj' },
        ],
        authentication: { type: 'basic', username: 'user', password: masked },
    })

    for(const answer of ['Zmlyc3Q=', 'c2Vjb25k']) {
        forgetPromptValues()
        window.createPrompt = vi.fn(async() => answer)
        await startGrpcCallForItem(store, item)
        const call = startedCalls[startedCalls.length - 1]
        expect(call.spec.metadata).toContainEqual(['x-secret-bin', answer])
        call.emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
        await settle()
    }

    expect(savedResponses[0].grpc.sentMetadata).toEqual([
        ['x-secret-bin', ''],
        ['x-******-bin', ''],
        ['x-public-bin', 'cHVibGlj'],
        ['Authorization', ''],
        ['user-agent', expect.stringMatching(/^Restfox\//)],
    ])
    expect({ ...savedResponses[0].grpc, timeTaken: 0 }).toEqual({ ...savedResponses[1].grpc, timeTaken: 0 })
    for(const answer of ['Zmlyc3Q=', 'c2Vjb25k']) {
        expect(JSON.stringify(savedResponses)).not.toContain(answer)
    }
})

test('an empty prompted User-Agent saves the default that went out', async() => {
    const store = createStore()
    localStorageValues.set('Restfox-GlobalUserAgent', 'MyAgent/1')
    window.createPrompt = vi.fn(async() => '')
    await startGrpcCallForItem(store, grpcItem({ headers: [{ name: 'User-Agent', value: `{% prompt(title='Agent', mask=1) %}` }] }))
    expect(startedCalls[0].spec.metadata).toEqual([['User-Agent', 'MyAgent/1']])
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()
    expect(savedResponses[0].grpc.sentMetadata).toEqual([['User-Agent', 'MyAgent/1']])
})

test('nothing loads or starts where gRPC is not available', async() => {
    const store = createStore()
    transport.isGrpcAvailable.mockReturnValue(false)

    await loadGrpcSchemaForItem(store, grpcItem(), { automatic: true })
    await startGrpcCallForItem(store, grpcItem())
    await settle()

    expect(transport.loadGrpcSchema).not.toHaveBeenCalled()
    expect(transport.startGrpcCall).not.toHaveBeenCalled()
    expect(savedResponses[0].grpc.error).toBe('gRPC calls need the Restfox desktop app or a self-hosted Restfox. Browsers cannot make them.')
})

// a methods load that waits until it is answered, or aborted unless answersAbort is false, as the desktop app's load
// answers an abort only once its reply comes back
function pendingSchemaLoads({ answersAbort = true } = {}) {
    const loads: { signal: AbortSignal | undefined, resolve: (value: GrpcSchema) => void, reject: (error: Error) => void }[] = []
    transport.loadGrpcSchema.mockImplementation((_spec: GrpcSchemaSpec, signal?: AbortSignal) => new Promise((resolve, reject) => {
        loads.push({ signal, resolve, reject })
        if(answersAbort) {
            signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')))
        }
    }))
    return loads
}

test('Cancel while a Send loads the methods stops the load, which leaves no error behind', async() => {
    const store = createStore()
    const loads = pendingSchemaLoads()
    const item = grpcItem()

    const sending = startGrpcCallForItem(store, item)
    await settle()
    expect(loads).toHaveLength(1)
    expect(loads[0].signal).toBeInstanceOf(AbortSignal)
    expect(loads[0].signal!.aborted).toBe(false)

    cancelGrpcCallForItem(store, item)
    expect(loads[0].signal!.aborted).toBe(true)
    await sending
    expect(savedResponses.map(response => response.grpc.ended)).toEqual(['cancelled'])
    expect(grpcSchemas['reflection:plaintext:localhost:50051']).toMatchObject({ loading: false, error: null })
    expect(transport.startGrpcCall).not.toHaveBeenCalled()
})

test('Cancel while a Send loads the methods leaves the load to the method list that also waits on it', async() => {
    const store = createStore()
    const loads = pendingSchemaLoads()
    const item = grpcItem()

    const sending = startGrpcCallForItem(store, item)
    await settle()
    // the method list of another item on the same server opened meanwhile
    const listing = loadGrpcSchemaForItem(store, grpcItem({ _id: 'item2' }), { automatic: true })
    await settle()
    expect(loads).toHaveLength(1)

    cancelGrpcCallForItem(store, item)
    expect(loads[0].signal!.aborted).toBe(false)
    await sending
    loads[0].resolve(schema)
    expect(await listing).toMatchObject({ schema, error: null })
    expect(grpcSchemas['reflection:plaintext:localhost:50051'].schema).toEqual(schema)
})

test('a Send that stopped waiting leaves the load to a later Send on the same server that waits on it', async() => {
    const store = createStore()
    const loads = pendingSchemaLoads()
    const first = grpcItem()
    const second = grpcItem({ _id: 'item2' })

    const firstSending = startGrpcCallForItem(store, first)
    await settle()
    cancelGrpcCallForItem(store, first)
    await firstSending
    expect(loads[0].signal!.aborted).toBe(true)

    const secondSending = startGrpcCallForItem(store, second)
    await settle()
    expect(loads).toHaveLength(2)
    loads[1].resolve(schema)
    await secondSending
    expect(startedCalls).toHaveLength(1)
})

test('a method list opened after a Send stopped its load, which the desktop app has not answered yet, loads again', async() => {
    const store = createStore()
    const loads = pendingSchemaLoads({ answersAbort: false })
    const item = grpcItem()

    const sending = startGrpcCallForItem(store, item)
    await settle()
    cancelGrpcCallForItem(store, item)
    await sending
    expect(loads[0].signal!.aborted).toBe(true)

    const listing = loadGrpcSchemaForItem(store, grpcItem({ _id: 'item2' }), { automatic: true })
    await settle()
    expect(loads).toHaveLength(2)
    loads[1].resolve(schema)
    expect(await listing).toMatchObject({ schema, error: null })

    // the stopped load's late answer changes nothing
    loads[0].reject(new Error('The methods load was stopped'))
    await settle()
    expect(grpcSchemas['reflection:plaintext:localhost:50051']).toMatchObject({ schema, loading: false, error: null })
})

test('received undecodable and unknown-field bytes survive a masked send in history', async() => {
    const store = createStore()
    window.createPrompt = vi.fn().mockResolvedValue('secret')
    const item = grpcItem({ body: { mimeType: 'application/json', text: '{"name":"{% prompt(title=\'Password\', mask=1) %}"}' } })
    await startGrpcCallForItem(store, item)
    const received = [
        { type: 'received', bytes: 'c2VjcmV0', decodeError: 'Not a Reply: invalid wire type', time: 2 },
        { type: 'received', json: '{"text":"secret"}', bytes: 'c2VjcmV0', unknownFields: ['10'], time: 3 },
    ] as const
    for(const event of received) {
        startedCalls[0].emit(event as any)
    }
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()
    expect(savedResponses[0].grpc.events).toEqual(received)
})

test('a response tag waits for the unary status and its history save, with inherited metadata and a masked prompt', async() => {
    const store = createStore()
    let finishSavingResponse: () => void = () => undefined
    const savingResponse = new Promise<void>(resolve => {
        finishSavingResponse = resolve
    })
    const dispatch = store.dispatch.getMockImplementation()
    store.dispatch.mockImplementation(async(action: string, payload: any) => {
        if(action === 'saveResponse') {
            await savingResponse
        }
        return dispatch(action, payload)
    })
    parentHeaders = { 'X-Folder': ['inherited'] }
    window.createPrompt = vi.fn().mockResolvedValue('secret')
    const item = grpcItem({ parentId: 'other-folder', body: { mimeType: 'application/json', text: '{"name":"{% prompt(title=\'Password\', mask=1) %}"}' } })
    let finished = false
    const waiting = startGrpcCallForItem(store, item, { unaryOnly: true, waitForEnd: true }).then(() => {
        finished = true
    })
    await settle()
    expect(finished).toBe(false)
    expect(startedCalls[0].spec.metadata).toContainEqual(['X-Folder', 'inherited'])
    expect(startedCalls[0].spec.messages).toEqual(['{"name":"secret"}'])
    startedCalls[0].emit({ type: 'sent', json: '{"name":"secret"}', index: 0 })
    startedCalls[0].emit({ type: 'received', json: '{"token":"secret"}' })
    expect(finished).toBe(false)
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()
    expect(finished).toBe(false)
    finishSavingResponse()
    await waiting
    expect(savedResponses[0].grpc.events).toEqual([{ type: 'sent', omitted: true, time: 5 }, { type: 'received', json: '{"token":"secret"}', time: 5 }])
})


test('Sent metadata uses the engine accepted rows for both live and masked history', async() => {
    window.createPrompt = vi.fn(async() => 'private')
    const store = createStore()
    parentHeaders = { 'Content-Type': ['application/json'], Connection: ['keep-alive'], te: ['other'], 'grpc-timeout': ['1S'] }
    await startGrpcCallForItem(store, grpcItem({ headers: [{ name: 'x-secret', value: `{% prompt(title='Secret', mask=1) %}` }] }))
    const call = startedCalls[0]
    const indexes = call.spec.metadata.map(([name], index) => ['x-secret', 'user-agent'].includes(name) ? index : -1).filter(index => index !== -1)
    call.emit({ type: 'sentMetadata', indexes })
    expect(grpcCalls[itemKey('item1')].sentMetadata).toEqual([['x-secret', 'private'], ['user-agent', expect.any(String)]])
    call.emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()
    expect(savedResponses[0].grpc.sentMetadata).toEqual([['x-secret', '******'], ['user-agent', expect.any(String)]])
})

test('a masked Basic password equal to the mask still leaves the encoded value out of history', async() => {
    window.createPrompt = vi.fn(async() => '******')
    await startGrpcCallForItem(createStore(), grpcItem({ authentication: { type: 'basic', username: 'u', password: `{% prompt(title='Secret', mask=1) %}` } }))
    expect(startedCalls[0].spec.metadata).toContainEqual(['Authorization', 'Basic dToqKioqKio='])
    startedCalls[0].emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
    await settle()
    expect(savedResponses[0].grpc.sentMetadata).toContainEqual(['Authorization', ''])
})

for(const method of ['SayHello', 'Chat']) {
    test(`a masked message equal to the mask is omitted from ${method} history`, async() => {
        window.createPrompt = vi.fn(async() => '******')
        const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method }, body: { mimeType: 'application/json', text: `{"name":"{% prompt(title='Secret', mask=1) %}"}` } })
        await startGrpcCallForItem(createStore(), item)
        const call = startedCalls[0]
        call.emit({ type: 'connected' })
        if(method === 'Chat') {
            await sendGrpcCallMessage(item, item.body!.text!)
        }
        call.emit({ type: 'sent', json: '{"name":"******"}', index: 0 })
        call.emit({ type: 'status', code: 0, name: 'OK', details: '', trailers: [] })
        await settle()
        expect(savedResponses[0].grpc.events[0]).toMatchObject({ type: 'sent', omitted: true })
        expect(savedResponses[0].grpc.events[0].json).toBeUndefined()
    })
}
