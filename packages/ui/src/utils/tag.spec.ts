// @vitest-environment edge-runtime

import { test, expect, vi, beforeEach, afterEach, describe } from 'vitest'

vi.mock('@/store', () => ({
    store: {
        state: { collection: [{ _id: 'login', _type: 'request', workspaceId: 'w', name: 'Login' }] },
        dispatch: vi.fn(),
    },
}))

const grpc = vi.hoisted(() => ({
    loadGrpcSchemaForItem: vi.fn(),
    startGrpcCallForItem: vi.fn(),
    getGrpcItemKey: (item: { _id: string }) => item._id,
    grpcItemSchemaKeys: { 'grpc-call': 'schema' },
    grpcSchemas: {} as Record<string, any>,
}))
vi.mock('@/utils/grpc-calls', () => grpc)

vi.mock('@/db', () => ({
    getResponsesByCollectionId: vi.fn(),
}))

import { handleResponseTag } from './tag'
import { SendResolver } from '@/helpers'
import { getResponsesByCollectionId } from '@/db'
import { store } from '@/store'
import type { ParsedResult } from '@/parsers/tag'

const encoder = new TextEncoder()

function savedResponse(id: string, body: string, fields: Record<string, unknown> = {}) {
    return {
        _id: id,
        collectionId: 'login',
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'application/json']],
        buffer: encoder.encode(body).buffer,
        createdAt: Date.now(),
        ...fields,
    }
}

const tokenTag = {
    functionName: 'response',
    parameters: { attribute: 'body', request: 'login', path: '$.token', behavior: 'never', maxAge: 0 },
} as unknown as ParsedResult

beforeEach(() => {
    vi.mocked(getResponsesByCollectionId).mockReset()
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    })
})

afterEach(() => vi.unstubAllGlobals())

test('a response cut short is passed over, the tag reads the newest whole one, as when only whole ones were saved', async() => {
    vi.mocked(getResponsesByCollectionId).mockResolvedValue([
        savedResponse('cut-short', '{"tok', { bodyIncomplete: 'timedOut' }),
        savedResponse('whole', '{"token":"abc123"}'),
    ] as any)

    expect(await handleResponseTag(tokenTag, false, undefined)).toBe('abc123')
})

test('with only responses cut short, no history means no value, as before', async() => {
    vi.mocked(getResponsesByCollectionId).mockResolvedValue([
        savedResponse('cut-short', '{"tok', { bodyIncomplete: 'failed' }),
    ] as any)

    expect(await handleResponseTag(tokenTag, false, undefined)).toBeUndefined()
})

test('when-expired with an expired response sends again and reads the response it just got', async() => {
    const expired = savedResponse('expired', '{"token":"old"}', { createdAt: Date.now() - 60_000 })
    const fresh = savedResponse('fresh', '{"token":"new"}')
    vi.mocked(getResponsesByCollectionId)
        .mockResolvedValueOnce([expired] as any)
        // newest first, as the database gives them
        .mockResolvedValueOnce([fresh, expired] as any)

    const whenExpired = { ...tokenTag, parameters: { ...tokenTag.parameters, behavior: 'when-expired', maxAge: 10 } } as unknown as ParsedResult

    expect(await handleResponseTag(whenExpired, true, undefined)).toBe('new')
})

describe('a response tag pointing at an item that is not an HTTP request', () => {
    const itemsOtherThanRequests = [
        { _id: 'newer-kind', _type: 'newer-kind', workspaceId: 'w', name: 'Newer Kind' },
    ]

    beforeEach(() => {
        store.state.collection.push(...itemsOtherThanRequests as any)
        vi.mocked(store.dispatch).mockClear()
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
    })

    afterEach(() => {
        store.state.collection = store.state.collection.filter(item => item._type === 'request')
    })

    for(const item of itemsOtherThanRequests) {
        for(const behavior of ['always', 'when-expired']) {
            test(`${item._type} with ${behavior} gives no value and never sends`, async() => {
                const tag = { ...tokenTag, parameters: { ...tokenTag.parameters, request: item._id, attribute: 'raw', behavior, maxAge: 10 } } as unknown as ParsedResult

                expect(await handleResponseTag(tag, true, undefined)).toBeUndefined()
                expect(store.dispatch).not.toHaveBeenCalled()
                expect(getResponsesByCollectionId).not.toHaveBeenCalled()
            })
        }
    }

    test('an HTTP request with always still sends, so the cases above can fail', async() => {
        const always = { ...tokenTag, parameters: { ...tokenTag.parameters, behavior: 'always' } } as unknown as ParsedResult

        await handleResponseTag(always, true, undefined)
        expect(store.dispatch).toHaveBeenCalledWith('sendRequest', expect.objectContaining({ _id: 'login' }))
    })
})

describe('response tags on unary gRPC calls', () => {
    const request = { _id: 'grpc-call', _type: 'grpc', workspaceId: 'w', name: 'Login', parentId: 'other-folder', grpc: { service: 'demo.Login', method: 'Token' } }
    const tag = (fields = {}) => ({ ...tokenTag, parameters: { ...tokenTag.parameters, request: request._id, ...fields } }) as unknown as ParsedResult
    const response = (fields = {}) => ({ _id: 'call', collectionId: request._id, createdAt: Date.now(), grpc: {
        service: 'demo.Login', method: 'Token', kind: 'unary', ended: 'completed', status: { code: 0, name: 'OK', details: '' },
        headers: [['X-Token', 'metadata-token']], events: [{ type: 'received', json: '{"token":"reply-token"}', time: 1 }], ...fields,
    } })
    beforeEach(() => {
        store.state.collection.push(request as any)
        grpc.grpcSchemas.schema = { schema: { services: [{ name: 'demo.Login', methods: [{ name: 'Token', requestStream: false, responseStream: false }] }] } }
        grpc.loadGrpcSchemaForItem.mockReset()
        grpc.startGrpcCallForItem.mockReset()
        vi.mocked(store.dispatch).mockClear()
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([response()] as any)
    })
    afterEach(() => {
        store.state.collection = store.state.collection.filter(item => item._type === 'request')
    })
    test('Body uses JSONPath, Raw reads JSON, and Header reads received metadata without case', async() => {
        expect(await handleResponseTag(tag(), false, undefined)).toBe('reply-token')
        expect(await handleResponseTag(tag({ attribute: 'raw' }), false, undefined)).toBe('{"token":"reply-token"}')
        expect(await handleResponseTag(tag({ attribute: 'header', path: 'x-ToKeN' }), false, undefined)).toBe('metadata-token')
        expect(grpc.startGrpcCallForItem).not.toHaveBeenCalled()
    })
    for(const behavior of ['always', 'no-history', 'when-expired']) {
        test(`${behavior} sends through Send and waits for the fresh history`, async() => {
            vi.mocked(getResponsesByCollectionId).mockResolvedValue(behavior === 'when-expired' ? [{ ...response(), createdAt: 1 }] as any : [])
            grpc.startGrpcCallForItem.mockImplementation(async() => {
                await new Promise(resolve => setTimeout(resolve, 0))
                vi.mocked(getResponsesByCollectionId).mockResolvedValue([response()] as any)
            })
            expect(await handleResponseTag(tag({ behavior, maxAge: 10 }), true, undefined)).toBe('reply-token')
            expect(grpc.startGrpcCallForItem).toHaveBeenCalledWith(store, request, { unaryOnly: true, waitForEnd: true })
            expect(store.dispatch).not.toHaveBeenCalled()
        })
    }
    test('never, fresh when-expired, existing no-history, and a preview never send', async() => {
        for(const [behavior, trigger] of [['never', true], ['when-expired', true], ['no-history', true], ['always', false]] as const) {
            expect(await handleResponseTag(tag({ behavior, maxAge: 10 }), trigger, undefined)).toBe('reply-token')
        }
        expect(grpc.startGrpcCallForItem).not.toHaveBeenCalled()
    })
    test('a saved unary call can be read offline before its schema has loaded', async() => {
        delete grpc.grpcSchemas.schema
        expect(await handleResponseTag(tag(), false, undefined)).toBe('reply-token')
        expect(grpc.loadGrpcSchemaForItem).not.toHaveBeenCalled()
        expect(grpc.startGrpcCallForItem).not.toHaveBeenCalled()
    })
    test('an offline tag skips a newer failed call without a known kind', async() => {
        delete grpc.grpcSchemas.schema
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([response({ kind: null, ended: 'failed', events: [], status: null }), response()] as any)
        expect(await handleResponseTag(tag(), false, undefined)).toBe('reply-token')
        expect(grpc.loadGrpcSchemaForItem).not.toHaveBeenCalled()
    })
    test('history skips non-OK, cancelled, incomplete, undecodable, multiple and non-unary replies', async() => {
        const skipped = [
            response({ status: { code: 5, name: 'NOT_FOUND' } }),
            response({ ended: 'cancelled' }), response({ status: null }), response({ kind: 'serverStream' }),
            response({ events: [{ type: 'received', bytes: 'CgVB', decodeError: 'Not a Reply', time: 1 }] }),
            response({ events: [{ type: 'received', json: '{}', time: 1 }, { type: 'received', json: '{}', time: 2 }] }),
        ]
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([...skipped, response()] as any)
        expect(await handleResponseTag(tag(), true, undefined)).toBe('reply-token')
        vi.mocked(getResponsesByCollectionId).mockResolvedValue(skipped as any)
        expect(await handleResponseTag(tag(), true, undefined)).toBeUndefined()
    })
    test('streams and an unchosen method fail with the response tag error', async() => {
        for(const method of [{ name: 'Token', requestStream: true, responseStream: false }, { name: 'Token', requestStream: false, responseStream: true }, null]) {
            grpc.grpcSchemas.schema.schema.services[0].methods = method ? [method] : []
            await expect(handleResponseTag(tag(), true, undefined)).rejects.toMatchObject({ message: 'A response tag can read only a unary gRPC call', cause: 'display-error' })
        }
        expect(grpc.startGrpcCallForItem).not.toHaveBeenCalled()
    })
})


for(const behavior of ['never', 'always']) {
    test(`a send response tag with ${behavior} cannot read the same path in another workspace`, async() => {
        const originalCollection = store.state.collection
        const other = { _id: 'Login.json', _type: 'request', workspaceId: 'wB', name: 'Login' }
        store.state.collection = [other as any]
        vi.mocked(store.dispatch).mockClear()
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([savedResponse('b', '{"token":"other-workspace"}')] as any)
        try {
            const send = new SendResolver('wA')
            await expect(send.resolve({}, `{% response(request='Login.json', attribute='body', path='$.token', behavior='${behavior}') %}`, 'unsaved')).rejects.toThrow('The request this tag reads is in another workspace')
            expect(getResponsesByCollectionId).not.toHaveBeenCalled()
            expect(store.dispatch).not.toHaveBeenCalled()
        } finally {
            store.state.collection = originalCollection
        }
    })
}
