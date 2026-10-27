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

function mountPanel(clientType?: string) {
    const activeTab = reactive({
        _id: 'socket', workspaceId: 'w1', _type: 'socket',
        clients: [{ id: 'client', url: clientType ? 'http://example.test' : 'ws://example.test', ...(clientType ? { type: clientType } : {}), message: 'hello', messages: [], payloads: [{ id: 'payload', name: 'Payload 1', payload: 'hello' }], currentPayloadId: 'payload' }],
    })
    const state = reactive({
        activeWorkspace: { _id: 'w1' },
        tabEnvironmentResolved: {},
        sockets: {} as Record<string, any>,
        flags: {},
    })
    const store = {
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
    return { store, toast, click, activeTab, app }
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
