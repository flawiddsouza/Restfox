// @vitest-environment happy-dom

import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createApp, h, markRaw, nextTick, reactive } from 'vue'
import ResponsePanelStream from './ResponsePanelStream.vue'
import type { ResponseStream, ResponseStreamView } from '@/global'

const encoder = new TextEncoder()

beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
})

function createStream(view: ResponseStreamView, contentType: string): ResponseStream {
    return {
        sendId: 'send-1',
        head: { status: 200, statusText: 'OK', headers: [['Content-Type', contentType], ['X-Request-Id', 'abc']], headTimeTaken: 300 },
        view,
        headAt: Date.now(),
        receivedBytes: 0,
        chunks: markRaw([]),
        chunkTimes: markRaw([]),
        revision: 0,
        endedAt: null,
    }
}

function mountStream(view: ResponseStreamView = 'events', contentType = 'text/event-stream') {
    const abortController = new AbortController()
    const state = reactive({
        requestResponseStreams: { tab1: createStream(view, contentType) } as Record<string, ResponseStream>,
        requestAbortController: { tab1: abortController },
    })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const app = createApp({ render: () => h(ResponsePanelStream, { tabId: 'tab1' }) })
    app.config.globalProperties.$store = { state }
    app.mount(element)

    // what the store does: chunks right away, the counter and revision at most every 100 ms
    const receive = async(text: string | Uint8Array, arrivedAt = 0) => {
        const stream = state.requestResponseStreams.tab1
        const bytes = typeof text === 'string' ? encoder.encode(text) : text
        stream.chunks.push(bytes)
        stream.chunkTimes.push(arrivedAt)
        stream.receivedBytes += bytes.byteLength
        stream.revision++
        await nextTick()
        await nextTick()
    }

    return {
        state,
        element,
        abortController,
        receive,
        rowTexts: () => [...element.querySelectorAll('.response-event-list-row')].map(row => [...row.children].map(cell => cell.textContent!.trim())),
        tags: () => [...element.querySelectorAll('.response-panel-address-bar .tag')].map(tag => tag.textContent!.trim().replace(/\s+/g, ' ')),
        unmount: () => {
            app.unmount()
            element.remove()
        },
    }
}

function chatEvent(content: string) {
    return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`
}

test('rows and extracted text appear as the revision moves on', async() => {
    const panel = mountStream()
    expect(panel.rowTexts()).toEqual([])

    await panel.receive(chatEvent('Hel'), 410)
    expect(panel.rowTexts().map(cells => cells.slice(0, 2))).toEqual([['1', '+0.41 s']])
    expect(panel.element.querySelector('.response-event-list-extracted-text')!.textContent).toBe('Hel')

    await panel.receive(chatEvent('lo') + ': keepalive\n\n', 1240)
    expect(panel.rowTexts()).toEqual([['1', '+0.41 s', expect.any(String)], ['2', '+1.24 s', expect.any(String)], ['3', '+1.24 s', 'comment keepalive']])
    expect(panel.element.querySelector('.response-event-list-extracted-text')!.textContent).toBe('Hello')
    // the keep-alive comment is no event
    expect(panel.tags()).toContain('2 events')

    panel.unmount()
})

test('chunks that arrive between revisions are read at the next one', async() => {
    const panel = mountStream()
    const stream = panel.state.requestResponseStreams.tab1
    stream.chunks.push(encoder.encode(chatEvent('a')))
    stream.chunkTimes.push(100)
    stream.chunks.push(encoder.encode(chatEvent('b')))
    stream.chunkTimes.push(150)
    await nextTick()
    expect(panel.rowTexts()).toEqual([])

    await panel.receive(chatEvent('c'), 200)
    expect(panel.rowTexts().map(cells => cells[1])).toEqual(['+0.10 s', '+0.15 s', '+0.20 s'])

    panel.unmount()
})

test('the event still arriving shows as a pending row', async() => {
    const panel = mountStream()
    await panel.receive(chatEvent('Hi') + 'event: update\ndata: {"partial"\n', 100)

    const rows = panel.element.querySelectorAll('.response-event-list-row')
    expect(rows).toHaveLength(2)
    expect(rows[1].classList.contains('response-event-list-row-pending')).toBe(true)
    expect(panel.rowTexts()[1]).toEqual(['2', '', 'update receiving {"partial"'])

    await panel.receive(':\n\n', 200)
    expect(panel.element.querySelectorAll('.response-event-list-row-pending')).toHaveLength(0)

    panel.unmount()
})

test('an event split across chunks, inside a multibyte character, becomes one row', async() => {
    const panel = mountStream()
    const bytes = encoder.encode('data: {"choices":[{"delta":{"content":"été"}}]}\n\n')
    const split = bytes.indexOf(0xc3) + 1
    await panel.receive(bytes.subarray(0, split), 10)
    await panel.receive(bytes.subarray(split), 20)
    expect(panel.rowTexts()).toHaveLength(1)
    expect(panel.element.querySelector('.response-event-list-extracted-text')!.textContent).toBe('été')
    panel.unmount()
})

test('lines view lists JSON lines', async() => {
    const panel = mountStream('lines', 'application/x-ndjson')
    await panel.receive('{"message":{"content":"Hi "},"done":false}\n{"message":{"content":"there"},"done":true}\n', 50)
    expect(panel.rowTexts().map(cells => cells.slice(0, 2))).toEqual([['1', '+0.05 s'], ['2', '+0.05 s']])
    expect(panel.element.querySelector('.response-event-list-extracted-text')!.textContent).toBe('Hi there')
    expect(panel.tags()).toContain('2 lines')
    panel.unmount()
})

test('text view shows the text as it is decoded', async() => {
    const panel = mountStream('text', 'application/json')
    await panel.receive('{"items": [1, ')
    await panel.receive('2]}')
    expect(panel.element.querySelector('.response-panel-stream-text pre')!.textContent).toBe('{"items": [1, 2]}')
    panel.unmount()
})

test('text view stops at 3 MB and says how much arrived', async() => {
    const panel = mountStream('text', 'text/plain')
    const chunk = new Uint8Array(1024 * 1024).fill(0x61)
    for(let i = 0; i < 4; i++) {
        await panel.receive(chunk)
    }
    expect(panel.element.querySelector('.response-panel-stream-text pre')!.textContent!.length).toBe(3 * 1024 * 1024)
    expect(panel.element.querySelector('.response-panel-stream-hint')!.textContent).toBe('Receiving, 4 MB so far')
    panel.unmount()
})

test('a scroll event that arrives after the text view is gone does nothing', async() => {
    const errors: unknown[] = []
    const stream = mountStream('text', 'application/json')
    await stream.receive('{"a":')
    const scroller = stream.element.querySelector('.response-panel-stream-text-scroller') as HTMLElement
    stream.unmount()
    window.addEventListener('error', event => errors.push(event.error))
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args))
    scroller.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(errors).toEqual([])
})

test('bytes view shows only the counter', async() => {
    const panel = mountStream('bytes', 'application/octet-stream')
    await panel.receive(new Uint8Array(3000))
    expect(panel.element.querySelector('.response-panel-tabs-context')!.textContent!.trim()).toBe('Receiving, 2.9 KB so far')
    panel.unmount()
})

test('address bar shows status, a ticking elapsed time and the size', async() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const panel = mountStream()
    await panel.receive(chatEvent('a'))
    // a running time moves by steps and keeps its width, so the tags after it stay put as it ticks
    expect(panel.tags()).toEqual(['200 OK', '300 ms', `${encoder.encode(chatEvent('a')).byteLength} B`, '1 event'])
    expect(panel.element.querySelector('.tag-running')!.textContent!.trim()).toBe('300 ms')

    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(panel.tags()[1]).toBe('2.3 s')

    panel.unmount()
})

test('Stop aborts the send', () => {
    const panel = mountStream()
    const stop = [...panel.element.querySelectorAll('button')].find(button => button.textContent!.trim() === 'Stop')!
    stop.click()
    expect(panel.abortController.signal.aborted).toBe(true)
    panel.unmount()
})

test('once the body ended, while scripts run, Stop is gone, since nothing is left to stop, and the time stops', async() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const panel = mountStream()
    await panel.receive(chatEvent('a'))
    const stopButton = () => [...panel.element.querySelectorAll('button')].find(button => button.textContent!.trim() === 'Stop')

    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(panel.tags()[1]).toBe('1.3 s')
    expect(stopButton()).toBeDefined()

    panel.state.requestResponseStreams.tab1.endedAt = Date.now()
    await nextTick()
    expect(stopButton()).toBeUndefined()
    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(panel.tags()[1]).toBe('1.3 s')
    expect(panel.element.querySelector('.tag-running')).toBeNull()

    panel.unmount()
})

test('Header tab lists the received headers', async() => {
    const panel = mountStream()
    const headerTab = [...panel.element.querySelectorAll('.response-panel-tab')].find(tab => tab.textContent!.trim() === 'Header') as HTMLElement
    headerTab.click()
    await nextTick()
    const cells = [...panel.element.querySelectorAll('.response-panel-tabs-context td')].map(cell => cell.textContent)
    expect(cells).toEqual(['Content-Type', 'text/event-stream', 'X-Request-Id', 'abc'])
    panel.unmount()
})

test('a newer send on the tab starts the list over', async() => {
    const panel = mountStream()
    await panel.receive(chatEvent('old'))
    panel.state.requestResponseStreams.tab1 = { ...createStream('events', 'text/event-stream'), sendId: 'send-2' }
    await nextTick()
    await panel.receive(chatEvent('new'))
    expect(panel.rowTexts()).toHaveLength(1)
    expect(panel.element.querySelector('.response-event-list-extracted-text')!.textContent).toBe('new')
    panel.unmount()
})

test('malformed data logs nothing', async() => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => vi.spyOn(console, method))
    const panel = mountStream()
    await panel.receive(new Uint8Array([0xff, 0xfe, 0x00, 0x0a, 0x0a]))
    await panel.receive('data: {"choices": [\n\nid: \u0000\nretry: x\nevent\n\n')
    await panel.receive('data: {"choices":[{"delta":{"content":5}}]}\n\n')
    const lines = mountStream('lines', 'application/x-ndjson')
    await lines.receive('{"broken": \n\u001e\n{}\n')
    const text = mountStream('text', 'text/plain')
    await text.receive(new Uint8Array([0xe2, 0x82]))
    panel.unmount()
    lines.unmount()
    text.unmount()
    for(const spy of spies) {
        expect(spy).not.toHaveBeenCalled()
    }
})

test('a saved response cut short says why above the preview', async() => {
    const { default: ResponsePanel } = await import('./ResponsePanel.vue')
    const banner = (response: Record<string, unknown>) => (ResponsePanel as any).computed.bodyIncompleteBanner.call({ response })

    expect(banner({ timeTaken: 3132, bodyIncomplete: 'cancelled' })).toBe('Stopped after 3.13 s. The response is incomplete.')
    expect(banner({ timeTaken: 2000, bodyIncomplete: 'timedOut' })).toBe('Timed out after 2 s. The response is incomplete.')
    expect(banner({ timeTaken: 2000, bodyIncomplete: 'failed' })).toBe('Connection lost after 2 s. The response is incomplete.')
    // saved by any version before, or complete
    expect(banner({ timeTaken: 2000 })).toBeNull()
})

test('a finished stream keeps its arrival times while in memory, and a saved one shows none', async() => {
    const { default: ResponsePanel } = await import('./ResponsePanel.vue')
    const body = chatEvent('a') + chatEvent('b') + 'data: {"cut'
    const buffer = encoder.encode(body).buffer
    const firstEnd = encoder.encode(chatEvent('a')).byteLength
    const eventListItems = (responseChunkTimes: Record<string, unknown>) => (ResponsePanel as any).computed.eventListItems.call({
        showsEventList: true,
        responseStreamView: 'events',
        response: { _id: 'r1', buffer },
        $store: { state: { responseChunkTimes } },
    })

    const inMemory = eventListItems({ r1: { chunkEnds: [firstEnd, buffer.byteLength], chunkTimes: [120, 480] } })
    expect(inMemory.items.map((item: { data: string, incomplete?: boolean }) => item.incomplete ?? false)).toEqual([false, false, true])
    expect(inMemory.times).toEqual([120, 480, 480])

    const saved = eventListItems({})
    expect(saved.items).toHaveLength(3)
    expect(saved.times).toBeNull()
})

test('once the body has ended, while scripts still run, nothing says it is still arriving', async() => {
    const bytes = mountStream('bytes', 'application/octet-stream')
    await bytes.receive(new Uint8Array(2048))
    expect(bytes.element.querySelector('.response-panel-stream-hint')!.textContent!.trim()).toBe('Receiving, 2 KB so far')
    bytes.state.requestResponseStreams.tab1.endedAt = Date.now()
    await nextTick()
    expect(bytes.element.querySelector('.response-panel-stream-hint')!.textContent!.trim()).toBe('Received 2 KB')
    bytes.unmount()

    // an event left open when the body ended stays as a row, marked incomplete instead of arriving
    const events = mountStream()
    await events.receive(chatEvent('a') + 'data: {"half":1}' + String.fromCharCode(10))
    expect(events.element.querySelectorAll('.response-event-list-row-pending').length).toBe(1)
    events.state.requestResponseStreams.tab1.endedAt = Date.now()
    await nextTick()
    await nextTick()
    expect(events.element.querySelectorAll('.response-event-list-row-pending').length).toBe(0)
    expect(events.rowTexts().length).toBe(2)
    expect(events.rowTexts()[1].at(-1)).toContain('incomplete')
    expect(events.tags()).toContain('2 events')
    events.unmount()
})
