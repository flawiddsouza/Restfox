// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'

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
    getWorkspacePlugins: vi.fn(async() => []),
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

import { createCollection, createCollections, createPlugin, createPlugins, createResponse, deleteCollectionsByIds, deletePlugin, deleteResponse, deleteResponsesByCollectionId, deleteResponsesByCollectionIds, getAllCollectionIdsForGivenWorkspace, getAllWorkspaces, getCollectionById, getCollectionForWorkspace, getFileWorkspace, getResponsesByCollectionId, getWorkspacePlugins, updateCollection, updatePlugin, updateResponse, updateWorkspace } from './db'
import type { CollectionItem, Plugin, ResponseHead, ResponseProgress, ResponseProgressHandler, SetEnvironmentVariableFunction, Workspace } from './global'
import { store } from './store'
import { getSocketItemCloses, noteSocketOpened, takeOpenedSocketKeys } from './utils/socket-connections'
import { getItemEntry, getItemVersion, itemWritesPending, itemWritesSettled, loadItemVersions, setItemVersion } from './utils/item-file-versions'
import { toRaw } from 'vue'
import type { UpdateCollectionResult } from './db'
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
        // a create waits its turn among the script's writes
        await vi.waitFor(() => expect(createPlugin).toHaveBeenCalledTimes(2))
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

        await vi.waitFor(() => expect(createPlugin).toHaveBeenCalledOnce())
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

    test('a request edited while its environment resolves goes out as it was at the click', async() => {
        const send = controlledSend()
        const sent = store.dispatch('sendRequest', tab)
        const urlAtClick = tab.url
        tab.url = 'http://127.0.0.1/edited'
        try {
            await send.started
            expect(vi.mocked(handleRequest).mock.calls.at(-1)![0]).toMatchObject({ url: urlAtClick })
            send.finish(responseOf('response-1', []))
            await sent
        } finally {
            tab.url = urlAtClick
        }
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
        vi.stubGlobal('document', {
            querySelector: () => null,
        })
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
        // the import ends with a reload, which reads the workspace's scripts back
        vi.mocked(getWorkspacePlugins).mockResolvedValueOnce([])

        await store.dispatch('setCollectionTree', {
            collectionTree: [folder('Imported', 0)],
            plugins: [{ _id: 'script', type: 'script', name: null, code: { pre_request: '', post_request: '' }, workspaceId: null, collectionId: 'Imported', enabled: true, createdAt: 1, updatedAt: 1 }],
        })

        expect(emitter.emit).toHaveBeenCalledWith('error', 'Cannot write plugins')
        expect(store.state.collection.map(item => item._id)).toEqual(['Imported'])
        expect(store.state.plugins.workspace).toEqual([])
    })

    const environmentsRefused = { error: null, oldCollectionId: 'Source', newCollectionId: 'Source (2)', environmentsError: 'Source: Not saved, as the environment name prod differs from Prod only in case, which Windows and macOS save as one file' }
    // a later item the file system refused, which stops the rest
    const stopped = 'Error creating collection: CON: EINVAL'

    test('environments refused on duplicating a folder are reported, also when a later item failed', async() => {
        store.state.collection = [folder('Source', 0)]
        store.state.collectionTree = [folder('Source', 0)]
        vi.mocked(createCollections).mockResolvedValueOnce({ error: stopped, results: [environmentsRefused] } as never)
        vi.mocked(updateCollection).mockResolvedValue({ error: null })

        await store.dispatch('duplicateCollectionItem', folder('Source', 0))

        expect(vi.mocked(emitter.emit).mock.calls).toEqual([['error', environmentsRefused.environmentsError], ['error', stopped]])
    })

    test('environments refused on importing a folder are reported, also when a later item failed', async() => {
        store.state.collection = []
        store.state.collectionTree = []
        vi.mocked(createCollections).mockResolvedValueOnce({ error: stopped, results: [environmentsRefused] } as never)
        vi.mocked(getCollectionForWorkspace).mockResolvedValueOnce({ collection: [folder('Source', 0)] } as never)

        await store.dispatch('setCollectionTree', { collectionTree: [folder('Source', 0)] })

        expect(vi.mocked(emitter.emit).mock.calls).toEqual([['error', environmentsRefused.environmentsError], ['error', stopped]])
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

    test('environments refused for a folder are reported, also when a later item failed', async() => {
        const environmentsError = 'Envs: Not saved, as the environment name prod differs from Prod only in case, which Windows and macOS save as one file'
        vi.spyOn(emitter, 'emit')
        vi.mocked(getCollectionForWorkspace).mockResolvedValue({
            collection: [{ _id: 'folder', _type: 'request_group', name: 'Envs', parentId: null, workspaceId: 'source' }],
        } as never)
        vi.mocked(createCollections).mockResolvedValueOnce({ error: 'Error creating collection: CON: EINVAL', results: [{ error: null, oldCollectionId: 'folder', newCollectionId: 'Envs', environmentsError }] } as never)
        vi.mocked(getWorkspacePlugins).mockResolvedValueOnce([])

        try {
            await store.dispatch('duplicateWorkspace', {
                sourceWorkspace: { _id: 'source', _type: 'local', name: 'Source' }, name: 'Copy', type: 'local', location: '', includeResponseHistory: false,
            })

            expect(vi.mocked(emitter.emit).mock.calls).toEqual([['error', environmentsError], ['error', 'Error creating collection: CON: EINVAL']])
        } finally {
            vi.mocked(getCollectionForWorkspace).mockReset()
            vi.mocked(emitter.emit).mockRestore()
        }
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

describe('socket connections of items no longer open', () => {
    const socketItem = (_id: string, ...clientIds: string[]) => ({ _id, _type: 'socket', name: _id, parentId: null, workspaceId: 'workspace-id', clients: clientIds.map(id => ({ id })) }) as unknown as CollectionItem
    let closes: Record<string, ReturnType<typeof vi.fn>>

    // as Connect opens and records them, the client id after the item's
    function connect(...keys: string[]) {
        for(const key of keys) {
            closes[key] = vi.fn()
            store.state.sockets[key] = { close: closes[key] } as unknown as WebSocket
            noteSocketOpened(key.slice(0, key.lastIndexOf('-')), key)
        }
    }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(console, 'log').mockImplementation(() => undefined)
        closes = {}
        for(const key of Object.keys(store.state.sockets)) {
            delete store.state.sockets[key]
        }
        for(const itemId of ['/S.json', '/S2.json', '/Chat', '/Chat-dev.json']) {
            takeOpenedSocketKeys(itemId)
        }
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'file', name: 'Workspace', environment: {}, environments: [], dotEnv: {} } as unknown as Workspace
        store.commit('setCollection', [socketItem('/S.json', 'c1', 'c2'), socketItem('/S2.json', 'c1')])
        store.state.tabs = [socketItem('/S.json', 'c1', 'c2'), socketItem('/S2.json', 'c1')]
        store.state.detachedTabs = []
        store.state.activeTab = store.state.tabs[0]
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    test('closing a socket tab closes the connections of its clients, and a Connect it was still waiting on', () => {
        connect('/S.json-c1', '/S.json-c2', '/S2.json-c1')
        const closesBefore = getSocketItemCloses('/S.json')
        store.commit('closeTab', '/S.json')
        expect(getSocketItemCloses('/S.json')).toBe(closesBefore + 1)
        expect(closes['/S.json-c1']).toHaveBeenCalledOnce()
        expect(closes['/S.json-c2']).toHaveBeenCalledOnce()
        expect(closes['/S2.json-c1']).not.toHaveBeenCalled()
        expect(Object.keys(store.state.sockets)).toEqual(['/S2.json-c1'])
    })

    test('closing a socket tab closes a connection its Connect opened for a client the tab no longer lists', () => {
        connect('/S.json-gone')
        store.commit('closeTab', '/S.json')
        expect(closes['/S.json-gone']).toHaveBeenCalledOnce()
    })

    test('closing a tab whose item lists clients that are not an array closes what its Connect opened', () => {
        store.state.tabs[0] = { ...store.state.tabs[0], clients: {} } as unknown as CollectionItem
        connect('/S.json-c1')
        store.commit('closeTab', '/S.json')
        expect(closes['/S.json-c1']).toHaveBeenCalledOnce()
    })

    test('closing a folder tab leaves the connection of a socket beside it whose path starts the same', () => {
        store.state.tabs.push({ _id: '/Chat', _type: 'request_group', name: 'Chat', parentId: null, workspaceId: 'workspace-id' } as CollectionItem, socketItem('/Chat-dev.json', 'c1'))
        connect('/Chat-dev.json-c1')
        store.commit('closeTab', '/Chat')
        expect(closes['/Chat-dev.json-c1']).not.toHaveBeenCalled()
    })

    test('moving a socket tab to a new window keeps its connections, and closing that window closes them', () => {
        connect('/S.json-c1')
        store.commit('detachTab', store.state.tabs[0])
        const closesBefore = getSocketItemCloses('/S.json')
        store.commit('closeTab', '/S.json')
        expect(closes['/S.json-c1']).not.toHaveBeenCalled()
        expect(store.state.sockets['/S.json-c1']).toBeDefined()
        expect(getSocketItemCloses('/S.json')).toBe(closesBefore)
        store.commit('closeDetachedTab', store.state.detachedTabs[0])
        expect(closes['/S.json-c1']).toHaveBeenCalledOnce()
        expect(store.state.sockets['/S.json-c1']).toBeUndefined()
    })

    test('a socket\'s window that a workspace switch closed closes its connections', () => {
        connect('/S.json-c1')
        const tab = store.state.tabs[0]
        store.commit('detachTab', tab)
        store.commit('closeTab', '/S.json')
        // the quick switcher drops the other workspace's windows from the list before they close
        store.state.detachedTabs = []
        store.commit('closeDetachedTab', tab)
        expect(closes['/S.json-c1']).toHaveBeenCalledOnce()
    })

    test('reopening a socket from the sidebar while its window is open takes that window\'s tab back', async() => {
        // what addTab reads besides the store: a document to scroll the tab into view, and the item's history
        vi.stubGlobal('document', {
            querySelector: () => null,
        })
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        connect('/S.json-c1')
        const tab = store.state.tabs[0]
        store.commit('detachTab', tab)
        store.commit('closeTab', '/S.json')
        // renamed in the sidebar while its window was open
        await store.dispatch('addTab', { ...socketItem('/S.json', 'c1'), name: 'Renamed' })
        expect(store.state.tabs.find(openTab => openTab._id === '/S.json')).toBe(tab)
        expect(tab.name).toBe('Renamed')
        expect(store.state.detachedTabs).toEqual([])
        // the window closing afterwards finds it open
        store.commit('closeDetachedTab', tab)
        expect(closes['/S.json-c1']).not.toHaveBeenCalled()
        await nextTick()
        vi.unstubAllGlobals()
    })

    test('reopening a folder from the sidebar while its window is open takes the sidebar\'s item, which has edits made elsewhere', async() => {
        vi.stubGlobal('document', {
            querySelector: () => null,
        })
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        const folder = { _id: '/F', _type: 'request_group', name: 'F', parentId: null, workspaceId: 'workspace-id', headers: [{ name: 'X-A', value: 'old' }] } as unknown as CollectionItem
        store.state.detachedTabs.push(JSON.parse(JSON.stringify(folder)))
        // the window's tab misses a header changed in the folder's settings
        await store.dispatch('addTab', { ...folder, headers: [{ name: 'X-A', value: 'new' }] })
        expect(store.state.detachedTabs).toEqual([])
        expect(store.state.tabs.find(openTab => openTab._id === '/F')!.headers).toEqual([{ name: 'X-A', value: 'new' }])
        await nextTick()
        vi.unstubAllGlobals()
    })

    test('deleting an item while another workspace is opened deletes it in its own workspace and leaves the other\'s', async() => {
        let release!: () => void
        vi.mocked(deleteResponsesByCollectionIds).mockImplementationOnce(() => new Promise<any>(resolve => {
            release = () => resolve(undefined)
        }))
        vi.mocked(deleteCollectionsByIds).mockResolvedValue({ error: null } as any)
        const item = { _id: '/S.json', _type: 'request', name: 'S', parentId: null, workspaceId: 'workspace-id' } as CollectionItem
        store.state.collection = [item]
        const deleted = store.dispatch('deleteCollectionItem', item)
        await vi.waitFor(() => expect(release).toBeDefined())
        // a file workspace with an item at the same path, which has a script
        const otherItem = { ...item, workspaceId: 'other' }
        store.state.activeWorkspace = { _id: 'other', _type: 'file', name: 'Other', environment: {}, environments: [], dotEnv: {} } as unknown as Workspace
        store.state.collection = [otherItem]
        const otherPlugin = { _id: 'p', type: 'script', name: 'script', code: { pre_request: '', post_request: '' }, workspaceId: 'other', collectionId: '/S.json', enabled: true, createdAt: 0, updatedAt: 0 } as unknown as Plugin
        store.state.plugins.workspace = [otherPlugin]
        release()
        await deleted
        expect(deleteCollectionsByIds).toHaveBeenCalledWith('workspace-id', ['/S.json'])
        expect(store.state.collection).toEqual([otherItem])
        expect(store.state.plugins.workspace).toEqual([otherPlugin])
    })

    test('Close All closes the connections of every tab and leaves those of a window of their own', () => {
        connect('/S.json-c1', '/S2.json-c1')
        store.commit('detachTab', store.state.tabs[1])
        store.commit('closeTab', '/S2.json')
        store.commit('closeAllTabs')
        expect(closes['/S.json-c1']).toHaveBeenCalledOnce()
        expect(closes['/S2.json-c1']).not.toHaveBeenCalled()
    })

    for(const action of ['closeWorkspace', 'deleteWorkspace']) {
        test(`${action} on the Workspaces page closes the connections its file workspace kept open in tabs`, async() => {
            connect('/S.json-c1')
            // the tabs a workspace keeps, as when it was left for the Workspaces page
            await store.commit('persistActiveWorkspaceTabs')
            store.state.activeWorkspace = null
            store.state.tabs = []
            // the browser database holds no item of a file workspace
            vi.mocked(getAllCollectionIdsForGivenWorkspace).mockResolvedValueOnce([])
            await store.dispatch(action, 'workspace-id')
            expect(closes['/S.json-c1']).toHaveBeenCalledOnce()
        })
    }

    test('deleting a socket item open in its own window closes its connections', async() => {
        connect('/S.json-c1')
        store.commit('detachTab', store.state.tabs[0])
        store.commit('closeTab', '/S.json')
        vi.mocked(deleteCollectionsByIds).mockResolvedValueOnce({ error: null } as any)
        await store.dispatch('deleteCollectionItem', socketItem('/S.json', 'c1'))
        expect(closes['/S.json-c1']).toHaveBeenCalledOnce()
        expect(store.state.detachedTabs).toEqual([])
    })
})

describe('a request whose file changed outside Restfox', () => {
    const request = (id: string, url = 'https://api.example/login') => ({ _id: id, _type: 'request', name: id.replace('.json', ''), parentId: null, workspaceId: 'workspace-id', method: 'GET', url, body: { mimeType: 'No Body' } }) as CollectionItem
    const changedOutside = { error: 'Not saved, as Login.json was changed outside Restfox', changedOutside: true }
    const changedOutsideToast = 'Login changed outside Restfox and was reloaded. Your last edit to it was not saved.'

    // the version this page holds for an item of the workspace shown, as a load or a write leaves it
    const setVersion = (id: string, version: string) => setItemVersion(getItemEntry('workspace-id', id), version)
    const versionOf = (id: string) => getItemVersion('workspace-id', id)
    const settled = (...ids: string[]) => Promise.all(ids.map(id => itemWritesSettled('workspace-id', id)))
    const readResult = (collection: CollectionItem[], versions: Record<string, string>, idMap: Map<string, string> | null = null) => ({ collection, workspace: null, idMap, versions })

    function held<T>() {
        let release!: (value: T) => void
        let reject!: (error: Error) => void
        const promise = new Promise<T>((resolve, fail) => {
            release = resolve
            reject = fail
        })
        return { promise, release, reject }
    }

    function open(...items: CollectionItem[]) {
        store.commit('setCollection', items)
        store.state.tabs = [...store.state.collection]
        store.state.detachedTabs = []
        store.state.activeTab = store.state.collection[0]
        store.state.skipPersistingActiveTab = false
        return store.state.collection
    }

    const flushPromises = async() => {
        for(let index = 0; index < 50; index++) {
            await Promise.resolve()
        }
    }

    function errorToasts() {
        return (vi.mocked(emitter.emit).mock.calls as unknown[][]).filter(call => call[0] === 'error').map(call => call[1])
    }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(updateCollection).mockReset()
        vi.mocked(getCollectionForWorkspace).mockReset()
        vi.spyOn(emitter, 'emit')
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'file', name: 'Workspace' } as Workspace
        store.state.plugins.workspace = []
        store.state.idMap = null
        loadItemVersions('workspace-id', {})
        loadItemVersions('copy-workspace', {})
    })

    // a reload's read left waiting holds every later reload until it ends, as in the app, so each ends with its test
    const pendingReads: ((value: unknown) => void)[] = []
    function pendingRead() {
        return new Promise(resolve => {
            pendingReads.push(resolve)
        }) as never
    }

    // a read the test releases itself, which still ends with the test when the test stops first
    function heldRead() {
        const read = held<unknown>()
        pendingReads.push(read.release)
        return read
    }

    afterEach(async() => {
        store.state.activeWorkspace = { _id: 'workspace-after-test', _type: 'file', name: 'After' } as Workspace
        pendingReads.splice(0).forEach(resolve => resolve({ collection: [], workspace: null, idMap: null }))
        await new Promise(resolve => setTimeout(resolve, 0))
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    test('a save carries the version the item was read with and takes the version its reply gives', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        vi.mocked(updateCollection).mockResolvedValue({ error: null, version: 'v2' })

        store.dispatch('persistCollectionItem', login)
        await settled('Login.json')
        login.url += '/me'
        store.dispatch('persistCollectionItem', login)
        await settled('Login.json')

        expect(vi.mocked(updateCollection).mock.calls.map(call => call[3])).toEqual(['v1', 'v2'])
        expect(versionOf('Login.json')).toBe('v2')
    })

    test('a save counts as pending until the storage takes its data, so leaving the page meanwhile is held', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        const reading = held<void>()
        vi.mocked(updateCollection).mockImplementation(async(_workspaceId, _id, _fields, _version, onSending) => {
            // the body files are read before the data leaves the page
            await reading.promise
            onSending?.()
            return { error: null, version: 'v2' }
        })

        store.dispatch('persistCollectionItem', login)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        expect(itemWritesPending()).toBe(true)
        reading.release()
        await settled('Login.json')
        expect(itemWritesPending()).toBe(false)
    })

    test('edits made while a save runs go out in one more save, made from the version that save\'s reply gave', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        const firstReply = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockReturnValueOnce(firstReply.promise).mockResolvedValue({ error: null, version: 'v3' })

        store.dispatch('persistCollectionItem', login)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        login.url += 'a'
        store.dispatch('persistCollectionItem', login)
        login.url += 'b'
        store.dispatch('persistCollectionItem', login)
        firstReply.release({ error: null, version: 'v2' })
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(2))
        await settled('Login.json')

        expect(vi.mocked(updateCollection).mock.calls[1][2].url).toBe('https://api.example/loginab')
        expect(vi.mocked(updateCollection).mock.calls[1][3]).toBe('v2')
    })

    test('a tab saves from the version its item was read with, as both stand for one item', async() => {
        const [login] = open(request('Login.json'))
        store.state.tabs = []
        store.state.activeTab = null
        setVersion('Login.json', 'v1')
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        vi.stubGlobal('document', {
            querySelector: () => null,
        })
        vi.mocked(updateCollection).mockResolvedValue({ error: null, version: 'v2' })

        await store.dispatch('addTab', login)
        const tab = store.state.activeTab as CollectionItem
        expect(toRaw(tab)).not.toBe(toRaw(login))
        tab.url += '/typed'
        store.dispatch('persistCollectionItem', tab)
        await settled('Login.json')
        expect(vi.mocked(updateCollection).mock.calls[0][3]).toBe('v1')

        tab.url += '/more'
        vi.mocked(getCollectionForWorkspace).mockResolvedValue(readResult([request('Login.json')], { 'Login.json': 'v2' }) as never)
        await store.dispatch('refreshWorkspaceCollection')

        expect(toRaw(store.state.collection[0])).toBe(toRaw(tab))
        expect(store.state.collection[0].url).toBe('https://api.example/login/typed/more')
    })

    test('a refused save tells the user once and reloads the workspace once', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        vi.mocked(updateCollection).mockResolvedValue(changedOutside)
        vi.mocked(getWorkspacePlugins).mockResolvedValue([])
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValue(read.promise as never)

        store.dispatch('persistCollectionItem', login)
        await settled('Login.json')
        // an edit made while the reload reads is refused again from the same stale object
        store.dispatch('persistCollectionItem', login)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(2))
        read.release(readResult([], {}))
        await settled('Login.json')

        expect(errorToasts()).toEqual([changedOutsideToast])
        expect(getCollectionForWorkspace).toHaveBeenCalledOnce()
    })

    test('a save refused for a workspace no longer shown is told without reloading the one shown', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        vi.mocked(updateCollection).mockResolvedValue(changedOutside)
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())
        store.state.activeWorkspace = { _id: 'other-workspace', _type: 'file', name: 'Other' } as Workspace

        store.dispatch('persistCollectionItem', login)
        await settled('Login.json')

        expect(emitter.emit).toHaveBeenCalledWith('error', 'Login changed outside Restfox, so your last edit to it was not saved.')
        expect(getCollectionForWorkspace).not.toHaveBeenCalled()
    })

    test('a failed save is told once until a save of the item goes through, and each failure reaches Logs', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        vi.mocked(updateCollection)
            .mockRejectedValueOnce(new Error('EPERM: operation not permitted'))
            .mockResolvedValueOnce({ error: 'Not saved, as Login.json cannot be read' })
            .mockResolvedValueOnce({ error: null, version: 'v2' })
            .mockRejectedValueOnce(new Error('ENOSPC: no space left on device'))

        for(let i = 0; i < 4; i++) {
            store.dispatch('persistCollectionItem', login)
            await settled('Login.json')
        }

        expect(errorToasts()).toEqual([
            'Login could not be saved: EPERM: operation not permitted',
            'Login could not be saved: ENOSPC: no space left on device',
        ])
        expect(console.error).toHaveBeenCalledWith('Login could not be saved: Not saved, as Login.json cannot be read')
    })

    test('a reload keeps an item whose file it read unchanged, with what the user typed, and replaces one changed outside', async() => {
        const [login, other] = open(request('Login.json'), request('Other.json', 'https://api.example/other'))
        setVersion('Login.json', 'login-v1')
        setVersion('Other.json', 'other-v1')
        login.url += '/typed-while-reading'
        vi.mocked(getCollectionForWorkspace).mockResolvedValue(readResult([request('Login.json'), request('Other.json', 'https://api.example/changed-outside')], { 'Login.json': 'login-v1', 'Other.json': 'other-outside' }) as never)

        await store.dispatch('refreshWorkspaceCollection')

        expect(store.state.collection[0]).toBe(login)
        expect(store.state.collection[0].url).toBe('https://api.example/login/typed-while-reading')
        expect(store.state.collection[1]).not.toBe(other)
        expect(store.state.collection[1].url).toBe('https://api.example/changed-outside')
        expect(versionOf('Other.json')).toBe('other-outside')
    })

    test('a reload keeps an item it read before a later save of it, and one it renamed, each with the version the page holds now', async() => {
        const [login, renamed] = open(request('Login.json'), request('Old.json'))
        setVersion('Login.json', 'v1')
        setVersion('Old.json', 'renamed-v1')
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValue(read.promise as never)
        vi.mocked(updateCollection).mockResolvedValue({ error: null, version: 'v2' })

        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        login.url += '/typed'
        store.dispatch('persistCollectionItem', login)
        await settled('Login.json')

        read.release(readResult([request('Login.json'), request('New.json')], { 'Login.json': 'v1', 'New.json': 'renamed-v1' }, new Map([['Login.json', 'Login.json'], ['Old.json', 'New.json']])))
        await reload

        expect(store.state.collection[0]).toBe(login)
        expect(store.state.collection[1]).toBe(renamed)
        expect(renamed._id).toBe('New.json')
        expect(renamed.name).toBe('New')
        expect(vi.mocked(updateCollection).mock.calls[0][2].url).toBe('https://api.example/login/typed')
        // the read came before the save, whose version the page keeps, so the next save is not refused
        expect(versionOf('Login.json')).toBe('v2')
        expect(versionOf('New.json')).toBe('renamed-v1')
        expect(versionOf('Old.json')).toBe(null)
    })

    test.each(['reply first', 'read first'])('a reload waits for a save asked for before its read returned, so the save\'s reply is not taken for an outside change (%s)', async(order) => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        const reply = held<UpdateCollectionResult>()
        const read = heldRead()
        vi.mocked(updateCollection).mockReturnValueOnce(reply.promise).mockResolvedValue({ error: null, version: 'v3' })
        vi.mocked(getCollectionForWorkspace).mockReturnValue(read.promise as never)

        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        // asked for after the reload began, and run by the server before the read, so the read has its version
        store.dispatch('persistCollectionItem', login)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        if(order === 'reply first') {
            reply.release({ error: null, version: 'v2' })
            await settled('Login.json')
            read.release(readResult([request('Login.json')], { 'Login.json': 'v2' }))
        } else {
            read.release(readResult([request('Login.json')], { 'Login.json': 'v2' }))
            await new Promise(resolve => setTimeout(resolve, 0))
            reply.release({ error: null, version: 'v2' })
        }
        await reload
        login.url += '/next'
        store.dispatch('persistCollectionItem', login)
        await settled('Login.json')

        expect(store.state.collection[0]).toBe(login)
        expect(vi.mocked(updateCollection).mock.calls[1][3]).toBe('v2')
        expect(errorToasts()).toEqual([])
    })

    test('a reload whose read fails, such as on a network share gone for a moment, keeps what the page shows and tells the user', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        vi.mocked(getWorkspacePlugins).mockResolvedValue([])
        vi.mocked(getCollectionForWorkspace).mockResolvedValue({ error: { message: 'EIO: i/o error' }, collection: [], workspace: null, idMap: null } as never)

        await store.dispatch('refreshWorkspace')

        expect(store.state.collection).toEqual([login])
        expect(store.state.tabs).toEqual([login])
        expect(versionOf('Login.json')).toBe('v1')
        expect(errorToasts()).toEqual(['The workspace could not be reloaded: EIO: i/o error'])
    })

    test.each(['answers with an error', 'rejects, as on a lost connection'])('a save refused again after the reload it caused failed reloads again, when the read %s', async(failure) => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        vi.mocked(updateCollection).mockResolvedValue(changedOutside)
        vi.mocked(getWorkspacePlugins).mockResolvedValue([])
        if(failure === 'answers with an error') {
            vi.mocked(getCollectionForWorkspace).mockResolvedValueOnce({ error: { message: 'EIO: i/o error' }, collection: [], workspace: null, idMap: null } as never)
        } else {
            vi.mocked(getCollectionForWorkspace).mockRejectedValueOnce(new Error('EIO: i/o error'))
        }
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())

        store.dispatch('persistCollectionItem', login)
        await vi.waitFor(() => expect(errorToasts()).toContain('The workspace could not be reloaded: EIO: i/o error'))
        login.url += '/typed'
        store.dispatch('persistCollectionItem', login)
        await settled('Login.json')

        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledTimes(2))
        expect(errorToasts().filter(message => message === changedOutsideToast)).toHaveLength(2)
    })

    test('a reload whose workspace the user left while it waited changes nothing', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        const reply = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockReturnValue(reply.promise)
        vi.mocked(getCollectionForWorkspace).mockResolvedValue(readResult([request('Login.json', 'https://api.example/changed-outside')], { 'Login.json': 'outside' }) as never)

        store.dispatch('persistCollectionItem', login)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        const shownCollection = store.state.collection
        store.state.activeWorkspace = { _id: 'other-workspace', _type: 'file', name: 'Other' } as Workspace
        reply.release({ error: null, version: 'v2' })
        await reload

        expect(store.state.collection).toBe(shownCollection)
    })

    test('a reload during which the workspace was loaded again, as after leaving it and coming back, changes nothing', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValue(read.promise as never)

        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        // the load App.vue makes when the workspace is opened again, which read the file after this reload did
        loadItemVersions('workspace-id', { 'Login.json': 'v2' })
        read.release(readResult([request('Login.json', 'https://api.example/older-read')], { 'Login.json': 'outside' }))
        await reload

        expect(store.state.collection[0]).toBe(login)
        expect(versionOf('Login.json')).toBe('v2')
    })

    test('a sort order merged into an item file is taken where the page held the version before it, and a file changed outside reloads', async() => {
        const [login, other] = open(request('Login.json'), request('Other.json'))
        store.state.collectionTree = [login, other]
        setVersion('Login.json', 'login-v1')
        setVersion('Other.json', 'other-v1')
        vi.mocked(createCollection).mockResolvedValueOnce({ error: null, oldCollectionId: 'n', newCollectionId: 'New.json', version: 'new-v1' })
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())
        vi.mocked(updateCollection).mockImplementation(async(_workspaceId, collectionId) => ({
            'New.json': { error: null, versionBefore: 'new-v1', version: 'new-v2' },
            'Login.json': { error: null, versionBefore: 'login-v1', version: 'login-v2' },
            // the file had a change made outside Restfox, which the page lacks
            'Other.json': { error: null, versionBefore: 'other-outside', version: 'other-v2' },
        })[collectionId as string] as UpdateCollectionResult)

        // the new request opens in a tab, which loads its history and scrolls the tab bar
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        vi.stubGlobal('document', {
            querySelector: () => null,
        })

        await store.dispatch('createCollectionItem', { type: 'request', name: 'New', method: 'GET', mimeType: 'No Body', parentId: null })
        await settled('New.json', 'Login.json', 'Other.json')

        expect(versionOf('New.json')).toBe('new-v2')
        expect(versionOf('Login.json')).toBe('login-v2')
        expect(versionOf('Other.json')).toBe('other-v1')
        // the merge hid the outside change from the watcher, so the workspace reloads to show it
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
    })

    test('a merge into an item whose version the page does not hold, such as a folder, reloads nothing', async() => {
        const folder = { _id: 'Folder', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: 'workspace-id', headers: [] } as unknown as CollectionItem
        open(folder)
        vi.mocked(updateCollection).mockResolvedValue({ error: null, versionBefore: 'f1', version: 'f2' })

        await store.dispatch('updateCollectionItem', { collectionId: 'Folder', name: 'Folder', parentId: null, headers: [{ name: 'X', value: '1' }], authentication: undefined })

        expect(vi.mocked(updateCollection).mock.calls[0].slice(0, 3)).toEqual(['workspace-id', 'Folder', { headers: [{ name: 'X', value: '1' }] }])
        expect(getCollectionForWorkspace).not.toHaveBeenCalled()
    })

    test('a merge whose write fails, such as to a read-only file, tells the user', async() => {
        open(request('Login.json'))
        setVersion('Login.json', 'v1')
        vi.mocked(updateCollection).mockRejectedValue(new Error('EPERM: operation not permitted'))

        const result = await store.dispatch('updateCollectionItem', { collectionId: 'Login.json', name: 'Login', parentId: null, headers: [{ name: 'X', value: '1' }] })

        expect(result.error).toBe('EPERM: operation not permitted')
        expect(errorToasts()).toEqual(['EPERM: operation not permitted'])
    })

    test('a merge into a file deleted outside Restfox tells the user and reloads', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        vi.mocked(updateCollection).mockResolvedValue(changedOutside)
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())

        await store.dispatch('updateCollectionItem', { collectionId: 'Login.json', name: login.name, parentId: null, headers: [{ name: 'X', value: '1' }], authentication: undefined })

        expect(errorToasts()).toEqual([changedOutside.error])
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
    })

    test('Properties, which sends no headers or authentication, puts back none it opened with over ones a reload brought in', async() => {
        const login = { ...request('Login.json'), headers: [{ name: 'X-Outside', value: '1' }], authentication: { type: 'bearer', token: 'outside' } } as CollectionItem
        open(login)
        vi.mocked(updateCollection).mockResolvedValue({ error: null })
        vi.mocked(getWorkspacePlugins).mockResolvedValue([])
        vi.mocked(getCollectionForWorkspace).mockResolvedValue(readResult([{ ...login, _id: 'Renamed.json', name: 'Renamed' }], { 'Renamed.json': 'v1' }) as never)

        await store.dispatch('updateCollectionItem', { collectionId: 'Login.json', name: 'Renamed', parentId: null })

        expect(vi.mocked(updateCollection).mock.calls).toEqual([['workspace-id', 'Login.json', { name: 'Renamed' }]])
    })

    test('a request created while a reload reads stays, with its tab, when the reload read before it was made', async() => {
        const [login] = open(request('Login.json'))
        store.state.collectionTree = [login]
        setVersion('Login.json', 'v1')
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValueOnce(read.promise as never).mockReturnValue(pendingRead())
        vi.mocked(createCollection).mockResolvedValueOnce({ error: null, oldCollectionId: 'n', newCollectionId: 'New.json', version: 'new-v1' })
        vi.mocked(updateCollection).mockResolvedValue({ error: null })
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        vi.stubGlobal('document', {
            querySelector: () => null,
        })

        vi.mocked(getWorkspacePlugins).mockResolvedValue([])

        const reload = store.dispatch('refreshWorkspace')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        await store.dispatch('createCollectionItem', { type: 'request', name: 'New', method: 'GET', mimeType: 'No Body', parentId: null })
        read.release(readResult([request('Login.json')], { 'Login.json': 'v1' }, new Map([['Login.json', 'Login.json']])))
        await reload

        expect(store.state.collection.map(item => item._id)).toEqual(['Login.json', 'New.json'])
        expect(store.state.tabs.map(tab => tab._id)).toContain('New.json')
    })

    test('a request deleted while a reload reads stays gone when the reload read it before the delete', async() => {
        const [login, other] = open(request('Login.json'), request('Other.json'))
        setVersion('Login.json', 'v1')
        setVersion('Other.json', 'o1')
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValueOnce(read.promise as never).mockReturnValue(pendingRead())
        vi.mocked(deleteCollectionsByIds).mockResolvedValue({ error: null } as never)

        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        await store.dispatch('deleteCollectionItem', other)
        read.release(readResult([request('Login.json'), request('Other.json')], { 'Login.json': 'v1', 'Other.json': 'o1' }))
        await reload

        expect(store.state.collection.map(item => item._id)).toEqual(['Login.json'])
        expect(store.state.collection[0]).toBe(login)
    })

    test('a request renamed and then deleted while the rename\'s reload reads stays gone under its new id', async() => {
        const [login, old] = open(request('Login.json'), request('Old.json'))
        setVersion('Login.json', 'v1')
        setVersion('Old.json', 'o1')
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValueOnce(read.promise as never).mockReturnValue(pendingRead())
        vi.mocked(deleteCollectionsByIds).mockResolvedValue({ error: null } as never)

        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        // deleted under the id it had, which the server keeps for the renamed file
        await store.dispatch('deleteCollectionItem', old)
        read.release(readResult([request('Login.json'), request('New.json')], { 'Login.json': 'v1', 'New.json': 'o1' }, new Map([['Login.json', 'Login.json'], ['Old.json', 'New.json']])))
        await reload

        expect(store.state.collection.map(item => item._id)).toEqual(['Login.json'])
        expect(store.state.collection[0]).toBe(login)
    })

    test('a request deleted while the reload a rename asked for reads goes, whichever ends first', async() => {
        for(const order of ['reload first', 'delete first']) {
            loadItemVersions('workspace-id', {})
            vi.mocked(getCollectionForWorkspace).mockReset()
            const [old] = open(request('Old.json'))
            setVersion('Old.json', 'o1')
            const read = heldRead()
            vi.mocked(getCollectionForWorkspace).mockReturnValueOnce(read.promise as never).mockReturnValue(pendingRead())
            const deleteReply = held<{ error: null }>()
            vi.mocked(deleteCollectionsByIds).mockReturnValueOnce(deleteReply.promise as never)

            const reload = store.dispatch('refreshWorkspaceCollection')
            await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
            const deleted = store.dispatch('deleteCollectionItem', old)
            await vi.waitFor(() => expect(deleteCollectionsByIds).toHaveBeenCalled())
            const readRenamed = readResult([request('New.json')], { 'New.json': 'o1' }, new Map([['Old.json', 'New.json']]))
            if(order === 'reload first') {
                read.release(readRenamed)
                await reload
                expect(old._id).toBe('New.json')
                deleteReply.release({ error: null })
                await deleted
            } else {
                deleteReply.release({ error: null })
                await deleted
                read.release(readRenamed)
                await reload
            }

            expect(store.state.collection).toEqual([])
            expect(store.state.tabs).toEqual([])
            expect(versionOf('New.json')).toBe(null)
            vi.mocked(deleteCollectionsByIds).mockReset()
        }
    })

    test('a request whose reload applies while its delete still clears its history goes under its new id', async() => {
        const [old] = open(request('Old.json'))
        setVersion('Old.json', 'o1')
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValueOnce(read.promise as never).mockReturnValue(pendingRead())
        const history = held<void>()
        vi.mocked(deleteResponsesByCollectionIds).mockReturnValueOnce(history.promise as never)
        vi.mocked(deleteCollectionsByIds).mockResolvedValueOnce({ error: null } as never)

        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        const deleted = store.dispatch('deleteCollectionItem', old)
        await vi.waitFor(() => expect(deleteResponsesByCollectionIds).toHaveBeenCalled())
        read.release(readResult([request('New.json')], { 'New.json': 'o1' }, new Map([['Old.json', 'New.json']])))
        await reload
        history.release()
        await deleted

        expect(store.state.collection).toEqual([])
        expect(store.state.tabs).toEqual([])
        expect(versionOf('New.json')).toBe(null)
    })

    test('a folder deleted while the reload its rename asked for reads goes when the reload applies first', async() => {
        const folder = (id: string) => ({ _id: id, _type: 'request_group', name: id, parentId: null, workspaceId: 'workspace-id' }) as unknown as CollectionItem
        const [old] = open(folder('Old'))
        store.state.tabs = []
        store.state.activeTab = null
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValueOnce(read.promise as never).mockReturnValue(pendingRead())
        const deleteReply = held<{ error: null }>()
        vi.mocked(deleteCollectionsByIds).mockReturnValueOnce(deleteReply.promise as never)

        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        const deleted = store.dispatch('deleteCollectionItem', old)
        await vi.waitFor(() => expect(deleteCollectionsByIds).toHaveBeenCalled())
        read.release(readResult([folder('New')], {}, new Map([['Old', 'New']])))
        await reload
        deleteReply.release({ error: null })
        await deleted

        expect(store.state.collection).toEqual([])
    })

    test('a reload keeps the tab of an item it read at the same id when the server\'s map lacks that id, as after a restart', async() => {
        const [first, second] = open(request('A.json'), request('C.json'))
        setVersion('A.json', 'a1')
        setVersion('C.json', 'c1')
        Object.assign(store.state.activeWorkspace as Workspace, { tabIds: ['A.json', 'C.json'], activeTabId: 'C.json' })
        vi.mocked(getWorkspacePlugins).mockResolvedValue([])
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        vi.stubGlobal('document', {
            querySelector: () => null,
        })
        vi.mocked(getCollectionForWorkspace).mockResolvedValue(readResult([request('A2.json'), request('C.json')], { 'A2.json': 'a1', 'C.json': 'c1' }, new Map([['A.json', 'A2.json']])) as never)

        await store.dispatch('refreshWorkspace')

        expect(store.state.tabs.map(tab => tab._id)).toEqual(['A2.json', 'C.json'])
        expect(toRaw(store.state.tabs[1])).toBe(toRaw(second))
        expect(first._id).toBe('A2.json')
    })

    test('a new request created at the id of one whose file was deleted outside replaces it, so the old tab cannot save over it', async() => {
        const [old] = open(request('New.json', 'https://api.example/old'))
        store.state.collectionTree = [old]
        setVersion('New.json', 'old-v1')
        vi.mocked(createCollection).mockResolvedValueOnce({ error: null, oldCollectionId: 'n', newCollectionId: 'New.json', version: 'new-v1' })
        vi.mocked(updateCollection).mockImplementation(async() => ({ error: null, versionBefore: 'new-v1', version: 'new-v2' }))
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        vi.stubGlobal('document', {
            querySelector: () => null,
        })

        await store.dispatch('createCollectionItem', { type: 'request', name: 'New', method: 'POST', mimeType: 'No Body', parentId: null })
        await settled('New.json')

        expect(store.state.collection).toHaveLength(1)
        expect(toRaw(store.state.collection[0])).not.toBe(toRaw(old))
        expect(store.state.collection[0].method).toBe('POST')
        expect(store.state.tabs.map(tab => toRaw(tab))).not.toContain(toRaw(old))
        expect(store.state.tabs.map(tab => tab._id)).toEqual(['New.json'])
    })

    test('a duplicate that lands at the id of one whose file was deleted outside replaces it too', async() => {
        const [source, stale] = open(request('Login.json'), request('Login (2).json', 'https://api.example/stale'))
        store.state.collectionTree = [source, stale]
        store.state.tabs = [stale]
        store.state.activeTab = stale
        setVersion('Login.json', 'v1')
        setVersion('Login (2).json', 'stale-v1')
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        vi.stubGlobal('document', {
            querySelector: () => null,
        })
        vi.mocked(createCollections).mockImplementationOnce(async(_workspaceId, collections) => ({ error: null, results: [{ error: null, oldCollectionId: collections[0]._id, newCollectionId: 'Login (2).json', version: 'dup-v1' }] }))
        vi.mocked(updateCollection).mockImplementation(async(_workspaceId, collectionId) => ({ error: null, versionBefore: collectionId === 'Login.json' ? 'v1' : 'dup-v1', version: `${collectionId}-merged` }))

        await store.dispatch('duplicateCollectionItem', toRaw(source))
        await settled('Login.json', 'Login (2).json')

        expect(store.state.collection.filter(item => item._id === 'Login (2).json')).toHaveLength(1)
        expect(store.state.collection.find(item => item._id === 'Login (2).json')?.url).toBe('https://api.example/login')
        expect(store.state.tabs.map(tab => toRaw(tab))).not.toContain(toRaw(stale))
    })

    test('a folder\'s headers go from the version the page holds', async() => {
        const folder = { _id: 'Folder', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: 'workspace-id', headers: [] } as unknown as CollectionItem
        open(folder)
        setVersion('Folder', 'f1')
        vi.mocked(updateCollection).mockResolvedValue({ error: null, versionBefore: 'f1', version: 'f2' })

        await store.dispatch('updateCollectionItem', { collectionId: 'Folder', name: 'Folder', parentId: null, headers: [{ name: 'X', value: '1' }] })

        expect(vi.mocked(updateCollection).mock.calls[0][3]).toBe('f1')
        expect(versionOf('Folder')).toBe('f2')
    })

    test('a folder\'s auth refused as changed outside leaves the page as it was', async() => {
        const folder = { _id: 'Folder', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: 'workspace-id', authentication: { type: 'page' } } as unknown as CollectionItem
        open(folder)
        setVersion('Folder', 'f1')
        vi.mocked(updateCollection).mockResolvedValue(changedOutside)
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())

        await store.dispatch('updateCollectionItem', { collectionId: 'Folder', name: 'Folder', parentId: null, authentication: { type: 'refused' } })

        expect(store.state.collection[0].authentication).toEqual({ type: 'page' })
    })

    test('a folder\'s sort order goes with no version, as it replaces nothing else in the file', async() => {
        const folder = (id: string, sortOrder: number) => ({ _id: id, _type: 'request_group', name: id, parentId: null, workspaceId: 'workspace-id', sortOrder }) as unknown as CollectionItem
        const [first, second] = open(folder('A', 0), folder('B', 1))
        store.state.collectionTree = [first, second]
        setVersion('A', 'a1')
        setVersion('B', 'b1')
        vi.mocked(updateCollection).mockResolvedValue({ error: null })
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())

        await store.dispatch('reorderCollectionItem', { from: { id: 'B', parentId: null }, to: { id: 'A', parentId: null, type: 'request_group', cursorPosition: 'top' } })

        const merges = vi.mocked(updateCollection).mock.calls.filter(call => 'sortOrder' in call[2])
        expect(merges.length).toBeGreaterThan(0)
        expect(merges.every(call => call[3] === undefined)).toBe(true)
    })

    test('a folder\'s headers refused as changed outside tell the user and reload', async() => {
        const folder = { _id: 'Folder', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: 'workspace-id', headers: [] } as unknown as CollectionItem
        open(folder)
        setVersion('Folder', 'f1')
        vi.mocked(updateCollection).mockResolvedValue(changedOutside)
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())

        await store.dispatch('updateCollectionItem', { collectionId: 'Folder', name: 'Folder', parentId: null, headers: [{ name: 'X', value: '1' }] })

        expect(errorToasts()).toEqual(['Folder changed outside Restfox and was reloaded. Your last edit to it was not saved.'])
        expect(store.state.collection[0].headers).toEqual([])
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
    })

    test('a reload replaces a folder\'s object and takes the version it read, unless a save since holds a newer one', async() => {
        const folder = { _id: 'Folder', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: 'workspace-id' } as unknown as CollectionItem
        const [shown] = open(folder)
        setVersion('Folder', 'f1')
        // what a folder's version leaves out, such as its environments, can change with the version the same
        vi.mocked(getCollectionForWorkspace).mockResolvedValueOnce({ collection: [{ ...folder, currentEnvironment: 'Outside' }], workspace: null, idMap: null, versions: { Folder: 'f1' } } as never)
        await store.dispatch('refreshWorkspaceCollection')
        expect(store.state.collection[0]).not.toBe(shown)
        expect(store.state.collection[0].currentEnvironment).toBe('Outside')
        vi.mocked(getCollectionForWorkspace).mockResolvedValueOnce({ collection: [{ ...folder }], workspace: null, idMap: null, versions: { Folder: 'outside' } } as never)
        await store.dispatch('refreshWorkspaceCollection')
        expect(versionOf('Folder')).toBe('outside')

        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValueOnce(read.promise as never)
        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledTimes(2))
        setVersion('Folder', 'saved-since')
        // a save's fields go onto every open object of the item
        shown.headers = [{ name: 'X-Typed', value: 'saved' }]
        store.state.collection[0].headers = shown.headers
        read.release({ collection: [{ ...folder, headers: [{ name: 'X-Read', value: 'older' }] }], workspace: null, idMap: null, versions: { Folder: 'outside' } })
        await reload
        expect(versionOf('Folder')).toBe('saved-since')
        expect(store.state.collection[0].headers).toEqual([{ name: 'X-Typed', value: 'saved' }])
        // a drag and Duplicate clone the raw items
        expect(() => structuredClone(toRaw(store.state.collection[0]))).not.toThrow()
    })

    test('a folder\'s late reply leaves a tab of the same id in another workspace', async() => {
        const folder = { _id: 'Folder', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: 'workspace-id', headers: [] } as unknown as CollectionItem
        open(folder)
        setVersion('Folder', 'f1')
        const save = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockReturnValueOnce(save.promise)
        const saving = store.dispatch('updateCollectionItem', { collectionId: 'Folder', name: 'Folder', parentId: null, headers: [{ name: 'X', value: '1' }] })
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())

        const otherTab = { ...folder, workspaceId: 'other-workspace' }
        store.state.tabs = [otherTab]
        save.release({ error: null, versionBefore: 'f1', version: 'f2' })
        await saving

        expect(store.state.tabs[0].workspaceId).toBe('other-workspace')
        expect(store.state.tabs[0].headers).toEqual([])
    })

    test('a reload waits for a folder\'s save asked for while it waited for an earlier one', async() => {
        const folder = { _id: 'Folder', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: 'workspace-id', headers: [] } as unknown as CollectionItem
        open(folder)
        setVersion('Folder', 'f1')
        const first = held<UpdateCollectionResult>()
        const second = held<UpdateCollectionResult>()
        const third = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValueOnce(read.promise as never)
        const reload = store.dispatch('refreshWorkspaceCollection')
        let reloadEnded = false
        reload.then(() => reloadEnded = true)
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        const typed = store.dispatch('updateCollectionItem', { collectionId: 'Folder', name: 'Folder', parentId: null, headers: [{ name: 'X', value: '1' }] })
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        read.release({ collection: [{ ...folder }], workspace: null, idMap: null, versions: { Folder: 'f1' } })
        await flushPromises()
        const typedMore = store.dispatch('updateCollectionItem', { collectionId: 'Folder', name: 'Folder', parentId: null, headers: [{ name: 'X', value: '12' }] })
        await flushPromises()

        first.release({ error: null, versionBefore: 'f1', version: 'f2' })
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(2))
        await flushPromises()
        // replaced now, the Folder panel would go back to the text of the first save
        expect(reloadEnded).toBe(false)
        const typedLast = store.dispatch('updateCollectionItem', { collectionId: 'Folder', name: 'Folder', parentId: null, headers: [{ name: 'X', value: '123' }] })
        await flushPromises()
        second.release({ error: null, versionBefore: 'f2', version: 'f3' })
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(3))
        await flushPromises()
        expect(reloadEnded).toBe(false)
        third.release({ error: null, versionBefore: 'f3', version: 'f4' })
        await reload
        await typed
        await typedMore
        await typedLast

        expect(store.state.collection[0].headers).toEqual([{ name: 'X', value: '123' }])
        expect(versionOf('Folder')).toBe('f4')
    })

    test('a folder\'s refused keystrokes are one message and one reload', async() => {
        const folder = { _id: 'Folder', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: 'workspace-id', headers: [] } as unknown as CollectionItem
        open(folder)
        setVersion('Folder', 'f1')
        vi.mocked(updateCollection).mockResolvedValue(changedOutside)
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())

        await store.dispatch('updateCollectionItem', { collectionId: 'Folder', name: 'Folder', parentId: null, headers: [{ name: 'X', value: '1' }] })
        await store.dispatch('updateCollectionItem', { collectionId: 'Folder', name: 'Folder', parentId: null, headers: [{ name: 'X', value: '12' }] })

        expect(errorToasts()).toEqual(['Folder changed outside Restfox and was reloaded. Your last edit to it was not saved.'])
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
    })

    test('a folder\'s field asked for before a reload brought an outside change goes with the version it was made from', async() => {
        const folder = { _id: 'Folder', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: 'workspace-id', headers: [] } as unknown as CollectionItem
        const [, login] = open(folder, request('Login.json'))
        setVersion('Folder', 'f1')
        setVersion('Login.json', 'l1')
        // a save of another item the reload waits for, so the folder's saves are asked for before it applies
        const loginSave = held<UpdateCollectionResult>()
        const headersSave = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockReturnValueOnce(loginSave.promise).mockReturnValueOnce(headersSave.promise).mockResolvedValue({ error: null })
        store.dispatch('persistCollectionItem', login)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        vi.mocked(getCollectionForWorkspace).mockResolvedValueOnce({ collection: [{ ...folder }, request('Login.json')], workspace: null, idMap: null, versions: { Folder: 'outside', 'Login.json': 'l1' } } as never).mockReturnValue(pendingRead())
        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        await flushPromises()
        const headers = store.dispatch('updateCollectionItem', { collectionId: 'Folder', name: 'Folder', parentId: null, headers: [{ name: 'X', value: '1' }] })
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(2))
        const authentication = store.dispatch('updateCollectionItem', { collectionId: 'Folder', name: 'Folder', parentId: null, authentication: { type: 'stale' } })
        await flushPromises()
        loginSave.release({ error: null, version: 'l1' })
        await flushPromises()
        headersSave.release({ error: null })
        await reload
        await headers
        await authentication
        await settled('Folder', 'Login.json')

        expect(vi.mocked(updateCollection).mock.calls.filter(call => 'authentication' in call[2]).map(call => call[3])).toEqual(['f1'])
    })

    describe('a request\'s script in a file workspace', () => {
        const code = (text: string) => ({ pre_request: text, post_request: '' })
        const script = (text: string) => ({ _id: 'p1', type: 'script', name: null, code: code(text), workspaceId: null, collectionId: 'Login.json', enabled: true, createdAt: 0, updatedAt: 0 }) as unknown as Plugin

        beforeEach(() => {
            vi.mocked(updatePlugin).mockReset()
            vi.mocked(getWorkspacePlugins).mockResolvedValue([])
        })

        test('a save goes from the code the text was typed on, and the next edit from what that save leaves', async() => {
            store.state.plugins.workspace = [script('file')]
            const first = held<undefined>()
            vi.mocked(updatePlugin).mockReturnValueOnce(first.promise).mockResolvedValue(undefined)

            const saving = store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('a'), basedOn: code('file') })
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledOnce())
            expect(store.state.plugins.workspace[0].code).toEqual(code('a'))
            const next = store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('b'), basedOn: toRaw(store.state.plugins.workspace[0].code) })
            await Promise.resolve()
            expect(updatePlugin).toHaveBeenCalledOnce()
            first.release(undefined)
            await saving
            await next

            expect(vi.mocked(updatePlugin).mock.calls.map(call => call[4])).toEqual([code('file'), code('a')])
        })

        test('a refused save tells the user and reads the scripts again', async() => {
            store.state.plugins.workspace = [script('file')]
            vi.mocked(updatePlugin).mockResolvedValue({ error: 'x', changedOutside: true })

            const saved = await store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('stale'), basedOn: code('older') })

            expect(saved).toBe(false)
            expect(vi.mocked(updatePlugin).mock.calls[0][4]).toEqual(code('older'))
            expect(errorToasts()).toEqual(['This script changed outside Restfox and was reloaded. Your last change to it was not saved.'])
            await vi.waitFor(() => expect(getWorkspacePlugins).toHaveBeenCalled())
        })

        test('a failed save puts the code back', async() => {
            store.state.plugins.workspace = [script('file')]
            vi.mocked(updatePlugin).mockRejectedValue(new Error('EPERM'))

            await store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('typed'), basedOn: code('file') })

            expect(store.state.plugins.workspace[0].code).toEqual(code('file'))
        })

        test('a failed save leaves alone the text of a later edit', async() => {
            store.state.plugins.workspace = [script('file')]
            const first = held<undefined>()
            const second = held<undefined>()
            vi.mocked(updatePlugin).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

            const saving = store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('a'), basedOn: code('file') })
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledOnce())
            const next = store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('b'), basedOn: code('a') })
            first.reject(new Error('EPERM'))
            await saving

            expect(store.state.plugins.workspace[0].code).toEqual(code('b'))
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledTimes(2))
            second.release(undefined)
            await next
        })

        test('a save asked for while the scripts are read keeps its text over what was read', async() => {
            store.state.plugins.workspace = [script('file')]
            const read = held<Plugin[]>()
            vi.mocked(getWorkspacePlugins).mockReturnValueOnce(read.promise)
            vi.mocked(updatePlugin).mockResolvedValue(undefined)

            store.commit('loadWorkspacePlugins')
            await store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('typed'), basedOn: code('file') })
            read.release([script('file')])
            await vi.waitFor(() => expect(toRaw(store.state.plugins.workspace[0])).not.toBe(undefined))
            await flushPromises()

            expect(store.state.plugins.workspace[0].code).toEqual(code('typed'))
        })

        test('a save already queued when the scripts are read reaches the storage before the read', async() => {
            store.state.plugins.workspace = [script('file')]
            const first = held<undefined>()
            vi.mocked(updatePlugin).mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
            vi.mocked(getWorkspacePlugins).mockResolvedValue([script('second')])

            const saving = store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('first'), basedOn: code('file') })
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledOnce())
            const next = store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('second'), basedOn: code('first') })
            store.commit('loadWorkspacePlugins')
            await flushPromises()
            expect(getWorkspacePlugins).not.toHaveBeenCalled()
            first.release(undefined)
            await saving
            await next
            await vi.waitFor(() => expect(getWorkspacePlugins).toHaveBeenCalledOnce())
            await flushPromises()

            expect(vi.mocked(updatePlugin).mock.calls.map(call => call[1].code)).toEqual([code('first'), code('second')])
            expect(store.state.plugins.workspace[0].code).toEqual(code('second'))
        })

        test('a first script still being created when the scripts are read reaches the storage before the read', async() => {
            store.state.plugins.workspace = []
            const created = held<undefined>()
            vi.mocked(createPlugin).mockReturnValueOnce(created.promise as never)

            const saving = store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('first') })
            await vi.waitFor(() => expect(createPlugin).toHaveBeenCalledOnce())
            const madePlugin = store.state.plugins.workspace[0]
            store.commit('loadWorkspacePlugins')
            await flushPromises()
            expect(getWorkspacePlugins).not.toHaveBeenCalled()
            vi.mocked(getWorkspacePlugins).mockResolvedValue([{ ...toRaw(madePlugin) }])
            created.release(undefined)
            await saving
            await vi.waitFor(() => expect(getWorkspacePlugins).toHaveBeenCalledOnce())
            await flushPromises()

            expect(store.state.plugins.workspace.map(plugin => plugin.code)).toEqual([code('first')])
        })

        test('a script typed before the workspace was left is not saved into the one shown', async() => {
            store.state.plugins.workspace = [script('file')]
            vi.mocked(updatePlugin).mockResolvedValue(undefined)

            const saved = await store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('typed'), basedOn: code('file'), typedInWorkspaceId: 'left' })

            expect(saved).toBe(false)
            expect(updatePlugin).not.toHaveBeenCalled()
            expect(store.state.plugins.workspace[0].code).toEqual(code('file'))
        })

        test('a script typed before the workspaces list was opened is dropped without an error', async() => {
            const workspace = store.state.activeWorkspace
            store.state.activeWorkspace = null
            const saved = await store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('typed'), basedOn: code('file'), typedInWorkspaceId: 'workspace-id' })
            store.state.activeWorkspace = workspace
            expect(saved).toBe(false)
        })

        test('a first script made while the scripts are read stays', async() => {
            store.state.plugins.workspace = []
            const read = held<Plugin[]>()
            vi.mocked(getWorkspacePlugins).mockReturnValueOnce(read.promise)
            vi.mocked(createPlugin).mockResolvedValue(undefined as never)

            store.commit('loadWorkspacePlugins')
            await flushPromises()
            await store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('first') })
            read.release([])
            await flushPromises()

            expect(store.state.plugins.workspace.map(plugin => plugin.code)).toEqual([code('first')])
        })

        test('saves of a script stay in one queue across a load of the workspace', async() => {
            store.state.plugins.workspace = [script('file')]
            const first = held<undefined>()
            vi.mocked(updatePlugin).mockReturnValueOnce(first.promise).mockResolvedValue(undefined)

            const saving = store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('first'), basedOn: code('file') })
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledOnce())
            loadItemVersions('workspace-id', {})
            const next = store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('second'), basedOn: code('first') })
            await flushPromises()
            expect(updatePlugin).toHaveBeenCalledOnce()
            first.release(undefined)
            await saving
            await next
        })

        test('saves of a script stay in one queue when its request is renamed', async() => {
            store.state.plugins.workspace = [script('file')]
            const first = held<undefined>()
            vi.mocked(updatePlugin).mockReturnValueOnce(first.promise).mockResolvedValue(undefined)

            const saving = store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('first'), basedOn: code('file') })
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledOnce())
            store.state.plugins.workspace[0].collectionId = 'Renamed.json'
            const next = store.dispatch('saveRequestScript', { collectionId: 'Renamed.json', code: code('second'), basedOn: code('first') })
            await flushPromises()
            expect(updatePlugin).toHaveBeenCalledOnce()
            first.release(undefined)
            await saving
            await next

            expect(vi.mocked(updatePlugin).mock.calls.map(call => call[1].code)).toEqual([code('first'), code('second')])
        })

        test('an older read of the scripts ending after a newer one is dropped', async() => {
            store.state.plugins.workspace = [script('file')]
            const older = held<Plugin[]>()
            const newer = held<Plugin[]>()
            vi.mocked(getWorkspacePlugins).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

            store.commit('loadWorkspacePlugins')
            store.commit('loadWorkspacePlugins')
            await vi.waitFor(() => expect(getWorkspacePlugins).toHaveBeenCalledTimes(2))
            newer.release([script('outside')])
            await flushPromises()
            older.release([script('file')])
            await flushPromises()

            expect(store.state.plugins.workspace[0].code).toEqual(code('outside'))
        })

        test.each(['the read ends first', 'the save ends first'])('a Plugins window save while the scripts are read keeps its code, %s', async(order) => {
            store.state.plugins.workspace = [{ ...script('file'), collectionId: null, workspaceId: 'workspace-id' }]
            const read = held<Plugin[]>()
            const save = held<undefined>()
            vi.mocked(getWorkspacePlugins).mockReturnValueOnce(read.promise)
            vi.mocked(updatePlugin).mockReturnValueOnce(save.promise).mockResolvedValue(undefined)

            store.commit('loadWorkspacePlugins')
            await vi.waitFor(() => expect(getWorkspacePlugins).toHaveBeenCalledOnce())
            store.commit('updatePlugin', { _id: 'p1', name: 'n', code: code('saved'), workspaceId: 'workspace-id' })
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledOnce())
            const steps = [() => read.release([{ ...script('file'), collectionId: null, workspaceId: 'workspace-id' }]), () => save.release(undefined)]
            for(const step of order === 'the read ends first' ? steps : steps.reverse()) {
                step()
                await flushPromises()
            }
            expect(store.state.plugins.workspace[0].code).toEqual(code('saved'))

            store.commit('updatePlugin', { _id: 'p1', name: 'n', code: code('next'), workspaceId: 'workspace-id' })
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledTimes(2))
            expect(vi.mocked(updatePlugin).mock.calls[1][4]).toEqual(code('saved'))
            await flushPromises()
        })

        test('a failed save from the Plugins window puts its code back', async() => {
            store.state.plugins.workspace = [{ ...script('file'), collectionId: null, workspaceId: 'workspace-id' }]
            vi.mocked(updatePlugin).mockRejectedValue(new Error('EPERM'))

            store.commit('updatePlugin', { _id: 'p1', name: 'n', code: code('typed'), workspaceId: 'workspace-id' })
            await vi.waitFor(() => expect(errorToasts()).toEqual(['EPERM']))

            expect(store.state.plugins.workspace[0].code).toEqual(code('file'))
        })

        test('a second save from the Plugins window goes from what the first leaves', async() => {
            store.state.plugins.workspace = [{ ...script('file'), collectionId: null, workspaceId: 'workspace-id' }]
            const first = held<undefined>()
            vi.mocked(updatePlugin).mockReturnValueOnce(first.promise).mockResolvedValue(undefined)

            store.commit('updatePlugin', { _id: 'p1', name: 'n', code: code('a'), workspaceId: 'workspace-id' })
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledOnce())
            store.commit('updatePlugin', { _id: 'p1', name: 'n', code: code('b'), workspaceId: 'workspace-id' })
            await flushPromises()
            expect(updatePlugin).toHaveBeenCalledOnce()
            first.release(undefined)
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledTimes(2))

            expect(vi.mocked(updatePlugin).mock.calls[1][4]).toEqual(code('a'))
        })

        test('an earlier reply from the Plugins window leaves the code of a later save, and a third save goes from it', async() => {
            store.state.plugins.workspace = [{ ...script('file'), collectionId: null, workspaceId: 'workspace-id' }]
            const first = held<undefined>()
            const second = held<undefined>()
            vi.mocked(updatePlugin).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue(undefined)

            store.commit('updatePlugin', { _id: 'p1', name: 'n', code: code('a'), workspaceId: 'workspace-id' })
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledOnce())
            store.commit('updatePlugin', { _id: 'p1', name: 'n', code: code('b'), workspaceId: 'workspace-id' })
            first.release(undefined)
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledTimes(2))
            await flushPromises()
            expect(store.state.plugins.workspace[0].code).toEqual(code('b'))

            store.commit('updatePlugin', { _id: 'p1', name: 'n', code: code('c'), workspaceId: 'workspace-id' })
            second.release(undefined)
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledTimes(3))
            expect(vi.mocked(updatePlugin).mock.calls[2][4]).toEqual(code('b'))
            await flushPromises()
        })

        test('a failed save from the Plugins window leaves the code of a later save', async() => {
            store.state.plugins.workspace = [{ ...script('file'), collectionId: null, workspaceId: 'workspace-id' }]
            const first = held<undefined>()
            vi.mocked(updatePlugin).mockReturnValueOnce(first.promise).mockResolvedValue(undefined)

            store.commit('updatePlugin', { _id: 'p1', name: 'n', code: code('a'), workspaceId: 'workspace-id' })
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledOnce())
            store.commit('updatePlugin', { _id: 'p1', name: 'n', code: code('b'), workspaceId: 'workspace-id' })
            first.reject(new Error('EPERM'))
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledTimes(2))
            await flushPromises()

            expect(store.state.plugins.workspace[0].code).toEqual(code('b'))
        })

        test('text typed before the page knew of the script goes with no base, so the file refuses it', async() => {
            store.state.plugins.workspace = [script('file')]
            vi.mocked(updatePlugin).mockResolvedValue({ error: 'x', changedOutside: true })

            const saved = await store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('typed'), basedOn: null })

            expect(saved).toBe(false)
            expect(vi.mocked(updatePlugin).mock.calls[0][4]).toBeNull()
        })

        test.each(['saveRequestScript', 'updatePlugin'])('%s that fails after a read replaced the script puts the code back on the script shown', async(path) => {
            const shownBefore = path === 'updatePlugin' ? { ...script('file'), collectionId: null, workspaceId: 'workspace-id' } : script('file')
            store.state.plugins.workspace = [shownBefore]
            const read = held<Plugin[]>()
            const save = held<undefined>()
            vi.mocked(getWorkspacePlugins).mockReturnValueOnce(read.promise)
            vi.mocked(updatePlugin).mockReturnValueOnce(save.promise)

            store.commit('loadWorkspacePlugins')
            await vi.waitFor(() => expect(getWorkspacePlugins).toHaveBeenCalledOnce())
            if(path === 'updatePlugin') {
                store.commit('updatePlugin', { _id: 'p1', name: 'n', code: code('typed'), workspaceId: 'workspace-id' })
            } else {
                store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('typed'), basedOn: code('file') })
            }
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledOnce())
            read.release([{ ...shownBefore, code: code('file') }])
            await flushPromises()
            expect(store.state.plugins.workspace[0].code).toEqual(code('typed'))
            save.reject(new Error('EPERM'))
            await flushPromises()

            expect(store.state.plugins.workspace[0].code).toEqual(code('file'))
        })

        test('scripts read for a workspace left meanwhile are not shown', async() => {
            const workspace = store.state.activeWorkspace
            store.state.plugins.workspace = [script('other workspace')]
            const read = held<Plugin[]>()
            vi.mocked(getWorkspacePlugins).mockReturnValueOnce(read.promise)

            store.commit('loadWorkspacePlugins')
            store.state.activeWorkspace = { ...workspace, _id: 'other' } as Workspace
            read.release([script('left')])
            await flushPromises()
            store.state.activeWorkspace = workspace

            expect(store.state.plugins.workspace[0].code).toEqual(code('other workspace'))
        })

        test('a refusal after the workspace was left reads no scripts into the one shown', async() => {
            const workspace = store.state.activeWorkspace
            store.state.plugins.workspace = [script('file')]
            const save = held<{ error: string, changedOutside: boolean }>()
            vi.mocked(updatePlugin).mockReturnValueOnce(save.promise)

            const saving = store.dispatch('saveRequestScript', { collectionId: 'Login.json', code: code('typed'), basedOn: code('file') })
            await vi.waitFor(() => expect(updatePlugin).toHaveBeenCalledOnce())
            store.state.activeWorkspace = { ...workspace, _id: 'other' } as Workspace
            save.release({ error: 'x', changedOutside: true })
            await saving
            await flushPromises()
            store.state.activeWorkspace = workspace

            expect(getWorkspacePlugins).not.toHaveBeenCalled()
            expect(errorToasts()).toEqual(['This script changed outside Restfox, so your last change to it was not saved.'])
        })

        test('the Plugins window saves from the code it holds, and a refusal leaves it unchanged', async() => {
            store.state.plugins.workspace = [{ ...script('file'), collectionId: null, workspaceId: 'workspace-id' }]
            vi.mocked(updatePlugin).mockResolvedValue({ error: 'x', changedOutside: true })
            vi.mocked(getWorkspacePlugins).mockReturnValue(pendingRead() as never)

            await store.commit('updatePlugin', { _id: 'p1', name: 'n', code: code('edited'), workspaceId: 'workspace-id' })

            await vi.waitFor(() => expect(errorToasts()).toHaveLength(1))
            expect(vi.mocked(updatePlugin).mock.calls[0][4]).toEqual(code('file'))
            expect(store.state.plugins.workspace[0].code).toEqual(code('file'))
        })
    })

    test('a rename holds leaving the page until the storage has answered it', async() => {
        const [login] = open(request('Login.json'))
        const reply = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockReturnValueOnce(reply.promise)
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())

        const rename = store.dispatch('updateCollectionItemName', { ...login, name: 'Renamed' })
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        expect(itemWritesPending()).toBe(true)
        reply.release({ error: null })
        await rename
        expect(itemWritesPending()).toBe(false)
    })

    test('a rename waits for the item\'s save still running, and does not reload a workspace the user left meanwhile', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        const reply = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockReturnValueOnce(reply.promise).mockResolvedValue({ error: null })
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())

        store.dispatch('persistCollectionItem', login)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        const rename = store.dispatch('updateCollectionItemName', { ...login, name: 'Renamed' })
        await Promise.resolve()
        expect(updateCollection).toHaveBeenCalledOnce()
        store.state.activeWorkspace = { _id: 'other-workspace', _type: 'file', name: 'Other' } as Workspace
        reply.release({ error: null, version: 'v2' })
        await rename

        expect(vi.mocked(updateCollection).mock.calls[1]).toEqual(['workspace-id', 'Login.json', { name: 'Renamed' }])
        expect(getCollectionForWorkspace).not.toHaveBeenCalled()
    })

    test('a save asked for while a reload applies goes out under the id it has, and its reply reaches the renamed item', async() => {
        const [renamed, other] = open(request('Old.json'), request('Other.json'))
        setVersion('Old.json', 'v1')
        setVersion('Other.json', 'o1')
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValue(read.promise as never)
        const otherSave = held<UpdateCollectionResult>()
        const renamedSave = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockReturnValueOnce(otherSave.promise).mockReturnValueOnce(renamedSave.promise)

        // a save the reload waits for, so the rename's save below starts before the reload applies
        store.dispatch('persistCollectionItem', other)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        read.release(readResult([request('New.json'), request('Other.json')], { 'New.json': 'v1', 'Other.json': 'o2' }, new Map([['Old.json', 'New.json']])))
        await new Promise(resolve => setTimeout(resolve, 0))
        renamed.url += '/typed'
        store.dispatch('persistCollectionItem', renamed)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(2))
        // the server keeps the id from before the rename for one more scan
        expect(vi.mocked(updateCollection).mock.calls[1].slice(1, 2)).toEqual(['Old.json'])
        expect(vi.mocked(updateCollection).mock.calls[1][3]).toBe('v1')
        otherSave.release({ error: null, version: 'o2' })
        await reload
        expect(renamed._id).toBe('New.json')
        renamedSave.release({ error: null, version: 'v2' })
        await settled('New.json')

        expect(store.state.collection[0]).toBe(renamed)
        expect(versionOf('New.json')).toBe('v2')
    })
    test('a running gRPC call follows its kept item to the id a rename gave it', async() => {
        const call = { _id: 'Old.json', _type: 'grpc', name: 'Old', parentId: null, workspaceId: 'workspace-id' } as unknown as CollectionItem
        open(call)
        setVersion('Old.json', 'v1')
        resetGrpcCalls()
        const oldKey = getGrpcItemKey({ workspaceId: 'workspace-id', _id: 'Old.json' })
        grpcCalls[oldKey] = { id: 'call-1', phase: 'open' } as unknown as GrpcLiveCall
        vi.mocked(getCollectionForWorkspace).mockResolvedValue(readResult([{ ...call, _id: 'New.json', name: 'New' } as CollectionItem], { 'New.json': 'v1' }, new Map([['Old.json', 'New.json']])) as never)

        await store.dispatch('refreshWorkspaceCollection')

        expect(store.state.collection[0]._id).toBe('New.json')
        expect(grpcCalls[getGrpcItemKey({ workspaceId: 'workspace-id', _id: 'New.json' })]?.id).toBe('call-1')
        expect(grpcCalls[oldKey]).toBeUndefined()
        resetGrpcCalls()
    })

    test('a reload given up as the user opened another workspace reloads no tabs', async() => {
        open(request('Login.json'))
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValue(read.promise as never)

        const refresh = store.dispatch('refreshWorkspace')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        const other = { _id: 'other-workspace', _type: 'file', name: 'Other' } as Workspace
        store.state.activeWorkspace = other
        read.release(readResult([request('Login.json')], {}))
        await refresh

        expect(other.tabIds).toBeUndefined()
        expect(getWorkspacePlugins).not.toHaveBeenCalled()
    })

    test('two reloads asked for close together, with an edit between them, both end and the edit is saved', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        const firstRead = heldRead()
        const secondRead = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValueOnce(firstRead.promise as never).mockReturnValueOnce(secondRead.promise as never)
        vi.mocked(updateCollection).mockResolvedValue({ error: null, version: 'v2' })

        const first = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        login.url += '/typed'
        store.dispatch('persistCollectionItem', login)
        const second = store.dispatch('refreshWorkspaceCollection')
        firstRead.release(readResult([request('Login.json')], { 'Login.json': 'v1' }))
        await first
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledTimes(2))
        secondRead.release(readResult([request('Login.json')], { 'Login.json': 'v2' }))
        await second

        expect(vi.mocked(updateCollection).mock.calls[0][2].url).toBe('https://api.example/login/typed')
        expect(store.state.collection[0]).toBe(login)
    })

    test('a drag in a file workspace shows the new order at once, also in an open tab copied from the item', async() => {
        const [first, second] = open(request('A.json'), request('B.json'))
        first.sortOrder = 0
        second.sortOrder = 1
        store.state.collectionTree = [first, second]
        setVersion('A.json', 'a1')
        setVersion('B.json', 'b1')
        const secondTab = { ...second } as CollectionItem
        store.state.tabs = [first, secondTab]
        vi.mocked(updateCollection).mockImplementation(async(_workspaceId, collectionId, fields) => 'sortOrder' in fields
            ? { error: null, versionBefore: collectionId === 'A.json' ? 'a1' : 'b1', version: `${collectionId}-${fields.sortOrder}` }
            : { error: null })
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())

        await store.dispatch('reorderCollectionItem', { from: { id: 'B.json', parentId: null }, to: { id: 'A.json', parentId: null, type: 'request', cursorPosition: 'top' } })

        expect([first.sortOrder, second.sortOrder, secondTab.sortOrder]).toEqual([1, 0, 0])
        expect(versionOf('B.json')).toBe('B.json-0')
    })

    test('a drag into another folder in a browser workspace moves the item\'s open tab too, whose whole save would otherwise put it back', async() => {
        const folder = (id: string) => ({ _id: id, _type: 'request_group', name: id, parentId: null, workspaceId: 'workspace-id', sortOrder: 0 }) as unknown as CollectionItem
        const item = { ...request('R'), parentId: 'F1', sortOrder: 0 } as CollectionItem
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'local', name: 'Browser' } as Workspace
        open(folder('F1'), folder('F2'), item)
        // the tab addTab opens is a copy of the item
        const tab = { ...item } as CollectionItem
        store.state.tabs = [tab]
        store.state.activeTab = tab
        vi.mocked(updateCollection).mockResolvedValue({ error: null })

        await store.dispatch('reorderCollectionItem', { from: { id: 'R', parentId: 'F1' }, to: { id: 'F2', parentId: null, type: 'request_group', cursorPosition: 'bottom' } })

        expect(tab.parentId).toBe('F2')
        expect(vi.mocked(updateCollection).mock.calls[0]).toEqual(['workspace-id', 'R', { parentId: 'F2' }])
    })

    test.each(['refused', 'failed on the way'])('a move the storage %s leaves the open tab in its folder, which it inherits from', async(outcome) => {
        const folder = (id: string) => ({ _id: id, _type: 'request_group', name: id, parentId: null, workspaceId: 'workspace-id', sortOrder: 0 }) as unknown as CollectionItem
        const item = { ...request('A/R.json'), parentId: 'A', sortOrder: 0 } as CollectionItem
        open(folder('A'), folder('B'), item)
        const tab = { ...item } as CollectionItem
        store.state.tabs = [tab]
        store.state.activeTab = tab
        if(outcome === 'refused') {
            vi.mocked(updateCollection).mockResolvedValue({ error: 'Cannot move R as it already exists in B' })
        } else {
            vi.mocked(updateCollection).mockRejectedValue(new Error('Failed to fetch'))
        }

        const move = store.dispatch('reorderCollectionItem', { from: { id: 'A/R.json', parentId: 'A' }, to: { id: 'B', parentId: null, type: 'request_group', cursorPosition: 'bottom' } })
        if(outcome === 'refused') {
            await move
        } else {
            await expect(move).rejects.toThrow('Failed to fetch')
        }

        expect(tab.parentId).toBe('A')
        expect(store.state.collection.find(object => object._id === 'A/R.json')?.parentId).toBe('A')
    })

    test('a drag refused as the folder changed outside Restfox tells the user and reloads', async() => {
        const folder = (id: string) => ({ _id: id, _type: 'request_group', name: id, parentId: null, workspaceId: 'workspace-id', sortOrder: 0 }) as unknown as CollectionItem
        open(folder('A'), folder('B'), { ...request('A/R.json'), parentId: 'A', sortOrder: 0 } as CollectionItem)
        const refusedMove = { error: 'Not moved, as B was changed outside Restfox', changedOutside: true }
        vi.mocked(updateCollection).mockResolvedValue(refusedMove)
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())

        await store.dispatch('reorderCollectionItem', { from: { id: 'A/R.json', parentId: 'A' }, to: { id: 'B', parentId: null, type: 'request_group', cursorPosition: 'bottom' } })

        expect(errorToasts()).toEqual([refusedMove.error])
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
    })

    test('a reload ends its window for versions, so later saves keep only the latest', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        vi.mocked(getCollectionForWorkspace).mockResolvedValue(readResult([request('Login.json')], { 'Login.json': 'v1' }) as never)
        await store.dispatch('refreshWorkspaceCollection')
        vi.mocked(updateCollection).mockResolvedValueOnce({ error: null, version: 'v2' }).mockResolvedValueOnce({ error: null, version: 'v3' })

        for(const letter of 'ab') {
            login.url += letter
            store.dispatch('persistCollectionItem', login)
            await settled('Login.json')
        }

        expect(getItemEntry('workspace-id', 'Login.json').history).toEqual(['v3'])
    })

    test('a move a browser workspace failed to store shows the item in its folder again', async() => {
        const folder = (id: string) => ({ _id: id, _type: 'request_group', name: id, parentId: null, workspaceId: 'workspace-id', sortOrder: 0 }) as unknown as CollectionItem
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'local', name: 'Browser' } as Workspace
        open(folder('A'), folder('B'), { ...request('R'), parentId: 'A', sortOrder: 0 } as CollectionItem)
        store.state.tabs = []
        store.state.activeTab = null
        vi.mocked(updateCollection).mockRejectedValue(new Error('QuotaExceededError'))

        await expect(store.dispatch('reorderCollectionItem', { from: { id: 'R', parentId: 'A' }, to: { id: 'B', parentId: null, type: 'request_group', cursorPosition: 'bottom' } })).rejects.toThrow('QuotaExceededError')

        expect(store.state.collection.find(item => item._id === 'R')?.parentId).toBe('A')
        const childrenOf = (id: string) => store.state.collectionTree.find(item => item._id === id)?.children?.map(item => item._id)
        expect([childrenOf('A'), childrenOf('B')]).toEqual([['R'], []])
    })

    test.each([
        ['a rename', { name: 'Renamed' }],
        ['a Properties move', { parentId: 'Gone' }],
        ['a Properties rename', { name: 'Renamed', fromProperties: true }],
    ])('%s refused as the item or folder changed outside Restfox tells the user and reloads', async(_label, change: { name?: string, parentId?: string, fromProperties?: boolean }) => {
        const [login] = open(request('Login.json'))
        const refusedChange = { error: 'Not saved, as /Login.json was changed outside Restfox', changedOutside: true }
        vi.mocked(updateCollection).mockResolvedValue(refusedChange)
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())

        if(change.parentId !== undefined || change.fromProperties) {
            await store.dispatch('updateCollectionItem', { collectionId: 'Login.json', name: change.name ?? login.name, parentId: change.parentId ?? null })
        } else {
            await store.dispatch('updateCollectionItemName', { ...login, name: change.name })
        }

        expect(errorToasts()).toEqual([refusedChange.error])
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
    })

    test('a merge whose reply comes after the user opened a copy of the workspace leaves the copy\'s items alone', async() => {
        const [first, second] = open(request('A.json'), request('B.json'))
        store.state.collectionTree = [first, second]
        setVersion('A.json', 'a1')
        setVersion('B.json', 'b1')
        const move = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockImplementation(async(_workspaceId, collectionId, fields) => 'parentId' in fields
            ? move.promise
            : { error: null, versionBefore: collectionId === 'A.json' ? 'a1' : 'b1', version: 'merged' })

        const reorder = store.dispatch('reorderCollectionItem', { from: { id: 'B.json', parentId: null }, to: { id: 'A.json', parentId: null, type: 'request', cursorPosition: 'top' } })
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        // the copy has items at the same paths, read at the same versions
        store.state.activeWorkspace = { _id: 'copy-workspace', _type: 'file', name: 'Copy' } as Workspace
        const copies = [request('A.json'), request('B.json')].map(item => ({ ...item, workspaceId: 'copy-workspace', sortOrder: 7 }))
        loadItemVersions('copy-workspace', { 'A.json': 'a1', 'B.json': 'b1' })
        open(...copies)
        move.release({ error: null })
        await reorder

        expect(['A.json', 'B.json'].map(id => getItemVersion('copy-workspace', id))).toEqual(['a1', 'b1'])
        expect(store.state.collection.map(item => item.sortOrder)).toEqual([7, 7])
        expect(getCollectionForWorkspace).not.toHaveBeenCalled()
    })

    test('a reload that keeps an item takes the sort order it read', async() => {
        const [login] = open(request('Login.json'))
        login.sortOrder = 5
        setVersion('Login.json', 'v1')
        vi.mocked(getCollectionForWorkspace).mockResolvedValue(readResult([{ ...request('Login.json'), sortOrder: 2 } as CollectionItem], { 'Login.json': 'v1' }) as never)

        await store.dispatch('refreshWorkspaceCollection')

        expect(store.state.collection[0]).toBe(login)
        expect(login.sortOrder).toBe(2)
    })

    test('a reload that read before a drag keeps the order the drag gave', async() => {
        const [first, second] = open(request('A.json'), request('B.json'))
        first.sortOrder = 0
        second.sortOrder = 1
        store.state.collectionTree = [first, second]
        setVersion('A.json', 'a1')
        setVersion('B.json', 'b1')
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValueOnce(read.promise as never).mockReturnValue(pendingRead())
        vi.mocked(updateCollection).mockImplementation(async(_workspaceId, collectionId, fields) => 'sortOrder' in fields
            ? { error: null, versionBefore: collectionId === 'A.json' ? 'a1' : 'b1', version: collectionId === 'A.json' ? 'a1' : 'b1' }
            : { error: null })

        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        await store.dispatch('reorderCollectionItem', { from: { id: 'B.json', parentId: null }, to: { id: 'A.json', parentId: null, type: 'request', cursorPosition: 'top' } })
        read.release(readResult([{ ...request('A.json'), sortOrder: 0 }, { ...request('B.json'), sortOrder: 1 }] as CollectionItem[], { 'A.json': 'a1', 'B.json': 'b1' }))
        await reload

        expect(store.state.collection.map(item => [item._id, item.sortOrder])).toEqual([['A.json', 1], ['B.json', 0]])
    })

    test('a reload keeps the tab the user opened again while it read, with what was typed there', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        const read = heldRead()
        vi.mocked(getCollectionForWorkspace).mockReturnValue(read.promise as never)

        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        // closed and opened again: a new copy of the item
        const reopened = { ...login, url: 'https://api.example/login/typed-after-reopening' } as CollectionItem
        store.state.tabs = [reopened]
        store.state.activeTab = reopened
        read.release(readResult([request('Login.json')], { 'Login.json': 'v1' }))
        await reload

        expect(toRaw(store.state.collection[0])).toBe(toRaw(reopened))
        expect(store.state.collection[0].url).toBe('https://api.example/login/typed-after-reopening')
    })

    test('a reload asked for while another runs reads after that one has reloaded its tabs too', async() => {
        open(request('Login.json'))
        vi.mocked(getWorkspacePlugins).mockResolvedValue([])
        const firstRead = heldRead()
        let tabsReloadedBeforeSecondRead: boolean | null = null
        vi.mocked(getCollectionForWorkspace)
            .mockReturnValueOnce(firstRead.promise as never)
            .mockImplementationOnce(async() => {
                tabsReloadedBeforeSecondRead = (store.state.activeWorkspace as Workspace).tabIds !== undefined
                return readResult([request('Login.json')], {}) as never
            })

        const first = store.dispatch('refreshWorkspace')
        const second = store.dispatch('refreshWorkspace')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        firstRead.release(readResult([request('Login.json')], {}))
        await first
        await second

        expect(tabsReloadedBeforeSecondRead).toBe(true)
    })

    // A reload that waits on another item's save, so the steps below run between its read and the moment it applies
    async function replaceLoginWhileItsSaveWaits() {
        const [login] = open(request('Login.json'), request('Other.json'))
        setVersion('Login.json', 'v1')
        setVersion('Other.json', 'o1')
        const otherSave = held<UpdateCollectionResult>()
        const loginSave = held<UpdateCollectionResult>()
        const read = heldRead()
        vi.mocked(updateCollection).mockReturnValueOnce(otherSave.promise).mockReturnValueOnce(loginSave.promise).mockResolvedValue({ error: null, version: 'v3' })
        vi.mocked(getCollectionForWorkspace).mockReturnValueOnce(read.promise as never).mockReturnValue(pendingRead())

        store.dispatch('persistCollectionItem', store.state.collection[1])
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        const reload = store.dispatch('refreshWorkspaceCollection')
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalledOnce())
        read.release(readResult([request('Login.json', 'https://api.example/changed-outside'), request('Other.json')], { 'Login.json': 'outside', 'Other.json': 'o2' }))
        await new Promise(resolve => setTimeout(resolve, 0))
        // a save of the item the reload is about to replace, which the reload does not wait for, and an edit after it
        store.dispatch('persistCollectionItem', login)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(2))
        login.url += '/before-the-reload'
        store.dispatch('persistCollectionItem', login)
        otherSave.release({ error: null, version: 'o2' })
        await reload
        expect(store.state.collection[0]).not.toBe(login)
        return { login, fresh: store.state.collection[0], loginSave }
    }

    test('a save asked for before a reload replaced its item for an outside change is not sent', async() => {
        const { loginSave } = await replaceLoginWhileItsSaveWaits()
        loginSave.release(changedOutside)
        await settled('Login.json')

        expect(updateCollection).toHaveBeenCalledTimes(2)
        expect(errorToasts()).toEqual([changedOutsideToast])
    })

    test('an edit made after a reload replaced its item is saved, while one still queued from before is not', async() => {
        const { fresh, loginSave } = await replaceLoginWhileItsSaveWaits()
        fresh.url += '/after-the-reload'
        store.dispatch('persistCollectionItem', fresh)
        loginSave.release(changedOutside)
        await settled('Login.json')

        expect(updateCollection).toHaveBeenCalledTimes(3)
        expect(vi.mocked(updateCollection).mock.calls[2][2].url).toBe('https://api.example/changed-outside/after-the-reload')
        expect(vi.mocked(updateCollection).mock.calls[2][3]).toBe('outside')
        expect(errorToasts()).toEqual([changedOutsideToast])
    })

    test('the tab a duplicate opens saves from the version its sort order merge gave', async() => {
        const [source] = open(request('Login.json'))
        store.state.collectionTree = [source]
        store.state.tabs = []
        store.state.activeTab = null
        setVersion('Login.json', 'v1')
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        vi.stubGlobal('document', {
            querySelector: () => null,
        })
        // the server answers with the id the duplicate sent and the path it gave the copy
        vi.mocked(createCollections).mockImplementationOnce(async(_workspaceId, collections) => ({ error: null, results: [{ error: null, oldCollectionId: collections[0]._id, newCollectionId: 'Login (2).json', version: 'dup-v1' }] }))
        vi.mocked(updateCollection).mockImplementation(async(_workspaceId, collectionId, fields, version) => {
            // a merge sends the one field, a whole save the item, which has a sort order too
            if(Object.keys(fields).length === 1 && 'sortOrder' in fields) {
                return { error: null, versionBefore: collectionId === 'Login.json' ? 'v1' : 'dup-v1', version: `${collectionId}-merged` }
            }
            return version === 'Login (2).json-merged' ? { error: null, version: 'dup-v3' } : changedOutside
        })

        await store.dispatch('duplicateCollectionItem', toRaw(source))
        await settled('Login.json', 'Login (2).json')
        const tab = store.state.activeTab as CollectionItem
        tab.url += '/typed'
        store.dispatch('persistCollectionItem', tab)
        await settled('Login (2).json')

        expect(emitter.emit).not.toHaveBeenCalledWith('error', expect.stringContaining('changed outside Restfox'))
        expect(versionOf('Login (2).json')).toBe('dup-v3')
    })

    test('an import merges the sort order only of items it moved', async() => {
        const [login] = open({ ...request('Login.json'), sortOrder: 0 } as CollectionItem)
        store.state.collectionTree = [login]
        vi.mocked(createCollections).mockResolvedValueOnce({ error: null, results: [] })
        vi.mocked(updateCollection).mockResolvedValue({ error: null })
        vi.mocked(getWorkspacePlugins).mockResolvedValue([])
        vi.mocked(getCollectionForWorkspace).mockReturnValue(pendingRead())

        const imported = store.dispatch('setCollectionTree', { collectionTree: [request('Imported.json')], parentId: null })
        await vi.waitFor(() => expect(getCollectionForWorkspace).toHaveBeenCalled())

        expect(updateCollection).not.toHaveBeenCalled()
        void imported
    })

    test('an import into a workspace kept in the browser leaves the open tabs on their objects', async() => {
        const [login] = open(request('Login.json'))
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'local', name: 'Browser' } as Workspace
        store.state.collectionTree = [login]
        vi.mocked(createCollections).mockResolvedValueOnce({ error: null, results: [] })
        vi.mocked(updateCollection).mockResolvedValue({ error: null })
        vi.mocked(getCollectionForWorkspace).mockResolvedValue({ collection: [request('Login.json'), request('Imported.json')], workspace: null, idMap: null } as never)

        await store.dispatch('setCollectionTree', { collectionTree: [request('Imported.json')], parentId: null })

        expect(store.state.tabs[0]).toBe(login)
        expect(store.state.collection.map(item => item._id)).toEqual(['Login.json', 'Imported.json'])
    })

    test('a delete waits for a save of the item still running, and holds leaving the page while it waits', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        const save = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockImplementationOnce(async(_workspaceId, _id, _fields, _version, onSending) => {
            onSending?.()
            return save.promise
        })
        vi.mocked(deleteCollectionsByIds).mockResolvedValue({ error: null } as never)

        store.dispatch('persistCollectionItem', login)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        expect(itemWritesPending()).toBe(false)
        const deleted = store.dispatch('deleteCollectionItem', login)
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(deleteCollectionsByIds).not.toHaveBeenCalled()
        expect(itemWritesPending()).toBe(true)
        save.release({ error: null, version: 'v2' })
        await deleted

        expect(deleteCollectionsByIds).toHaveBeenCalledOnce()
        expect(versionOf('Login.json')).toBe(null)
    })

    test('a delete that fails on the way, such as on a lost connection, leaves later saves of the item going out', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        vi.mocked(deleteCollectionsByIds).mockRejectedValueOnce(new Error('Failed to fetch'))
        vi.mocked(updateCollection).mockResolvedValue({ error: null, version: 'v2' })

        await expect(store.dispatch('deleteCollectionItem', login)).rejects.toThrow('Failed to fetch')
        login.url += '/typed'
        store.dispatch('persistCollectionItem', login)
        await settled('Login.json')

        expect(updateCollection).toHaveBeenCalledOnce()
    })

    test.each(['refused', 'failed on the way'])('a delete the storage %s saves what the user changed while it waited', async(outcome) => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        const save = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockReturnValueOnce(save.promise).mockResolvedValue({ error: null, version: 'v3' })
        if(outcome === 'refused') {
            vi.mocked(deleteCollectionsByIds).mockResolvedValueOnce({ error: 'EBUSY: resource busy or locked' } as never)
        } else {
            vi.mocked(deleteCollectionsByIds).mockRejectedValueOnce(new Error('Failed to fetch'))
        }

        store.dispatch('persistCollectionItem', login)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        const deleted = store.dispatch('deleteCollectionItem', login)
        await new Promise(resolve => setTimeout(resolve, 0))
        // a message arrives on the socket, which the tab saves
        login.url += '/latest'
        store.dispatch('persistCollectionItem', login)
        save.release({ error: null, version: 'v2' })
        await deleted.catch(() => undefined)
        await settled('Login.json')

        expect(updateCollection).toHaveBeenCalledTimes(2)
        expect(vi.mocked(updateCollection).mock.calls[1][2].url).toBe('https://api.example/login/latest')
        expect(vi.mocked(updateCollection).mock.calls[1][3]).toBe('v2')
    })

    test('a save dropped by a delete that then fails is not sent when a reload replaced the item meanwhile', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        const deleteReply = held<{ error: string }>()
        vi.mocked(deleteCollectionsByIds).mockReturnValueOnce(deleteReply.promise as never)
        vi.mocked(getCollectionForWorkspace).mockResolvedValueOnce(readResult([request('Login.json', 'https://api.example/changed-outside')], { 'Login.json': 'outside' }) as never).mockReturnValue(pendingRead())

        const deleted = store.dispatch('deleteCollectionItem', login)
        await vi.waitFor(() => expect(deleteCollectionsByIds).toHaveBeenCalled())
        login.url += '/typed'
        store.dispatch('persistCollectionItem', login)
        await settled('Login.json')
        await store.dispatch('refreshWorkspaceCollection')
        expect(store.state.collection[0]).not.toBe(login)
        deleteReply.release({ error: 'EBUSY: resource busy or locked' })
        await deleted
        await settled('Login.json')

        expect(updateCollection).not.toHaveBeenCalled()
        expect(errorToasts()).toEqual(expect.arrayContaining(['EBUSY: resource busy or locked', changedOutsideToast]))
        expect(errorToasts()).toHaveLength(2)
    })

    test('a delete drops the saves that would start while it waits, such as a connected socket\'s, without telling the user', async() => {
        const [login] = open(request('Login.json'))
        setVersion('Login.json', 'v1')
        const save = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockReturnValueOnce(save.promise).mockResolvedValue(changedOutside)
        vi.mocked(deleteCollectionsByIds).mockResolvedValue({ error: null } as never)

        store.dispatch('persistCollectionItem', login)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        // a message arrives on the socket, which the tab saves
        store.dispatch('persistCollectionItem', login)
        const deleted = store.dispatch('deleteCollectionItem', login)
        await new Promise(resolve => setTimeout(resolve, 0))
        store.dispatch('persistCollectionItem', login)
        save.release({ error: null, version: 'v2' })
        await deleted

        expect(updateCollection).toHaveBeenCalledOnce()
        expect(errorToasts()).toEqual([])
    })

    test('an import creates only the new items, merges the sort order of one already open after its save through its writes, and ends with a reload that keeps the open tab', async() => {
        const [login] = open(request('Login.json'))
        store.state.collectionTree = [login]
        Object.assign(store.state.activeWorkspace as Workspace, { tabIds: ['Login.json'], activeTabId: 'Login.json' })
        // the open tab is a copy of the item, as addTab makes it
        const tab = { ...login } as CollectionItem
        setVersion('Login.json', 'v1')
        store.state.tabs = [tab]
        store.state.activeTab = tab
        vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
        vi.mocked(getWorkspacePlugins).mockResolvedValue([])
        vi.stubGlobal('document', {
            querySelector: () => null,
        })
        vi.mocked(createCollections).mockResolvedValueOnce({ error: null, results: [] })
        const save = held<UpdateCollectionResult>()
        vi.mocked(updateCollection).mockReturnValueOnce(save.promise).mockResolvedValue({ error: null, versionBefore: 'v2', version: 'v3' })
        vi.mocked(getCollectionForWorkspace).mockResolvedValue(readResult([request('Login.json')], { 'Login.json': 'v3' }) as never)

        // an edit whose save is still running when the import renumbers the tree
        store.dispatch('persistCollectionItem', tab)
        await vi.waitFor(() => expect(updateCollection).toHaveBeenCalledOnce())
        const imported = store.dispatch('setCollectionTree', { collectionTree: [request('Imported.json')], parentId: null })
        await vi.waitFor(() => expect(createCollections).toHaveBeenCalledOnce())
        expect(vi.mocked(createCollections).mock.calls[0][1].map(item => item._id)).toEqual(['Imported.json'])
        expect(updateCollection).toHaveBeenCalledOnce()
        save.release({ error: null, version: 'v2' })
        await imported

        expect(vi.mocked(updateCollection).mock.calls[1].slice(0, 3)).toEqual(['workspace-id', 'Login.json', { sortOrder: 0 }])
        expect(versionOf('Login.json')).toBe('v3')
        expect(getCollectionForWorkspace).toHaveBeenCalledWith('workspace-id', null, true)
        expect(toRaw(store.state.collection[0])).toBe(toRaw(tab))
        expect(toRaw(store.state.tabs[0])).toBe(toRaw(tab))
    })
})
