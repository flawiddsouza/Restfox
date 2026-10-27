// @vitest-environment edge-runtime

import { test, expect, vi, beforeEach, afterEach, describe } from 'vitest'

vi.mock('@/store', () => ({
    store: {
        state: { activeWorkspace: { _id: 'w' }, collection: [{ _id: 'login', _type: 'request', workspaceId: 'w', name: 'Login' }] },
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
import { SendResolver, createGrpcRequestData, substituteEnvironmentVariables, substituteEnvironmentVariablesForSend } from '@/helpers'
import { generateCode } from '@/utils/generate-code'
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
    store.state.activeWorkspace = { _id: 'w' } as any
    vi.mocked(getResponsesByCollectionId).mockReset().mockResolvedValue([])
    vi.mocked(store.dispatch).mockReset().mockResolvedValue(savedResponse('sent', '{"token":"new"}'))
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

    expect(await handleResponseTag(tokenTag, 'display', undefined)).toBe('abc123')
})

test('with only responses cut short, no history means no value, as before', async() => {
    vi.mocked(getResponsesByCollectionId).mockResolvedValue([
        savedResponse('cut-short', '{"tok', { bodyIncomplete: 'failed' }),
    ] as any)

    expect(await handleResponseTag(tokenTag, 'display', undefined)).toBeUndefined()
})

test('when-expired with an expired response sends again and reads the response it just got', async() => {
    const expired = savedResponse('expired', '{"token":"old"}', { createdAt: Date.now() - 60_000 })
    const fresh = savedResponse('fresh', '{"token":"new"}')
    vi.mocked(getResponsesByCollectionId)
        .mockResolvedValueOnce([expired] as any)
        // newest first, as the database gives them
        .mockResolvedValueOnce([fresh, expired] as any)
    vi.mocked(store.dispatch).mockResolvedValueOnce(fresh)

    const whenExpired = { ...tokenTag, parameters: { ...tokenTag.parameters, behavior: 'when-expired', maxAge: 10 } } as unknown as ParsedResult

    expect(await handleResponseTag(whenExpired, 'send', undefined)).toBe('new')
})

test('a generated command sends an Always tag\'s request once, for the url and the body both', async() => {
    vi.mocked(getResponsesByCollectionId).mockResolvedValue([savedResponse('older', '{"token":"saved"}')] as any)
    const tag = `{% response(request='login', attribute='body', path='$.token', behavior='always') %}`
    const request = { _id: 'command', workspaceId: 'w', _type: 'request', name: 'Command', method: 'POST', url: `https://example.test/${tag}`, body: { mimeType: 'application/json', text: `{"token":"${tag}"}` } } as any
    expect(await generateCode(request, {}, {}, undefined, 'shell', 'curl', new SendResolver((request).workspaceId, 'send'))).toContain('https://example.test/new')
    expect(store.dispatch).toHaveBeenCalledOnce()
    expect(await createGrpcRequestData(request, {}, {}, undefined, null)).toMatchObject({ url: 'https://example.test/new', message: '{"token":"new"}' })
    expect(store.dispatch).toHaveBeenCalledTimes(2)
})

test('two resolutions of one tag in one send at once send its request once', async() => {
    let finish: (response: any) => void = () => undefined
    vi.mocked(store.dispatch).mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve
    }))
    const send = new SendResolver('w', 'send')
    const text = `{% response(request='login', attribute='body', path='$.token', behavior='always') %}`
    const values = Promise.all([send.resolve({}, text, 'url'), send.resolve({}, text, 'body')])
    await vi.waitFor(() => expect(store.dispatch).toHaveBeenCalled())
    finish(savedResponse('sent', '{"token":"new"}'))
    expect(await values).toEqual(['new', 'new'])
    expect(store.dispatch).toHaveBeenCalledOnce()
})

test('a tag whose send failed is tried again by the next resolution of the same send', async() => {
    vi.mocked(store.dispatch).mockResolvedValueOnce({ error: 'Error: Request failed' })
    const send = new SendResolver('w', 'send')
    const text = `{% response(request='login', attribute='body', path='$.token', behavior='always') %}`
    await expect(send.resolve({}, text, 'url')).rejects.toThrow('The request this tag sent did not complete with a whole response')
    expect(await send.resolve({}, text, 'body')).toBe('new')
    expect(store.dispatch).toHaveBeenCalledTimes(2)
})

for(const behavior of ['always', 'when-expired', 'no-history']) {
    for(const outcome of ['cancelled', 'failed', 'timedOut', 'replaced']) {
        test(`${behavior} errors when its own send is ${outcome}, rather than reading an older reply`, async() => {
            const older = savedResponse('older', '{"token":"old"}', { createdAt: 1 })
            vi.mocked(getResponsesByCollectionId).mockResolvedValue([older] as any)
            if(behavior === 'no-history') {
                vi.mocked(getResponsesByCollectionId).mockResolvedValueOnce([])
            }
            vi.mocked(store.dispatch).mockResolvedValueOnce(outcome === 'failed' ? { error: 'Error: Request failed' } : savedResponse('partial', '{"token":"partial"}', { bodyIncomplete: outcome === 'replaced' ? 'cancelled' : outcome }))
            const tag = { ...tokenTag, parameters: { ...tokenTag.parameters, behavior, maxAge: 10 } } as unknown as ParsedResult
            await expect(handleResponseTag(tag, 'send', undefined)).rejects.toMatchObject({ message: 'The request this tag sent did not complete with a whole response', cause: 'display-error' })
        })
    }
}

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

                expect(await handleResponseTag(tag, 'send', undefined)).toBeUndefined()
                expect(store.dispatch).not.toHaveBeenCalled()
                expect(getResponsesByCollectionId).not.toHaveBeenCalled()
            })
        }
    }

    test('an HTTP request with always still sends, so the cases above can fail', async() => {
        const always = { ...tokenTag, parameters: { ...tokenTag.parameters, behavior: 'always' } } as unknown as ParsedResult

        await handleResponseTag(always, 'send', undefined)
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
        expect(await handleResponseTag(tag(), 'display', undefined)).toBe('reply-token')
        expect(await handleResponseTag(tag({ attribute: 'raw' }), 'display', undefined)).toBe('{"token":"reply-token"}')
        expect(await handleResponseTag(tag({ attribute: 'header', path: 'x-ToKeN' }), 'display', undefined)).toBe('metadata-token')
        expect(grpc.startGrpcCallForItem).not.toHaveBeenCalled()
    })
    test('a gRPC dependency that fails during preparation returns no response', async() => {
        grpc.startGrpcCallForItem.mockResolvedValueOnce(undefined)
        await expect(handleResponseTag(tag({ behavior: 'always' }), 'send', undefined)).rejects.toThrow('The request this tag sent did not complete with a whole response')
    })
    for(const behavior of ['always', 'no-history', 'when-expired']) {
        test(`${behavior} uses the call's own result`, async() => {
            vi.mocked(getResponsesByCollectionId).mockResolvedValue(behavior === 'when-expired' ? [{ ...response(), createdAt: 1 }] as any : [])
            grpc.startGrpcCallForItem.mockResolvedValue(response())
            expect(await handleResponseTag(tag({ behavior, maxAge: 10 }), 'send', undefined)).toBe('reply-token')
            expect(grpc.startGrpcCallForItem).toHaveBeenCalledWith(store, request, { unaryOnly: true, waitForEnd: true })
            expect(store.dispatch).not.toHaveBeenCalled()
        })
    }
    test('never, fresh when-expired, existing no-history, and a preview never send', async() => {
        delete grpc.grpcSchemas.schema
        for(const [behavior, trigger] of [['never', 'send'], ['when-expired', 'send'], ['no-history', 'send'], ['always', 'display']] as const) {
            expect(await handleResponseTag(tag({ behavior, maxAge: 10 }), trigger, undefined)).toBe('reply-token')
        }
        expect(grpc.startGrpcCallForItem).not.toHaveBeenCalled()
        expect(grpc.loadGrpcSchemaForItem).not.toHaveBeenCalled()
    })
    for(const outcome of ['cancelled', 'failed', 'timedOut', 'replaced']) {
        test(`an Always unary call that is ${outcome} cannot reuse an older reply`, async() => {
            grpc.startGrpcCallForItem.mockResolvedValueOnce(outcome === 'replaced' ? undefined : response({ ended: outcome, status: null, events: [] }))
            await expect(handleResponseTag(tag({ behavior: 'always' }), 'send', undefined)).rejects.toMatchObject({ message: 'The request this tag sent did not complete with a whole response', cause: 'display-error' })
        })
    }
    test('a saved unary call can be read offline before its schema has loaded', async() => {
        delete grpc.grpcSchemas.schema
        expect(await handleResponseTag(tag(), 'display', undefined)).toBe('reply-token')
        expect(grpc.loadGrpcSchemaForItem).not.toHaveBeenCalled()
        expect(grpc.startGrpcCallForItem).not.toHaveBeenCalled()
    })
    test('a dependency schema preparation error stops the tag with that cause', async() => {
        delete grpc.grpcSchemas.schema
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        grpc.loadGrpcSchemaForItem.mockResolvedValueOnce({ schema: null, error: 'Login history unavailable', errorWithoutValues: 'Login history unavailable', connectionStatus: null })
        await expect(handleResponseTag(tag({ behavior: 'always' }), 'send', undefined)).rejects.toThrow('Login history unavailable')
        expect(grpc.startGrpcCallForItem).not.toHaveBeenCalled()
    })
    test('a schema wait rereads newly saved history before deciding whether to send', async() => {
        delete grpc.grpcSchemas.schema
        vi.mocked(getResponsesByCollectionId).mockResolvedValueOnce([]).mockResolvedValue([response()] as any)
        let finish!: () => void
        grpc.loadGrpcSchemaForItem.mockImplementationOnce(() => new Promise(resolve => {
            finish = () => {
                grpc.grpcSchemas.schema = { schema: { services: [{ name: 'demo.Login', methods: [{ name: 'Token', requestStream: false, responseStream: false }] }] } }
                resolve({ schema: grpc.grpcSchemas.schema.schema, error: null, connectionStatus: null })
            }
        }))
        const result = handleResponseTag(tag({ behavior: 'no-history' }), 'send', undefined)
        await vi.waitFor(() => expect(grpc.loadGrpcSchemaForItem).toHaveBeenCalledOnce())
        finish()
        expect(await result).toBe('reply-token')
        expect(getResponsesByCollectionId).toHaveBeenCalledTimes(2)
        expect(grpc.startGrpcCallForItem).not.toHaveBeenCalled()
    })
    test('an offline tag skips a newer failed call without a known kind', async() => {
        delete grpc.grpcSchemas.schema
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([response({ kind: null, ended: 'failed', events: [], status: null }), response()] as any)
        expect(await handleResponseTag(tag(), 'display', undefined)).toBe('reply-token')
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
        expect(await handleResponseTag(tag(), 'send', undefined)).toBe('reply-token')
        vi.mocked(getResponsesByCollectionId).mockResolvedValue(skipped as any)
        expect(await handleResponseTag(tag(), 'send', undefined)).toBeUndefined()
    })
    test('streams and an unchosen method fail with the response tag error', async() => {
        for(const method of [{ name: 'Token', requestStream: true, responseStream: false }, { name: 'Token', requestStream: false, responseStream: true }, null]) {
            grpc.grpcSchemas.schema.schema.services[0].methods = method ? [method] : []
            await expect(handleResponseTag(tag(), 'send', undefined)).rejects.toMatchObject({ message: 'A response tag can read only a unary gRPC call', cause: 'display-error' })
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
            const send = new SendResolver('wA', 'send')
            await expect(send.resolve({}, `{% response(request='Login.json', attribute='body', path='$.token', behavior='${behavior}') %}`, 'unsaved')).rejects.toThrow('The request this tag reads is in another workspace')
            expect(getResponsesByCollectionId).not.toHaveBeenCalled()
            expect(store.dispatch).not.toHaveBeenCalled()
        } finally {
            store.state.collection = originalCollection
        }
    })
}

for(const change of ['delete', 'switch']) {
    test(`a later ${change} during history stops before sending or schema loading`, async() => {
        const collection = store.state.collection
        ;(store.state as any).activeWorkspace = { _id: 'w' }
        let finish!: (responses: any[]) => void
        vi.mocked(getResponsesByCollectionId).mockReturnValueOnce(new Promise(resolve => {
            finish = resolve
        }))
        const result = handleResponseTag({ ...tokenTag, parameters: { ...tokenTag.parameters, behavior: 'no-history' } }, 'send', undefined, 'w')
        if(change === 'delete') {
            store.state.collection = []
        } else {
            (store.state as any).activeWorkspace = { _id: 'other' }; store.state.collection = [{ ...collection[0], workspaceId: 'other' }]
        }
        finish([])
        await expect(result).rejects.toThrow()
        expect(store.dispatch).not.toHaveBeenCalled()
        store.state.collection = collection
    })
}
for(const change of ['delete', 'switch']) {
    test(`a ${change} while the tag's own send runs stops before using its reply`, async() => {
        const collection = store.state.collection
        ;(store.state as any).activeWorkspace = { _id: 'w' }
        let finish!: (response: any) => void
        vi.mocked(store.dispatch).mockReturnValueOnce(new Promise(resolve => {
            finish = resolve
        }))
        try {
            const result = handleResponseTag({ ...tokenTag, parameters: { ...tokenTag.parameters, behavior: 'always' } }, 'send', undefined, 'w')
            await vi.waitFor(() => expect(store.dispatch).toHaveBeenCalledOnce())
            if(change === 'delete') {
                store.state.collection = []
            } else {
                (store.state as any).activeWorkspace = { _id: 'other' }; store.state.collection = [{ ...collection[0], workspaceId: 'other' }]
            }
            finish(savedResponse('sent', '{"token":"new"}'))
            await expect(result).rejects.toThrow(change === 'delete' ? 'was deleted' : 'another workspace')
        } finally {
            store.state.collection = collection
        }
    })
}
test('initially deleted target is absence in its active workspace', async() => {
    (store.state as any).activeWorkspace = { _id: 'w' }
    expect(await handleResponseTag({ ...tokenTag, parameters: { ...tokenTag.parameters, request: 'deleted' } }, 'display', undefined, 'w')).toBeUndefined()
})

for(const [behavior, mode] of [['never', 'send'], ['when-expired', 'send'], ['no-history', 'send'], ['always', 'display']] as const) {
    for(const change of ['delete', 'switch']) {
        test(`${behavior} in ${mode} rejects a ${change} during a history read that would return a saved value`, async() => {
            const collection = store.state.collection
            let release!: () => void
            vi.mocked(getResponsesByCollectionId).mockImplementationOnce(() => new Promise(resolve => {
                release = () => resolve([savedResponse('saved', '{"token":"old"}')] as any)
            }))
            const tag = { ...tokenTag, parameters: { ...tokenTag.parameters, behavior, maxAge: 3600 } }
            const result = handleResponseTag(tag, mode, undefined, 'w')
            try {
                expect(getResponsesByCollectionId).toHaveBeenCalledWith('w', 'login')
                store.state.collection = change === 'delete' ? [] : [{ ...collection[0], workspaceId: 'other' }]
                if(change === 'switch') {
                    store.state.activeWorkspace = { _id: 'other' } as any
                }
                release()
                await expect(result).rejects.toMatchObject({ message: change === 'delete' ? 'The request this tag reads was deleted' : 'The request this tag reads is in another workspace', cause: 'display-error' })
                expect(store.dispatch).not.toHaveBeenCalled()
            } finally {
                store.state.collection = collection
            }
        })
    }
}

for(const mode of [undefined, true, false, 'invalid', 'display']) {
    test(`only the send mode grants permission, received: ${String(mode)}`, async() => {
        const prompt = vi.fn(async() => 'asked')
        window.createPrompt = prompt
        const text = `{% response(request='login', attribute='body', path='$.token', behavior='always') %}`
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([savedResponse('saved', '{"token":"saved"}')] as any)
        expect(await substituteEnvironmentVariables({}, text, mode as any)).toBe('saved')
        const resolver = new SendResolver('w', mode as any)
        expect(await resolver.resolve({}, `${text}/{% prompt(title='P', defaultValue='preview') %}`, 'unsaved')).toBe('saved/preview')
        expect(store.dispatch).not.toHaveBeenCalled()
        expect(prompt).not.toHaveBeenCalled()
    })
}

test('placeholder policy covers only display response-tag errors, while real send resolvers reject absence', async() => {
    const text = `{% response(request='login', attribute='body', path='$.token', behavior='never') %}`
    vi.mocked(getResponsesByCollectionId).mockRejectedValue(new Error('history failed'))
    expect(await substituteEnvironmentVariables({}, text, 'display', { noError: true, responseTagErrors: 'placeholder' })).toBe('<no value found>')
    await expect(substituteEnvironmentVariables({}, text, 'display', { noError: true })).rejects.toThrow('history failed')
    await expect(substituteEnvironmentVariables({}, '{% malformed %}', 'display', { noError: true, responseTagErrors: 'placeholder' })).resolves.toBe('{% malformed %}')
    await expect(substituteEnvironmentVariables({}, '{% invalid(1) %}', 'display', { responseTagErrors: 'placeholder' })).rejects.toThrow('Could not resolve tag')
    vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
    await expect(substituteEnvironmentVariables({}, text, 'send', { noError: true })).resolves.toBe('<no value found>')
    await expect(new SendResolver('w', 'send').resolve({}, text, 'unsaved')).rejects.toThrow('Could not resolve tag')
    await expect(substituteEnvironmentVariablesForSend({}, text, 'w')).rejects.toThrow('Could not resolve tag')
})

for(const displayError of [false, true]) {
    test(`placeholder response tags log unexpected history errors only, display error: ${displayError}`, async() => {
        const error = new Error('History file cannot be parsed', displayError ? { cause: 'display-error' } : undefined)
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        vi.mocked(getResponsesByCollectionId).mockRejectedValueOnce(error)
        try {
            expect(await substituteEnvironmentVariables({}, `{% response(request='login', attribute='body', path='$.token', behavior='never') %}`, 'display', { noError: true, responseTagErrors: 'placeholder' })).toBe('<no value found>')
            expect(log).toHaveBeenCalledTimes(displayError ? 0 : 1)
            if(!displayError) {
                expect(log).toHaveBeenCalledWith(error)
            }
        } finally {
            log.mockRestore()
        }
    })
}

describe('later gRPC lookups', () => {
    for(const errorWithoutValues of ['Metadata ******: a name has only letters, digits, -, _ and .', undefined]) {
        test(`a schema error thrown by a response tag is safe for history, engine copy: ${errorWithoutValues !== undefined}`, async() => {
            const collection = store.state.collection
            store.state.collection = [{ _id: 'g', _type: 'grpc', workspaceId: 'w', grpc: { service: 'Demo', method: 'Call' } } as any]
            grpc.loadGrpcSchemaForItem.mockReset().mockResolvedValueOnce({
                schema: null,
                error: 'Metadata private name: a name has only letters, digits, -, _ and .',
                errorWithoutValues,
                connectionStatus: null,
            })
            try {
                const result = handleResponseTag({ ...tokenTag, parameters: { ...tokenTag.parameters, request: 'g', behavior: 'always' } }, 'send', undefined, 'w')
                await expect(result).rejects.toMatchObject({ message: errorWithoutValues ?? 'Could not load the methods of the request this tag reads', cause: 'display-error' })
                await expect(result).rejects.not.toThrow('private name')
            } finally {
                store.state.collection = collection
            }
        })
    }

    for(const waitingOn of ['history', 'schema']) {
        for(const change of ['delete', 'switch']) {
            test(`${change} during ${waitingOn} stops before a dependency can be sent`, async() => {
                const original = store.state.collection
                const item = { _id: 'g', _type: 'grpc', workspaceId: 'w', name: 'G', parentId: null, grpc: { service: 'Demo', method: 'Call' } } as const
                store.state.collection = [item as any]
                let release!: () => void
                Object.keys(grpc.grpcSchemas).forEach(key => delete grpc.grpcSchemas[key])
                grpc.loadGrpcSchemaForItem.mockReset()
                grpc.startGrpcCallForItem.mockReset()
                vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
                if(waitingOn === 'history') {
                    vi.mocked(getResponsesByCollectionId).mockImplementationOnce(() => new Promise(resolve => {
                        release = () => resolve([])
                    }))
                } else {
                    grpc.loadGrpcSchemaForItem.mockImplementationOnce(() => new Promise(resolve => {
                        release = () => resolve({ schema: null, error: null, connectionStatus: null })
                    }))
                }
                const tag = { ...tokenTag, parameters: { ...tokenTag.parameters, request: 'g', behavior: 'always' } }
                const result = handleResponseTag(tag, 'send', undefined, 'w')
                const rejected = expect(result).rejects.toThrow(change === 'delete' ? 'The request this tag reads was deleted' : 'The request this tag reads is in another workspace')
                if(waitingOn === 'schema') {
                    await vi.waitFor(() => expect(grpc.loadGrpcSchemaForItem).toHaveBeenCalledOnce())
                }
                store.state.collection = change === 'delete' ? [] : [{ ...item, workspaceId: 'other' } as any]
                if(change === 'switch') {
                    store.state.activeWorkspace = { _id: 'other' } as any
                }
                release()
                await rejected
                if(waitingOn === 'history') {
                    expect(grpc.loadGrpcSchemaForItem).not.toHaveBeenCalled()
                }
                expect(grpc.startGrpcCallForItem).not.toHaveBeenCalled()
                store.state.collection = original
            })
        }
    }
})
