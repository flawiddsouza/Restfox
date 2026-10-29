// @vitest-environment happy-dom

import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, type App } from 'vue'

vi.mock('./CodeMirrorSingleLine.vue', () => ({
    default: defineComponent({ setup: () => () => h('input') }),
}))
vi.mock('socket.io-client-v2', () => ({ default: (url: string) => new SocketTest(url) }))
vi.mock('socket.io-client-v3', () => ({ io: (url: string) => new SocketTest(url) }))
vi.mock('socket.io-client-v4', () => ({ io: (url: string) => new SocketTest(url) }))

import SocketPanel from './SocketPanel.vue'
import { getSocketClientRemovals, noteSocketClientRemoved, noteSocketItemsClosed, takeOpenedSocketKeys } from '@/utils/socket-connections'

const mountedApps: App[] = []

class TestWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    readyState = TestWebSocket.CONNECTING
    constructor(readonly url: string = '') {}
    addEventListener = vi.fn()
    emit(event: string) {
        for(const [name, callback] of this.addEventListener.mock.calls as any[]) {
            if(name === event) {
                callback()
            }
        }
    }
    send = vi.fn(() => {
        if(this.readyState === TestWebSocket.CONNECTING) {
            throw new DOMException('Still in CONNECTING state', 'InvalidStateError')
        }
    })
    close = vi.fn(() => {
        this.readyState = TestWebSocket.CLOSING
    })
}

class SocketTest {
    connected = false
    constructor(readonly url: string) {}
    on = vi.fn()
    onAny = vi.fn()
    close = vi.fn()
    disconnect = vi.fn()
    emit(event: string) {
        for(const [name, callback] of this.on.mock.calls as any[]) {
            if(name === event) {
                callback(new Error('connection failed'))
            }
        }
    }
}

beforeEach(() => {
    vi.stubGlobal('WebSocket', TestWebSocket)
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
})

afterEach(() => {
    mountedApps.splice(0).forEach(app => app.unmount())
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

// a panel mounted again after a tab switch gets the tab and store of the panel it replaces
function mountPanel(clientType?: string, replaced?: { activeTab: any, store: any }) {
    const activeTab = replaced?.activeTab ?? reactive({
        _id: 'socket', workspaceId: 'w1', _type: 'socket',
        clients: [{ id: 'client', url: clientType ? 'http://example.test' : 'ws://example.test', ...(clientType ? { type: clientType } : {}), message: 'hello', messages: [], payloads: [{ id: 'payload', name: 'Payload 1', payload: 'hello' }], currentPayloadId: 'payload' }],
    })
    const state = replaced?.store.state ?? reactive({
        activeWorkspace: { _id: 'w1' },
        tabEnvironmentResolved: {},
        sockets: {} as Record<string, any>,
        flags: {},
    })
    const store = replaced?.store ?? {
        state,
        dispatch: vi.fn(async() => ({ environment: {} })),
    }
    const toast = { success: vi.fn(), error: vi.fn() }
    const element = document.createElement('div')
    const app = createApp(SocketPanel, { activeTab })
    app.provide('store', store)
    app.provide('$toast', toast)
    app.config.errorHandler = vi.fn()
    app.mount(element)
    mountedApps.push(app)
    const click = (label: string) => [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent!.trim() === label)!.click()
    return { store, toast, click, activeTab, app, element }
}

test('Connect shows an environment error and the next click can connect', async() => {
    const panel = mountPanel()
    panel.store.dispatch.mockRejectedValueOnce(new Error('Could not resolve tag'))
    panel.click('Connect')
    await vi.waitFor(() => expect(panel.toast.error).toHaveBeenCalledWith('Could not resolve tag'))

    panel.click('Connect')
    await vi.waitFor(() => expect(panel.store.state.sockets['socket-client']).toBeInstanceOf(TestWebSocket))
    expect(panel.store.dispatch).toHaveBeenCalledTimes(2)
    expect(panel.store.dispatch).toHaveBeenCalledWith('getEnvironmentForRequest', expect.objectContaining({ collectionItem: expect.objectContaining({ _id: 'socket' }) }))
})

test('Send shows an environment error and sends no message', async() => {
    const panel = mountPanel()
    const socket = new TestWebSocket()
    socket.readyState = TestWebSocket.OPEN
    panel.store.state.sockets['socket-client'] = socket
    panel.store.dispatch.mockRejectedValueOnce(new Error('Could not resolve tag'))
    await nextTick()

    panel.click('Send')
    await vi.waitFor(() => expect(panel.toast.error).toHaveBeenCalledWith('Could not resolve tag'))
    expect(socket.send).not.toHaveBeenCalled()
})

test('Send sends the message as it was at the click, though it changes while the environment resolves', async() => {
    const panel = mountPanel()
    const socket = new TestWebSocket()
    socket.readyState = TestWebSocket.OPEN
    panel.store.state.sockets['socket-client'] = socket
    await nextTick()
    let finish!: (value: { environment: object }) => void
    panel.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve
    }))
    panel.click('Send')
    panel.activeTab.clients[0].message = 'edited'
    finish({ environment: {} })
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce())
    expect(socket.send).toHaveBeenCalledWith('hello')
})

for(const change of ['closes', 'is replaced by a new Connect']) {
    test(`Send shows that the message was not sent and saves nothing when the connection ${change} while the environment resolves`, async() => {
        const panel = mountPanel()
        const socket = new TestWebSocket()
        socket.readyState = TestWebSocket.OPEN
        panel.store.state.sockets['socket-client'] = socket
        await nextTick()
        let finish!: (value: { environment: object }) => void
        panel.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
            finish = resolve
        }))
        panel.click('Send')
        const replacement = new TestWebSocket()
        if(change === 'closes') {
            socket.readyState = TestWebSocket.CLOSED
        } else {
            replacement.readyState = TestWebSocket.OPEN
            panel.store.state.sockets['socket-client'] = replacement
        }
        finish({ environment: {} })
        await vi.waitFor(() => expect(panel.toast.error).toHaveBeenCalledWith('Message not sent: the connection closed'))
        expect(socket.send).not.toHaveBeenCalled()
        expect(replacement.send).not.toHaveBeenCalled()
        expect(panel.activeTab.clients[0].messages).toHaveLength(0)
    })
}

test('Socket.IO Send emits and saves the event as it was at the click, though another payload tab is picked while the environment resolves', async() => {
    const panel = mountPanel('Socket.IO')
    const socket = new SocketTest('http://example.test')
    socket.connected = true
    const emitted = vi.fn()
    socket.emit = emitted
    panel.store.state.sockets['socket-client'] = socket
    ;(panel.activeTab.clients[0] as any).event = 'login'
    await nextTick()
    let finish!: (value: { environment: object }) => void
    panel.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve
    }))
    panel.click('Send')
    ;(panel.activeTab.clients[0] as any).event = 'logout'
    panel.activeTab.clients[0].message = 'bye'
    finish({ environment: {} })
    await vi.waitFor(() => expect(emitted).toHaveBeenCalledOnce())
    expect(emitted).toHaveBeenCalledWith('login', 'hello')
    expect((panel.activeTab.clients[0].messages as any[]).at(-1).message).toBe('[login] hello')
})

for(const clientType of [undefined, 'Socket.IO-v2', 'Socket.IO-v3', 'Socket.IO']) {
    for(const firstClosesFirst of [true, false]) {
        test(`an older socket closing does not cancel a newer Connect, ${clientType ?? 'WebSocket'}, first closes first: ${firstClosesFirst}`, async() => {
            const panel = mountPanel(clientType)
            const socketClass = clientType ? SocketTest : TestWebSocket
            panel.click('Connect')
            await vi.waitFor(() => expect(panel.store.state.sockets['socket-client']).toBeInstanceOf(socketClass))
            const first = panel.store.state.sockets['socket-client']
            let finish!: (value: { environment: object }) => void
            panel.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
                finish = resolve
            }))
            panel.activeTab.clients[0].url = clientType ? 'http://second.test' : 'ws://second.test'
            panel.click('Connect')
            if(firstClosesFirst) {
                first.emit(clientType ? 'connect_error' : 'error')
                first.emit(clientType ? 'disconnect' : 'close')
                await nextTick()
            }
            finish({ environment: {} })
            await vi.waitFor(() => {
                expect(panel.store.state.sockets['socket-client']).toBeInstanceOf(socketClass)
                expect(panel.store.state.sockets['socket-client']).not.toBe(first)
            })
            const second = panel.store.state.sockets['socket-client']
            expect(second.url).toBe(clientType ? 'http://second.test' : 'ws://second.test')
            if(!firstClosesFirst) {
                first.emit(clientType ? 'connect_error' : 'error')
                first.emit(clientType ? 'disconnect' : 'close')
                await nextTick()
            }
            expect(panel.store.state.sockets['socket-client']).toBe(second)
            expect(second.close).not.toHaveBeenCalled()
            if(clientType) {
                expect(second.disconnect).not.toHaveBeenCalled()
            }
            expect(panel.toast.error).not.toHaveBeenCalled()
        })
    }
}

test('Disconnect still cancels a pending Connect while an open socket is shown', async() => {
    const panel = mountPanel()
    panel.click('Connect')
    await vi.waitFor(() => expect(panel.store.state.sockets['socket-client']).toBeInstanceOf(TestWebSocket))
    const first = panel.store.state.sockets['socket-client']
    let finish!: (value: { environment: object }) => void
    panel.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve
    }))
    panel.activeTab.clients[0].url = 'ws://second.test'
    panel.click('Connect')
    first.readyState = TestWebSocket.OPEN
    first.emit('open')
    await nextTick()
    panel.click('Disconnect')
    finish({ environment: {} })
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    expect(panel.store.state.sockets['socket-client']).toBeNull()
    expect(first.close).toHaveBeenCalledOnce()
})

test('Disconnect in the panel rebuilt after a tab switch also cancels a Connect the earlier panel still waits on', async() => {
    const panel = mountPanel()
    panel.click('Connect')
    await vi.waitFor(() => expect(panel.store.state.sockets['socket-client']).toBeInstanceOf(TestWebSocket))
    const first = panel.store.state.sockets['socket-client']
    let finish!: (value: { environment: object }) => void
    panel.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve
    }))
    panel.activeTab.clients[0].url = 'ws://second.test'
    panel.click('Connect')
    first.readyState = TestWebSocket.OPEN
    first.emit('open')
    await nextTick()
    // an HTTP tab shown in between unmounts the socket panel, and coming back mounts a new one
    mountedApps.splice(mountedApps.indexOf(panel.app), 1)
    panel.app.unmount()
    const rebuilt = mountPanel(undefined, panel)
    await nextTick()
    rebuilt.click('Disconnect')
    finish({ environment: {} })
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    expect(panel.store.state.sockets['socket-client']).toBeNull()
})

test('Connect in a panel kept in the background goes ahead when its own waiting attempt was overtaken by another panel', async() => {
    const panel = mountPanel()
    panel.store.dispatch.mockImplementationOnce(() => new Promise(() => undefined))
    panel.click('Connect')
    // the same item shown in its own window, where Connect fails
    const other = mountPanel(undefined, panel)
    panel.store.dispatch.mockRejectedValueOnce(new Error('tag failed'))
    other.click('Connect')
    await vi.waitFor(() => expect(other.toast.error).toHaveBeenCalledWith('tag failed'))
    panel.click('Connect')
    expect(panel.store.dispatch).toHaveBeenCalledTimes(3)
    await vi.waitFor(() => expect(panel.store.state.sockets['socket-client']).toBeInstanceOf(TestWebSocket))
})

test('Connect opens no socket for a client removed while the environment resolves', async() => {
    const panel = mountPanel()
    document.body.appendChild(Object.assign(document.createElement('alert-confirm-prompt'), { createConfirm: vi.fn(async() => true) }))
    let finish!: (value: { environment: object }) => void
    panel.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve
    }))
    panel.click('Connect')
    panel.element.querySelector<HTMLButtonElement>('button.icon')!.click()
    await vi.waitFor(() => expect(panel.activeTab.clients).toHaveLength(0))
    finish({ environment: {} })
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    expect(panel.store.state.sockets['socket-client']).toBeUndefined()
})

test('Connect opens no socket for an item closed while the environment resolves, such as by closing its tab', async() => {
    const panel = mountPanel()
    let finish!: (value: { environment: object }) => void
    panel.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve
    }))
    panel.click('Connect')
    await vi.waitFor(() => expect(panel.store.dispatch).toHaveBeenCalledOnce())
    noteSocketItemsClosed(['socket'])
    finish({ environment: {} })
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    expect(panel.store.state.sockets['socket-client']).toBeUndefined()
    // the next Connect opens
    panel.click('Connect')
    await vi.waitFor(() => expect(panel.store.state.sockets['socket-client']).toBeInstanceOf(TestWebSocket))
})

test('Connect after the item closed and opened again goes ahead while the earlier attempt still waits, which then opens nothing', async() => {
    const panel = mountPanel()
    let finish!: (value: { environment: object }) => void
    panel.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve
    }))
    panel.click('Connect')
    await vi.waitFor(() => expect(panel.store.dispatch).toHaveBeenCalledOnce())
    noteSocketItemsClosed(['socket'])
    panel.click('Connect')
    await vi.waitFor(() => expect(panel.store.state.sockets['socket-client']).toBeInstanceOf(TestWebSocket))
    const opened = panel.store.state.sockets['socket-client']
    finish({ environment: {} })
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    expect(panel.store.dispatch).toHaveBeenCalledTimes(2)
    expect(panel.store.state.sockets['socket-client']).toBe(opened)
})

test('a socket closed with its item while still connecting is not reported as a failed connection', async() => {
    const panel = mountPanel()
    panel.click('Connect')
    await vi.waitFor(() => expect(panel.store.state.sockets['socket-client']).toBeInstanceOf(TestWebSocket))
    const socket = panel.store.state.sockets['socket-client']
    // as the store closes it: the browser then reports an error and a close for a socket still connecting
    noteSocketItemsClosed(['socket'])
    delete panel.store.state.sockets['socket-client']
    socket.emit('error')
    socket.emit('close')
    await nextTick()
    expect(panel.activeTab.clients[0].messages.map((message: { message: string }) => message.message).filter((text: string) => text.startsWith('Could not connect'))).toEqual([])
})

test('Connect opens no socket for a client removed through another copy of its tab while the environment resolves', async() => {
    const panel = mountPanel()
    let finish!: (value: { environment: object }) => void
    panel.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve
    }))
    panel.click('Connect')
    await vi.waitFor(() => expect(panel.store.dispatch).toHaveBeenCalledOnce())
    // the tab a workspace switch loads again is another object, which this panel's tab still lists the client in
    noteSocketClientRemoved('socket-client')
    finish({ environment: {} })
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    expect(panel.store.state.sockets['socket-client']).toBeUndefined()
})

test('removing a client counts the removal, which a Connect through another copy of its tab reads', async() => {
    const panel = mountPanel()
    document.body.appendChild(Object.assign(document.createElement('alert-confirm-prompt'), { createConfirm: vi.fn(async() => true) }))
    const removalsBefore = getSocketClientRemovals('socket-client')
    panel.element.querySelector<HTMLButtonElement>('button.icon')!.click()
    await vi.waitFor(() => expect(panel.activeTab.clients).toHaveLength(0))
    expect(getSocketClientRemovals('socket-client')).toBe(removalsBefore + 1)
})

test('Connect records the connection it opens under its item, which closing the item closes', async() => {
    takeOpenedSocketKeys('socket')
    const panel = mountPanel()
    panel.click('Connect')
    await vi.waitFor(() => expect(panel.store.state.sockets['socket-client']).toBeInstanceOf(TestWebSocket))
    expect(takeOpenedSocketKeys('socket')).toEqual(['socket-client'])
})

test('Connect opens no socket for a client removed from the panel rebuilt after a tab switch while the environment resolves', async() => {
    const panel = mountPanel()
    document.body.appendChild(Object.assign(document.createElement('alert-confirm-prompt'), { createConfirm: vi.fn(async() => true) }))
    let finish!: (value: { environment: object }) => void
    panel.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve
    }))
    panel.click('Connect')
    // the panel's first render finishes before it goes, as a panel shown on screen has
    await nextTick()
    // an HTTP tab shown in between unmounts the socket panel, and coming back mounts a new one
    mountedApps.splice(mountedApps.indexOf(panel.app), 1)
    panel.app.unmount()
    const rebuilt = mountPanel(undefined, panel)
    rebuilt.element.querySelector<HTMLButtonElement>('button.icon')!.click()
    await vi.waitFor(() => expect(panel.activeTab.clients).toHaveLength(0))
    finish({ environment: {} })
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    expect(panel.store.state.sockets['socket-client']).toBeUndefined()
})

for(const firstEndsFirst of [true, false]) {
    test(`a Connect from before a tab switch does not replace the one the rebuilt panel started, first ends first: ${firstEndsFirst}`, async() => {
        const panel = mountPanel()
        const finishes: (() => void)[] = []
        panel.store.dispatch.mockImplementation(() => new Promise(resolve => {
            finishes.push(() => resolve({ environment: {} }))
        }))
        panel.click('Connect')
        await nextTick()
        // an HTTP tab shown in between unmounts the socket panel, and coming back mounts a new one, which shows Connect
        mountedApps.splice(mountedApps.indexOf(panel.app), 1)
        panel.app.unmount()
        panel.activeTab.clients[0].url = 'ws://second.test'
        const rebuilt = mountPanel(undefined, panel)
        rebuilt.click('Connect')
        expect(finishes).toHaveLength(2)
        const settle = async() => {
            for(let tick = 0; tick < 20; tick++) {
                await Promise.resolve()
            }
        }
        if(firstEndsFirst) {
            // the earlier one opens nothing
            finishes[0]()
            await settle()
            expect(panel.store.state.sockets['socket-client']).toBeUndefined()
        }
        finishes[1]()
        await settle()
        const current = panel.store.state.sockets['socket-client']
        expect(current).toBeInstanceOf(TestWebSocket)
        if(!firstEndsFirst) {
            // nor does it replace the later one
            finishes[0]()
            await settle()
        }
        expect(panel.store.state.sockets['socket-client']).toBe(current)
        expect(current.close).not.toHaveBeenCalled()
    })
}

for(const firstEndsFirst of [true, false]) {
    test(`an older Connect failure keeps the newer marker, first ends first: ${firstEndsFirst}`, async() => {
        const panel = mountPanel()
        let failFirst!: (error: Error) => void
        let failSecond!: (error: Error) => void
        panel.store.dispatch.mockImplementationOnce(() => new Promise((_resolve, reject) => {
            failFirst = reject
        }))
            .mockImplementationOnce(() => new Promise((_resolve, reject) => {
                failSecond = reject
            }))
        panel.click('Connect')
        panel.activeTab.clients[0].url = 'ws://second.test'
        panel.click('Connect')
        if(firstEndsFirst) {
            failFirst(new Error('first failed'))
            await vi.waitFor(() => expect(panel.toast.error).toHaveBeenCalledWith('first failed'))
            panel.click('Connect')
            expect(panel.store.dispatch).toHaveBeenCalledTimes(2)
            failSecond(new Error('second failed'))
        } else {
            failSecond(new Error('second failed'))
            await vi.waitFor(() => expect(panel.toast.error).toHaveBeenCalledWith('second failed'))
            // Returning to the first URL creates a distinct attempt with the same target text.
            panel.activeTab.clients[0].url = 'ws://example.test'
            let finishThird!: (result: { environment: Record<string, never> }) => void
            panel.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
                finishThird = resolve
            }))
            panel.click('Connect')
            failFirst(new Error('first failed'))
            await vi.waitFor(() => expect(panel.toast.error).toHaveBeenCalledWith('first failed'))
            panel.click('Connect')
            expect(panel.store.dispatch).toHaveBeenCalledTimes(3)
            finishThird({ environment: {} })
        }
        await nextTick()
        expect(panel.app.config.errorHandler).not.toHaveBeenCalled()
    })
}

for(const firstEndsFirst of [false, true]) {
    test(`a replaced Connect success cannot replace a newer attempt at the original URL, first ends first: ${firstEndsFirst}`, async() => {
        const panel = mountPanel()
        const finishes: (() => void)[] = []
        panel.store.dispatch.mockImplementation(() => new Promise(resolve => {
            finishes.push(() => resolve({ environment: {} }))
        }))
        panel.click('Connect')
        panel.activeTab.clients[0].url = 'ws://second.test'
        panel.click('Connect')
        panel.activeTab.clients[0].url = 'ws://example.test'
        panel.click('Connect')
        if(firstEndsFirst) {
            finishes[0]()
            for(let index = 0; index < 20; index++) {
                await Promise.resolve()
            }
            expect(panel.store.state.sockets['socket-client']).toBeUndefined()
            panel.click('Connect')
            expect(panel.store.dispatch).toHaveBeenCalledTimes(3)
        }
        finishes[2]()
        await vi.waitFor(() => expect(panel.store.state.sockets['socket-client']).toBeInstanceOf(TestWebSocket))
        const current = panel.store.state.sockets['socket-client']
        if(!firstEndsFirst) {
            finishes[0]()
        }
        finishes[1]()
        for(let index = 0; index < 20; index++) {
            await Promise.resolve()
        }
        expect(panel.store.state.sockets['socket-client']).toBe(current)
        expect(current.close).not.toHaveBeenCalled()
    })
}
