// @vitest-environment happy-dom

import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { KeepAlive, createApp, h, markRaw, nextTick, reactive, ref } from 'vue'
import ResponsePanel from './ResponsePanel.vue'
import type { ResponseStream } from '@/global'

const encoder = new TextEncoder()
const ROW_HEIGHT = 26

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
})

function chatEvents(count: number, prefix = '') {
    return Array.from({ length: count }, (_, index) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `${prefix}${index} ` } }] })}\n\n`).join('')
}

function savedResponse(id: string, body: string) {
    return {
        _id: id,
        collectionId: 'tab1',
        url: 'http://127.0.0.1/sse',
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'text/event-stream']],
        mimeType: 'text/event-stream',
        buffer: encoder.encode(body).buffer,
        timeTaken: 1200,
        testResults: [],
        createdAt: 1,
    }
}

function liveStream(body: string): ResponseStream {
    const bytes = encoder.encode(body)
    return {
        sendId: 'send-1',
        head: { status: 200, statusText: 'OK', headers: [['content-type', 'text/event-stream']], headTimeTaken: 10 },
        view: 'events',
        headAt: Date.now(),
        receivedBytes: bytes.byteLength,
        chunks: markRaw([bytes]),
        chunkTimes: markRaw([100]),
        revision: 1,
        endedAt: null,
    }
}

// happy-dom does no layout, so a scroller gets the sizes a browser would give it
function giveScrollerLayout(scroller: HTMLElement, clientHeight: number) {
    let scrollTop = 0
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => clientHeight })
    Object.defineProperty(scroller, 'scrollHeight', {
        configurable: true,
        get: () => Math.max(clientHeight, parseFloat((scroller.firstElementChild as HTMLElement).style.height) || 0),
    })
    Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
            scrollTop = Math.max(0, Math.min(value, scroller.scrollHeight - clientHeight))
        },
    })
}

function mountPanel(state: Record<string, any>, keepAliveShown?: { value: boolean }) {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const activeTab: Record<string, any> = { _id: 'tab1', _type: 'request', name: 'SSE', method: 'GET', url: 'http://127.0.0.1/sse' }
    const app = createApp({
        render: () => keepAliveShown
            ? h(KeepAlive, null, [keepAliveShown.value ? h(ResponsePanel, { activeTab, key: 'panel' }) : h('div', { key: 'other' }, 'another tab')])
            : h(ResponsePanel, { activeTab }),
    })
    const commit = vi.fn()
    app.config.globalProperties.$store = { state, commit }
    app.config.globalProperties.$toast = { success: vi.fn(), error: vi.fn() }
    app.mount(element)
    return {
        element,
        commit,
        activeTab,
        scroller: () => element.querySelector('.response-event-list-scroller') as HTMLElement,
        pathInput: () => element.querySelector('.response-event-list-path input') as HTMLInputElement,
        detailTitle: () => element.querySelector('.response-event-list-detail .response-event-list-pane-header span')?.textContent ?? null,
        rows: () => [...element.querySelectorAll('.response-event-list-row')] as HTMLElement[],
        unmount: () => {
            app.unmount()
            element.remove()
        },
    }
}

function storeState(fields: Record<string, any>): Record<string, any> {
    return reactive({
        activeWorkspace: { _id: 'w', _type: 'local', name: 'W' },
        flags: { responseLineWrapping: false },
        settings: { customResponseFormats: [] },
        requestAbortController: { tab1: new AbortController() },
        requestResponseStatus: {},
        requestResponses: {},
        requestResponseStreams: {},
        responseChunkTimes: {},
        extractPathInputs: {},
        responses: { tab1: [] },
        ...fields,
    })
}

async function settle() {
    for(let i = 0; i < 4; i++) {
        await nextTick()
    }
}

async function userScrollsTo(scroller: HTMLElement, top: number) {
    scroller.scrollTop = top
    scroller.dispatchEvent(new Event('scroll'))
    await nextTick()
}

async function typePath(input: HTMLInputElement, path: string) {
    input.value = path
    input.dispatchEvent(new Event('input'))
    await nextTick()
}

test('when a stream ends, the finished list keeps the typed path, the open row and the scroll position of the live one', async() => {
    const body = chatEvents(50)
    const state = storeState({
        requestResponseStatus: { tab1: 'receiving' },
        requestResponseStreams: { tab1: liveStream(body) },
    })
    const panel = mountPanel(state)
    await settle()
    expect(panel.rows().length).toBeGreaterThan(0)

    giveScrollerLayout(panel.scroller(), 260)
    await userScrollsTo(panel.scroller(), 10 * ROW_HEIGHT)
    await typePath(panel.pathInput(), '$.choices[0].index')
    panel.rows().find(row => row.firstElementChild!.textContent!.trim() === '15')!.click()
    await nextTick()
    expect(panel.detailTitle()).toBe('Event 15')

    // what the store does when the send ends
    state.requestResponses.tab1 = savedResponse('r1', body)
    state.requestResponseStatus.tab1 = 'loaded'
    delete state.requestResponseStreams.tab1
    await settle()

    expect(panel.element.querySelector('.response-panel-stream-actions')).toBeNull()
    expect(panel.pathInput().value).toBe('$.choices[0].index')
    expect(panel.detailTitle()).toBe('Event 15')
    expect(panel.scroller().scrollTop).toBe(10 * ROW_HEIGHT)

    panel.unmount()
})

test('another response of the request, from history or a new Send, starts its list fresh but keeps the path the user typed', async() => {
    const state = storeState({
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: savedResponse('r1', chatEvents(50, 'a')) },
    })
    const panel = mountPanel(state)
    await settle()

    giveScrollerLayout(panel.scroller(), 260)
    await userScrollsTo(panel.scroller(), 10 * ROW_HEIGHT)
    await typePath(panel.pathInput(), '$.choices[0].index')
    panel.rows()[3].click()
    await nextTick()
    expect(panel.detailTitle()).not.toBeNull()

    state.requestResponses.tab1 = savedResponse('r2', chatEvents(50, 'b'))
    await settle()

    expect(panel.detailTitle()).toBeNull()
    expect(panel.scroller().scrollTop).toBe(0)
    expect(panel.rows()[0].firstElementChild!.textContent!.trim()).toBe('1')
    // the same request answers in the same shape, so the path applies to every response of it
    expect(panel.pathInput().value).toBe('$.choices[0].index')

    // a cleared path stays cleared too
    await typePath(panel.pathInput(), '')
    state.requestResponses.tab1 = savedResponse('r3', chatEvents(50, 'c'))
    await settle()
    expect(panel.pathInput().value).toBe('')
    expect(panel.element.querySelector('.response-event-list-extracted')).toBeNull()

    panel.unmount()
})

test('a path typed for one request is not used for another, which starts from its guessed path', async() => {
    const state = storeState({
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: savedResponse('r1', chatEvents(5)) },
        // what the user typed for another request
        extractPathInputs: { 'other-request': '$.id' },
    })
    const panel = mountPanel(state)
    await settle()

    expect(panel.pathInput().value).toBe('$.choices[0].delta.content')

    panel.unmount()
})

test('switching to another tab and back keeps the list where it was scrolled to', async() => {
    // happy-dom's ResizeObserver never calls back, a browser's does when the list leaves the page
    const resizeCallbacks: (() => void)[] = []
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) {
            resizeCallbacks.push(callback)
        }
        observe = vi.fn()
        disconnect = vi.fn()
    })
    const state = storeState({
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: savedResponse('r1', chatEvents(500)) },
    })
    const shown = ref(true)
    const panel = mountPanel(state, shown)
    await settle()
    const scroller = panel.scroller()
    giveScrollerLayout(scroller, 260)
    await userScrollsTo(scroller, 300 * ROW_HEIGHT)

    shown.value = false
    await settle()
    // a browser resets the scroll position of an element taken out of the page, and reports its new size
    scroller.scrollTop = 0
    resizeCallbacks.forEach(callback => callback())
    shown.value = true
    await settle()

    expect(panel.scroller()).toBe(scroller)
    expect(scroller.scrollTop).toBe(300 * ROW_HEIGHT)
    expect(panel.rows().map(row => Number(row.firstElementChild!.textContent))).toContain(301)

    panel.unmount()
})

test('a JSON lines response whose type starts with application/json has one path input, the list\'s, not the JSON filter too', async() => {
    const lines = '{"message":{"content":"a"}}\n{"message":{"content":"b"}}\n'
    const response = { ...savedResponse('r1', lines), headers: [['content-type', 'application/jsonl']], mimeType: 'application/jsonl' }
    const state = storeState({
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: response },
    })
    const panel = mountPanel(state)
    await settle()

    expect(panel.rows().length).toBe(2)
    expect(panel.element.querySelectorAll('input[type="text"]').length).toBe(1)
    expect(panel.pathInput()).not.toBeNull()

    panel.unmount()
})

// a browser resets the scroll position of an element taken out of the page, as KeepAlive does on a tab switch
function giveFixedScrollLayout(element: HTMLElement, clientHeight: number, scrollHeight: number) {
    let scrollTop = 0
    Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight })
    Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight })
    Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
            scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight))
        },
    })
}

test('after switching tabs and back, the live extracted text still follows new text', async() => {
    const stream = liveStream(chatEvents(30))
    const state = storeState({
        requestResponseStatus: { tab1: 'receiving' },
        requestResponseStreams: { tab1: stream },
    })
    const shown = ref(true)
    const panel = mountPanel(state, shown)
    await settle()

    // kept, since a hidden tab's elements are out of the page
    const extractedElement = panel.element.querySelector('.response-event-list-extracted-text') as HTMLElement
    const extracted = () => extractedElement
    giveFixedScrollLayout(extracted(), 60, 600)
    extracted().scrollTop = 600
    extracted().dispatchEvent(new Event('scroll'))
    await nextTick()

    shown.value = false
    await settle()
    extracted().scrollTop = 0
    shown.value = true
    await settle()
    expect(extracted().scrollTop).toBe(540)

    // through the store state, which the views watch
    state.requestResponseStreams.tab1.chunks.push(encoder.encode(chatEvents(5, 'x')))
    state.requestResponseStreams.tab1.chunkTimes.push(200)
    state.requestResponseStreams.tab1.revision++
    await settle()

    expect(extracted().scrollTop).toBe(540)

    panel.unmount()
})

test('after switching tabs and back, live text scrolled up by the user stays where it was', async() => {
    const stream = { ...liveStream('{"a":'), head: { status: 200, statusText: 'OK', headers: [['content-type', 'application/json']], headTimeTaken: 10 }, view: 'text' as const }
    const state = storeState({
        requestResponseStatus: { tab1: 'receiving' },
        requestResponseStreams: { tab1: stream },
    })
    const shown = ref(true)
    const panel = mountPanel(state, shown)
    await settle()

    // kept, since a hidden tab's elements are out of the page
    const scrollerElement = panel.element.querySelector('.response-panel-stream-text-scroller') as HTMLElement
    const scroller = () => scrollerElement
    giveFixedScrollLayout(scroller(), 100, 1000)
    scroller().scrollTop = 300
    scroller().dispatchEvent(new Event('scroll'))
    await nextTick()

    shown.value = false
    await settle()
    scroller().scrollTop = 0
    shown.value = true
    await settle()

    expect(scroller().scrollTop).toBe(300)

    panel.unmount()
})

test('a live extracted text pane made again after its path matched nothing follows new text, whatever the old one did', async() => {
    const stream = liveStream(chatEvents(30))
    const state = storeState({
        requestResponseStatus: { tab1: 'receiving' },
        requestResponseStreams: { tab1: stream },
    })
    const panel = mountPanel(state)
    await settle()

    const extracted = () => panel.element.querySelector('.response-event-list-extracted-text') as HTMLElement | null
    giveFixedScrollLayout(extracted()!, 60, 600)
    extracted()!.scrollTop = 100
    extracted()!.dispatchEvent(new Event('scroll'))
    await nextTick()

    await typePath(panel.pathInput(), '$.choices[0].delta.conten')
    await settle()
    expect(extracted()).toBeNull()
    await typePath(panel.pathInput(), '$.choices[0].delta.content')
    await settle()
    giveFixedScrollLayout(extracted()!, 60, 600)

    // through the store state, which the views watch
    state.requestResponseStreams.tab1.chunks.push(encoder.encode(chatEvents(5, 'x')))
    state.requestResponseStreams.tab1.chunkTimes.push(200)
    state.requestResponseStreams.tab1.revision++
    await settle()

    expect(extracted()!.scrollTop).toBe(540)

    panel.unmount()
})

test('after switching tabs and back, a finished list\'s extracted text is where the user left it', async() => {
    const state = storeState({
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: savedResponse('r1', chatEvents(30)) },
    })
    const shown = ref(true)
    const panel = mountPanel(state, shown)
    await settle()

    // kept, since a hidden tab's elements are out of the page
    const extracted = panel.element.querySelector('.response-event-list-extracted-text') as HTMLElement
    giveFixedScrollLayout(extracted, 60, 600)
    extracted.scrollTop = 200
    extracted.dispatchEvent(new Event('scroll'))
    await nextTick()

    shown.value = false
    await settle()
    extracted.scrollTop = 0
    shown.value = true
    await settle()

    expect(extracted.scrollTop).toBe(200)

    panel.unmount()
})

// a JSON body that arrived slowly, shown live as text, then finished
function liveTextStream(): ResponseStream {
    return { ...liveStream('{"items":['), head: { status: 200, statusText: 'OK', headers: [['content-type', 'application/json']], headTimeTaken: 10 }, view: 'text' }
}

function finishedJson() {
    const body = JSON.stringify({ items: Array.from({ length: 200 }, (_, index) => ({ id: index })) })
    return { ...savedResponse('r-json', body), headers: [['content-type', 'application/json']], mimeType: 'application/json' }
}

async function finishLiveText(state: Record<string, any>) {
    state.requestResponses.tab1 = finishedJson()
    state.requestResponseStatus.tab1 = 'loaded'
    delete state.requestResponseStreams.tab1
}

// the element the finished text viewer scrolls, as the panel picks it
function textViewerScroller(element: HTMLElement) {
    const section = element.querySelector('.response-panel-tabs-context section') as HTMLElement
    return (section.querySelector('.cm-scroller') ?? section) as HTMLElement
}

// past the panel's next tick and animation frame
function afterFrame() {
    return new Promise(resolve => setTimeout(resolve, 50))
}

test('a live text the user followed to its end opens at its end once finished, one scrolled up opens at the top', async() => {
    for(const followed of [true, false]) {
        const state = storeState({
            requestResponseStatus: { tab1: 'receiving' },
            requestResponseStreams: { tab1: liveTextStream() },
        })
        const panel = mountPanel(state)
        await settle()

        if(!followed) {
            const liveText = panel.element.querySelector('.response-panel-stream-text-scroller') as HTMLElement
            giveFixedScrollLayout(liveText, 100, 1000)
            liveText.scrollTop = 300
            liveText.dispatchEvent(new Event('scroll'))
            await nextTick()
        }

        await finishLiveText(state)
        await nextTick()
        giveFixedScrollLayout(textViewerScroller(panel.element), 100, 1000)
        await afterFrame()

        expect(textViewerScroller(panel.element).scrollTop).toBe(followed ? 900 : 0)

        panel.unmount()
    }
})

test('a followed live text that finishes while its tab is hidden opens at its end when shown again', async() => {
    const state = storeState({
        requestResponseStatus: { tab1: 'receiving' },
        requestResponseStreams: { tab1: liveTextStream() },
    })
    const shown = ref(true)
    const panel = mountPanel(state, shown)
    await settle()

    shown.value = false
    await settle()
    await finishLiveText(state)
    await settle()
    await afterFrame()

    shown.value = true
    await nextTick()
    giveFixedScrollLayout(textViewerScroller(panel.element), 100, 1000)
    await afterFrame()

    expect(textViewerScroller(panel.element).scrollTop).toBe(900)

    panel.unmount()
})

test('a finished response whose content type is in upper case shows as text, as the live view showed it', async() => {
    const state = storeState({
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: { ...finishedJson(), headers: [['Content-Type', 'Application/JSON']] } },
    })
    const panel = mountPanel(state)
    await settle()

    expect(panel.element.textContent).not.toContain('Unknown Media Type')

    panel.unmount()
})

test('the history menu acts on its own request, also in a window of its own while another request is active in the main one', async() => {
    vi.stubGlobal('createPrompt', vi.fn().mockResolvedValue('Renamed'))
    const state = storeState({
        activeTab: { _id: 'tab2', _type: 'request', name: 'Other', method: 'GET', url: 'http://127.0.0.1/other' },
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: finishedJson() },
    })
    const panel = mountPanel(state)
    await settle()
    const ownItem = expect.objectContaining({ _id: 'tab1' })

    for(const action of ['Rename Current Response', 'Delete Current Response', 'Clear History']) {
        panel.element.querySelector('.custom-dropdown')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
        await settle()
        const item = [...panel.element.querySelectorAll('.context-menu-item')].find(element => element.textContent!.trim() === action) as HTMLElement
        item.click()
        await settle()
    }

    expect(panel.commit.mock.calls).toEqual([
        ['renameCurrentlyActiveResponse', { name: 'Renamed', collectionItem: ownItem }],
        ['deleteCurrentlyActiveResponse', ownItem],
        ['clearResponseHistory', ownItem],
    ])

    panel.unmount()
})

// small enough to be parsed at once, so no parse of the response viewer is left running after the test
function finishedSmallJson() {
    return { ...savedResponse('r-small', '{"ok":true}'), headers: [['content-type', 'application/json']], mimeType: 'application/json' }
}

// a name, a custom method or a file name from collection data, which may have been imported or read from a shared file workspace
const markup = '<img src=x onerror="window.ranResponsePanel = true"> &amp;'

test('the history menu shows a response\'s name and custom method as typed, in its usual layout', async() => {
    const saved = { ...finishedSmallJson(), name: `Login ${markup}`, request: { method: `CUSTOM${markup}`, headers: {}, original: { body: { mimeType: 'No Body' } } } }
    const state = storeState({
        activeTab: { _id: 'tab1' },
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: saved },
        responses: { tab1: [saved] },
    })
    const panel = mountPanel(state)
    await settle()

    panel.element.querySelector('.custom-dropdown')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()

    // the history entry, not an option of the Preview tab's menu
    const entry = [...panel.element.querySelectorAll('.context-menu-item')].find(item => item.querySelector('.tag'))!
    expect(entry.querySelector('img')).toBeNull()
    expect(entry.querySelector('.tag.green')!.textContent).toBe('200 OK')
    expect(entry.querySelector('[class^="request-method--"]')!.textContent!.trim()).toBe(`CUSTOM${markup}`)
    expect(entry.textContent).toContain(`Login ${markup}`)
    panel.unmount()
})

test('a response with a status code that has no name, such as Cloudflare\'s 520 sent with no status text, shows its code in the panel and the history menu', async() => {
    const saved = { ...finishedSmallJson(), status: 520, statusText: '' }
    const state = storeState({
        activeTab: { _id: 'tab1' },
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: saved },
        responses: { tab1: [saved] },
    })
    const panel = mountPanel(state)
    await settle()

    expect(panel.element.querySelector('.response-panel-address-bar-tag-container .tag')!.textContent!.trim()).toBe('520')
    panel.element.querySelector('.custom-dropdown')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    const entry = [...panel.element.querySelectorAll('.context-menu-item')].find(item => item.querySelector('.tag'))!
    expect(entry.querySelector('.tag.red')!.textContent!.trim()).toBe('520')
    panel.unmount()
})

test('the history menu shows a status read from a crafted history file as typed', async() => {
    const saved = { ...finishedSmallJson(), status: markup }
    const state = storeState({
        activeTab: { _id: 'tab1' },
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: { ...finishedSmallJson(), _id: 'r-other' } },
        responses: { tab1: [saved] },
    })
    const panel = mountPanel(state)
    await settle()

    panel.element.querySelector('.custom-dropdown')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    const entry = [...panel.element.querySelectorAll('.context-menu-item')].find(item => item.querySelector('.tag'))!
    expect(entry.querySelector('img')).toBeNull()
    expect(entry.querySelector('.tag')!.textContent!.trim()).toBe(markup)
    panel.unmount()
})

test('the Request tab names each field and file of a sent multipart body as it is named', async() => {
    const fileName = `scan ${markup}.png`
    const fieldName = `doc ${markup}`
    const saved = { ...finishedSmallJson(), request: { method: 'POST', headers: {}, body: undefined, original: { body: { mimeType: 'multipart/form-data', params: [{ name: fieldName, type: 'file', files: [new File(['a'], fileName)] }] } } } }
    const state = storeState({
        activeTab: { _id: 'tab1' },
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: saved },
    })
    const panel = mountPanel(state)
    await settle()

    const requestTab = [...panel.element.querySelectorAll('.response-panel-tab')].find(tab => tab.textContent!.trim() === 'Request') as HTMLElement
    requestTab.click()
    await settle()

    const link = panel.element.querySelector('.content-box a[download]') as HTMLAnchorElement
    expect(panel.element.querySelector('.content-box img')).toBeNull()
    expect(panel.element.querySelector('.content-box td')!.textContent).toBe(fieldName)
    expect(link.textContent).toBe(fileName)
    expect(link.getAttribute('download')).toBe(fileName)
    panel.unmount()
})

for(const method of ['HEAD', 'head', 'get']) {
    test(`the Request tab shows no body for ${method}, which sends none`, async() => {
        const saved = { ...finishedSmallJson(), request: { method, headers: {}, body: null, original: { body: { mimeType: 'multipart/form-data', params: [{ name: 'field', type: 'text', value: 'value' }] } } } }
        const state = storeState({
            activeTab: { _id: 'tab1' },
            requestResponseStatus: { tab1: 'loaded' },
            requestResponses: { tab1: saved },
        })
        const panel = mountPanel(state)
        await settle()

        const requestTab = [...panel.element.querySelectorAll('.response-panel-tab')].find(tab => tab.textContent!.trim() === 'Request') as HTMLElement
        requestTab.click()
        await settle()

        expect(panel.element.querySelector('.content-box td')).toBeNull()
        panel.unmount()
    })
}

test('Restore keeps the file of a binary body that history saved no copy of, as for a HEAD request', async() => {
    const prompt = Object.assign(document.createElement('alert-confirm-prompt'), { createConfirm: vi.fn(async() => true) })
    document.body.appendChild(prompt)
    const file = new File(['a'], 'a.bin')
    const saved = { ...finishedSmallJson(), request: { method: 'HEAD', headers: {}, body: null, original: { url: 'http://127.0.0.1/a', body: { mimeType: 'application/octet-stream', fileName: file } } } }
    const state = storeState({
        activeTab: { _id: 'tab1' },
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: saved },
    })
    const panel = mountPanel(state)
    await settle()

    const requestTab = [...panel.element.querySelectorAll('.response-panel-tab')].find(tab => tab.textContent!.trim() === 'Request') as HTMLElement
    requestTab.click()
    await settle()
    ;[...panel.element.querySelectorAll('button')].find(button => button.textContent!.trim() === 'Restore')!.click()
    await vi.waitFor(() => expect(panel.activeTab.url).toBe('http://127.0.0.1/a'))

    expect(panel.activeTab.body.fileName).toMatchObject({ name: 'a.bin' })
    // the method it was sent with, as the tab had GET
    expect(panel.activeTab.method).toBe('HEAD')
    panel.unmount()
    prompt.remove()
})

test('the Request tab shows a sent body and multipart text values as text, tags included', async() => {
    const cases = [
        { request: { method: 'POST', headers: {}, body: '<user><name>Ann</name></user>', original: { body: { mimeType: 'text/plain' } } }, shown: '<user><name>Ann</name></user>' },
        { request: { method: 'POST', headers: {}, body: null, original: { body: { mimeType: 'multipart/form-data', params: [{ name: 'note', type: 'text', value: `<b>bold</b> ${markup}` }] } } }, shown: `<b>bold</b> ${markup}` },
    ]
    for(const { request, shown } of cases) {
        const state = storeState({
            activeTab: { _id: 'tab1' },
            requestResponseStatus: { tab1: 'loaded' },
            requestResponses: { tab1: { ...finishedSmallJson(), request } },
        })
        const panel = mountPanel(state)
        await settle()

        const requestTab = [...panel.element.querySelectorAll('.response-panel-tab')].find(tab => tab.textContent!.trim() === 'Request') as HTMLElement
        requestTab.click()
        await settle()

        const box = panel.element.querySelector('.content-box')!
        expect(box.textContent).toContain(shown)
        expect(box.querySelector('user, b, img')).toBeNull()
        panel.unmount()
    }
})

test('the Request tab lists each file of a multipart row once, and leaves out a File row with no file picked, which the send skips', async() => {
    const params = [
        { name: 'files', type: 'file', files: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')] },
        // switched to File, with no file picked, which the send skips and history keeps
        { name: 'empty', type: 'file' },
    ]
    const saved = { ...finishedSmallJson(), request: { method: 'POST', headers: {}, body: null, original: { body: { mimeType: 'multipart/form-data', params } } } }
    const state = storeState({
        activeTab: { _id: 'tab1' },
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: saved },
    })
    const panel = mountPanel(state)
    await settle()

    const requestTab = [...panel.element.querySelectorAll('.response-panel-tab')].find(tab => tab.textContent!.trim() === 'Request') as HTMLElement
    requestTab.click()
    await settle()

    const box = panel.element.querySelector('.content-box')!
    expect([...box.querySelectorAll('a[download]')].map(link => link.textContent)).toEqual(['a.txt', 'b.txt'])
    expect([...box.querySelectorAll('td')].map(cell => cell.textContent!.trim())).toEqual(['files', 'a.txtb.txt'])
    panel.unmount()
})

test('the Request tab of one panel keeps its download link working while another panel shows its own, and revokes it once it goes', async() => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const panels = []
    for(const name of ['a.txt', 'b.txt']) {
        const saved = { ...finishedSmallJson(), request: { method: 'POST', headers: {}, body: new File(['a'], name), original: { body: { mimeType: 'application/octet-stream' } } } }
        const panel = mountPanel(storeState({
            activeTab: { _id: 'tab1' },
            requestResponseStatus: { tab1: 'loaded' },
            requestResponses: { tab1: saved },
        }))
        await settle()
        const requestTab = [...panel.element.querySelectorAll('.response-panel-tab')].find(tab => tab.textContent!.trim() === 'Request') as HTMLElement
        requestTab.click()
        await settle()
        panels.push(panel)
    }
    const links = panels.map(panel => (panel.element.querySelector('.content-box a[download]') as HTMLAnchorElement).href)
    expect(revoke).not.toHaveBeenCalledWith(links[0])
    panels[0].unmount()
    expect(revoke).toHaveBeenCalledWith(links[0])
    expect(revoke).not.toHaveBeenCalledWith(links[1])
    panels[1].unmount()
    revoke.mockRestore()
})

for(const [mimeType, rows, description] of [
    ['multipart/form-data', [], 'a multipart body whose rows were all deleted'],
    ['multipart/form-data', [{ name: 'a', value: '1', type: 'text', disabled: true }], 'a multipart body whose rows were all turned off'],
    // switching the body type keeps the rows of the one before
    ['No Body', [{ name: 'a', value: '1', type: 'text' }], 'No Body kept with the rows of a multipart body picked before'],
    // a file picked and cleared again leaves an empty list
    ['multipart/form-data', [{ name: 'f', type: 'file' }, { name: 'g', type: 'file', files: [] }], 'a multipart body whose File rows have no file'],
] as const) {
    test(`the Request tab shows no body for ${description}`, async() => {
        const saved = { ...finishedSmallJson(), request: { method: 'POST', headers: {}, body: null, original: { body: { mimeType, params: rows } } } }
        const state = storeState({
            activeTab: { _id: 'tab1' },
            requestResponseStatus: { tab1: 'loaded' },
            requestResponses: { tab1: saved },
        })
        const panel = mountPanel(state)
        await settle()

        const requestTab = [...panel.element.querySelectorAll('.response-panel-tab')].find(tab => tab.textContent!.trim() === 'Request') as HTMLElement
        requestTab.click()
        await settle()

        expect(panel.element.querySelector('.content-box')!.textContent).not.toContain('null')
        expect(panel.element.querySelector('.content-box td')).toBeNull()
        panel.unmount()
    })
}

test('the Request tab shows the body a pre-request script sent in place of the multipart rows', async() => {
    const saved = { ...finishedSmallJson(), request: { method: 'POST', headers: {}, body: '{"a":1}', original: { body: { mimeType: 'multipart/form-data', params: [{ name: 'row', value: '1', type: 'text' }] } } } }
    const state = storeState({
        activeTab: { _id: 'tab1' },
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: saved },
    })
    const panel = mountPanel(state)
    await settle()

    const requestTab = [...panel.element.querySelectorAll('.response-panel-tab')].find(tab => tab.textContent!.trim() === 'Request') as HTMLElement
    requestTab.click()
    await settle()

    const box = panel.element.querySelector('.content-box')!
    expect(box.querySelector('td')).toBeNull()
    expect(box.textContent).toContain('{"a":1}')
    panel.unmount()
})

test('the Request tab leaves out the multipart rows that were turned off, which the send skips', async() => {
    const params = [
        { name: 'sent', value: '1', type: 'text' },
        { name: 'off', value: '2', type: 'text', disabled: true },
        { name: 'offFile', type: 'file', files: [new File(['a'], 'a.txt')], disabled: true },
    ]
    const saved = { ...finishedSmallJson(), request: { method: 'POST', headers: {}, body: null, original: { body: { mimeType: 'multipart/form-data', params } } } }
    const state = storeState({
        activeTab: { _id: 'tab1' },
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: saved },
    })
    const panel = mountPanel(state)
    await settle()

    const requestTab = [...panel.element.querySelectorAll('.response-panel-tab')].find(tab => tab.textContent!.trim() === 'Request') as HTMLElement
    requestTab.click()
    await settle()

    expect([...panel.element.querySelectorAll('.content-box td')].map(cell => cell.textContent!.trim())).toEqual(['sent', '1'])
    panel.unmount()
})

test('the Request tab names a sent file as it is named, and downloads it under that name', async() => {
    const fileName = `report ${markup}.txt`
    const saved = { ...finishedSmallJson(), request: { method: 'POST', headers: {}, body: new File(['a'], fileName), original: { body: { mimeType: 'application/octet-stream' } } } }
    const state = storeState({
        activeTab: { _id: 'tab1' },
        requestResponseStatus: { tab1: 'loaded' },
        requestResponses: { tab1: saved },
    })
    const panel = mountPanel(state)
    await settle()

    const requestTab = [...panel.element.querySelectorAll('.response-panel-tab')].find(tab => tab.textContent!.trim() === 'Request') as HTMLElement
    requestTab.click()
    await settle()

    const link = panel.element.querySelector('.content-box a[download]') as HTMLAnchorElement
    expect(panel.element.querySelector('.content-box img')).toBeNull()
    expect(link.textContent).toBe(fileName)
    expect(link.getAttribute('download')).toBe(fileName)
    panel.unmount()
})
