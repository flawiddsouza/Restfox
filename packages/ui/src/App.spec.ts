// @vitest-environment happy-dom

import { test, expect, vi } from 'vitest'
import App from './App.vue'
import { getCollectionForWorkspace } from './db'
import { enqueueItemWrite, getItemEntry } from './utils/item-file-versions'

vi.mock('./db', async(importOriginal) => ({ ...await importOriginal<typeof import('./db')>(), getCollectionForWorkspace: vi.fn() }))
// mounting App starts the whole app, so the handler runs with a stand-in for the component it reads
function pressSendRequestHotkey(activeTab: Record<string, any>) {
    const dispatch = vi.fn()
    const commit = vi.fn()
    const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, cancelable: true })
    App.methods!.handleGlobalKeydown.call({
        openContextMenuElement: null,
        activeTab,
        tabs: [activeTab],
        $store: { dispatch, commit },
    }, event)
    return { dispatch, commit, event }
}

test('Ctrl+Enter sends an HTTP request tab', () => {
    const activeTab = { _id: 'item1', _type: 'request', name: 'Request' }
    const { dispatch, event } = pressSendRequestHotkey(activeTab)

    expect(dispatch.mock.calls).toEqual([['sendRequest', { collectionItem: activeTab, cancelEarlierSends: true }]])
    expect(event.defaultPrevented).toBe(true)
})

test.each([
    ['a socket', 'socket'],
    ['a folder', 'request_group'],
    // a gRPC panel handles the shortcut itself
    ['a gRPC request', 'grpc'],
    ['a type only a newer version knows', 'some-future-type'],
])('Ctrl+Enter sends nothing for %s', (_label, _type) => {
    const { dispatch, commit, event } = pressSendRequestHotkey({ _id: 'item1', _type, name: 'Item' })

    expect(dispatch).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
})

function held<T>() {
    let release!: (value: T) => void
    const promise = new Promise<T>(resolve => {
        release = resolve
    })
    return { promise, release }
}

// the component as fetchSetCollectionForWorkspace reads it
function workspaceShown(id: string) {
    return {
        activeWorkspace: { _id: id, _type: 'file', name: id },
        $store: { commit: vi.fn(), dispatch: vi.fn() },
        $toast: { error: vi.fn() },
        appLoaded: false,
        activeWorkspaceLoaded: false,
    }
}

const loaded = (id: string) => ({ error: null, collection: [{ _id: `${id}.json` }], workspace: null, idMap: null, versions: {} })

test.each(['waits for a save', 'reads'])('a workspace load overtaken by another while it %s shows nothing and leaves the watcher alone', async(step) => {
    vi.mocked(getCollectionForWorkspace).mockReset()
    const save = held<void>()
    const read = held<unknown>()
    if(step === 'waits for a save') {
        enqueueItemWrite(getItemEntry('A', 'Login.json'), () => save.promise)
        vi.mocked(getCollectionForWorkspace).mockImplementation(async(id) => loaded(id) as never)
    } else {
        vi.mocked(getCollectionForWorkspace).mockImplementation(async(id) => (id === 'A' ? read.promise : loaded(id)) as never)
    }
    const component = workspaceShown('A')
    const loadA = App.methods!.fetchSetCollectionForWorkspace.call(component)
    await new Promise(resolve => setTimeout(resolve, 0))
    // the user opened B meanwhile
    component.activeWorkspace = { _id: 'B', _type: 'file', name: 'B' }
    await App.methods!.fetchSetCollectionForWorkspace.call(component)
    save.release()
    read.release(loaded('A'))
    await loadA

    const setCollections = component.$store.commit.mock.calls.filter(call => call[0] === 'setCollection')
    expect(setCollections).toEqual([['setCollection', [{ _id: 'B.json' }]]])
    expect(vi.mocked(getCollectionForWorkspace).mock.calls.map(call => call[0])).toEqual(step === 'reads' ? ['A', 'B'] : ['B'])
})

// the preload's call, one for all tries of a test, as the page calls it when a held one is let go
const retryUnload = vi.fn()

function leavePage(isElectron: boolean) {
    vi.stubGlobal('electronIPC', { retryUnload })
    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown }
    App.methods!.holdUnloadForPendingSaves.call({ $store: { state: { flags: { isElectron } } } }, event)
    return { event }
}

test.each([false, true])('leaving while a save of an item waits in the page is held, and Electron goes ahead once it ends (Electron: %s)', async(isElectron) => {
    retryUnload.mockClear()
    expect(leavePage(isElectron).event.preventDefault).not.toHaveBeenCalled()

    // a save whose data has left the page, for Electron's main process or the server, holds nothing
    const save = held<void>()
    const entry = getItemEntry(`unload-${isElectron}`, 'Login.json')
    enqueueItemWrite(entry, (_entry, sent) => {
        sent()
        return save.promise
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(leavePage(isElectron).event.preventDefault).not.toHaveBeenCalled()

    // an edit's save waiting behind it does
    enqueueItemWrite(entry, async() => undefined)
    const { event } = leavePage(isElectron)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.returnValue).toBe('')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(retryUnload).not.toHaveBeenCalled()

    save.release()
    await vi.waitFor(() => expect(retryUnload).toHaveBeenCalledTimes(isElectron ? 1 : 0))
    if(isElectron) {
        // the close Electron then repeats goes
        expect(leavePage(true).event.preventDefault).not.toHaveBeenCalled()
    }
    vi.unstubAllGlobals()
})

test('the close or reload Electron repeats goes without waiting for saves asked since, and a later one is held again', async() => {
    retryUnload.mockClear()
    const entry = getItemEntry('unload-retry', 'Login.json')
    const first = held<void>()
    enqueueItemWrite(entry, (_entry, sent) => {
        sent()
        return first.promise
    })
    enqueueItemWrite(entry, async() => undefined)
    leavePage(true)
    first.release()
    await vi.waitFor(() => expect(retryUnload).toHaveBeenCalledOnce())
    // a socket's next message asks for another save, which the repeated close does not wait for
    const second = held<void>()
    enqueueItemWrite(entry, (_entry, sent) => {
        sent()
        return second.promise
    })
    enqueueItemWrite(entry, async() => undefined)
    expect(leavePage(true).event.preventDefault).not.toHaveBeenCalled()
    // a later close, as when the repeat unloaded nothing, is held again
    expect(leavePage(true).event.preventDefault).toHaveBeenCalledOnce()
    second.release()
    await vi.waitFor(() => expect(retryUnload).toHaveBeenCalledTimes(2))
    expect(leavePage(true).event.preventDefault).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
})

test('Electron lets the window go after a while when a save never ends', async() => {
    retryUnload.mockClear()
    vi.useFakeTimers()
    try {
        const entry = getItemEntry('unload-hung', 'Login.json')
        enqueueItemWrite(entry, () => new Promise<void>(() => undefined))
        enqueueItemWrite(entry, async() => undefined)
        leavePage(true)
        await vi.advanceTimersByTimeAsync(10000)
        expect(retryUnload).toHaveBeenCalledOnce()
        // and the repeated close is not held again
        expect(leavePage(true).event.preventDefault).not.toHaveBeenCalled()
    } finally {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    }
})
