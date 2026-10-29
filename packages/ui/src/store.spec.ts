// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./db', () => ({
    fileIPC: vi.fn(),
    getResponsesByCollectionId: vi.fn(),
    getCollectionForWorkspace: vi.fn(),
    getAllWorkspaces: vi.fn(),
    getFileWorkspace: vi.fn(),
    getCollectionById: vi.fn(),
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

import { createCollection, createCollections, createPlugin, createPlugins, createResponse, deleteCollectionsByIds, deletePlugin, deleteResponse, deleteResponsesByCollectionId, getAllWorkspaces, getCollectionById, getCollectionForWorkspace, getFileWorkspace, getResponsesByCollectionId, getWorkspacePlugins, updateCollection, updatePlugin, updateResponse, updateWorkspace } from './db'
import type { CollectionItem, Plugin, ResponseHead, ResponseProgress, ResponseProgressHandler, SetEnvironmentVariableFunction, Workspace } from './global'
import { store } from './store'
import { emitter } from './event-bus'
import { INHERITED_AUTHENTICATION_TYPE, SendResolver, handleRequest } from './helpers'
import * as grpcState from './utils/grpc-calls'
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

describe('script environment writes belong to the request workspace', () => {
    function held<T>() {
        let release!: (value: T) => void
        const promise = new Promise<T>(resolve => release = resolve)
        return { promise, release }
    }

    const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
    const workspace = (_id: string, _type?: string): Workspace => ({
        _id, _type, name: _id, location: `/workspaces/${_id}`, dotEnv: {}, createdAt: 1, updatedAt: 1,
        environment: { kept: _id },
        environments: [{ name: 'Default', environment: { kept: _id } }],
    })
    const item = (_id: string, parentId: string | null = 'Auth'): CollectionItem => ({
        _id, parentId, _type: 'request', name: _id, workspaceId: 'A', method: 'GET', url: 'http://127.0.0.1/slow',
    })
    const folder = (): CollectionItem => ({
        ...item('Auth', null), _type: 'request_group', environment: { folderKept: 'A' },
        environments: [{ name: 'Default', environment: { folderKept: 'A' } }],
    })
    let storedWorkspaces: Workspace[]
    let storedItems: Record<string, CollectionItem>
    let request: CollectionItem

    function activate(id: string) {
        store.state.activeWorkspace = store.state.workspaces.find(workspace => workspace._id === id)!
        const requestForWorkspace = { ...copy(request), workspaceId: id }
        store.commit('setCollection', [{ ...folder(), workspaceId: id }, requestForWorkspace])
        store.state.tabs = []
        store.state.detachedTabs = []
    }

    function controlledScript(script: (set: SetEnvironmentVariableFunction, environment: any) => void | Promise<void>) {
        const response = held<void>()
        const started = held<void>()
        vi.mocked(handleRequest).mockImplementationOnce(async(_request, environment, _headers, _auth, set) => {
            started.release()
            await response.promise
            await script(set, environment)
            return { status: null, statusText: '', error: 'No response history needed' }
        })
        return { started: started.promise, finish: () => response.release() }
    }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        vi.spyOn(console, 'log').mockImplementation(() => undefined)
        vi.mocked(handleRequest).mockReset()
        request = item('Auth/Login.json')
        storedWorkspaces = [workspace('A'), workspace('B')]
        storedItems = { [request._id]: copy(request), Auth: folder() }
        store.state.workspaces = copy(storedWorkspaces)
        store.state.plugins.global = []
        store.state.plugins.workspace = []
        vi.mocked(getAllWorkspaces).mockImplementation(async() => copy(storedWorkspaces))
        vi.mocked(getFileWorkspace).mockImplementation(async location => ({ version: 1, ...copy(storedWorkspaces.find(workspace => workspace.location === location)!) }))
        vi.mocked(getCollectionById).mockImplementation(async(_workspaceId, id) => storedItems[id] && copy(storedItems[id]))
        vi.mocked(updateWorkspace).mockImplementation(async(id, fields) => {
            Object.assign(storedWorkspaces.find(workspace => workspace._id === id)!, copy(fields))
            return { error: null }
        })
        vi.mocked(updateCollection).mockImplementation(async(id, collectionId, fields) => {
            if(id === 'A') {
                Object.assign(storedItems[collectionId], copy(fields))
            }
            return { error: null, idMap: null }
        })
        activate('A')
    })

    afterEach(() => {
        vi.mocked(getAllWorkspaces).mockReset()
        vi.mocked(getFileWorkspace).mockReset()
        vi.mocked(getCollectionById).mockReset()
        vi.mocked(updateWorkspace).mockReset()
        vi.mocked(updateCollection).mockReset()
        vi.restoreAllMocks()
    })

    for(const type of ['in-app', 'file']) {
        test(`a held response writes only to its ${type} owner after switching workspaces`, async() => {
            storedWorkspaces[0]._type = type === 'file' ? 'file' : undefined
            store.state.workspaces[0]._type = storedWorkspaces[0]._type
            // Storage has changed since this workspace was last opened.
            storedWorkspaces[0].environment.diskEdit = 'keep'
            const send = controlledScript(async(set, environment) => {
                const saved = set('token', 'from-A')
                expect(environment.token).toBe('from-A')
                await saved
                await set('ftoken', 'from-A', 'folder', request._id)
                expect(environment.ftoken).toBe('from-A')
            })
            const sent = store.dispatch('sendRequest', request)
            await send.started
            activate('B')
            const b = copy(store.state.activeWorkspace)
            send.finish()
            await sent

            expect(updateWorkspace).toHaveBeenCalledWith('A', { environment: { kept: 'A', diskEdit: 'keep', token: 'from-A' } })
            expect(updateCollection).toHaveBeenCalledWith('A', 'Auth', { environment: { folderKept: 'A', ftoken: 'from-A' } })
            expect(updateCollection).toHaveBeenCalledWith('A', 'Auth', { environments: [{ name: 'Default', environment: { folderKept: 'A', ftoken: 'from-A' } }] })
            expect(storedWorkspaces[0].environment).toEqual({ kept: 'A', diskEdit: 'keep', token: 'from-A' })
            expect(store.state.workspaces[0].environment).toEqual(storedWorkspaces[0].environment)
            expect(store.state.workspaces[0].environments).toEqual(storedWorkspaces[0].environments)
            expect(store.state.activeWorkspace).toEqual(b)
            expect(storedWorkspaces[1]).toEqual(b)
            expect(store.state.collection[0].environment).toEqual({ folderKept: 'A' })
            expect(getCollectionById).toHaveBeenCalledWith('A', request._id)
            if(type === 'file') {
                expect(getFileWorkspace).toHaveBeenCalledWith('/workspaces/A')
                expect(getAllWorkspaces).not.toHaveBeenCalled()
            } else {
                expect(getAllWorkspaces).toHaveBeenCalledOnce()
                expect(getFileWorkspace).not.toHaveBeenCalled()
            }
            activate('A')
            expect(store.state.activeWorkspace!.environment.token).toBe('from-A')
        })
    }

    test('an active owner keeps the same mutations, values and refresh using the live script parent', async() => {
        const mutations: unknown[] = []
        const actions: string[] = []
        const stopMutations = store.subscribe(({ type, payload }) => {
            if(type.startsWith('update')) {
                mutations.push([type, copy(payload)])
            }
        })
        const stopActions = store.subscribeAction(({ type }) => actions.push(type))
        const pluginItem = item('plugin-item', 'ScriptParent')
        storedItems.ScriptParent = { ...folder(), _id: 'ScriptParent' }
        store.commit('setCollection', [folder(), storedItems.ScriptParent, request, pluginItem])
        const send = controlledScript(async set => {
            await set('token', 'from-A')
            await set('ftoken', 'from-A', 'folder', pluginItem._id)
        })
        const sent = store.dispatch('sendRequest', request)
        await send.started
        send.finish()
        await sent
        stopMutations()
        stopActions()
        expect(mutations).toEqual([
            ['updateWorkspaceEnvironment', { workspaceId: 'A', environment: { kept: 'A', token: 'from-A' } }],
            ['updateWorkspaceEnvironments', { workspaceId: 'A', environments: [{ name: 'Default', environment: { kept: 'A', token: 'from-A' } }] }],
            ['updateCollectionItemEnvironment', { collectionId: 'ScriptParent', environment: { folderKept: 'A', ftoken: 'from-A' } }],
            ['updateCollectionItemEnvironments', { collectionId: 'ScriptParent', environments: [{ name: 'Default', environment: { folderKept: 'A', ftoken: 'from-A' } }] }],
        ])
        expect(actions).toContain('reloadTabEnvironmentResolved')
        expect(getAllWorkspaces).not.toHaveBeenCalled()
        expect(getCollectionById).not.toHaveBeenCalled()
    })

    test('a timer dispatches an A request while B is already active', async() => {
        activate('B')
        const send = controlledScript(async set => {
            await set('token', 'from-A')
            await set('ftoken', 'from-A', 'folder')
        })
        const sent = store.dispatch('sendRequest', request)
        await send.started
        send.finish()
        await sent
        expect(storedWorkspaces[0].environment.token).toBe('from-A')
        expect(storedItems.Auth.environment).toMatchObject({ ftoken: 'from-A' })
        expect(store.state.activeWorkspace!.environment).toEqual({ kept: 'B' })
    })

    for(const scope of ['workspace', 'folder'] as const) {
        for(const order of ['first then second', 'second then first']) {
            test(`two scripts finishing ${order} keep both inactive ${scope} values`, async() => {
                activate('B')
                const read = held<any>()
                const getEnvironment = scope === 'workspace' ? getAllWorkspaces : getCollectionById
                vi.mocked(getEnvironment).mockReturnValueOnce(read.promise)
                const first = controlledScript(async set => {
                    await set('first', 'one', scope)
                })
                const second = controlledScript(async set => {
                    await set('second', 'two', scope)
                })
                const firstSent = store.dispatch('sendRequest', request)
                await first.started
                const secondSent = store.dispatch('sendRequest', request)
                await second.started
                const [earlier, later] = order === 'first then second' ? [first, second] : [second, first]
                earlier.finish()
                await vi.waitFor(() => expect(getEnvironment).toHaveBeenCalledOnce())
                later.finish()
                await Promise.resolve()
                expect(updateWorkspace).not.toHaveBeenCalled()
                expect(updateCollection).not.toHaveBeenCalled()
                read.release(scope === 'workspace' ? copy(storedWorkspaces) : copy(request))
                await Promise.all([firstSent, secondSent])
                const environment = scope === 'workspace' ? storedWorkspaces[0].environment : storedItems.Auth.environment
                expect(environment).toMatchObject({ first: 'one', second: 'two' })
                if(scope === 'workspace') {
                    expect(store.state.workspaces[0].environment).toEqual(storedWorkspaces[0].environment)
                }
            })
        }
    }

    for(const stage of ['workspace read', 'file workspace read', 'item read', 'folder read', 'workspace environment save', 'workspace environments save', 'folder environment save', 'folder environments save']) {
        for(const storageFinishesFirst of [false, true]) {
            test(`returning to the owner during ${stage} preserves a live edit, storage finishes ${storageFinishesFirst ? 'first' : 'last'}`, async() => {
                activate('B')
                const pause = held<any>()
                const folderScope = stage.startsWith('item') || stage.startsWith('folder')
                let reached = false
                if(stage === 'file workspace read') {
                    store.state.workspaces[0]._type = 'file'
                    vi.mocked(getFileWorkspace).mockImplementationOnce(() => {
                        reached = true
                        return pause.promise
                    })
                } else if(stage === 'workspace read') {
                    vi.mocked(getAllWorkspaces).mockImplementationOnce(() => {
                        reached = true
                        return pause.promise
                    })
                } else if(stage.endsWith('read')) {
                    const original = vi.mocked(getCollectionById).getMockImplementation()!
                    vi.mocked(getCollectionById).mockImplementation(async(id, collectionId) => {
                        if(collectionId === (stage === 'item read' ? request._id : 'Auth')) {
                            reached = true
                            return pause.promise
                        }
                        return original(id, collectionId)
                    })
                } else if(folderScope) {
                    const original = vi.mocked(updateCollection).getMockImplementation()!
                    vi.mocked(updateCollection).mockImplementation(async(id, collectionId, fields) => {
                        if((stage === 'folder environment save' ? fields.environment : fields.environments) && !reached) {
                            reached = true
                            await pause.promise
                        }
                        return original(id, collectionId, fields)
                    })
                } else {
                    const original = vi.mocked(updateWorkspace).getMockImplementation()!
                    vi.mocked(updateWorkspace).mockImplementation(async(id, fields) => {
                        if((stage === 'workspace environment save' ? fields.environment : fields.environments) && !reached) {
                            reached = true
                            await pause.promise
                        }
                        return original(id, fields)
                    })
                }
                const send = controlledScript(async set => {
                    await set('token', 'from-A', folderScope ? 'folder' : 'workspace')
                })
                const sent = store.dispatch('sendRequest', request)
                await send.started
                send.finish()
                await vi.waitFor(() => expect(reached).toBe(true))
                const openOwnerAndEdit = () => {
                    activate('A')
                    if(storageFinishesFirst) {
                        store.commit('setCollection', [copy(storedItems.Auth), copy(request)])
                    }
                    const live = folderScope ? store.state.collection[0] : store.state.activeWorkspace!
                    live.environment.edit = 'keep'
                    if(storageFinishesFirst) {
                        live.environments![0].environment.edit = 'keep'
                    }
                    return live
                }
                const liveBeforeSave = storageFinishesFirst ? null : openOwnerAndEdit()
                const result = stage === 'file workspace read' ? { version: 1, ...copy(storedWorkspaces[0]) }
                    : stage === 'workspace read' ? copy(storedWorkspaces)
                        : stage === 'item read' ? copy(request) : stage === 'folder read' ? folder() : undefined
                pause.release(result)
                await sent
                const live = liveBeforeSave ?? openOwnerAndEdit()
                expect(live.environment).toMatchObject({ edit: 'keep', token: 'from-A' })
                expect(live.environments![0].environment).toMatchObject({ edit: 'keep', token: 'from-A' })
                const updates = folderScope ? vi.mocked(updateCollection).mock.calls : vi.mocked(updateWorkspace).mock.calls
                expect(updates).toHaveLength(!storageFinishesFirst && stage.endsWith('environment save') ? 3 : 2)
                if(stage === 'item read' && !storageFinishesFirst) {
                    expect(getCollectionById).toHaveBeenCalledOnce()
                }
            })
        }
    }

    test('a deleted owner is skipped with a visible error', async() => {
        const send = controlledScript(async set => {
            await set('token', 'from-A')
        })
        const sent = store.dispatch('sendRequest', request)
        await send.started
        activate('B')
        store.state.workspaces = store.state.workspaces.filter(workspace => workspace._id !== 'A')
        send.finish()
        await sent
        expect(updateWorkspace).not.toHaveBeenCalled()
        expect(updateCollection).not.toHaveBeenCalled()
        expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/not saved.*workspace no longer exists/i))
    })

    for(const missing of ['item', 'folder', 'parent', 'folder type']) {
        test(`a missing ${missing} falls back to the owner workspace`, async() => {
            activate('B')
            if(missing === 'item') {
                delete storedItems[request._id]
            } else if(missing === 'folder') {
                delete storedItems.Auth
            } else if(missing === 'parent') {
                storedItems[request._id].parentId = null
            } else {
                storedItems.Auth._type = 'request'
            }
            const send = controlledScript(async set => {
                await set('token', 'from-A', 'folder')
            })
            const sent = store.dispatch('sendRequest', request)
            await send.started
            send.finish()
            await sent
            expect(storedWorkspaces[0].environment.token).toBe('from-A')
            expect(updateCollection).not.toHaveBeenCalled()
            expect(store.state.activeWorkspace!.environment).toEqual({ kept: 'B' })
        })
    }

    test('a storage failure is logged and the next queued write still saves', async() => {
        activate('B')
        vi.mocked(getAllWorkspaces).mockRejectedValueOnce(new Error('Cannot read environment'))
        const send = controlledScript(async(set, environment) => {
            const failed = set('failed', 'one')
            const saved = set('saved', 'two')
            expect(environment).toMatchObject({ failed: 'one', saved: 'two' })
            await failed
            await saved
        })
        const sent = store.dispatch('sendRequest', request)
        await send.started
        send.finish()
        await sent
        expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cannot read environment' }))
        expect(storedWorkspaces[0].environment).toEqual({ kept: 'A', saved: 'two' })
    })

    test('a queued write uses live state if the owner is opened before it starts', async() => {
        activate('B')
        const read = held<Workspace[]>()
        vi.mocked(getAllWorkspaces).mockReturnValueOnce(read.promise)
        const send = controlledScript(async set => {
            const first = set('first', 'one')
            const second = set('second', 'two')
            await first
            await second
        })
        const sent = store.dispatch('sendRequest', request)
        await send.started
        send.finish()
        await vi.waitFor(() => expect(getAllWorkspaces).toHaveBeenCalledOnce())
        activate('A')
        store.state.activeWorkspace!.environment.edit = 'keep'
        read.release(copy(storedWorkspaces))
        await sent
        expect(getAllWorkspaces).toHaveBeenCalledOnce()
        expect(store.state.activeWorkspace!.environment).toEqual({ kept: 'A', edit: 'keep', first: 'one', second: 'two' })
    })

    test('an owner missing from storage is skipped with a visible error', async() => {
        activate('B')
        storedWorkspaces = storedWorkspaces.filter(workspace => workspace._id !== 'A')
        const send = controlledScript(async set => {
            await set('token', 'from-A')
        })
        const sent = store.dispatch('sendRequest', request)
        await send.started
        send.finish()
        await sent
        expect(updateWorkspace).not.toHaveBeenCalled()
        expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/not saved.*workspace no longer exists/i))
    })

    test('closing the owner during a save leaves the remaining workspace cache untouched', async() => {
        activate('B')
        const saved = held<void>()
        const update = vi.mocked(updateWorkspace).getMockImplementation()!
        vi.mocked(updateWorkspace).mockImplementation(async(id, fields) => {
            const result = await update(id, fields)
            if(fields.environments) {
                await saved.promise
            }
            return result
        })
        const send = controlledScript(async set => {
            await set('token', 'from-A')
        })
        const sent = store.dispatch('sendRequest', request)
        await send.started
        send.finish()
        await vi.waitFor(() => expect(updateWorkspace).toHaveBeenCalledTimes(2))
        store.state.workspaces = store.state.workspaces.filter(workspace => workspace._id !== 'A')
        saved.release()
        await sent
        expect(store.state.workspaces).toEqual([workspace('B')])
        expect(console.error).not.toHaveBeenCalled()
    })

    test('finishing one write does not remove a newer pending write from the queue', async() => {
        activate('B')
        const firstRead = held<Workspace[]>()
        const secondRead = held<Workspace[]>()
        const thirdQueued = held<void>()
        vi.mocked(getAllWorkspaces).mockReturnValueOnce(firstRead.promise).mockReturnValueOnce(secondRead.promise)
        const send = controlledScript(async set => {
            const first = set('first', 'one')
            const second = set('second', 'two')
            await first
            const third = set('third', 'three')
            thirdQueued.release()
            await second
            await third
        })
        const sent = store.dispatch('sendRequest', request)
        await send.started
        send.finish()
        await vi.waitFor(() => expect(getAllWorkspaces).toHaveBeenCalledOnce())
        firstRead.release(copy(storedWorkspaces))
        await thirdQueued.promise
        await Promise.resolve()
        expect(getAllWorkspaces).toHaveBeenCalledTimes(2)
        secondRead.release(copy(storedWorkspaces))
        await sent
        expect(storedWorkspaces[0].environment).toEqual({ kept: 'A', first: 'one', second: 'two', third: 'three' })
    })

    test('an inactive script uses its stored current parent rather than the request or the other workspace tree', async() => {
        activate('B')
        storedItems['plugin-item'] = item('plugin-item', 'MovedParent')
        storedItems.MovedParent = { ...folder(), _id: 'MovedParent' }
        const send = controlledScript(async set => {
            await set('token', 'from-A', 'folder', 'plugin-item')
        })
        const sent = store.dispatch('sendRequest', request)
        await send.started
        send.finish()
        await sent
        expect(storedItems.MovedParent.environment).toMatchObject({ token: 'from-A' })
        expect(storedItems.Auth.environment).toEqual({ folderKept: 'A' })
        expect(updateWorkspace).not.toHaveBeenCalled()
    })

    for(const scope of ['workspace', 'folder'] as const) {
        for(const shape of ['missing', 'empty', 'legacy', 'named']) {
            test(`${scope} writes preserve the ${shape} saved shape`, async() => {
                activate('B')
                const target = scope === 'workspace' ? storedWorkspaces[0] : storedItems.Auth
                delete target.environments
                if(shape === 'missing') {
                    delete target.environment
                } else if(shape === 'empty') {
                    target.environment = {}
                } else {
                    target.environment = { legacy: 'keep' }
                }
                if(shape === 'named') {
                    target.currentEnvironment = 'Production'
                    target.environments = [{ name: 'Default', environment: { other: 'keep' } }, { name: 'Production', environment: { legacy: 'keep' } }]
                }
                const send = controlledScript(async set => {
                    await set('nested.token', 'from-A', scope)
                })
                const sent = store.dispatch('sendRequest', request)
                await send.started
                send.finish()
                await sent
                expect(target.environment).toEqual({ ...(['missing', 'empty'].includes(shape) ? {} : { legacy: 'keep' }), nested: { token: 'from-A' } })
                if(shape === 'named') {
                    expect(target.environments![0]).toEqual({ name: 'Default', environment: { other: 'keep' } })
                    expect(target.environments![1]).toEqual({ name: 'Production', environment: target.environment })
                } else if(scope === 'folder') {
                    expect(target.environments).toBeUndefined()
                    expect(updateCollection).toHaveBeenCalledOnce()
                } else {
                    expect(target.environments).toEqual([{ name: 'Default', color: 'var(--text-color)', environment: target.environment }])
                }
            })
        }
    }

    test('folder environment mutations accept an explicit owner while another workspace is active', async() => {
        activate('B')
        store.commit('updateCollectionItemEnvironment', { workspaceId: 'A', collectionId: 'Auth', environment: { token: 'A' } })
        store.commit('updateCollectionItemEnvironments', { workspaceId: 'A', collectionId: 'Auth', environments: [{ name: 'Default', environment: { token: 'A' } }] })
        expect(updateCollection).toHaveBeenCalledWith('A', 'Auth', { environment: { token: 'A' } })
        expect(updateCollection).toHaveBeenCalledWith('A', 'Auth', { environments: [{ name: 'Default', environment: { token: 'A' } }] })
    })

    test('an environments save the storage refuses, such as over a file it cannot read, shows its error', async() => {
        activate('A')
        const refusal = 'Not saved, as Prod.json cannot be read: Unexpected token'
        vi.mocked(updateCollection).mockResolvedValueOnce({ error: refusal })
        vi.mocked(updateWorkspace).mockResolvedValueOnce({ error: refusal })
        vi.spyOn(emitter, 'emit')
        store.commit('updateCollectionItemEnvironments', { workspaceId: 'A', collectionId: 'Auth', environments: [{ name: 'Prod', environment: {} }] })
        store.commit('updateWorkspaceEnvironments', { workspaceId: 'A', environments: [{ name: 'Prod', environment: {} }] })
        await vi.waitFor(() => expect(emitter.emit).toHaveBeenCalledTimes(2))
        expect(vi.mocked(emitter.emit).mock.calls).toEqual([['error', refusal], ['error', refusal]])
    })

    test('a workspace rename the storage refuses, such as with restfox.json it cannot read, shows its error', async() => {
        activate('A')
        const refusal = 'Not saved, as restfox.json cannot be read: Unexpected token'
        vi.mocked(updateWorkspace).mockResolvedValueOnce({ error: refusal })
        vi.spyOn(emitter, 'emit')
        await store.dispatch('updateWorkspace', { _id: 'A', updatedFields: { name: 'Renamed' } })
        expect(emitter.emit).toHaveBeenCalledWith('error', refusal)
    })

    test('a folder environment pick that fails to write shows its error and goes to Logs', async() => {
        activate('A')
        const failure = new Error('EACCES: permission denied, open \'_.json\'')
        vi.mocked(updateCollection).mockRejectedValueOnce(failure)
        vi.spyOn(emitter, 'emit')
        store.commit('updateCollectionItemCurrentEnvironment', { collectionId: 'Auth', currentEnvironment: 'Prod' })
        await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('Error saving folder environment pick', failure))
        expect(emitter.emit).toHaveBeenCalledWith('error', failure.message)
    })

    test('a workspace environment pick the storage refuses, such as with restfox.json it cannot read, shows its error', async() => {
        activate('A')
        const refusal = 'Not saved, as restfox.json cannot be read: Unexpected token'
        vi.mocked(updateWorkspace).mockResolvedValueOnce({ error: refusal })
        vi.spyOn(emitter, 'emit')
        store.commit('updateWorkspaceCurrentEnvironment', { workspaceId: 'A', currentEnvironment: 'Prod' })
        await vi.waitFor(() => expect(emitter.emit).toHaveBeenCalledWith('error', refusal))
    })

    test('a folder environments save that fails to write shows its error and goes to Logs', async() => {
        activate('A')
        const failure = new Error('EPERM: operation not permitted')
        vi.mocked(updateCollection).mockRejectedValueOnce(failure)
        vi.spyOn(emitter, 'emit')
        store.commit('updateCollectionItemEnvironments', { workspaceId: 'A', collectionId: 'Auth', environments: [{ name: 'Prod', environment: {} }] })
        await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('Error saving folder environments', failure))
        expect(emitter.emit).toHaveBeenCalledWith('error', 'EPERM: operation not permitted')
    })

    for(const scope of ['workspace', 'folder'] as const) {
        test(`a ${scope} environments save refused after switching workspaces goes to Logs and changes no list`, async() => {
            const refusal = 'Not saved, as Default.json cannot be read: Unexpected token'
            if(scope === 'workspace') {
                vi.mocked(updateWorkspace).mockImplementation(async(_id, fields) => ({ error: fields.environments ? refusal : null }))
            } else {
                vi.mocked(updateCollection).mockImplementation(async(_id, _collectionId, fields) => ({ error: fields.environments ? refusal : null }))
            }
            const send = controlledScript(async set => {
                await set('token', 'from-A', scope)
            })
            const sent = store.dispatch('sendRequest', request)
            await send.started
            activate('B')
            const workspacesBefore = copy(store.state.workspaces)
            send.finish()
            await sent
            await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: refusal })))
            expect(store.state.workspaces).toEqual(workspacesBefore)
        })
    }
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

describe('duplicateWorkspace', () => {
    beforeEach(() => vi.clearAllMocks())

    test('copies each script once, and an imported request script belongs to the new request and the new workspace', async() => {
        const script = (id: string, workspaceId: string | null, collectionId: string | null) => ({
            _id: id, type: 'script', name: null, code: { pre_request: id, post_request: '' }, workspaceId, collectionId, enabled: true, createdAt: 1, updatedAt: 1,
        }) as Plugin
        vi.mocked(getCollectionForWorkspace).mockResolvedValueOnce({
            collection: [{ _id: 'request', _type: 'request', name: 'Login', parentId: null, workspaceId: 'source' }],
        } as never)
        vi.mocked(createCollections).mockResolvedValueOnce({ error: null, results: [] } as never)
        vi.mocked(getWorkspacePlugins).mockResolvedValueOnce([
            script('workspace', 'source', null),
            script('typed in the editor', null, 'request'),
            // an import gives a request's script the workspace's id too
            script('imported', 'source', 'request'),
        ])

        await store.dispatch('duplicateWorkspace', {
            sourceWorkspace: { _id: 'source', _type: 'local', name: 'Source' }, name: 'Copy', type: 'local', location: '', includeResponseHistory: false,
        })

        const [copies, newWorkspaceId] = vi.mocked(createPlugins).mock.calls[0]
        const newRequestId = vi.mocked(createCollections).mock.calls[0][1][0]._id
        expect(newRequestId).not.toBe('request')
        expect(copies.map(plugin => [(plugin.code as { pre_request: string }).pre_request, plugin.workspaceId, plugin.collectionId])).toEqual([
            ['workspace', newWorkspaceId, null],
            ['typed in the editor', null, newRequestId],
            ['imported', newWorkspaceId, newRequestId],
        ])
    })
})

function resolutionGate<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((done, fail) => {
        resolve = done; reject = fail
    })
    return { promise, resolve, reject }
}

describe('response tag resolution boundaries', () => {
    const tag = `{% response(request='login', attribute='body', path='$.token', behavior='always') %}`
    const login = { _id: 'login', _type: 'request', name: 'Login', workspaceId: 'w', parentId: null, url: 'https://example.test/login', method: 'GET' } as CollectionItem
    const folder = { _id: 'folder', _type: 'request_group', name: 'Folder', workspaceId: 'w', parentId: null, environment: { TOKEN: tag } } as CollectionItem
    const request = { ...login, _id: 'request', parentId: 'folder' }
    const reply = (token: string) => ({ _id: token, collectionId: 'login', status: 200, statusText: 'OK', headers: [['content-type', 'application/json']], buffer: new TextEncoder().encode(JSON.stringify({ token })).buffer, createdAt: Date.now() })
    beforeEach(() => {
        vi.clearAllMocks()
        resetGrpcCalls()
        vi.stubGlobal('localStorage', { getItem: () => null })
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        store.state.activeWorkspace = { _id: 'w', name: 'W', _type: 'file', dotEnv: {} } as Workspace
        folder.environment = { TOKEN: tag }
        folder.headers = []
        store.state.collection = [login, folder, request]
        store.state.responses = {}
        store.state.requestResponses = {}
        store.state.requestResponseStatus = {}
        store.state.requestAbortController = {}
        store.state.plugins.global = []
        store.state.plugins.workspace = []
        store.state.tabEnvironmentResolved = {}
        store.state.tabs = [request]
        store.state.detachedTabs = []
        vi.mocked(getResponsesByCollectionId).mockReset().mockResolvedValue([])
        vi.mocked(handleRequest).mockReset().mockImplementation(async item => ({ ...reply('fresh'), collectionId: item._id } as any))
    })
    afterEach(() => {
        resetGrpcCalls(); vi.restoreAllMocks(); vi.unstubAllGlobals()
    })

    test('display environments use saved history, while send environments trigger dependencies', async() => {
        const display = await store.dispatch('getEnvironmentForRequest', { collectionItem: request, mode: 'display', noError: true, responseTagErrors: 'placeholder' })
        expect(display.environment.TOKEN).toBe('<no value found>')
        expect(handleRequest).not.toHaveBeenCalled()
        const sending = await store.dispatch('getEnvironmentForRequest', { collectionItem: request, mode: 'send' })
        expect(sending.environment.TOKEN).toBe('fresh')
        expect(handleRequest).toHaveBeenCalledOnce()
    })

    test('failed preparation returns an ordinary error, clears cancellation membership and allows retry', async() => {
        vi.mocked(getResponsesByCollectionId).mockRejectedValueOnce(new Error('history unavailable'))
        const response = await store.dispatch('sendRequest', request).catch(error => ({ rejected: error }))
        expect(response).toMatchObject({ status: null, statusText: 'Error', error: 'Error: Request failed' })
        expect(store.state.requestResponses.request).toEqual(response)
        expect(store.state.requestResponseStatus.request).toBe('loaded')
        const failedController = store.state.requestAbortController.request
        await store.dispatch('sendRequest', { collectionItem: request, cancelEarlierSends: true })
        expect(failedController.signal.aborted).toBe(false)
        expect(handleRequest).toHaveBeenCalled()
    })

    // The runner starts its step in the background. Wait for that exact action to finish.
    function runnerStep() {
        const finished = resolutionGate<void>()
        let step: any
        const unsubscribe = store.subscribeAction({
            before(action) {
                if(action.type === 'executeCollectionRunnerNext' && !step) {
                    step = action
                }
            },
            after(action) {
                if(action === step) {
                    finished.resolve(undefined)
                }
            },
        })
        return { finished: finished.promise, unsubscribe }
    }

    const run = (item: CollectionItem, continueOnError: boolean, delayMs = 0) => store.dispatch('startCollectionRunner', {
        source: { ...folder, children: [item] }, selectedRequests: [item], iterations: 1, delayMs, continueOnError,
    })

    for(const olderEndsFirst of [true, false]) {
        for(const continueOnError of [true, false]) {
            test(`an old runner's failed Login cannot change a replacement run, older ends first: ${olderEndsFirst}, continue on error: ${continueOnError}`, async() => {
                store.commit('resetCollectionRunner')
                const oldStep = runnerStep()
                const loginStarted = resolutionGate<void>()
                const loginResult = resolutionGate<any>()
                const newerStarted = resolutionGate<void>()
                const newerResult = resolutionGate<any>()
                vi.mocked(handleRequest).mockImplementationOnce(() => {
                    loginStarted.resolve(undefined)
                    return loginResult.promise
                }).mockImplementationOnce(() => {
                    newerStarted.resolve(undefined)
                    return newerResult.promise
                })
                try {
                    await run(request, continueOnError)
                    await loginStarted.promise
                    await store.dispatch('cancelCollectionRunner')
                    store.commit('resetCollectionRunner')
                    const newer = { ...login, _id: 'newer' }
                    store.state.collection.push(newer)
                    await run(newer, false)
                    await newerStarted.promise
                    const newerRunner = store.state.collectionRunner
                    if(olderEndsFirst) {
                        loginResult.resolve({ status: null, error: 'Login failed' })
                        await oldStep.finished
                        expect(store.state.collectionRunner).toBe(newerRunner)
                        expect(newerRunner.isRunning).toBe(true)
                        expect(newerRunner.currentRequestId).toBe('newer')
                        expect(newerRunner.results[0]).toMatchObject({ requestId: 'newer', status: 'running' })
                        expect(newerRunner.results[0].error).toBeUndefined()
                    }
                    newerResult.resolve({ ...reply('new response'), collectionId: 'newer' })
                    await vi.waitFor(() => expect(newerRunner.isRunning).toBe(false))
                    if(!olderEndsFirst) {
                        loginResult.resolve({ status: null, error: 'Login failed' })
                        await oldStep.finished
                    }
                    expect(newerRunner.results[0]).toMatchObject({ requestId: 'newer', status: 'success' })
                    expect(newerRunner.results[0].error).toBeUndefined()
                    expect(handleRequest).toHaveBeenCalledTimes(2)
                } finally {
                    oldStep.unsubscribe()
                    await store.dispatch('cancelCollectionRunner')
                    store.commit('resetCollectionRunner')
                }
            })
        }
    }

    test('a cancelled runner keeps its cancelled row when its pending Login fails', async() => {
        store.commit('resetCollectionRunner')
        const step = runnerStep()
        const started = resolutionGate<void>()
        const loginResult = resolutionGate<any>()
        vi.mocked(handleRequest).mockImplementationOnce(() => {
            started.resolve(undefined)
            return loginResult.promise
        })
        try {
            await run(request, true)
            await started.promise
            await store.dispatch('cancelCollectionRunner')
            loginResult.resolve({ status: null, error: 'Login failed' })
            await step.finished
            expect(store.state.collectionRunner.isRunning).toBe(false)
            expect(store.state.collectionRunner.currentRequestIndex).toBe(0)
            expect(store.state.collectionRunner.results[0]).toMatchObject({ status: 'error', error: 'Cancelled' })
            expect(handleRequest).toHaveBeenCalledOnce()
        } finally {
            step.unsubscribe()
            store.commit('resetCollectionRunner')
        }
    })

    for(const failed of [true, false]) {
        test(`a runner cancelled during its delay cannot advance a replacement run, failed: ${failed}`, async() => {
            store.commit('resetCollectionRunner')
            const step = runnerStep()
            const newerStarted = resolutionGate<void>()
            const newerResult = resolutionGate<any>()
            vi.mocked(handleRequest).mockResolvedValueOnce(failed ? { status: null, error: 'Failed' } as any : reply('old') as any)
                .mockImplementationOnce(() => {
                    newerStarted.resolve(undefined)
                    return newerResult.promise
                })
            try {
                await run(login, true, 60000)
                await vi.waitFor(() => expect(store.state.collectionRunner.results[0].status).toBe(failed ? 'error' : 'success'))
                // Cancel releases the delay, then close and start again before its continuation runs.
                store.dispatch('cancelCollectionRunner')
                store.commit('resetCollectionRunner')
                const newer = { ...login, _id: 'newer' }
                store.state.collection.push(newer)
                const starting = run(newer, false)
                await step.finished
                await starting
                await newerStarted.promise
                expect(store.state.collectionRunner.currentRequestIndex).toBe(0)
                expect(store.state.collectionRunner.currentRequestId).toBe('newer')
                expect(store.state.collectionRunner.isRunning).toBe(true)
                newerResult.resolve({ ...reply('new'), collectionId: 'newer' })
                await vi.waitFor(() => expect(store.state.collectionRunner.isRunning).toBe(false))
                expect(store.state.collectionRunner.results[0].status).toBe('success')
                expect(handleRequest).toHaveBeenCalledTimes(2)
            } finally {
                step.unsubscribe()
                await store.dispatch('cancelCollectionRunner')
                store.commit('resetCollectionRunner')
            }
        })
    }

    test('an older preparation failure cannot replace a newer Send or another workspace display', async() => {
        for(const replacement of ['send', 'workspace']) {
            const history = resolutionGate<any[]>()
            vi.mocked(getResponsesByCollectionId).mockReturnValueOnce(history.promise)
            const sending = store.dispatch('sendRequest', request).catch(error => ({ rejected: error }))
            await vi.waitFor(() => expect(getResponsesByCollectionId).toHaveBeenCalled())
            const marker = { status: null, statusText: 'Other', error: 'other result' }
            if(replacement === 'workspace') {
                store.state.activeWorkspace = { _id: 'other' } as Workspace
            } else {
                store.state.requestAbortController.request = new AbortController()
            }
            store.state.requestResponses.request = marker
            store.state.requestResponseStatus.request = 'pending'
            history.reject(new Error('old failure'))
            expect(await sending).toMatchObject({ error: 'Error: Request failed' })
            expect(store.state.requestResponses.request).toEqual(marker)
            expect(store.state.requestResponseStatus.request).toBe('pending')
            store.state.activeWorkspace = { _id: 'w', name: 'W', _type: 'file', dotEnv: {} } as Workspace
            vi.mocked(getResponsesByCollectionId).mockClear()
        }
    })

    test('a failed Login settles the newest Send after leaving its workspace', async() => {
        for(const failWhileAway of [true, false]) {
            const workspace = store.state.activeWorkspace!
            const collection = [...store.state.collection]
            const loginStarted = resolutionGate<void>()
            const loginResult = resolutionGate<any>()
            vi.mocked(handleRequest).mockImplementationOnce(() => {
                loginStarted.resolve(undefined)
                return loginResult.promise
            })
            const marker = reply('previous')
            store.state.requestResponses.request = marker
            const sending = store.dispatch('sendRequest', request)
            await loginStarted.promise
            expect(store.state.requestResponseStatus.request).toBe('loading')
            store.commit('setActiveWorkspace', { _id: 'other', _type: 'file', name: 'Other', dotEnv: {} })
            store.commit('setCollection', [])
            expect(store.state.requestResponseStatus.request).toBe('loading')
            expect(store.state.requestResponses.request).toEqual(marker)
            if(!failWhileAway) {
                store.commit('setActiveWorkspace', workspace)
                store.commit('setCollection', collection)
            }
            loginResult.resolve({ status: null, statusText: 'Error', error: 'Login failed' })
            const result = await sending
            expect(result.error).toBe('Error: The request this tag sent did not complete with a whole response')
            expect(store.state.requestResponseStatus.request).toBe('loaded')
            expect(store.state.requestResponses.request).toEqual(failWhileAway ? marker : result)
            store.commit('setActiveWorkspace', workspace)
            store.commit('setCollection', collection)
            expect(store.state.requestResponseStatus.request).toBe('loaded')
        }
    })

    for(const olderEndsFirst of [true, false]) {
        test(`a failed Login leaves another file workspace's same-id newer Send alone, older ends first: ${olderEndsFirst}`, async() => {
            const loginStarted = resolutionGate<void>()
            const loginResult = resolutionGate<any>()
            const newerStarted = resolutionGate<void>()
            const newerResult = resolutionGate<any>()
            vi.mocked(handleRequest).mockImplementationOnce(() => {
                loginStarted.resolve(undefined)
                return loginResult.promise
            }).mockImplementationOnce(() => {
                newerStarted.resolve(undefined)
                return newerResult.promise
            })
            const older = store.dispatch('sendRequest', request)
            await loginStarted.promise
            const otherRequest = { ...request, workspaceId: 'other', parentId: null }
            store.commit('setActiveWorkspace', { _id: 'other', _type: 'file', name: 'Other', dotEnv: {} })
            store.commit('setCollection', [otherRequest])
            const marker = reply('other-previous')
            store.state.requestResponses.request = marker
            const newer = store.dispatch('sendRequest', otherRequest)
            await newerStarted.promise
            const newerController = store.state.requestAbortController.request
            if(olderEndsFirst) {
                loginResult.resolve({ status: null, statusText: 'Error', error: 'Login failed' })
                await older
                expect(store.state.requestResponseStatus.request).toBe('loading')
                expect(store.state.requestResponses.request).toEqual(marker)
            }
            const response = { ...reply('other-new'), collectionId: 'request' }
            newerResult.resolve(response)
            await newer
            if(!olderEndsFirst) {
                loginResult.resolve({ status: null, statusText: 'Error', error: 'Login failed' })
                await older
            }
            expect(store.state.requestAbortController.request).toBe(newerController)
            expect(store.state.requestResponseStatus.request).toBe('loaded')
            expect(store.state.requestResponses.request).toEqual(response)
        })
    }

    for(const failed of [true, false]) {
        for(const firstEndsFirst of [true, false]) {
            test(`environment refresh publishes tabs independently and ignores stale success/error, first ends first: ${firstEndsFirst}, failure: ${failed}`, async() => {
                const first = resolutionGate<any[]>()
                const second = resolutionGate<any[]>()
                const fast = { ...login, _id: 'fast' }
                store.state.tabs = [request, fast]
                vi.mocked(getResponsesByCollectionId).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
                const oldRefresh = store.dispatch('reloadTabEnvironmentResolved')
                await vi.waitFor(() => expect(getResponsesByCollectionId).toHaveBeenCalledTimes(1))
                await vi.waitFor(() => expect(store.state.tabEnvironmentResolved.fast).toEqual({}))
                const newRefresh = store.dispatch('reloadTabEnvironmentResolved')
                await vi.waitFor(() => expect(getResponsesByCollectionId).toHaveBeenCalledTimes(2))
                const finishFirst = () => failed ? first.reject(new Error('old failure')) : first.resolve([reply('old')] as any)
                if(firstEndsFirst) {
                    finishFirst()
                    await oldRefresh
                    expect(store.state.tabEnvironmentResolved.request).toBeUndefined()
                }
                second.resolve([reply('new')] as any)
                await newRefresh
                if(!firstEndsFirst) {
                    finishFirst()
                }
                await oldRefresh
                expect(store.state.tabEnvironmentResolved.request.TOKEN).toBe('new')
                expect(console.error).toHaveBeenCalledTimes(failed ? 1 : 0)
                if(failed) {
                    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'old failure' }))
                }
            })
        }

    }

    test('a stale unexpected refresh failure cannot clear current values or report', async() => {
        const previous = resolutionGate<any[]>()
        store.state.activeWorkspace!.environment = { DELAY: `{% response(request='login', attribute='body', path='$.token', behavior='never') %}` }
        store.state.collection[1].environment = { TOKEN: '{% invalid-function() %}' }
        vi.mocked(getResponsesByCollectionId).mockReturnValueOnce(previous.promise)
        const oldRefresh = store.dispatch('reloadTabEnvironmentResolved')
        await vi.waitFor(() => expect(getResponsesByCollectionId).toHaveBeenCalledOnce())
        store.state.tabs = []
        await store.dispatch('reloadTabEnvironmentResolved')
        store.state.tabEnvironmentResolved.request = { CURRENT: true }
        previous.resolve([])
        await oldRefresh
        expect(store.state.tabEnvironmentResolved.request).toEqual({ CURRENT: true })
        expect(console.error).not.toHaveBeenCalled()
    })

    test('a current unexpected refresh error clears stale values, logs and settles', async() => {
        store.state.tabEnvironmentResolved.request = { STALE: true }
        store.state.collection[1].environment = { TOKEN: '{% invalid-function() %}' }
        await store.dispatch('reloadTabEnvironmentResolved')
        expect(store.state.tabEnvironmentResolved.request).toEqual({})
        expect(console.error).toHaveBeenCalled()
        store.state.collection[1].environment = { TOKEN: tag }
    })

    test('automatic schema preparation defers unused tags, and fails visibly for a used value', async() => {
        const grpc = { ...request, _id: 'g', _type: 'grpc', url: 'localhost:50051', grpc: { service: 'Demo', method: 'Call' }, headers: [] } as CollectionItem
        store.state.collection.push(grpc)
        grpcTransport.loadGrpcSchema.mockResolvedValue({ source: 'reflection', services: [] })
        await grpcState.loadGrpcSchemaForItem(store, grpc, { automatic: true, mode: 'display' } as any)
        expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledOnce()
        expect(handleRequest).not.toHaveBeenCalled()
        grpc.headers = [{ name: 'authorization', value: '{{TOKEN}}' }]
        const result = await grpcState.loadGrpcSchemaForItem(store, grpc, { automatic: true, force: true, mode: 'display' } as any)
        expect(result).toMatchObject({ error: expect.stringContaining('Could not resolve tag') })
        expect(handleRequest).not.toHaveBeenCalled()
        expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledOnce()
    })

    test('a failed dependency schema preparation stops the tag with its original cause', async() => {
        const grpc = { ...request, _id: 'g', _type: 'grpc', url: 'localhost:50051', grpc: { service: 'Demo', method: 'Call' }, headers: [{ name: 'authorization', value: '{{TOKEN}}' }] } as CollectionItem
        store.state.collection.push(grpc)
        vi.mocked(handleRequest).mockResolvedValue({ status: null, statusText: 'Error', error: 'Error: Request failed' } as any)
        await expect(new SendResolver('w', 'send').resolve({}, `{% response(request='g', attribute='body', path='$.token', behavior='always') %}`, 'unsaved')).rejects.toThrow('The request this tag sent did not complete with a whole response')
        expect(grpcTransport.loadGrpcSchema).not.toHaveBeenCalled()
        expect(grpcTransport.startGrpcCall).not.toHaveBeenCalled()
    })

    for(const usedIn of ['address', 'direct metadata', 'inherited metadata']) {
        test(`automatic schema used absence fails in ${usedIn} without sending or placeholder traffic`, async() => {
            const grpc = { ...request, _id: 'g', _type: 'grpc', url: usedIn === 'address' ? '{{TOKEN}}:50051' : 'localhost:50051', grpc: { service: 'Demo', method: 'Call' }, headers: usedIn === 'direct metadata' ? [{ name: 'authorization', value: tag }] : [] } as CollectionItem
            if(usedIn === 'inherited metadata') {
                folder.headers = [{ name: 'authorization', value: '{{TOKEN}}' }]
            }
            store.state.collection.push(grpc)
            const result = await grpcState.loadGrpcSchemaForItem(store, grpc, { automatic: true, mode: 'display' })
            expect(result).toMatchObject({ error: expect.stringContaining('Could not resolve tag') })
            expect(handleRequest).not.toHaveBeenCalled()
            expect(grpcTransport.loadGrpcSchema).not.toHaveBeenCalled()
            folder.headers = []
        })
    }

    test('a schema load without an explicit send mode cannot send Login', async() => {
        const grpc = { ...request, _id: 'g', _type: 'grpc', url: 'localhost:50051', grpc: { service: 'Demo', method: 'Call' }, headers: [{ name: 'authorization', value: '{{TOKEN}}' }] } as CollectionItem
        store.state.collection.push(grpc)
        const result = await grpcState.loadGrpcSchemaForItem(store, grpc, { force: true } as any)
        expect(handleRequest).not.toHaveBeenCalled()
        expect(grpcTransport.loadGrpcSchema).not.toHaveBeenCalled()
        expect(result).toMatchObject({ error: expect.stringContaining('Could not resolve tag') })
    })

    test('X to cold G to Login uses send permission after G was opened and failed in display mode', async() => {
        const grpc = { ...request, _id: 'g', _type: 'grpc', url: 'localhost:50051', grpc: { service: 'Demo', method: 'Call' }, headers: [{ name: 'authorization', value: '{{TOKEN}}' }], body: { mimeType: 'application/json', text: '{}' } } as CollectionItem
        store.state.collection.push(grpc)
        grpcTransport.loadGrpcSchema.mockResolvedValue({ source: 'reflection', services: [{ name: 'Demo', methods: [{ name: 'Call', path: '/Demo/Call', requestStream: false, responseStream: false, inputType: 'A', outputType: 'B', example: '{}' }] }] })
        await grpcState.loadGrpcSchemaForItem(store, grpc, { automatic: true, mode: 'display' } as any)
        expect(grpcTransport.loadGrpcSchema).not.toHaveBeenCalled()
        vi.mocked(handleRequest).mockClear()
        grpcTransport.startGrpcCall.mockImplementation(async(_spec, event) => {
            event({ type: 'received', json: '{"token":"g-token"}', time: 1 })
            event({ type: 'status', code: 0, name: 'OK', details: '', trailers: [], time: 2 })
            return { send: vi.fn(), end: vi.fn(), cancel: vi.fn() }
        })
        const sourceFolder = { ...folder, _id: 'source-folder', environment: { G_TOKEN: `{% response(request='g', attribute='body', path='$.token', behavior='always') %}` } }
        const source = { ...login, _id: 'x', parentId: sourceFolder._id }
        store.state.collection.push(sourceFolder, source)
        await store.dispatch('sendRequest', source)
        expect(vi.mocked(handleRequest).mock.calls.find(([item]) => item._id === 'x')?.[1]).toMatchObject({ G_TOKEN: 'g-token' })
        expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.arrayContaining([['authorization', 'fresh']]) }), expect.any(AbortSignal))
        expect(grpcTransport.startGrpcCall).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.arrayContaining([['authorization', 'fresh']]) }), expect.any(Function))
        expect(vi.mocked(handleRequest).mock.calls.filter(([item]) => item._id === 'login')).toHaveLength(1)
    })

    test('X to cold G sends the Login in G\'s address once when a newer methods load of G takes over', async() => {
        const grpc = { ...login, _id: 'g', _type: 'grpc', url: `localhost:${tag}`, grpc: { service: 'Demo', method: 'Call' }, headers: [], body: { mimeType: 'application/json', text: '{}' } } as CollectionItem
        store.state.collection.push(grpc)
        grpcTransport.loadGrpcSchema.mockResolvedValue({ source: 'reflection', services: [{ name: 'Demo', methods: [{ name: 'Call', path: '/Demo/Call', requestStream: false, responseStream: false, inputType: 'A', outputType: 'B', example: '{}' }] }] })
        grpcTransport.startGrpcCall.mockImplementation(async(_spec, event) => {
            event({ type: 'received', json: '{"token":"g-token"}', time: 1 })
            event({ type: 'status', code: 0, name: 'OK', details: '', trailers: [], time: 2 })
            return { send: vi.fn(), end: vi.fn(), cancel: vi.fn() }
        })
        const firstLogin = resolutionGate<any>()
        vi.mocked(handleRequest).mockImplementation(async item => {
            if(item._id === 'login' && vi.mocked(handleRequest).mock.calls.filter(([called]) => called._id === 'login').length === 1) {
                return firstLogin.promise
            }
            return { ...reply('50051'), collectionId: item._id } as any
        })
        const sourceFolder = { ...folder, _id: 'source-folder', environment: { G_TOKEN: `{% response(request='g', attribute='body', path='$.token', behavior='always') %}` } }
        const source = { ...login, _id: 'x', parentId: sourceFolder._id }
        store.state.collection.push(sourceFolder, source)
        const sending = store.dispatch('sendRequest', source)
        await vi.waitFor(() => expect(vi.mocked(handleRequest).mock.calls.some(([item]) => item._id === 'login')).toBe(true))
        // G's tab opens meanwhile and starts its own methods load, which takes over
        await grpcState.loadGrpcSchemaForItem(store, grpc, { automatic: true, mode: 'display' })
        firstLogin.resolve({ ...reply('50051'), collectionId: 'login' })
        await sending
        expect(vi.mocked(handleRequest).mock.calls.filter(([item]) => item._id === 'login')).toHaveLength(1)
        expect(vi.mocked(handleRequest).mock.calls.find(([item]) => item._id === 'x')?.[1]).toMatchObject({ G_TOKEN: 'g-token' })
    })

    for(const behavior of ['no-history', 'when-expired']) {
        test(`X to cold G with ${behavior} reads saved history after a display kind check transport failure`, async() => {
            const grpc = { ...login, _id: 'g', _type: 'grpc', url: 'localhost:50051', grpc: { service: 'Demo', method: 'Call' }, headers: [{ name: 'authorization', value: tag }], body: { mimeType: 'application/json', text: '{}' } } as CollectionItem
            const saved = { _id: 'saved', collectionId: 'g', createdAt: Date.now(), grpc: { service: 'Demo', method: 'PreviousCall', kind: 'unary', ended: 'completed', status: { code: 0 }, events: [{ type: 'received', json: '{"token":"saved-g-token"}' }] } }
            const sourceFolder = { ...folder, _id: 'source-folder', environment: { G_TOKEN: `{% response(request='g', attribute='body', path='$.token', behavior='${behavior}', maxAge=3600) %}` } }
            const source = { ...login, _id: 'x', parentId: sourceFolder._id }
            store.state.collection.push(grpc, sourceFolder, source)
            let savedResponses = [saved]
            vi.mocked(getResponsesByCollectionId).mockImplementation(async(_workspaceId, itemId) => (itemId === 'g' ? savedResponses : itemId === 'login' ? [reply('saved-login')] : []) as any)
            grpcTransport.loadGrpcSchema.mockReset().mockRejectedValue(new Error('Offline schema transport'))
            grpcTransport.startGrpcCall.mockReset().mockImplementation(async(_spec, event) => {
                event({ type: 'received', json: '{"token":"fresh-g-token"}', time: 1 })
                event({ type: 'status', code: 0, name: 'OK', details: '', trailers: [], time: 2 })
                return { send: vi.fn(), end: vi.fn(), cancel: vi.fn() }
            })

            await store.dispatch('sendRequest', source)
            expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledOnce()
            expect(grpcTransport.startGrpcCall).not.toHaveBeenCalled()
            expect(vi.mocked(handleRequest).mock.calls.map(([item]) => item._id)).toEqual(['x'])
            expect(vi.mocked(handleRequest).mock.calls[0][1]).toMatchObject({ G_TOKEN: 'saved-g-token' })

            // If history changes during the failed display load, the call prepares its own send.
            resetGrpcCalls()
            vi.mocked(handleRequest).mockClear()
            const schemaStarted = resolutionGate<void>()
            const schemaResult = resolutionGate<any>()
            grpcTransport.loadGrpcSchema.mockReset().mockImplementationOnce(() => {
                schemaStarted.resolve(undefined)
                return schemaResult.promise
            }).mockResolvedValueOnce({ source: 'reflection', services: [{ name: 'Demo', methods: [{ name: 'Call', path: '/Demo/Call', requestStream: false, responseStream: false, inputType: 'A', outputType: 'B', example: '{}' }] }] })
            const sending = store.dispatch('sendRequest', source)
            await schemaStarted.promise
            if(behavior === 'no-history') {
                savedResponses = []
            } else {
                saved.createdAt -= 7200000
            }
            schemaResult.reject(new Error('Offline schema transport'))
            await sending
            expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledTimes(2)
            expect(grpcTransport.startGrpcCall).toHaveBeenCalledOnce()
            expect(vi.mocked(handleRequest).mock.calls.map(([item]) => item._id)).toEqual(['login', 'x'])
            expect(vi.mocked(handleRequest).mock.calls[1][1]).toMatchObject({ G_TOKEN: 'fresh-g-token' })
            expect(grpcTransport.startGrpcCall).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.arrayContaining([['authorization', 'fresh']]) }), expect.any(Function))
        })

        for(const streaming of [false, true]) {
            test(`X to cold G with ${behavior} reads another method's history without sending Login and checks the ${streaming ? 'streaming' : 'unary'} current method`, async() => {
                const grpc = { ...login, _id: 'g', _type: 'grpc', url: 'localhost:50051', grpc: { service: 'Demo', method: 'Call' }, headers: [{ name: 'authorization', value: tag }], body: { mimeType: 'application/json', text: '{}' } } as CollectionItem
                const saved = { _id: 'saved', collectionId: 'g', createdAt: Date.now(), grpc: { service: 'Demo', method: 'PreviousCall', kind: 'unary', ended: 'completed', status: { code: 0 }, events: [{ type: 'received', json: '{"token":"saved-g-token"}' }] } }
                const sourceFolder = { ...folder, _id: 'source-folder', environment: { G_TOKEN: `{% response(request='g', attribute='body', path='$.token', behavior='${behavior}', maxAge=3600) %}` } }
                const source = { ...login, _id: 'x', parentId: sourceFolder._id }
                store.state.collection.push(grpc, sourceFolder, source)
                let savedResponses = [saved]
                vi.mocked(getResponsesByCollectionId).mockImplementation(async(_workspaceId, itemId) => (itemId === 'g' ? savedResponses : itemId === 'login' ? [reply('saved-login')] : []) as any)
                const schema = { source: 'reflection', services: [{ name: 'Demo', methods: [{ name: 'Call', path: '/Demo/Call', requestStream: false, responseStream: streaming, inputType: 'A', outputType: 'B', example: '{}' }] }] }
                grpcTransport.loadGrpcSchema.mockReset().mockResolvedValue(schema)
                grpcTransport.startGrpcCall.mockReset().mockImplementation(async(_spec, event) => {
                    event({ type: 'received', json: '{"token":"g-token"}', time: 1 })
                    event({ type: 'status', code: 0, name: 'OK', details: '', trailers: [], time: 2 })
                    return { send: vi.fn(), end: vi.fn(), cancel: vi.fn() }
                })

                const result = await store.dispatch('sendRequest', source)
                expect(vi.mocked(handleRequest).mock.calls.filter(([item]) => item._id === 'login')).toHaveLength(0)
                expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledOnce()
                expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.arrayContaining([['authorization', 'saved-login']]) }), expect.any(AbortSignal))
                expect(grpcTransport.startGrpcCall).not.toHaveBeenCalled()
                if(streaming) {
                    expect(result.error).toContain('A response tag can read only a unary gRPC call')
                    expect(handleRequest).not.toHaveBeenCalled()
                } else {
                    expect(vi.mocked(handleRequest).mock.calls.find(([item]) => item._id === 'x')?.[1]).toMatchObject({ G_TOKEN: 'saved-g-token' })

                    resetGrpcCalls()
                    vi.mocked(handleRequest).mockClear()
                    grpcTransport.loadGrpcSchema.mockClear()
                    saved.createdAt -= 7200000
                    const sendBehavior = behavior === 'no-history' ? 'always' : 'when-expired'
                    sourceFolder.environment.G_TOKEN = `{% response(request='g', attribute='body', path='$.token', behavior='${sendBehavior}', maxAge=3600) %}`
                    await store.dispatch('sendRequest', source)
                    expect(vi.mocked(handleRequest).mock.calls.find(([item]) => item._id === 'x')?.[1]).toMatchObject({ G_TOKEN: 'g-token' })
                    expect(vi.mocked(handleRequest).mock.calls.filter(([item]) => item._id === 'login')).toHaveLength(1)
                    expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledOnce()
                    expect(grpcTransport.startGrpcCall).toHaveBeenCalledOnce()
                    expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.arrayContaining([['authorization', 'fresh']]) }), expect.any(AbortSignal))
                    expect(grpcTransport.startGrpcCall).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.arrayContaining([['authorization', 'fresh']]) }), expect.any(Function))

                    for(const initiallySends of [false, true]) {
                        resetGrpcCalls()
                        vi.mocked(handleRequest).mockClear()
                        grpcTransport.loadGrpcSchema.mockClear()
                        grpcTransport.startGrpcCall.mockClear()
                        sourceFolder.environment.G_TOKEN = `{% response(request='g', attribute='body', path='$.token', behavior='${behavior}', maxAge=3600) %}`
                        const setHistory = (needsSend: boolean) => {
                            saved.createdAt = Date.now() - (needsSend ? 7200000 : 0)
                            savedResponses = needsSend && behavior === 'no-history' ? [] : [saved]
                        }
                        setHistory(initiallySends)
                        const schemaStarted = resolutionGate<void>()
                        const schemaLoad = resolutionGate<typeof schema>()
                        grpcTransport.loadGrpcSchema.mockImplementationOnce(() => {
                            schemaStarted.resolve(undefined)
                            return schemaLoad.promise
                        })
                        const sending = store.dispatch('sendRequest', source)
                        await schemaStarted.promise
                        try {
                            expect(vi.mocked(handleRequest).mock.calls.filter(([item]) => item._id === 'login')).toHaveLength(initiallySends ? 1 : 0)
                            expect(grpcTransport.startGrpcCall).not.toHaveBeenCalled()
                            setHistory(!initiallySends)
                        } finally {
                            schemaLoad.resolve(schema)
                            await sending
                        }
                        expect(vi.mocked(handleRequest).mock.calls.find(([item]) => item._id === 'x')?.[1]).toMatchObject({ G_TOKEN: initiallySends ? 'saved-g-token' : 'g-token' })
                        expect(vi.mocked(handleRequest).mock.calls.filter(([item]) => item._id === 'login')).toHaveLength(1)
                        expect(grpcTransport.startGrpcCall).toHaveBeenCalledTimes(initiallySends ? 0 : 1)
                        if(!initiallySends) {
                            expect(grpcTransport.startGrpcCall).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.arrayContaining([['authorization', 'fresh']]) }), expect.any(Function))
                        }
                    }
                }
            })
        }
    }

    for(const reuse of ['loaded', 'loading']) {
        test(`X to G reuses a ${reuse} schema and resolves G's address dependency once`, async() => {
            const schema = { source: 'reflection', services: [{ name: 'Demo', methods: [{ name: 'Call', path: '/Demo/Call', requestStream: false, responseStream: false, inputType: 'A', outputType: 'B', example: '{}' }] }] }
            const schemaLoad = resolutionGate<any>()
            grpcTransport.loadGrpcSchema.mockReset().mockReturnValueOnce(schemaLoad.promise)
            const other = { ...login, _id: 'h', _type: 'grpc', url: 'localhost:50051' } as CollectionItem
            const loading = grpcState.loadGrpcSchemaForItem(store, other, { automatic: true, mode: 'display' })
            await vi.waitFor(() => expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledOnce())
            if(reuse === 'loaded') {
                schemaLoad.resolve(schema)
                await loading
            }
            const grpc = { ...login, _id: 'g', _type: 'grpc', url: tag, grpc: { service: 'Demo', method: 'Call' }, headers: [], body: { mimeType: 'application/json', text: '{}' } } as CollectionItem
            const sourceFolder = { ...folder, _id: 'source-folder', environment: { G_TOKEN: `{% response(request='g', attribute='body', path='$.token', behavior='always') %}` } }
            const source = { ...login, _id: 'x', parentId: sourceFolder._id }
            store.state.collection.push(other, grpc, sourceFolder, source)
            vi.mocked(handleRequest).mockImplementation(async item => ({ ...reply('localhost:50051'), collectionId: item._id } as any))
            grpcTransport.startGrpcCall.mockImplementation(async(_spec, event) => {
                event({ type: 'received', json: '{"token":"g-token"}', time: 1 })
                event({ type: 'status', code: 0, name: 'OK', details: '', trailers: [], time: 2 })
                return { send: vi.fn(), end: vi.fn(), cancel: vi.fn() }
            })
            const sending = store.dispatch('sendRequest', source)
            await vi.waitFor(() => expect(grpcState.grpcItemSchemaKeys[getGrpcItemKey(grpc)]).toBe(grpcState.grpcItemSchemaKeys[getGrpcItemKey(other)]))
            schemaLoad.resolve(schema)
            const preparedOther = await loading
            await sending
            expect(vi.mocked(handleRequest).mock.calls.find(([item]) => item._id === 'x')?.[1]).toMatchObject({ G_TOKEN: 'g-token' })
            expect(vi.mocked(handleRequest).mock.calls.filter(([item]) => item._id === 'login')).toHaveLength(1)
            expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledOnce()
            expect(preparedOther?.requestPreparation?.stopAbortController.signal.aborted).toBe(false)
        })
    }

    for(const hasErrorWithoutValues of [true, false]) {
        test(`a dependent gRPC call never saves a shared schema load's masked metadata name, engine copy: ${hasErrorWithoutValues}`, async() => {
            const schemaStarted = resolutionGate<void>()
            const schemaLoad = resolutionGate<any>()
            window.createPrompt = vi.fn(async() => 'private name')
            const other = { ...login, _id: 'h', _type: 'grpc', url: 'localhost:50051', headers: [{ name: `{% prompt(title='Metadata name', mask=1) %}`, value: 'value' }] } as CollectionItem
            const grpc = { ...login, _id: 'g', _type: 'grpc', url: other.url, grpc: { service: 'Demo', method: 'Call' } } as CollectionItem
            const sourceFolder = { ...folder, _id: 'source-folder', environment: { G_TOKEN: `{% response(request='g', attribute='body', path='$.token', behavior='always') %}` } }
            const source = { ...grpc, _id: 'x', parentId: sourceFolder._id }
            store.state.collection.push(other, grpc, sourceFolder, source)
            grpcTransport.loadGrpcSchema.mockReset().mockImplementationOnce(() => {
                schemaStarted.resolve(undefined)
                return schemaLoad.promise
            })
            try {
                const loading = grpcState.loadGrpcSchemaForItem(store, other, { force: true, mode: 'send' })
                await schemaStarted.promise
                expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.arrayContaining([['private name', 'value']]) }), expect.any(AbortSignal))
                const sending = startGrpcCallForItem(store, source, { waitForEnd: true })
                await vi.waitFor(() => expect(grpcState.grpcItemSchemaKeys[getGrpcItemKey(grpc)]).toBe(grpcState.grpcItemSchemaKeys[getGrpcItemKey(other)]))
                const error = Object.assign(new Error('Metadata private name: a name has only letters, digits, -, _ and .'), hasErrorWithoutValues ? { messageWithoutValues: 'Metadata ******: a name has only letters, digits, -, _ and .' } : {})
                schemaLoad.reject(error)
                await loading
                await sending
                const saved = vi.mocked(createResponse).mock.calls.find(([, response]) => response.collectionId === 'x')?.[1] as any
                expect(saved.grpc.error).toBe(hasErrorWithoutValues ? 'Metadata ******: a name has only letters, digits, -, _ and .' : 'Could not load the methods of the request this tag reads')
                expect(JSON.stringify(saved)).not.toContain('private name')
                expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledOnce()
                expect(grpcTransport.startGrpcCall).not.toHaveBeenCalled()
                expect(window.createPrompt).toHaveBeenCalledOnce()
            } finally {
                delete (window as any).createPrompt
            }
        })
    }

    test('an HTTP dependency preparation failure keeps its cause in Logs only', async() => {
        const missing = `{% response(request='missing', attribute='body', path='$.token', behavior='never') %}`
        const loginFolder = { ...folder, _id: 'login-folder', environment: { MISSING: missing } }
        store.state.collection[0] = { ...login, parentId: loginFolder._id }
        store.state.collection.push(loginFolder)
        const result = await store.dispatch('sendRequest', request)
        expect(result.error).toBe('Error: The request this tag sent did not complete with a whole response')
        expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('request=\'missing\'') }))
        expect(handleRequest).not.toHaveBeenCalled()
    })

    test('a gRPC environment failure does not save its HTTP dependency masked script value', async() => {
        const originalHelpers = await vi.importActual<typeof import('./helpers')>('./helpers')
        vi.mocked(handleRequest).mockImplementation(originalHelpers.handleRequest)
        window.createPrompt = vi.fn(async() => 'private-header-value')
        try {
            const http = { ...login, _id: 'h', headers: [{ name: 'X-Secret', value: `{% prompt(title='Dependency secret', mask=1) %}` }] }
            const sourceFolder = { ...folder, _id: 'source-folder', environment: { H_TOKEN: `{% response(request='h', attribute='body', path='$.token', behavior='always') %}` } }
            const source = { ...login, _id: 'x', _type: 'grpc', parentId: sourceFolder._id, url: 'localhost:50051', grpc: { service: 'Demo', method: 'Call' } } as CollectionItem
            store.state.collection.push(http, sourceFolder, source)
            store.state.plugins.workspace = [{ ...scriptPlugin('throw-header', { pre_request: `throw new Error(rf.request.getHeader('X-Secret'))`, post_request: '' }), collectionId: 'h' }]
            await startGrpcCallForItem(store, source, { waitForEnd: true })
            expect(window.createPrompt).toHaveBeenCalledOnce()
            expect(store.state.requestResponses.h.error).toContain('private-header-value')
            const saved = vi.mocked(createResponse).mock.calls.find(([, response]) => response.collectionId === 'x')?.[1] as any
            expect(saved.grpc.error).toBe('The request this tag sent did not complete with a whole response')
            expect(JSON.stringify(saved)).not.toContain('private-header-value')
            expect(console.error).toHaveBeenCalled()
            expect(grpcTransport.loadGrpcSchema).not.toHaveBeenCalled()
            expect(grpcTransport.startGrpcCall).not.toHaveBeenCalled()
        } finally {
            delete (window as any).createPrompt
        }
    })

    for(const schemaKind of ['unary', 'streaming', 'offline']) {
        test(`X to cold G with never reads another method's whole history only once the schema shows a unary method, schema: ${schemaKind}`, async() => {
            const grpc = { ...login, _id: 'g', _type: 'grpc', url: 'localhost:50051', grpc: { service: 'Demo', method: 'Call' }, headers: [{ name: 'authorization', value: tag }], body: { mimeType: 'application/json', text: '{}' } } as CollectionItem
            const saved = { _id: 'saved', collectionId: 'g', createdAt: Date.now(), grpc: { service: 'Demo', method: 'PreviousCall', kind: 'unary', ended: 'completed', status: { code: 0 }, events: [{ type: 'received', json: '{"token":"saved-g-token"}' }] } }
            const sourceFolder = { ...folder, _id: 'source-folder', environment: { G_TOKEN: `{% response(request='g', attribute='body', path='$.token', behavior='never') %}` } }
            const source = { ...login, _id: 'x', parentId: sourceFolder._id }
            store.state.collection.push(grpc, sourceFolder, source)
            vi.mocked(getResponsesByCollectionId).mockImplementation(async(_workspaceId, itemId) => (itemId === 'g' ? [saved] : itemId === 'login' ? [reply('saved-login')] : []) as any)
            grpcTransport.loadGrpcSchema.mockReset()
            if(schemaKind === 'offline') {
                grpcTransport.loadGrpcSchema.mockRejectedValue(new Error('Offline schema transport'))
            } else {
                grpcTransport.loadGrpcSchema.mockResolvedValue({ source: 'reflection', services: [{ name: 'Demo', methods: [{ name: 'Call', path: '/Demo/Call', requestStream: false, responseStream: schemaKind === 'streaming', inputType: 'A', outputType: 'B', example: '{}' }] }] })
            }

            const result = await store.dispatch('sendRequest', source)
            expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledOnce()
            expect(grpcTransport.loadGrpcSchema).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.arrayContaining([['authorization', 'saved-login']]) }), expect.any(AbortSignal))
            expect(grpcTransport.startGrpcCall).not.toHaveBeenCalled()
            // with the method's kind unknown, never cannot tell a unary call's reply from a stream's, as before
            if(schemaKind !== 'unary') {
                expect(result.error).toContain('A response tag can read only a unary gRPC call')
                expect(handleRequest).not.toHaveBeenCalled()
            } else {
                expect(vi.mocked(handleRequest).mock.calls.map(([item]) => item._id)).toEqual(['x'])
                expect(vi.mocked(handleRequest).mock.calls[0][1]).toMatchObject({ G_TOKEN: 'saved-g-token' })
            }
        })
    }

    for(const dependencyIn of ['metadata', 'folder environment']) {
        test(`X to cold G with never does not send Login in G's ${dependencyIn} or load its schema`, async() => {
            vi.mocked(getResponsesByCollectionId).mockImplementation(async(_workspaceId, collectionId) => collectionId === login._id ? [reply('saved-login-token')] as any : [])
            const grpc = { ...login, _id: 'g', _type: 'grpc', parentId: dependencyIn === 'folder environment' ? folder._id : null, url: 'localhost:50051', grpc: { service: 'Demo', method: 'Call' }, headers: [{ name: 'authorization', value: dependencyIn === 'metadata' ? tag : '{{TOKEN}}' }] } as CollectionItem
            const sourceFolder = { ...folder, _id: 'source-folder', environment: { G_TOKEN: `{% response(request='g', attribute='body', path='$.token', behavior='never') %}` } }
            const source = { ...login, _id: 'x', parentId: sourceFolder._id }
            store.state.collection.push(grpc, sourceFolder, source)
            grpcTransport.loadGrpcSchema.mockResolvedValue({ source: 'reflection', services: [] })
            const result = await store.dispatch('sendRequest', source)
            expect(handleRequest).not.toHaveBeenCalled()
            expect(grpcTransport.loadGrpcSchema).not.toHaveBeenCalled()
            expect(grpcTransport.startGrpcCall).not.toHaveBeenCalled()
            expect(result.error).toContain('Could not resolve tag')
            expect(result.error).toContain('request=\'g\'')
        })
    }
})
