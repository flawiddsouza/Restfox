// @vitest-environment happy-dom

import { test, expect, vi } from 'vitest'
import App from './App.vue'

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
