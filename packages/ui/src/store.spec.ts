import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./db', () => ({
    getResponsesByCollectionId: vi.fn(),
    getCollectionForWorkspace: vi.fn(),
    getAllWorkspaces: vi.fn(),
    putWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    getAllCollectionIdsForGivenWorkspace: vi.fn(),
    createCollection: vi.fn(),
    createCollections: vi.fn(),
    updateCollection: vi.fn(),
    createResponse: vi.fn(),
    updateResponse: vi.fn(),
    deleteResponsesByCollectionIds: vi.fn(),
    deleteResponsesByCollectionId: vi.fn(),
    deleteResponse: vi.fn(),
    deleteResponsesByIds: vi.fn(),
    deletePluginsByWorkspace: vi.fn(),
    deletePluginsByCollectionIds: vi.fn(),
    modifyCollections: vi.fn(),
    deleteCollectionsByWorkspaceId: vi.fn(),
    getGlobalPlugins: vi.fn(),
    getWorkspacePlugins: vi.fn(),
    deleteCollectionsByIds: vi.fn(),
    createPlugin: vi.fn(),
    updatePlugin: vi.fn(),
    deletePlugin: vi.fn(),
    createPlugins: vi.fn(),
}))

vi.mock('./helpers', async(importOriginal) => {
    const original = await importOriginal<typeof import('./helpers')>()
    return { ...original, handleRequest: vi.fn() }
})

const grpcTransport = vi.hoisted(() => ({
    isGrpcAvailable: vi.fn(() => true),
    loadGrpcSchema: vi.fn(),
    startGrpcCall: vi.fn(),
}))

vi.mock('./utils/grpc-transport', () => grpcTransport)

import { createCollection, createCollections, createPlugin, createPlugins, createResponse, deleteCollectionsByIds, deletePlugin, deleteResponse, deleteResponsesByCollectionId, getCollectionForWorkspace, getResponsesByCollectionId, updateCollection, updatePlugin, updateResponse } from './db'
import type { CollectionItem, Plugin, ResponseHead, ResponseProgress, ResponseProgressHandler, Workspace } from './global'
import { store } from './store'
import { emitter } from './event-bus'
import { INHERITED_AUTHENTICATION_TYPE, handleRequest } from './helpers'
import { type GrpcLiveCall, getGrpcItemKey, grpcCalls, resetGrpcCalls, startGrpcCallForItem } from './utils/grpc-calls'

function scriptPlugin(id: string, code: { pre_request: string, post_request: string }): Plugin {
    return {
        _id: id,
        type: 'script',
        name: null,
        code,
        workspaceId: null,
        collectionId: 'request-id',
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
    }
}

describe('saveRequestScript', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(emitter, 'emit')
        store.state.activeWorkspace = {
            _id: 'workspace-id',
            _type: 'file',
            name: 'Workspace',
        } as Workspace
        store.state.plugins.workspace = []
    })

    afterEach(() => vi.restoreAllMocks())

    test('reports a failed create, keeps the typed script and creates it again on the next edit', async() => {
        vi.mocked(createPlugin).mockRejectedValueOnce(new Error('Cannot read plugins'))
        const script = (preRequest: string) => ({ collectionId: 'request-id', code: { pre_request: preRequest, post_request: '' } })

        expect(await store.dispatch('saveRequestScript', script('new'))).toBe(false)
        expect(emitter.emit).toHaveBeenCalledWith('error', 'Cannot read plugins')
        // the script editor shows this plugin, so dropping it would clear what was typed
        expect(store.state.plugins.workspace.map(plugin => plugin.code.pre_request)).toEqual(['new'])

        expect(await store.dispatch('saveRequestScript', script('newer'))).toBe(true)
        expect(createPlugin).toHaveBeenCalledTimes(2)
        expect(vi.mocked(createPlugin).mock.calls[1][0]).toMatchObject({ _id: store.state.plugins.workspace[0]._id, code: script('newer').code })
        expect(updatePlugin).not.toHaveBeenCalled()

        expect(await store.dispatch('saveRequestScript', script('newest'))).toBe(true)
        expect(createPlugin).toHaveBeenCalledTimes(2)
        expect(updatePlugin).toHaveBeenCalledOnce()
        expect(store.state.plugins.workspace).toHaveLength(1)
    })

    test('an edit made while a failed script is created again updates it rather than creating it twice', async() => {
        vi.mocked(createPlugin).mockRejectedValueOnce(new Error('Cannot read plugins'))
        const script = (preRequest: string) => ({ collectionId: 'request-id', code: { pre_request: preRequest, post_request: '' } })
        expect(await store.dispatch('saveRequestScript', script('new'))).toBe(false)
        let finishCreate!: () => void
        vi.mocked(createPlugin).mockImplementationOnce(() => new Promise<void>(resolve => finishCreate = resolve))

        const retried = store.dispatch('saveRequestScript', script('newer'))
        const edited = store.dispatch('saveRequestScript', script('newest'))
        finishCreate()

        expect(await retried).toBe(true)
        expect(await edited).toBe(true)
        expect(createPlugin).toHaveBeenCalledTimes(2)
        expect(updatePlugin).toHaveBeenCalledOnce()
    })

    test('reports a failed update and keeps the saved script', async() => {
        const plugin = scriptPlugin('primary', { pre_request: 'saved', post_request: '' })
        store.state.plugins.workspace = [plugin]
        vi.mocked(updatePlugin).mockRejectedValueOnce(new Error('Cannot update plugins'))

        expect(await store.dispatch('saveRequestScript', {
            collectionId: 'request-id', code: { pre_request: 'new', post_request: '' },
        })).toBe(false)

        expect(emitter.emit).toHaveBeenCalledWith('error', 'Cannot update plugins')
        expect(store.state.plugins.workspace[0].code).toEqual({ pre_request: 'saved', post_request: '' })
    })

    test('reports a failed duplicate delete and keeps the duplicate in memory', async() => {
        store.state.plugins.workspace = [
            scriptPlugin('primary', { pre_request: '', post_request: '' }),
            scriptPlugin('duplicate', { pre_request: '', post_request: 'saved' }),
        ]
        vi.mocked(deletePlugin).mockRejectedValueOnce(new Error('Cannot delete plugins'))

        expect(await store.dispatch('saveRequestScript', {
            collectionId: 'request-id', code: { pre_request: 'new', post_request: '' },
        })).toBe(false)
        expect(emitter.emit).toHaveBeenCalledWith('error', 'Cannot delete plugins')
        expect(store.state.plugins.workspace.map(plugin => plugin._id)).toEqual(['primary', 'duplicate'])
    })

    test('updates the primary script and removes stale duplicates', async() => {
        const primary = scriptPlugin('primary', {
            pre_request: '',
            post_request: '',
        })
        const duplicate = scriptPlugin('duplicate', {
            pre_request: '',
            post_request: 'throw new Error("stale")',
        })
        store.state.plugins.workspace = [primary, duplicate]

        await store.dispatch('saveRequestScript', {
            collectionId: 'request-id',
            code: {
                pre_request: '',
                post_request: '',
            },
        })

        expect(store.state.plugins.workspace).toHaveLength(1)
        expect(store.state.plugins.workspace[0]._id).toBe('primary')
        expect(store.state.plugins.workspace[0].code).toEqual({
            pre_request: '',
            post_request: '',
        })
        expect(updatePlugin).toHaveBeenCalledOnce()
        expect(deletePlugin).toHaveBeenCalledWith(
            'duplicate',
            'workspace-id',
            'request-id',
        )
    })

    test('reserves a new script before persistence to prevent duplicate creation', async() => {
        let finishCreate: (() => void) | undefined
        vi.mocked(createPlugin).mockImplementationOnce(() => new Promise<void>(resolve => {
            finishCreate = resolve
        }))

        const firstSave = store.dispatch('saveRequestScript', {
            collectionId: 'request-id',
            code: {
                pre_request: 'first',
                post_request: '',
            },
        })
        const secondSave = store.dispatch('saveRequestScript', {
            collectionId: 'request-id',
            code: {
                pre_request: 'second',
                post_request: '',
            },
        })

        finishCreate?.()
        await Promise.all([firstSave, secondSave])

        expect(createPlugin).toHaveBeenCalledOnce()
        expect(updatePlugin).toHaveBeenCalledOnce()
        expect(store.state.plugins.workspace).toHaveLength(1)
        expect(store.state.plugins.workspace[0].code).toEqual({
            pre_request: 'second',
            post_request: '',
        })
    })
})

describe('Plugins modal mutations', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(emitter, 'emit')
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'file', name: 'Workspace' } as Workspace
        store.state.plugins.global = []
        store.state.plugins.workspace = []
    })

    afterEach(() => vi.restoreAllMocks())

    for(const scope of ['global', 'workspace'] as const) {
        const plugin = () => ({
            ...scriptPlugin('plugin', { pre_request: 'saved', post_request: '' }),
            name: 'Saved', collectionId: null, workspaceId: scope === 'global' ? null : 'workspace-id',
        })

        for(const mutation of ['addPlugin', 'updatePlugin', 'updatePluginStatus', 'deletePlugin']) {
            test(`reports a failed ${mutation} in ${scope} scope and preserves memory`, async() => {
                const saved = plugin()
                if(mutation !== 'addPlugin') {
                    store.state.plugins[scope] = [saved]
                }
                const before = JSON.parse(JSON.stringify(store.state.plugins))
                const operation = mutation === 'addPlugin' ? createPlugin : mutation === 'deletePlugin' ? deletePlugin : updatePlugin
                vi.mocked(operation).mockRejectedValueOnce(new Error('Storage failed'))

                store.commit(mutation, mutation === 'deletePlugin' ? saved._id : { ...saved, name: 'Changed', enabled: false })

                await vi.waitFor(() => expect(emitter.emit).toHaveBeenCalledWith('error', 'Storage failed'))
                expect(store.state.plugins).toEqual(before)
            })
        }

        test(`a failed scope move from ${scope} keeps the original copy and plugin`, async() => {
            const saved = plugin()
            store.state.plugins[scope] = [saved]
            const before = JSON.parse(JSON.stringify(store.state.plugins))
            vi.mocked(createPlugin).mockRejectedValueOnce(new Error('Cannot create destination'))

            store.commit('updatePlugin', { ...saved, name: 'Changed', workspaceId: scope === 'global' ? 'workspace-id' : null })

            await vi.waitFor(() => expect(emitter.emit).toHaveBeenCalledWith('error', 'Cannot create destination'))
            expect(deletePlugin).not.toHaveBeenCalled()
            expect(store.state.plugins).toEqual(before)
        })

        test(`a scope move from ${scope} creates first and keeps memory unchanged if deleting the old copy fails`, async() => {
            const saved = plugin()
            store.state.plugins[scope] = [saved]
            const before = JSON.parse(JSON.stringify(store.state.plugins))
            let finishCreate!: () => void
            vi.mocked(createPlugin).mockImplementationOnce(() => new Promise<void>(resolve => finishCreate = resolve))
            vi.mocked(deletePlugin).mockRejectedValueOnce(new Error('Cannot delete source'))

            store.commit('updatePlugin', { ...saved, name: 'Changed', workspaceId: scope === 'global' ? 'workspace-id' : null })
            expect(createPlugin).toHaveBeenCalledOnce()
            expect(deletePlugin).not.toHaveBeenCalled()
            expect(store.state.plugins).toEqual(before)
            finishCreate()

            await vi.waitFor(() => expect(emitter.emit).toHaveBeenCalledWith('error', 'Cannot delete source'))
            expect(deletePlugin).toHaveBeenCalledOnce()
            expect(store.state.plugins).toEqual(before)
        })

        test(`a successful scope move from ${scope} updates memory after storage succeeds`, async() => {
            const saved = plugin()
            store.state.plugins[scope] = [saved]
            const destination = scope === 'global' ? 'workspace' : 'global'
            const moved = { ...saved, name: 'Changed', workspaceId: scope === 'global' ? 'workspace-id' : null }

            store.commit('updatePlugin', moved)

            await vi.waitFor(() => expect(store.state.plugins[destination]).toHaveLength(1))
            expect(store.state.plugins[scope]).toEqual([])
            expect(store.state.plugins[destination][0]).toMatchObject({ ...moved, updatedAt: expect.any(Number) })
            expect(vi.mocked(createPlugin).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deletePlugin).mock.invocationCallOrder[0])
            expect(emitter.emit).not.toHaveBeenCalledWith('error', expect.anything())
        })
    }
})

describe('getEnvironmentForRequest', () => {
    const folder = (id: string, parentId: string | null, authentication: CollectionItem['authentication']): CollectionItem => ({
        _id: id,
        _type: 'request_group',
        name: id,
        parentId,
        workspaceId: 'workspace-id',
        authentication,
    })
    const request: CollectionItem = { _id: 'request-id', _type: 'request', name: 'Request', parentId: 'child', workspaceId: 'workspace-id' }
    const rootAuthentication = { type: 'bearer', token: 'root-token' }

    const resolve = async(childAuthentication: CollectionItem['authentication']) => {
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'file', name: 'Workspace', dotEnv: {} } as Workspace
        store.state.collection = [folder('root', null, rootAuthentication), folder('child', 'root', childAuthentication), request]
        const { parentAuthentication } = await store.dispatch('getEnvironmentForRequest', { collectionItem: request })
        return parentAuthentication
    }

    test('a folder set to No Auth stops the auth of the folders above it', async() => {
        expect(await resolve({ type: 'none' })).toBeUndefined()
    })

    test('a folder set to Inherit, or without an authentication object, passes the auth of the folder above it through', async() => {
        expect(await resolve({ type: INHERITED_AUTHENTICATION_TYPE })).toEqual(rootAuthentication)
        expect(await resolve(undefined)).toEqual(rootAuthentication)
    })

    test('a folder whose own auth is unticked passes the auth of the folder above it through, as it always has', async() => {
        expect(await resolve({ type: 'bearer', token: 'child-token', disabled: true })).toEqual(rootAuthentication)
    })

    test('a folder with an auth of its own wins over the folder above it', async() => {
        expect(await resolve({ type: 'basic', username: 'u', password: 'p' })).toEqual({ type: 'basic', username: 'u', password: 'p' })
    })
})

describe('getEnvironmentForRequest with a prompt tag', () => {
    test('a prompt tag in a folder environment is left for send time, so switching tabs never asks', async() => {
        const createPrompt = vi.fn(async() => 'typed')
        ;(window as any).createPrompt = createPrompt
        const tag = `{% prompt(title='Password') %}`
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'file', name: 'Workspace', dotEnv: {}, environment: { WORKSPACE_PASSWORD: tag } } as unknown as Workspace
        store.state.collection = [
            { _id: 'folder', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: 'workspace-id', environment: { PASSWORD: tag, COPY: '{{WORKSPACE_PASSWORD}}' } },
            { _id: 'request-id', _type: 'request', name: 'Request', parentId: 'folder', workspaceId: 'workspace-id' },
        ] as CollectionItem[]
        const { environment } = await store.dispatch('getEnvironmentForRequest', { collectionItem: store.state.collection[1] })
        expect(environment).toMatchObject({ PASSWORD: tag, WORKSPACE_PASSWORD: tag, COPY: tag })
        expect(createPrompt).not.toHaveBeenCalled()
    })
})

describe('sendRequest while a response arrives', () => {
    const tab = { _id: 'stream-tab', _type: 'request', name: 'Stream', parentId: null, workspaceId: 'workspace-id', method: 'GET', url: 'http://127.0.0.1/sse' } as CollectionItem
    const encoder = new TextEncoder()

    const head = (contentType: string): ResponseHead => ({ status: 200, statusText: 'OK', headers: [['Content-Type', contentType]], headTimeTaken: 5 })

    const responseOf = (id: string, bytes: Uint8Array[], extra: Record<string, unknown> = {}) => {
        const buffer = new Uint8Array(bytes.reduce((total, chunk) => total + chunk.byteLength, 0))
        let offset = 0
        bytes.forEach(chunk => {
            buffer.set(chunk, offset)
            offset += chunk.byteLength
        })
        return { _id: id, collectionId: tab._id, status: 200, statusText: 'OK', headers: [['Content-Type', 'text/event-stream']], buffer: buffer.buffer, testResults: [], ...extra }
    }

    // a handleRequest that hands its progress handler and a way to finish to the test, queued in dispatch order
    const controlledSend = () => {
        let handler: ResponseProgressHandler | undefined
        let signal: AbortSignal | undefined
        let finish: ((response: any) => void) | undefined
        const started = new Promise<void>(resolveStarted => {
            vi.mocked(handleRequest).mockImplementationOnce((...args: any[]) => {
                handler = args[9]
                signal = args[7]
                resolveStarted()
                return new Promise(resolve => {
                    finish = resolve
                })
            })
        })
        return {
            started,
            progress: (progress: ResponseProgress) => handler?.(progress),
            finish: (response: any) => finish?.(response),
            signal: () => signal!,
        }
    }

    // Send with interval sends again while earlier sends may still arrive
    const sendOnInterval = () => store.dispatch('sendRequest', tab)
    // the Send button, Enter and the send shortcut
    const sendByUser = () => store.dispatch('sendRequest', { collectionItem: tab, cancelEarlierSends: true })

    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'file', name: 'Workspace', dotEnv: {} } as Workspace
        store.state.collection = [tab]
        store.state.plugins.global = []
        store.state.plugins.workspace = []
        delete store.state.responses[tab._id]
        delete store.state.requestResponseStreams[tab._id]
        store.state.responseChunkTimes = {}
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    test('an event stream still open at 250 ms shows as receiving, with the chunks that arrived', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        send.progress({ type: 'head', head: head('text/event-stream') })
        send.progress({ type: 'data', bytes: encoder.encode('data: 1\n\n') })
        vi.advanceTimersByTime(249)
        expect(store.state.requestResponseStatus[tab._id]).toBe('loading')
        vi.advanceTimersByTime(1)

        expect(store.state.requestResponseStatus[tab._id]).toBe('receiving')
        expect(store.state.requestResponseStreams[tab._id]).toMatchObject({ view: 'events', receivedBytes: 9, revision: 1 })
        expect(store.state.requestResponseStreams[tab._id].chunks.length).toBe(1)
        expect(store.state.requestResponseStreams[tab._id].chunkTimes.length).toBe(1)

        send.finish(responseOf('response-1', [encoder.encode('data: 1\n\n')]))
        await sent
    })

    test('a response that fails to save goes back to loading, as before streaming, not to a receiving view with nothing to show', async() => {
        vi.mocked(createResponse).mockRejectedValueOnce(new Error('save failed'))
        // the history of an open tab is already loaded
        store.state.responses[tab._id] = []
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        send.progress({ type: 'head', head: head('text/event-stream') })
        vi.advanceTimersByTime(250)
        expect(store.state.requestResponseStatus[tab._id]).toBe('receiving')

        send.finish(responseOf('response-1', []))
        await expect(sent).rejects.toThrow('save failed')
        expect(tab._id in store.state.requestResponseStreams).toBe(false)
        expect(store.state.requestResponseStatus[tab._id]).toBe('loading')
    })

    test('a JSON lines body still open at 250 ms shows as receiving too', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        send.progress({ type: 'head', head: head('application/x-ndjson') })
        vi.advanceTimersByTime(250)
        expect(store.state.requestResponseStatus[tab._id]).toBe('receiving')
        expect(store.state.requestResponseStreams[tab._id].view).toBe('lines')

        send.finish(responseOf('response-1', []))
        await sent
    })

    test('an event stream that ends at once, such as an MCP reply, never shows as receiving, also while slow scripts run', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        send.progress({ type: 'head', head: head('text/event-stream') })
        send.progress({ type: 'data', bytes: encoder.encode('data: 1\n\n') })
        send.progress({ type: 'end' })
        // the scripts and the save take a second
        vi.advanceTimersByTime(1000)
        expect(store.state.requestResponseStatus[tab._id]).toBe('loading')

        send.finish(responseOf('response-1', [encoder.encode('data: 1\n\n')]))
        await sent
        expect(store.state.requestResponseStatus[tab._id]).toBe('loaded')
    })

    test('a JSON body cut short is shown but not saved, older versions would read it as whole, a stream cut short is saved', async() => {
        // the history of an open tab is already loaded
        store.state.responses[tab._id] = []
        const json = controlledSend()
        const jsonSent = store.dispatch('sendRequest', tab)
        await json.started
        json.finish(responseOf('json-partial', [encoder.encode('{"tok')], { headers: [['Content-Type', 'application/json']], bodyIncomplete: 'timedOut' }))
        await jsonSent

        expect(store.state.requestResponses[tab._id]._id).toBe('json-partial')
        expect(store.state.requestResponseStatus[tab._id]).toBe('loaded')
        expect(createResponse).not.toHaveBeenCalled()
        expect(store.state.responses[tab._id]).toEqual([])

        const events = controlledSend()
        const eventsSent = store.dispatch('sendRequest', tab)
        await events.started
        events.finish(responseOf('events-partial', [encoder.encode('data: 1\n\n')], { headers: [['Content-Type', 'text/event-stream']], bodyIncomplete: 'timedOut' }))
        await eventsSent

        expect(createResponse).toHaveBeenCalledOnce()
        expect(store.state.responses[tab._id].map((response: any) => response._id)).toEqual(['events-partial'])
    })

    test('a JSON response that ends within 100 ms never shows as receiving', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        send.progress({ type: 'head', head: head('application/json') })
        send.progress({ type: 'data', bytes: encoder.encode('{"a":1}') })
        expect(store.state.requestResponseStreams[tab._id].view).toBe('text')
        vi.advanceTimersByTime(90)
        expect(store.state.requestResponseStatus[tab._id]).toBe('loading')

        send.finish(responseOf('response-1', [encoder.encode('{"a":1}')]))
        await sent
        expect(store.state.requestResponseStatus[tab._id]).toBe('loaded')

        vi.advanceTimersByTime(1000)
        expect(store.state.requestResponseStatus[tab._id]).toBe('loaded')
        expect(tab._id in store.state.requestResponseStreams).toBe(false)
    })

    test('a JSON response still open at 300 ms shows as receiving', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        send.progress({ type: 'head', head: head('application/json') })
        vi.advanceTimersByTime(249)
        expect(store.state.requestResponseStatus[tab._id]).toBe('loading')
        vi.advanceTimersByTime(51)
        expect(store.state.requestResponseStatus[tab._id]).toBe('receiving')

        send.finish(responseOf('response-1', []))
        await sent
        expect(store.state.requestResponseStatus[tab._id]).toBe('loaded')
    })

    test('the size and revision refresh at most once per 100 ms across 50 chunks', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        send.progress({ type: 'head', head: head('application/octet-stream') })
        const stream = store.state.requestResponseStreams[tab._id]
        const bumpTimes: number[] = []
        let lastRevision = stream.revision
        const chunk = new Uint8Array(1000)

        for(let i = 0; i < 50; i++) {
            send.progress({ type: 'data', bytes: chunk })
            vi.advanceTimersByTime(10)
            if(stream.revision !== lastRevision) {
                expect(stream.revision).toBe(lastRevision + 1)
                lastRevision = stream.revision
                bumpTimes.push(Date.now())
            }
        }

        expect(stream.chunks.length).toBe(50)
        expect(bumpTimes.length).toBeGreaterThan(0)
        expect(bumpTimes.length).toBeLessThanOrEqual(5)
        bumpTimes.slice(1).forEach((time, index) => {
            expect(time - bumpTimes[index]).toBeGreaterThanOrEqual(100)
        })

        vi.advanceTimersByTime(100)
        expect(stream.receivedBytes).toBe(50 * 1000)

        send.finish(responseOf('response-1', Array(50).fill(chunk)))
        await sent
    })

    test('at the end the response is saved once with its bodyIncomplete, the status is loaded and the entry is gone', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        const chunks = [encoder.encode('data: 1\n\n'), encoder.encode('data: 2\n')]
        send.progress({ type: 'head', head: head('text/event-stream') })
        send.progress({ type: 'data', bytes: chunks[0] })
        send.progress({ type: 'data', bytes: chunks[1] })

        send.finish(responseOf('response-1', chunks, { bodyIncomplete: 'cancelled' }))
        await sent

        expect(createResponse).toHaveBeenCalledOnce()
        expect(vi.mocked(createResponse).mock.calls[0][1]).toMatchObject({ _id: 'response-1', bodyIncomplete: 'cancelled' })
        expect(store.state.requestResponses[tab._id]).toMatchObject({ _id: 'response-1', bodyIncomplete: 'cancelled' })
        expect(store.state.requestResponseStatus[tab._id]).toBe('loaded')
        expect(tab._id in store.state.requestResponseStreams).toBe(false)
    })

    test('a complete response is saved without a bodyIncomplete field', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        send.progress({ type: 'head', head: head('application/json') })
        send.finish(responseOf('response-1', []))
        await sent

        expect(createResponse).toHaveBeenCalledOnce()
        expect('bodyIncomplete' in vi.mocked(createResponse).mock.calls[0][1]).toBe(false)
    })

    test('the arrival time of each chunk is kept in memory for the response, never saved, and dropped with it', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        const chunks = [encoder.encode('data: 1\n\n'), encoder.encode('data: 22\n\n')]
        vi.advanceTimersByTime(40)
        send.progress({ type: 'head', head: head('text/event-stream') })
        vi.advanceTimersByTime(60)
        send.progress({ type: 'data', bytes: chunks[0] })
        vi.advanceTimersByTime(1140)
        send.progress({ type: 'data', bytes: chunks[1] })

        expect(store.state.requestResponseStreams[tab._id].chunkTimes).toEqual([100, 1240])

        send.finish(responseOf('response-1', chunks))
        await sent

        expect(store.state.responseChunkTimes['response-1']).toEqual({ chunkEnds: [9, 19], chunkTimes: [100, 1240] })
        expect(JSON.stringify(vi.mocked(createResponse).mock.calls[0][1])).not.toContain('chunkTimes')

        store.state.activeTab = tab
        store.commit('deleteCurrentlyActiveResponse')
        await vi.waitFor(() => expect('response-1' in store.state.responseChunkTimes).toBe(false))
    })

    test('no arrival times are kept when a script replaced the body, or when nothing arrived as chunks', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        send.progress({ type: 'head', head: head('text/event-stream') })
        send.progress({ type: 'data', bytes: encoder.encode('data: 1\n\n') })
        send.finish(responseOf('response-1', [encoder.encode('replaced by a script')]))
        await sent
        expect('response-1' in store.state.responseChunkTimes).toBe(false)

        vi.mocked(handleRequest).mockResolvedValueOnce(responseOf('response-2', [encoder.encode('{}')]) as any)
        await store.dispatch('sendRequest', tab)
        expect('response-2' in store.state.responseChunkTimes).toBe(false)
    })

    test('an earlier send still arriving on the tab never writes into a newer send\'s entry, nor removes it', async() => {
        // the history of an open tab is already loaded
        store.state.responses[tab._id] = []
        const first = controlledSend()
        const second = controlledSend()

        const firstSent = sendOnInterval()
        await first.started
        first.progress({ type: 'head', head: head('application/json') })
        first.progress({ type: 'data', bytes: encoder.encode('first-1') })

        const secondSent = sendOnInterval()
        await second.started
        second.progress({ type: 'head', head: head('text/event-stream') })
        const secondStream = store.state.requestResponseStreams[tab._id]

        first.progress({ type: 'data', bytes: encoder.encode('first-2') })
        vi.advanceTimersByTime(300)
        expect(secondStream.chunks.length).toBe(0)
        expect(secondStream.receivedBytes).toBe(0)
        expect(secondStream.revision).toBe(0)

        first.finish(responseOf('response-1', [encoder.encode('first-1'), encoder.encode('first-2')]))
        await firstSent
        expect(store.state.requestResponseStreams[tab._id]).toBe(secondStream)
        expect(store.state.responseChunkTimes['response-1']?.chunkEnds).toEqual([7, 14])

        second.progress({ type: 'data', bytes: encoder.encode('data: 2\n\n') })
        expect(secondStream.chunks.length).toBe(1)

        second.finish(responseOf('response-2', [encoder.encode('data: 2\n\n')]))
        await secondSent
        expect(tab._id in store.state.requestResponseStreams).toBe(false)
        expect(store.state.requestResponseStatus[tab._id]).toBe('loaded')
    })

    test('a body that ended stays on the loading overlay while its scripts or the save take long', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        send.progress({ type: 'head', head: head('application/json') })
        send.progress({ type: 'data', bytes: encoder.encode('{"a":1}') })
        send.progress({ type: 'end' })
        vi.advanceTimersByTime(1000)
        expect(store.state.requestResponseStatus[tab._id]).toBe('loading')

        send.finish(responseOf('response-1', [encoder.encode('{"a":1}')]))
        await sent
        expect(store.state.requestResponseStatus[tab._id]).toBe('loaded')
    })

    test('an event stream whose body ended shows every chunk and says it ended, while its scripts run', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        await send.started

        send.progress({ type: 'head', head: head('text/event-stream') })
        const stream = store.state.requestResponseStreams[tab._id]
        expect(stream.endedAt).toBeNull()
        send.progress({ type: 'data', bytes: encoder.encode('data: 1\n\n') })
        send.progress({ type: 'end' })

        expect(stream.endedAt).toBe(Date.now())
        expect(stream.receivedBytes).toBe(9)
        expect(stream.revision).toBe(1)
        expect(store.state.requestResponseStatus[tab._id]).toBe('loading')
        vi.advanceTimersByTime(1000)
        expect(stream.revision).toBe(1)

        send.finish(responseOf('response-1', [encoder.encode('data: 1\n\n')]))
        await sent
    })

    test('sending again cancels the earlier send on the tab, which no control could reach once replaced, and leaves it out of history, Send with interval does not', async() => {
        // the history of an open tab is already loaded
        store.state.responses[tab._id] = []
        const first = controlledSend()
        const second = controlledSend()
        const third = controlledSend()

        const firstSent = sendByUser()
        await first.started
        first.progress({ type: 'head', head: head('text/event-stream') })

        const secondSent = sendByUser()
        await second.started
        expect(first.signal().aborted).toBe(true)
        expect(second.signal().aborted).toBe(false)

        const thirdSent = sendOnInterval()
        await third.started
        expect(second.signal().aborted).toBe(false)

        first.finish(responseOf('response-1', [], { bodyIncomplete: 'cancelled' }))
        second.finish(responseOf('response-2', []))
        third.finish(responseOf('response-3', []))
        await Promise.all([firstSent, secondSent, thirdSent])

        // the send the user replaced is not kept, the ones that overlap on purpose are
        expect(store.state.responses[tab._id].map((response: any) => response._id).sort()).toEqual(['response-2', 'response-3'])
        expect(vi.mocked(createResponse).mock.calls.map(call => call[1]._id).sort()).toEqual(['response-2', 'response-3'])
    })

    test('an earlier send whose body had ended before sending again is still saved, its scripts were all that ran on', async() => {
        // the history of an open tab is already loaded
        store.state.responses[tab._id] = []
        const first = controlledSend()
        const second = controlledSend()

        const firstSent = sendByUser()
        await first.started
        first.progress({ type: 'head', head: head('application/json') })
        first.progress({ type: 'end' })

        const secondSent = sendByUser()
        await second.started

        first.finish(responseOf('response-1', []))
        second.finish(responseOf('response-2', []))
        await Promise.all([firstSent, secondSent])

        expect(store.state.responses[tab._id].map((response: any) => response._id).sort()).toEqual(['response-1', 'response-2'])
    })

    test('an earlier send that ends while a newer one is receiving leaves the newer one on screen, with its Stop', async() => {
        // the history of an open tab is already loaded
        store.state.responses[tab._id] = []
        const first = controlledSend()
        const second = controlledSend()

        const firstSent = sendOnInterval()
        await first.started
        first.progress({ type: 'head', head: head('text/event-stream') })
        first.progress({ type: 'data', bytes: encoder.encode('data: 1\n\n') })

        const secondSent = sendOnInterval()
        await second.started
        second.progress({ type: 'head', head: head('text/event-stream') })
        const secondStream = store.state.requestResponseStreams[tab._id]
        vi.advanceTimersByTime(250)
        expect(store.state.requestResponseStatus[tab._id]).toBe('receiving')

        first.finish(responseOf('response-1', [encoder.encode('data: 1\n\n')], { bodyIncomplete: 'timedOut' }))
        await firstSent
        expect(createResponse).toHaveBeenCalledOnce()
        expect(store.state.requestResponseStatus[tab._id]).toBe('receiving')
        expect(store.state.requestResponseStreams[tab._id]).toBe(secondStream)
        expect(store.state.requestResponses[tab._id]?._id).not.toBe('response-1')
        store.state.requestAbortController[tab._id].abort()
        expect(second.signal().aborted).toBe(true)

        second.finish(responseOf('response-2', [], { bodyIncomplete: 'cancelled' }))
        await secondSent
        expect(store.state.requestResponseStatus[tab._id]).toBe('loaded')
        expect(store.state.requestResponses[tab._id]._id).toBe('response-2')
    })

    test('an earlier send that ends while a newer one waits for its body keeps the overlay, and never flips the view back and forth', async() => {
        // the history of an open tab is already loaded
        store.state.responses[tab._id] = []
        const first = controlledSend()
        const second = controlledSend()
        const statuses: string[] = []
        const recordStatus = () => {
            const status = store.state.requestResponseStatus[tab._id]
            if(statuses[statuses.length - 1] !== status) {
                statuses.push(status)
            }
        }

        const firstSent = sendOnInterval()
        await first.started
        first.progress({ type: 'head', head: head('text/event-stream') })
        vi.advanceTimersByTime(250)
        recordStatus()

        const secondSent = sendOnInterval()
        await second.started
        recordStatus()
        second.progress({ type: 'head', head: head('text/plain') })
        recordStatus()

        first.finish(responseOf('response-1', []))
        await firstSent
        recordStatus()
        vi.advanceTimersByTime(300)
        recordStatus()

        second.finish(responseOf('response-2', []))
        await secondSent
        recordStatus()

        expect(statuses).toEqual(['receiving', 'loading', 'receiving', 'loaded'])
        expect(store.state.requestResponses[tab._id]._id).toBe('response-2')
    })

    test('a late head of an earlier send neither shows nor replaces the newer send\'s entry', async() => {
        // the history of an open tab is already loaded
        store.state.responses[tab._id] = []
        const first = controlledSend()
        const second = controlledSend()

        const firstSent = sendOnInterval()
        await first.started
        const secondSent = sendOnInterval()
        await second.started

        first.progress({ type: 'head', head: head('text/event-stream') })
        first.progress({ type: 'data', bytes: encoder.encode('data: 1\n\n') })
        expect(store.state.requestResponseStatus[tab._id]).toBe('loading')
        expect(tab._id in store.state.requestResponseStreams).toBe(false)

        second.progress({ type: 'head', head: head('text/event-stream') })
        const secondStream = store.state.requestResponseStreams[tab._id]
        vi.advanceTimersByTime(250)
        expect(store.state.requestResponseStatus[tab._id]).toBe('receiving')

        // a head, and its 250 ms timer, from the oldest send while the second is shown
        first.progress({ type: 'head', head: head('application/json') })
        vi.advanceTimersByTime(300)
        expect(store.state.requestResponseStreams[tab._id]).toBe(secondStream)
        expect(store.state.requestResponseStatus[tab._id]).toBe('receiving')

        first.finish(responseOf('response-1', []))
        second.finish(responseOf('response-2', []))
        await Promise.all([firstSent, secondSent])
        expect(store.state.requestResponses[tab._id]._id).toBe('response-2')
    })
})

describe('Collection Runner with a body cut short', () => {
    const request = (id: string) => ({ _id: id, _type: 'request', name: id, parentId: 'folder', workspaceId: 'workspace-id', method: 'GET', url: 'http://127.0.0.1/' }) as CollectionItem

    test('a timed out body counts as a failed request with its reason, a complete one as passed', async() => {
        vi.clearAllMocks()
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        const cutShort = request('cut-short')
        const complete = request('complete')
        const folder = { _id: 'folder', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: 'workspace-id', children: [cutShort, complete] } as CollectionItem
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'file', name: 'Workspace', dotEnv: {} } as Workspace
        store.state.collection = [folder, cutShort, complete]
        store.state.collectionTree = [folder]
        store.state.plugins.global = []
        store.state.plugins.workspace = []
        store.commit('resetCollectionRunner')

        const buffer = new TextEncoder().encode('data: 1\n\n').buffer
        vi.mocked(handleRequest)
            .mockResolvedValueOnce({ _id: 'r1', collectionId: 'cut-short', status: 200, statusText: 'OK', headers: [], buffer, testResults: [{ description: 'ok', passed: true }], bodyIncomplete: 'timedOut' } as any)
            .mockResolvedValueOnce({ _id: 'r2', collectionId: 'complete', status: 200, statusText: 'OK', headers: [], buffer, testResults: [{ description: 'ok', passed: true }] } as any)

        await store.dispatch('startCollectionRunner', { source: folder, selectedRequests: [cutShort, complete], iterations: 1, delayMs: 0, continueOnError: true })
        await vi.waitFor(() => expect(store.state.collectionRunner.isRunning).toBe(false))

        expect(store.state.collectionRunner.results[0]).toMatchObject({ requestId: 'cut-short', status: 'error', error: 'Response timed out before it ended' })
        expect(store.state.collectionRunner.results[1]).toMatchObject({ requestId: 'complete', status: 'success' })
        expect(store.state.collectionRunner.results[1].error).toBeUndefined()
    })

    test('a run whose send a user Send replaces counts as cancelled, not as the response of the user Send or a pass', async() => {
        vi.clearAllMocks()
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        const running = request('running')
        const folder = { _id: 'folder', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: 'workspace-id', children: [running] } as CollectionItem
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'file', name: 'Workspace', dotEnv: {} } as Workspace
        store.state.collection = [folder, running]
        store.state.collectionTree = [folder]
        store.state.plugins.global = []
        store.state.plugins.workspace = []
        store.state.responses[running._id] = []
        store.state.requestResponses[running._id] = null
        store.commit('resetCollectionRunner')

        const buffer = new TextEncoder().encode('data: 1\n\n').buffer
        let runnerSendStarted: (() => void) | undefined
        const runnerSendStartedPromise = new Promise<void>(resolve => {
            runnerSendStarted = resolve
        })
        let finishUserSend: ((response: any) => void) | undefined
        vi.mocked(handleRequest)
            // the runner's send, cut short by the user's Send after its head
            .mockImplementationOnce((...args: any[]) => {
                const signal: AbortSignal = args[7]
                runnerSendStarted?.()
                return new Promise(resolve => {
                    signal.addEventListener('abort', () => resolve({ _id: 'runner-response', collectionId: 'running', status: 200, statusText: 'OK', headers: [], buffer, testResults: [], bodyIncomplete: 'cancelled' } as any))
                })
            })
            // the user's send, still running when the runner reads its result
            .mockImplementationOnce(() => new Promise(resolve => {
                finishUserSend = resolve
            }))

        await store.dispatch('startCollectionRunner', { source: folder, selectedRequests: [running], iterations: 1, delayMs: 0, continueOnError: true })
        await runnerSendStartedPromise
        const userSent = store.dispatch('sendRequest', { collectionItem: running, cancelEarlierSends: true })
        await vi.waitFor(() => expect(store.state.collectionRunner.isRunning).toBe(false))

        expect(store.state.collectionRunner.results[0]).toMatchObject({ requestId: 'running', status: 'error', error: 'Response cancelled before it ended' })

        finishUserSend?.({ _id: 'user-response', collectionId: 'running', status: 200, statusText: 'OK', headers: [], buffer, testResults: [] })
        await userSent
    })
})

describe('setActiveTab', () => {
    beforeEach(() => {
        // the tab is scrolled into view, where the page has one
        vi.stubGlobal('document', { querySelector: () => null })
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'file', name: 'Workspace' } as Workspace
        store.state.activeTab = null
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    test('an item of a type only a newer version knows opens as it is, its url and parameters untouched', async() => {
        const newer = { _id: 'newer-1', _type: 'newer-kind', workspaceId: 'workspace-id', url: 'x://y?a=1', parameters: [] } as unknown as CollectionItem
        await store.dispatch('setActiveTab', newer)
        expect(newer.url).toBe('x://y?a=1')
        expect(newer.parameters).toEqual([])
    })

    test('an HTTP request with a query its parameters lack gets them, as it always has', async() => {
        const request = { _id: 'request-1', _type: 'request', workspaceId: 'workspace-id', url: 'http://example.test/?a=1', parameters: [] } as unknown as CollectionItem
        await store.dispatch('setActiveTab', request)
        expect(request.parameters).toEqual([{ name: 'a', value: '1' }])
    })
})

describe('response history mutations given an item other than the active tab', () => {
    const activeTab = { _id: 'active-tab', _type: 'request', name: 'Active', parentId: null, workspaceId: 'workspace-a' } as CollectionItem
    const grpcItem = { _id: 'grpc-item', _type: 'grpc', name: 'gRPC', parentId: null, workspaceId: 'workspace-b' } as unknown as CollectionItem
    const response = (id: string, collectionId: string) => ({ _id: id, collectionId, name: null, buffer: '', request: { original: {} } }) as any

    beforeEach(() => {
        vi.clearAllMocks()
        store.state.activeTab = activeTab
        store.state.responses[activeTab._id] = [response('active-1', activeTab._id)]
        store.state.requestResponses[activeTab._id] = store.state.responses[activeTab._id][0]
        store.state.requestResponseStatus[activeTab._id] = 'loaded'
        store.state.responses[grpcItem._id] = [response('grpc-1', grpcItem._id), response('grpc-2', grpcItem._id)]
        store.state.requestResponses[grpcItem._id] = store.state.responses[grpcItem._id][0]
        store.state.requestResponseStatus[grpcItem._id] = 'loaded'
    })

    const expectActiveTabUntouched = () => {
        expect(store.state.responses[activeTab._id].map((entry: any) => entry._id)).toEqual(['active-1'])
        expect(store.state.requestResponses[activeTab._id]).toMatchObject({ _id: 'active-1', name: null })
        expect(store.state.requestResponseStatus[activeTab._id]).toBe('loaded')
    }

    test('clearResponseHistory clears the given item\'s history only', async() => {
        store.commit('clearResponseHistory', grpcItem)
        await vi.waitFor(() => expect(store.state.responses[grpcItem._id]).toEqual([]))

        expect(deleteResponsesByCollectionId).toHaveBeenCalledOnce()
        expect(deleteResponsesByCollectionId).toHaveBeenCalledWith('workspace-b', 'grpc-item')
        expect(store.state.requestResponses[grpcItem._id]).toBeNull()
        expect(store.state.requestResponseStatus[grpcItem._id]).toBe('pending')
        expectActiveTabUntouched()
    })

    test('deleteCurrentlyActiveResponse deletes the given item\'s shown entry only', async() => {
        store.commit('deleteCurrentlyActiveResponse', grpcItem)
        await vi.waitFor(() => expect(store.state.responses[grpcItem._id].map((entry: any) => entry._id)).toEqual(['grpc-2']))

        expect(deleteResponse).toHaveBeenCalledOnce()
        expect(deleteResponse).toHaveBeenCalledWith('workspace-b', 'grpc-item', 'grpc-1')
        expect(store.state.requestResponses[grpcItem._id]._id).toBe('grpc-2')
        expect(store.state.requestResponseStatus[grpcItem._id]).toBe('loaded')
        expectActiveTabUntouched()
    })

    test('renameCurrentlyActiveResponse renames the given item\'s shown entry only', async() => {
        store.commit('renameCurrentlyActiveResponse', { name: 'Renamed', collectionItem: grpcItem })
        await vi.waitFor(() => expect(updateResponse).toHaveBeenCalledOnce())

        expect(updateResponse).toHaveBeenCalledWith('workspace-b', 'grpc-item', 'grpc-1', { name: 'Renamed' })
        expect(store.state.requestResponses[grpcItem._id].name).toBe('Renamed')
        expect(store.state.responses[grpcItem._id][1].name).toBeNull()
        expectActiveTabUntouched()
    })

    test('renameCurrentlyActiveResponse renames the history entry too when the shown one is a copy, as after a send', async() => {
        // saveResponse keeps a copy of the entry it shows
        store.state.requestResponses[grpcItem._id] = { ...store.state.responses[grpcItem._id][0] }
        store.commit('renameCurrentlyActiveResponse', { name: 'Renamed', collectionItem: grpcItem })
        await vi.waitFor(() => expect(updateResponse).toHaveBeenCalledOnce())

        expect(store.state.responses[grpcItem._id].map((entry: any) => entry.name)).toEqual(['Renamed', null])
    })
})

describe('refreshWorkspaceCollection with running gRPC calls', () => {
    const item = (id: string) => ({ _id: id, _type: 'grpc', name: id, parentId: null, workspaceId: 'workspace-id' }) as unknown as CollectionItem
    const runningCall = (id: string) => ({ id, phase: 'open' }) as unknown as GrpcLiveCall
    const itemKey = (id: string) => getGrpcItemKey({ workspaceId: 'workspace-id', _id: id })

    beforeEach(() => {
        vi.clearAllMocks()
        resetGrpcCalls()
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'file', name: 'Workspace' } as Workspace
        store.commit('setCollection', [item('Renamed.json'), item('Gone.json')])
    })

    afterEach(() => {
        resetGrpcCalls()
    })

    test('a call moves to its item\'s new id, and one whose new id the reloaded collection lacks is not moved there', async() => {
        grpcCalls[itemKey('Renamed.json')] = runningCall('call-renamed')
        grpcCalls[itemKey('Gone.json')] = runningCall('call-gone')
        vi.mocked(getCollectionForWorkspace).mockResolvedValue({
            collection: [item('Renamed Again.json')],
            workspace: null,
            // the map also holds an item whose file went away outside Restfox
            idMap: new Map([['Renamed.json', 'Renamed Again.json'], ['Gone.json', 'Not In Collection.json']]),
        } as any)

        await store.dispatch('refreshWorkspaceCollection')

        expect(grpcCalls[itemKey('Renamed Again.json')]?.id).toBe('call-renamed')
        expect(grpcCalls[itemKey('Renamed.json')]).toBeUndefined()
        expect(grpcCalls[itemKey('Not In Collection.json')]).toBeUndefined()
        expect(grpcCalls[itemKey('Gone.json')]).toBeUndefined()
    })
})

describe('a gRPC call of an item whose history was never loaded', () => {
    const item = { _id: 'grpc-unloaded', _type: 'grpc', name: 'Demo/SayHello', parentId: null, workspaceId: 'workspace-id', url: 'localhost:50051', grpc: { service: 'demo.v1.Demo', method: 'SayHello' }, body: { mimeType: 'application/json', text: '{}' } } as unknown as CollectionItem

    beforeEach(() => {
        vi.clearAllMocks()
        resetGrpcCalls()
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
        store.state.activeWorkspace = { _id: 'workspace-id', _type: null, name: 'Workspace' } as unknown as Workspace
        store.commit('setCollection', [item])
        delete store.state.responses[item._id]
        delete store.state.requestResponses[item._id]
        delete store.state.requestResponseStatus[item._id]
        grpcTransport.loadGrpcSchema.mockResolvedValue({ source: 'reflection', services: [{ name: 'demo.v1.Demo', methods: [{ name: 'SayHello', path: '/demo.v1.Demo/SayHello', requestStream: false, responseStream: false, inputType: 'A', outputType: 'B', example: '{}' }] }] })
        grpcTransport.startGrpcCall.mockImplementation((_spec: unknown, onEvent: (event: any) => void) => {
            setTimeout(() => {
                onEvent({ type: 'connected', time: 1 })
                onEvent({ type: 'received', json: '{"a":1}', time: 3 })
                onEvent({ type: 'status', code: 0, name: 'OK', details: '', trailers: [], time: 4 })
            })
            return { send: vi.fn(), end: vi.fn(), cancel: vi.fn() }
        })
    })

    afterEach(() => {
        resetGrpcCalls()
        vi.unstubAllGlobals()
    })

    // such as a tab never opened in the main window, detached into a window of its own: its history first loads with
    // the save, which reads it from the database while the call is already shown
    test('stays shown once it ends, and is the first entry of its history', async() => {
        vi.mocked(getResponsesByCollectionId).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([]), 5)))

        await startGrpcCallForItem(store, item)
        await vi.waitFor(() => expect(createResponse).toHaveBeenCalledOnce())

        const callId = grpcCalls[getGrpcItemKey(item)].id
        expect(store.state.responses[item._id].map((entry: any) => entry._id)).toEqual([callId])
        expect(store.state.requestResponses[item._id]?._id).toBe(callId)
        expect(store.state.requestResponseStatus[item._id]).toBe('loaded')
    })
})

describe('gRPC calls of two file workspaces with an item at the same path', () => {
    const item = (workspaceId: string, id = 'Chat.json') => ({ _id: id, _type: 'grpc', name: 'Chat', parentId: null, workspaceId, url: 'localhost:50051', grpc: { service: 'demo.v1.Demo', method: 'Chat' }, body: { mimeType: 'application/json', text: '{}' } }) as unknown as CollectionItem
    const historyEntryB = { _id: 'b-1', collectionId: 'Chat.json', createdAt: 1, grpc: { events: [] } }
    let onEventA: (event: any) => void
    let callA: { send: ReturnType<typeof vi.fn>, end: ReturnType<typeof vi.fn>, cancel: ReturnType<typeof vi.fn> }

    const showHistoryB = () => {
        store.state.responses['Chat.json'] = [historyEntryB]
        store.state.requestResponses['Chat.json'] = historyEntryB
        store.state.requestResponseStatus['Chat.json'] = 'loaded'
    }

    beforeEach(async() => {
        vi.clearAllMocks()
        resetGrpcCalls()
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
        grpcTransport.loadGrpcSchema.mockResolvedValue({ source: 'reflection', services: [{ name: 'demo.v1.Demo', methods: [{ name: 'Chat', path: '/demo.v1.Demo/Chat', requestStream: true, responseStream: true, inputType: 'A', outputType: 'B', example: '{}' }] }] })
        grpcTransport.startGrpcCall.mockImplementation((_spec: unknown, onEvent: (event: any) => void) => {
            onEventA = onEvent
            callA = { send: vi.fn(), end: vi.fn(), cancel: vi.fn() }
            return callA
        })
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        vi.mocked(deleteCollectionsByIds).mockResolvedValue({ error: null } as any)

        store.state.activeWorkspace = { _id: 'wA', _type: 'file', name: 'A', environment: {}, dotEnv: {} } as unknown as Workspace
        store.commit('setCollection', [item('wA')])
        await startGrpcCallForItem(store, item('wA'))
        onEventA({ type: 'connected', time: 1 })

        // the other workspace opened, its item's history loaded
        store.state.activeWorkspace = { _id: 'wB', _type: 'file', name: 'B', environment: {}, dotEnv: {} } as unknown as Workspace
        store.commit('setCollection', [item('wB')])
        showHistoryB()
    })

    afterEach(() => {
        resetGrpcCalls()
        vi.unstubAllGlobals()
        delete store.state.responses['Chat.json']
        delete store.state.requestResponses['Chat.json']
        delete store.state.requestResponseStatus['Chat.json']
    })

    // the first workspace's call ends and is saved there, under its own item, and the open workspace's item still
    // shows its own history
    const expectCallASavedInItsWorkspace = async() => {
        expect(callA.cancel).not.toHaveBeenCalled()
        onEventA({ type: 'status', code: 0, name: 'OK', details: '', trailers: [], time: 2 })
        await vi.waitFor(() => expect(createResponse).toHaveBeenCalledOnce())
        expect(createResponse).toHaveBeenCalledWith('wA', expect.objectContaining({ collectionId: 'Chat.json' }))
        expect(store.state.responses['Chat.json']).toEqual([historyEntryB])
        expect(store.state.requestResponses['Chat.json']).toEqual(historyEntryB)
    }

    test('deleting the item in the other workspace leaves the call running', async() => {
        await store.dispatch('deleteCollectionItem', item('wB'))
        showHistoryB()
        await expectCallASavedInItsWorkspace()
    })

    test('renaming the item in the other workspace leaves the call with its own item', async() => {
        vi.mocked(getCollectionForWorkspace).mockResolvedValue({ collection: [item('wB', 'Talk.json')], workspace: null, idMap: new Map([['Chat.json', 'Talk.json']]) } as any)
        await store.dispatch('refreshWorkspaceCollection')
        await expectCallASavedInItsWorkspace()
    })

    test('the call ending while the other workspace is open is saved in its own workspace only', async() => {
        await expectCallASavedInItsWorkspace()
    })
})


test('a history load finishing after a workspace switch saves only to the call workspace', async() => {
    vi.clearAllMocks()
    const collectionId = 'Chat.json'
    const savedA = { _id: 'a-old', collectionId, createdAt: 1, grpc: { events: [] } }
    const savedB = { _id: 'b-old', collectionId, createdAt: 2, grpc: { events: [] } }
    const response = { _id: 'a-new', collectionId, createdAt: 3, grpc: { events: [] } }
    const originalWorkspace = store.state.activeWorkspace
    let finishLoad!: (responses: any[]) => void
    vi.mocked(getResponsesByCollectionId).mockReturnValueOnce(new Promise(resolve => finishLoad = resolve)).mockResolvedValue([response, savedA] as any)
    store.state.activeWorkspace = { _id: 'wA' } as Workspace
    delete store.state.responses[collectionId]
    delete store.state.requestResponses[collectionId]
    try {
        const saving = store.dispatch('saveResponse', { workspaceId: 'wA', collectionId, response })
        await vi.waitFor(() => expect(getResponsesByCollectionId).toHaveBeenCalledWith('wA', collectionId))
        store.state.activeWorkspace = { _id: 'wB' } as Workspace
        store.state.responses[collectionId] = [savedB]
        store.state.requestResponses[collectionId] = savedB
        finishLoad([savedA])
        await saving
        expect(createResponse).toHaveBeenCalledWith('wA', response)
        expect(store.state.responses[collectionId]).toEqual([savedB])
        expect(store.state.requestResponses[collectionId]).toEqual(savedB)
    } finally {
        store.state.activeWorkspace = originalWorkspace
        delete store.state.responses[collectionId]
        delete store.state.requestResponses[collectionId]
    }
})

describe('writes the storage refuses, such as to a file holding merge conflict markers', () => {
    const folder = (id: string, sortOrder: number) => ({ _id: id, _type: 'request_group', name: id, parentId: null, workspaceId: 'workspace-id', sortOrder, headers: [], authentication: { type: 'No Auth' } }) as CollectionItem
    const refused = { error: 'Error updating sortOrder for Conflicted/_.json: Unexpected token' }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(emitter, 'emit')
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'file', name: 'Workspace' } as Workspace
        store.state.plugins.workspace = []
    })

    afterEach(() => vi.restoreAllMocks())

    test('a sibling\'s sort order on creating an item is reported', async() => {
        store.state.collection = [folder('Conflicted', 0)]
        store.state.collectionTree = [folder('Conflicted', 0)]
        vi.mocked(createCollection).mockResolvedValueOnce({ error: null } as never)
        vi.mocked(updateCollection).mockImplementation(async(_workspaceId, collectionId) => collectionId === 'Conflicted' ? refused : { error: null })

        await store.dispatch('createCollectionItem', { type: 'request_group', name: 'New', parentId: null })

        await vi.waitFor(() => expect(emitter.emit).toHaveBeenCalledWith('error', refused.error))
    })

    test('a sibling\'s sort order on duplicating an item is reported, and the duplicate still gets its scripts', async() => {
        store.state.collection = [folder('Conflicted', 0), folder('Source', 1)]
        store.state.collectionTree = [folder('Conflicted', 0), folder('Source', 1)]
        store.state.plugins.workspace = [{ _id: 'script', type: 'script', name: null, code: { pre_request: '', post_request: '' }, workspaceId: null, collectionId: 'Source', enabled: true, createdAt: 1, updatedAt: 1 }]
        vi.mocked(createCollections).mockResolvedValueOnce({ error: null, results: [] } as never)
        vi.mocked(updateCollection).mockImplementation(async(_workspaceId, collectionId) => collectionId === 'Conflicted' ? refused : { error: null })

        await store.dispatch('duplicateCollectionItem', folder('Source', 1))

        await vi.waitFor(() => expect(emitter.emit).toHaveBeenCalledWith('error', refused.error))
        expect(createPlugins).toHaveBeenCalledOnce()
    })

    test('a failed copy of the duplicate\'s scripts is reported and the duplicate is still added', async() => {
        store.state.collection = [folder('Source', 0)]
        store.state.collectionTree = [folder('Source', 0)]
        store.state.plugins.workspace = [{ _id: 'script', type: 'script', name: null, code: { pre_request: '', post_request: '' }, workspaceId: null, collectionId: 'Source', enabled: true, createdAt: 1, updatedAt: 1 }]
        vi.mocked(createCollections).mockResolvedValueOnce({ error: null, results: [] } as never)
        vi.mocked(updateCollection).mockResolvedValue({ error: null })
        vi.mocked(createPlugins).mockRejectedValueOnce(new Error('Cannot write plugins'))

        await expect(store.dispatch('duplicateCollectionItem', folder('Source', 0))).resolves.toEqual({ error: null, results: [] })

        expect(emitter.emit).toHaveBeenCalledWith('error', 'Cannot write plugins')
        expect(emitter.emit).toHaveBeenCalledWith('request_group', 'added')
        expect(store.state.plugins.workspace.map(plugin => plugin._id)).toEqual(['script'])
    })

    test('a sibling\'s sort order on moving an item is reported', async() => {
        store.state.collection = [folder('Conflicted', 0), folder('Moved', 1)]
        store.state.collectionTree = [folder('Conflicted', 0), folder('Moved', 1)]
        vi.mocked(updateCollection).mockImplementation(async(_workspaceId, collectionId, fields) => collectionId === 'Conflicted' && 'sortOrder' in fields ? refused : { error: null })
        vi.mocked(getCollectionForWorkspace).mockResolvedValue({ collection: store.state.collection } as never)

        await store.dispatch('reorderCollectionItem', {
            from: { id: 'Moved', parentId: null },
            to: { id: 'Conflicted', parentId: null, type: 'request_group', cursorPosition: 'top' },
        })

        expect(emitter.emit).toHaveBeenCalledWith('error', refused.error)
    })

    test('a failed copy of imported scripts is reported and the import still shows its items', async() => {
        store.state.collection = []
        store.state.collectionTree = []
        vi.mocked(createCollections).mockResolvedValueOnce({ error: null, results: [] } as never)
        vi.mocked(createPlugins).mockRejectedValueOnce(new Error('Cannot write plugins'))
        vi.mocked(getCollectionForWorkspace).mockResolvedValueOnce({ collection: [folder('Imported', 0)] } as never)

        await store.dispatch('setCollectionTree', {
            collectionTree: [folder('Imported', 0)],
            plugins: [{ _id: 'script', type: 'script', name: null, code: { pre_request: '', post_request: '' }, workspaceId: null, collectionId: 'Imported', enabled: true, createdAt: 1, updatedAt: 1 }],
        })

        expect(emitter.emit).toHaveBeenCalledWith('error', 'Cannot write plugins')
        expect(store.state.collection.map(item => item._id)).toEqual(['Imported'])
        expect(store.state.plugins.workspace).toEqual([])
    })

    test('a folder\'s selected environment is reported', async() => {
        vi.mocked(updateCollection).mockResolvedValueOnce(refused)

        store.commit('updateCollectionItemCurrentEnvironment', { collectionId: 'Conflicted', currentEnvironment: 'Production' })

        await vi.waitFor(() => expect(emitter.emit).toHaveBeenCalledWith('error', refused.error))
    })

    test('a folder\'s headers are reported and its auth is not written after them', async() => {
        store.state.collection = [folder('Conflicted', 0)]
        vi.mocked(updateCollection).mockResolvedValueOnce(refused)

        const result = await store.dispatch('updateCollectionItem', {
            collectionId: 'Conflicted', name: 'Conflicted', parentId: null,
            headers: [{ name: 'X-Key', value: '1' }], authentication: { type: 'bearer', token: 't' },
        })

        expect(result).toEqual(refused)
        expect(emitter.emit).toHaveBeenCalledWith('error', refused.error)
        expect(updateCollection).toHaveBeenCalledOnce()
    })
})
