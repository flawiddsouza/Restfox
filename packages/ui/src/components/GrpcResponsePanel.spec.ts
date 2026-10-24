// @vitest-environment happy-dom

import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createApp, h, KeepAlive, markRaw, nextTick, reactive } from 'vue'
import type { CollectionItem, GrpcCallResult, GrpcFinalResponse } from '@/global'

const transport = vi.hoisted(() => ({
    isGrpcAvailable: vi.fn(() => true),
    loadGrpcSchema: vi.fn(),
    startGrpcCall: vi.fn(),
}))

vi.mock('@/utils/grpc-transport', () => transport)

import { EditorView } from '@codemirror/view'
import { emitter } from '@/event-bus'
import GrpcResponsePanel from './GrpcResponsePanel.vue'
import EditTagModal from './modals/EditTagModal.vue'
import * as helpers from '@/helpers'
import * as db from '@/db'
import { useMobile } from '@/composables/useMobile'
import { getGrpcItemKey, grpcCalls, grpcItemSchemaKeys, grpcSchemas, resetGrpcCalls, type GrpcLiveCall } from '@/utils/grpc-calls'

// what grpc-calls keeps an item's call by
const itemKey = (id: string) => getGrpcItemKey({ workspaceId: 'w1', _id: id })

const ROW_HEIGHT = 26

beforeEach(() => {
    resetGrpcCalls()
    transport.isGrpcAvailable.mockReturnValue(true)
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    })
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

function entry(id: string, grpc: Partial<GrpcCallResult>, createdAt = 1700000000000): GrpcFinalResponse {
    return {
        _id: id,
        collectionId: 'item1',
        createdAt,
        grpc: {
            url: 'localhost:50051',
            service: 'demo.v1.Demo',
            method: 'SayHello',
            kind: 'unary',
            events: [],
            headers: [],
            trailers: [],
            status: { code: 0, name: 'OK', details: '' },
            timeTaken: 42,
            ended: 'completed',
            ...grpc,
        },
    }
}

function mountPanel(initial: { entries?: GrpcFinalResponse[], grpc?: CollectionItem['grpc'] } = {}) {
    const state = reactive({
        flags: { responseLineWrapping: false },
        activeWorkspace: { _id: 'w1', environment: {} },
        requestResponses: { item1: initial.entries?.[0] ?? null } as Record<string, any>,
        requestResponseStatus: {} as Record<string, string>,
        responses: { item1: initial.entries ?? [] } as Record<string, any[]>,
    })
    const commit = vi.fn()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const panelApp = createApp({
        render: () => h('div', { class: 'response-panel' }, [h(GrpcResponsePanel, { activeTab: { _id: 'item1', _type: 'grpc', name: 'Demo.SayHello', workspaceId: 'w1', parentId: null, grpc: initial.grpc } })]),
    })
    const store = { state, commit }
    // the panel reads it with useStore, the previews and the menu it shows still read this.$store
    panelApp.provide('store', store)
    panelApp.config.globalProperties.$store = store
    panelApp.mount(element)
    return {
        state,
        commit,
        element,
        text: () => element.textContent!.replace(/\s+/g, ' '),
        statusTag: () => element.querySelector('[data-testid="grpc-response-panel-status"]') as HTMLElement,
        tab: (name: string) => element.querySelector(`[data-testid="grpc-response-panel-tab-${name}"]`) as HTMLElement,
        unmount: () => panelApp.unmount(),
    }
}

function liveCall(fields: Partial<GrpcLiveCall>): GrpcLiveCall {
    return {
        id: 'call1',
        phase: 'open',
        kind: 'serverStream',
        url: 'localhost:50051',
        service: 'demo.v1.Demo',
        method: 'Count',
        events: markRaw([]),
        revision: 0,
        headers: null,
        trailers: null,
        status: null,
        error: null,
        sendError: null,
        endError: null,
        createdAt: Date.now(),
        startedAt: Date.now(),
        endedAt: null,
        ended: null,
        sentCount: 0,
        receivedCount: 0,
        halfClosed: false,
        liveShown: true,
        ...fields,
    }
}

test('with no call yet it says how to get one, and in a browser that calls need the desktop app or a self-hosted Restfox', async() => {
    const panel = mountPanel()
    expect(panel.text()).toContain('Send the call to see its response here')
    panel.unmount()

    transport.isGrpcAvailable.mockReturnValue(false)
    const browser = mountPanel()
    expect(browser.text()).toContain('gRPC calls need the Restfox desktop app or a self-hosted Restfox. Browsers cannot make them.')
    expect(browser.element.querySelector('a')!.getAttribute('href')).toBe('https://github.com/flawiddsouza/Restfox/releases')
    browser.unmount()
})

test('a unary reply shows OK in green, its time, and the reply as a whole', async() => {
    const panel = mountPanel({ entries: [entry('e1', {
        events: [{ type: 'sent', json: '{\n  "name": "Ada"\n}', time: 1 }, { type: 'received', json: '{\n  "message": "Hello Ada"\n}', time: 40 }],
        headers: [['x-echo-user', 'Ada']],
        trailers: [['x-echo-user', 'Ada'], ['x-done', '1']],
    })] })

    expect(panel.statusTag().textContent).toBe('OK')
    expect(panel.statusTag().classList.contains('green')).toBe(true)
    expect(panel.text()).toContain('42 ms')
    // a unary call has no counts
    expect(panel.text()).not.toContain('received')
    expect(panel.element.querySelector('.cm-content')!.textContent).toContain('"message": "Hello Ada"')
    expect(panel.element.querySelector('.grpc-message-list')).toBeNull()

    expect(panel.tab('Metadata').textContent).toBe('Metadata (1)')
    expect(panel.tab('Trailers').textContent).toBe('Trailers (2)')
    panel.tab('Trailers').click()
    await nextTick()
    expect([...panel.element.querySelectorAll('.content-box tr')].map(row => row.textContent)).toEqual(['x-echo-userAda', 'x-done1'])
    panel.unmount()
})

test('history shows sent metadata above received metadata, keeping the count for received metadata alone', async() => {
    const panel = mountPanel({ entries: [entry('e1', {
        sentMetadata: [['x-user', 'Ada'], ['user-agent', 'Restfox/1']],
        headers: [['x-reply', 'yes']],
        trailers: [['x-done', '1']],
    })] })
    expect(panel.tab('Metadata').textContent).toBe('Metadata (1)')
    panel.tab('Metadata').click()
    await nextTick()
    expect([...panel.element.querySelectorAll('.content-box h4')].map(heading => heading.textContent)).toEqual(['Sent', 'Received'])
    expect([...panel.element.querySelectorAll('.content-box tr')].map(row => row.textContent)).toEqual(['x-userAda', 'user-agentRestfox/1', 'x-replyyes'])

    panel.tab('Trailers').click()
    await nextTick()
    expect(panel.element.querySelector('.content-box h4')).toBeNull()
    expect([...panel.element.querySelectorAll('.content-box tr')].map(row => row.textContent)).toEqual(['x-done1'])

    for(const sentMetadata of [undefined, []]) {
        panel.state.requestResponses.item1 = entry('old', { sentMetadata, headers: [['x-old', 'yes']] })
        panel.tab('Metadata').click()
        await nextTick()
        expect(panel.element.querySelector('.content-box')!.textContent).not.toContain('Sent')
        expect([...panel.element.querySelectorAll('.content-box tr')].map(row => row.textContent)).toEqual(['x-oldyes'])
    }
    panel.unmount()
})

test('a live call shows sent metadata before received metadata arrives and keeps it while the call runs', async() => {
    grpcCalls[itemKey('item1')] = liveCall({ startedAt: null })
    const panel = mountPanel()
    panel.tab('Metadata').click()
    await nextTick()
    expect(panel.element.querySelector('.content-box')!.textContent).not.toContain('Sent')

    const call = grpcCalls[itemKey('item1')]
    call.startedAt = Date.now()
    call.sentMetadata = [['x-user', 'Ada']]
    await nextTick()
    expect(panel.tab('Metadata').textContent).toBe('Metadata')
    expect([...panel.element.querySelectorAll('.content-box h4')].map(heading => heading.textContent)).toEqual(['Sent', 'Received'])
    expect([...panel.element.querySelectorAll('.content-box tr')].map(row => row.textContent)).toEqual(['x-userAda'])
    expect(panel.text()).toContain('No metadata received yet')

    const table = panel.element.querySelector('.content-box table')
    call.headers = [['x-reply', 'yes']]
    await nextTick()
    expect(panel.tab('Metadata').textContent).toBe('Metadata (1)')
    expect(panel.element.querySelector('.content-box table')).toBe(table)
    expect([...panel.element.querySelectorAll('.content-box tr')].map(row => row.textContent)).toEqual(['x-userAda', 'x-replyyes'])
    panel.unmount()
})

test('a failed call says how it failed above the messages, with the error details one click away', async() => {
    const panel = mountPanel({ entries: [entry('e1', {
        events: [{ type: 'sent', json: '{}', time: 1 }],
        status: { code: 5, name: 'NOT_FOUND', details: 'user 42 not found', errorDetails: '{\n  "code": 5,\n  "details": []\n}' },
    })] })

    expect(panel.statusTag().textContent).toBe('NOT_FOUND (5)')
    expect(panel.statusTag().classList.contains('red')).toBe(true)
    const banner = panel.element.querySelector('[data-testid="grpc-response-panel-banner"]') as HTMLElement
    expect(banner.textContent).toContain('NOT_FOUND (5): user 42 not found')
    // with no reply, the sent message is listed
    expect(panel.element.querySelector('.grpc-message-list')).not.toBeNull()

    expect(panel.element.querySelector('.grpc-response-panel-error-details')).toBeNull()
    const details = [...banner.querySelectorAll('button')].find(button => button.textContent === 'Details') as HTMLButtonElement
    details.click()
    await nextTick()
    expect(panel.element.querySelector('.grpc-response-panel-error-details .cm-content')!.textContent).toContain('"code": 5')
    panel.unmount()
})

test('a unary call the server ended with OK and no reply keeps its green OK and says the reply is missing', () => {
    const panel = mountPanel({ entries: [entry('e1', { events: [{ type: 'sent', json: '{}', time: 1 }] })] })

    expect(panel.statusTag().textContent).toBe('OK')
    expect(panel.statusTag().classList.contains('green')).toBe(true)
    const banner = panel.element.querySelector('[data-testid="grpc-response-panel-banner"]') as HTMLElement
    expect(banner.textContent).toContain('SayHello returns one message. The server sent none.')
    panel.unmount()
})

test('a stopped stream says how long it ran, a cancelled call is grey, a call that could not start says why', async() => {
    const stopped = mountPanel({ entries: [entry('e1', { kind: 'bidiStream', ended: 'cancelled', status: { code: 1, name: 'CANCELLED', details: 'Cancelled on client' }, timeTaken: 4200, events: [{ type: 'sent', json: '{}', time: 1 }, { type: 'received', json: '{}', time: 2 }] })] })
    expect(stopped.statusTag().textContent).toBe('CANCELLED')
    expect(stopped.statusTag().className).toBe('tag')
    expect(stopped.text()).toContain('Stopped after 4.2 s')
    expect(stopped.text()).toContain('1 sent · 1 received')
    stopped.unmount()

    const failed = mountPanel({ entries: [entry('e2', { status: null, ended: 'failed', error: 'The server does not offer server reflection' })] })
    expect(failed.statusTag().textContent).toBe('Failed')
    expect(failed.text()).toContain('The server does not offer server reflection')
    failed.unmount()

    // stopped before its method was known, so its kind was never saved: shown as a unary call is
    const unknownKind = mountPanel({ entries: [entry('e3', { kind: undefined, status: null, ended: 'cancelled', timeTaken: 4200 })] })
    expect(unknownKind.text()).toContain('Cancelled after 4.2 s')
    expect(unknownKind.text()).not.toContain('received')
    unknownKind.unmount()
})

test('a running stream shows its messages live, then the saved call in the same list, keeping the open message', async() => {
    const events = markRaw([{ type: 'sent' as const, json: '{}', time: 1 }])
    grpcCalls[itemKey('item1')] = liveCall({ events, sentCount: 1 })
    const panel = mountPanel()
    await nextTick()

    expect(panel.statusTag().textContent).toBe('Receiving')
    expect(panel.text()).toContain('1 sent · 0 received')
    // earlier calls are listed once this one ends
    expect(panel.element.querySelector('.response-panel-address-bar-select-container')).toBeNull()

    const scroller = panel.element.querySelector('.grpc-message-list-scroller') as HTMLElement
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 10 * ROW_HEIGHT })
    const call = grpcCalls[itemKey('item1')]
    for(let n = 1; n <= 3; n++) {
        call.events.push({ type: 'received', json: `{\n  "n": ${n}\n}`, time: n * 10 })
        call.receivedCount++
    }
    call.revision++
    await nextTick()
    expect(panel.element.querySelectorAll('.grpc-message-list-row')).toHaveLength(4)
    expect(panel.text()).toContain('1 sent · 3 received')

    const thirdRow = panel.element.querySelectorAll('.grpc-message-list-row')[2] as HTMLElement
    thirdRow.click()
    await nextTick()
    const list = panel.element.querySelector('.grpc-message-list')

    // the call ends and its saved copy takes over, as grpc-calls does it
    call.phase = 'ended'
    call.ended = 'completed'
    const saved = entry('call1', { kind: 'serverStream', method: 'Count', events: call.events, status: { code: 0, name: 'OK', details: '' } })
    panel.state.requestResponses.item1 = saved
    panel.state.responses.item1 = [saved]
    await nextTick()

    expect(panel.statusTag().textContent).toBe('OK')
    expect(panel.element.querySelector('.grpc-message-list')).toBe(list)
    expect(panel.element.querySelector('.grpc-message-list-pane-header')!.textContent).toContain('#3, received at')
    panel.unmount()
})

test('a client stream is Open until the client ends it, then Receiving', async() => {
    grpcCalls[itemKey('item1')] = liveCall({ kind: 'clientStream', method: 'Sum' })
    const panel = mountPanel()
    await nextTick()
    expect(panel.statusTag().textContent).toBe('Open')
    grpcCalls[itemKey('item1')].halfClosed = true
    await nextTick()
    expect(panel.statusTag().textContent).toBe('Receiving')
    panel.unmount()
})

test('a finished client stream keeps the messages it sent in its list beside its one reply', async() => {
    const panel = mountPanel({ entries: [entry('e1', {
        kind: 'clientStream',
        method: 'Sum',
        events: [
            { type: 'sent', json: '{\n  "value": "1"\n}', time: 1 },
            { type: 'sent', json: '{\n  "value": "2"\n}', time: 2 },
            { type: 'received', json: '{\n  "total": "3",\n  "count": 2\n}', time: 3 },
        ],
    })] })
    expect(panel.element.querySelector('.grpc-message-list')).not.toBeNull()
    expect(panel.text()).toContain('2 sent · 1 received')
    panel.unmount()
})

test('a live stream has Stop beside its counts, and says Connecting until it is connected, in a tag that keeps its width', async() => {
    grpcCalls[itemKey('item1')] = liveCall({ kind: 'bidiStream', method: 'Chat', phase: 'connecting' })
    const panel = mountPanel()
    await nextTick()
    expect(panel.statusTag().textContent).toBe('Connecting')

    grpcCalls[itemKey('item1')].phase = 'open'
    await nextTick()
    expect(panel.statusTag().textContent).toBe('Open')
    // as wide as Connecting while the call runs, so the tags after it stay put
    expect(panel.statusTag().classList.contains('grpc-response-panel-live-status')).toBe(true)
    const stop = panel.element.querySelector('[data-testid="grpc-response-panel-stop"]') as HTMLButtonElement
    expect(stop.textContent).toBe('Stop')
    panel.unmount()
})

test('a running call counts by tenths of a second in a tag that keeps its width', async() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    grpcCalls[itemKey('item1')] = liveCall({})
    const panel = mountPanel()
    await nextTick()
    const timeTag = () => panel.statusTag().nextElementSibling as HTMLElement

    // ticks land a few ms after each tenth, the time still moves by a tenth
    vi.advanceTimersByTime(1404)
    await nextTick()
    expect(timeTag().textContent).toBe('1.4 s')
    vi.advanceTimersByTime(101)
    await nextTick()
    expect(timeTag().textContent).toBe('1.5 s')
    expect(timeTag().classList.contains('tag-running')).toBe(true)

    panel.unmount()
    vi.useRealTimers()
})

test('an item whose method is a client stream says Start where nothing has run yet', async() => {
    grpcSchemas.key1 = { loading: false, schema: { source: 'reflection', services: [{ name: 'demo.v1.Demo', methods: [{ name: 'Sum', path: '/demo.v1.Demo/Sum', requestStream: true, responseStream: false, inputType: 'demo.v1.SumRequest', outputType: 'demo.v1.SumReply', example: '{}' }] }] }, loadedAt: 1, error: null, errorCode: null, failedAt: null }
    grpcItemSchemaKeys[itemKey('item1')] = 'key1'
    const panel = mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'Sum' } })
    expect(panel.text()).toContain('Start the stream to see its messages here')
    panel.unmount()
})

test('a call waiting for its reply shows the loading view with Cancel at once, a server stream until it has run a moment', async() => {
    // a unary call as it starts, connecting before it waits for the reply
    grpcCalls[itemKey('item1')] = liveCall({ kind: 'unary', method: 'SayHello', phase: 'connecting', liveShown: false })
    const panel = mountPanel()
    await nextTick()
    const waiting = () => panel.element.querySelector('.grpc-response-panel-waiting') as HTMLElement | null
    expect(waiting()!.textContent).toContain('Connecting...')

    grpcCalls[itemKey('item1')].phase = 'open'
    await nextTick()
    expect(waiting()!.textContent).toContain('Waiting for the reply...')
    expect(waiting()!.querySelector('button')!.textContent).toBe('Cancel')
    panel.unmount()

    // a server stream that runs on shows its messages as they arrive instead
    grpcCalls[itemKey('item1')] = liveCall({ kind: 'serverStream', liveShown: false })
    const stream = mountPanel()
    await nextTick()
    expect(stream.element.querySelector('.grpc-response-panel-waiting')!.textContent).toContain('Waiting for the reply...')

    grpcCalls[itemKey('item1')].liveShown = true
    await nextTick()
    expect(stream.element.querySelector('.grpc-response-panel-waiting')).toBeNull()
    expect(stream.statusTag().textContent).toBe('Receiving')
    stream.unmount()
})

test('history lists earlier calls by time and status, picking one shows it, the menu clears it', async() => {
    const newer = entry('e2', { status: { code: 14, name: 'UNAVAILABLE', details: 'No connection established' } }, 1700000100000)
    const older = entry('e1', {}, 1700000000000)
    const panel = mountPanel({ entries: [newer, older] })

    const dropdown = panel.element.querySelector('.response-panel-address-bar-select-container .custom-dropdown') as HTMLElement
    expect(dropdown.textContent).toContain('Demo.SayHello')
    dropdown.click()
    await nextTick()
    await nextTick()
    const options = [...panel.element.querySelectorAll('.context-menu-item')] as HTMLElement[]
    expect(options).toHaveLength(2)
    expect(options[0].textContent).toContain('UNAVAILABLE (14)')
    expect(options[1].textContent).toContain('OK')

    options[1].click()
    await nextTick()
    expect(panel.state.requestResponses.item1._id).toBe('e1')
    expect(panel.statusTag().textContent).toBe('OK')

    dropdown.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    await nextTick()
    const clear = [...panel.element.querySelectorAll('.context-menu-item')].find(option => option.textContent!.includes('Clear History')) as HTMLElement
    clear.click()
    // its own item, which in a window of its own is not the main window's active tab
    expect(panel.commit).toHaveBeenCalledWith('clearResponseHistory', expect.objectContaining({ _id: 'item1' }))
    panel.unmount()
})

test('on a phone, history names a call made before a method was chosen by its server, as the menu does', async() => {
    const { isMobile } = useMobile()
    isMobile.value = true
    const noMethod = entry('e2', { service: '', method: '', status: null, ended: 'failed', error: 'Choose a method to call' }, 1700000100000)
    const panel = mountPanel({ entries: [noMethod, entry('e1', {})] })
    try {
        const dropdown = panel.element.querySelector('.custom-dropdown') as HTMLElement
        expect(dropdown.textContent).toContain('localhost:50051')

        dropdown.click()
        await nextTick()
        const sublabels = [...document.body.querySelectorAll('.mobile-sheet-row-sublabel')].map(sublabel => sublabel.textContent!.trim())
        expect(sublabels).toEqual(['localhost:50051', 'Demo.SayHello'])
    } finally {
        panel.unmount()
        isMobile.value = false
    }
})

test('a panel kept alive out of sight runs no clock for its item\'s call, and runs it once shown again', async() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const state = reactive({
        flags: { responseLineWrapping: false },
        requestResponses: {} as Record<string, any>,
        requestResponseStatus: {} as Record<string, string>,
        responses: {} as Record<string, any[]>,
    })
    const items = [
        { _id: 'item1', _type: 'grpc', name: 'Demo.Count', workspaceId: 'w1', parentId: null },
        { _id: 'item2', _type: 'grpc', name: 'Demo.SayHello', workspaceId: 'w1', parentId: null },
    ] as CollectionItem[]
    const shown = reactive({ item: items[0] })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const panelApp = createApp({
        render: () => h('div', { class: 'response-panel' }, [
            h(KeepAlive, () => h(GrpcResponsePanel, { key: shown.item._id, activeTab: shown.item })),
        ]),
    })
    const store = { state, commit: vi.fn() }
    panelApp.provide('store', store)
    panelApp.config.globalProperties.$store = store
    panelApp.mount(element)
    await nextTick()

    shown.item = items[1]
    await nextTick()
    // the call starts out of sight, as from a window of its own, which shares the calls
    grpcCalls[itemKey('item1')] = liveCall({})
    await nextTick()
    expect(vi.getTimerCount()).toBe(0)

    shown.item = items[0]
    await nextTick()
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1404)
    await nextTick()
    expect((element.querySelector('[data-testid="grpc-response-panel-status"]')!.nextElementSibling as HTMLElement).textContent).toBe('1.4 s')

    panelApp.unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
})

test('an undecodable unary reply shows its reason and selectable base64, and an unknown-field reply shows both forms', async() => {
    const panel = mountPanel({ entries: [entry('raw', { events: [{ type: 'received', bytes: 'CgVB', decodeError: 'Not a demo.v1.HelloReply: index out of range', time: 1 } as any] })] })
    expect(panel.text()).toContain('Could not be decoded')
    expect(panel.text()).toContain('Not a demo.v1.HelloReply: index out of range')
    expect(panel.element.querySelector('.cm-content')!.textContent).toContain('CgVB')
    panel.state.requestResponses.item1 = entry('unknown', { events: [{ type: 'received', json: '{"text":"hi"}', bytes: 'CgJoaVAH', unknownFields: ['2', 'point.5', 'items.3', 'labels.value.4', 'extra.6'], time: 1 } as any] })
    await nextTick()
    expect(panel.text()).toContain('Has fields the .proto files do not describe: 2, point.5, items.3, labels.value.4, extra.6')
    expect(panel.text()).toContain('"text": "hi"')
    expect(panel.text()).toContain('CgJoaVAH')
    panel.unmount()
})

test('a saved unary reply and error details re-indent at once without changing history', async() => {
    localStorage.setItem('Restfox-IndentSize', '2')
    const saved = entry('indented', { events: [{ type: 'received', json: '{"nested":{"value":1}}', time: 1 }], status: { code: 5, name: 'NOT_FOUND', details: 'missing', errorDetails: '{"details":{"value":2}}' } })
    const panel = mountPanel({ entries: [saved] })
    expect(panel.element.querySelector('.grpc-response-panel-messages .cm-line:nth-child(3)')!.textContent).toBe('    "value": 1')
    const details = [...panel.element.querySelectorAll('button')].find(button => button.textContent === 'Details')!
    details.click()
    await nextTick()
    localStorage.setItem('Restfox-IndentSize', '4')
    emitter.emit('editor_indent_size', 4)
    await nextTick()
    expect(panel.element.querySelector('.grpc-response-panel-messages .cm-line:nth-child(3)')!.textContent).toBe('        "value": 1')
    expect(panel.element.querySelector('.grpc-response-panel-error-details .cm-line:nth-child(3)')!.textContent).toBe('        "value": 2')
    expect(saved.grpc.events[0].json).toBe('{"nested":{"value":1}}')
    expect(saved.grpc.status!.errorDetails).toBe('{"details":{"value":2}}')
    panel.unmount()
})

test('a unary reply selection can be stored in an environment variable', async() => {
    const panel = mountPanel({ entries: [entry('selection', { events: [{ type: 'received', json: '{"text":"picked"}', time: 1 }] })] })
    const editor = EditorView.findFromDOM(panel.element.querySelector('.cm-editor') as HTMLElement)!
    const start = editor.state.doc.toString().indexOf('picked')
    editor.dispatch({ selection: { anchor: start, head: start + 6 } })
    const prompt = document.createElement('alert-confirm-prompt') as HTMLElement & { createPrompt: ReturnType<typeof vi.fn> }
    prompt.createPrompt = vi.fn().mockResolvedValue('reply_value')
    document.body.appendChild(prompt)
    const action = panel.element.querySelector('[title="Set selected text as environment variable"]') as HTMLElement
    expect(action).not.toBeNull()
    action.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(panel.state.activeWorkspace.environment).toEqual({ reply_value: 'picked' })
    expect(panel.commit).toHaveBeenCalledWith('updateWorkspaceEnvironment', expect.objectContaining({ environment: { reply_value: 'picked' } }))
    panel.unmount()
})

test('a large unary reply waits for Load Response and a new reply asks again', async() => {
    const json = JSON.stringify({ text: 'x'.repeat(3 * 1024 * 1024) })
    const panel = mountPanel({ entries: [entry('large1', { events: [{ type: 'received', json, time: 1 }] })] })
    expect(panel.text()).toContain('Large Response Warning')
    expect(panel.element.querySelector('.cm-editor')).toBeNull()
    const load = [...panel.element.querySelectorAll('button')].find(button => button.textContent === 'Load Response')!
    load.click()
    await nextTick()
    expect(panel.element.querySelector('.cm-editor')).not.toBeNull()
    panel.state.requestResponses.item1 = entry('large2', { events: [{ type: 'received', json, time: 1 }] })
    await nextTick()
    expect(panel.text()).toContain('Large Response Warning')
    expect(panel.element.querySelector('.cm-editor')).toBeNull()
    panel.unmount()
})

test('a large unary reply is not formatted before Load Response', async() => {
    const json = JSON.stringify({ text: 'x'.repeat(3 * 1024 * 1024) })
    const parse = vi.spyOn(JSON, 'parse')
    const panel = mountPanel({ entries: [entry('large1', { events: [{ type: 'received', json, time: 1 }] })] })
    await nextTick()
    expect(panel.text()).toContain('Large Response Warning')
    expect(parse.mock.calls.some(([text]) => text === json)).toBe(false)
    parse.mockRestore()
    panel.unmount()
})

test('a large undecodable reply shows its note and reason before Load Response', () => {
    const panel = mountPanel({ entries: [entry('large-raw', { events: [{ type: 'received', bytes: 'A'.repeat(3 * 1024 * 1024 + 4), decodeError: 'Not a Reply: invalid wire type', time: 1 }] })] })
    expect(panel.text()).toContain('Large Response Warning')
    expect(panel.text()).toContain('Could not be decoded')
    expect(panel.text()).toContain('Not a Reply: invalid wire type')
    expect(panel.element.querySelector('.cm-editor')).toBeNull()
    panel.unmount()
})

test('the response tag picker includes gRPC items and shows why a stream cannot be read', async() => {
    vi.spyOn(db, 'getCollectionForWorkspace').mockResolvedValue({ collection: [{ _id: 'stream', _type: 'grpc', name: 'Stream call', parentId: null, workspaceId: 'w1' }] } as any)
    vi.spyOn(helpers, 'substituteEnvironmentVariables').mockRejectedValue(new Error('A response tag can read only a unary gRPC call', { cause: 'display-error' }))
    const props = reactive({ showModal: false, parsedFunc: { functionName: 'response', parameters: { request: 'stream', attribute: 'body', path: '$', behavior: 'never' } }, updateFunc: vi.fn() })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const app = createApp({ render: () => h(EditTagModal, props as any) })
    const store = { state: reactive({ activeWorkspace: { _id: 'w1' } }) }
    app.provide('store', store)
    app.config.globalProperties.$store = store
    app.mount(element)
    props.showModal = true
    await new Promise(resolve => setTimeout(resolve, 0))
    expect([...element.querySelectorAll('option')].some(option => option.textContent === 'Stream call')).toBe(true)
    expect((element.querySelector('textarea') as HTMLTextAreaElement).value).toBe('A response tag can read only a unary gRPC call')
    app.unmount()
})


test('re-indenting a unary reply clears the selected environment variable text', async() => {
    const panel = mountPanel({ entries: [entry('selection-indent', { events: [{ type: 'received', json: '{"text":"picked"}', time: 1 }] })] })
    const editor = EditorView.findFromDOM(panel.element.querySelector('.cm-editor') as HTMLElement)!
    const start = editor.state.doc.toString().indexOf('picked')
    editor.dispatch({ selection: { anchor: start, head: start + 6 } })
    await nextTick()
    expect(panel.element.querySelector('[title="Set selected text as environment variable"]')).not.toBeNull()
    localStorage.setItem('Restfox-IndentSize', '8')
    emitter.emit('editor_indent_size', 8)
    await nextTick()
    expect(panel.element.querySelector('.cm-line:nth-child(2)')!.textContent).toBe('        "text": "picked"')
    const prompt = document.createElement('alert-confirm-prompt') as HTMLElement & { createPrompt: ReturnType<typeof vi.fn> }
    prompt.createPrompt = vi.fn().mockResolvedValue('reply_value')
    document.body.appendChild(prompt)
    ;(panel.element.querySelector('[title="Set selected text as environment variable"]') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(prompt.createPrompt).not.toHaveBeenCalled()
    expect(panel.commit).not.toHaveBeenCalledWith('updateWorkspaceEnvironment', expect.anything())
    panel.unmount()
})
