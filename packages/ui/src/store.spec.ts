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

import { createPlugin, createResponse, deletePlugin, getResponsesByCollectionId, updatePlugin } from './db'
import type { CollectionItem, Plugin, ResponseHead, ResponseProgress, ResponseProgressHandler, Workspace } from './global'
import { store } from './store'
import { INHERITED_AUTHENTICATION_TYPE, handleRequest } from './helpers'

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
        store.state.activeWorkspace = {
            _id: 'workspace-id',
            _type: 'file',
            name: 'Workspace',
        } as Workspace
        store.state.plugins.workspace = []
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
