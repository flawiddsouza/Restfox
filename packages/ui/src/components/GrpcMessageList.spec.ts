// @vitest-environment happy-dom

import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { KeepAlive, createApp, h, markRaw, nextTick, reactive } from 'vue'
import { EditorView } from '@codemirror/view'
import { emitter } from '@/event-bus'
import GrpcMessageList from './GrpcMessageList.vue'
import type { GrpcCallResultEvent } from '@/global'
import type { GrpcMessageListViewState } from '@/utils/grpc'

const ROW_HEIGHT = 26

beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    })
})

const layoutCleanups: (() => void)[] = []

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    layoutCleanups.splice(0).forEach(cleanup => cleanup())
})

function message(index: number): GrpcCallResultEvent {
    return index % 2 === 0
        ? { type: 'sent', json: `{\n  "text": "hi ${index}"\n}`, time: index * 10 }
        : { type: 'received', json: `{\n  "text": "echo: hi ${index}"\n}`, time: index * 10 }
}

function mountList(initial: { events: GrpcCallResultEvent[], live?: boolean, viewState?: GrpcMessageListViewState | null }) {
    const props = reactive({ events: markRaw(initial.events), revision: 0, live: initial.live ?? false, viewState: initial.viewState ?? null })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const setEnvironmentVariable = vi.fn()
    const listApp = createApp({
        render: () => h(GrpcMessageList, { ...props, onSetEnvironmentVariable: setEnvironmentVariable }),
    })
    listApp.config.globalProperties.$store = { state: reactive({ flags: { responseLineWrapping: false } }) }
    listApp.mount(element)
    return {
        props,
        element,
        setEnvironmentVariable,
        // the events grow in place while a call runs, revision tells the list
        push(...events: GrpcCallResultEvent[]) {
            props.events.push(...events)
            props.revision++
        },
        rows: () => [...element.querySelectorAll('.grpc-message-list-row')] as HTMLElement[],
        scroller: () => element.querySelector('.grpc-message-list-scroller') as HTMLElement,
        unmount: () => {
            listApp.unmount()
            element.remove()
        },
    }
}

// happy-dom does no layout, so the scroller gets the sizes a browser would give it, resize changes its height
function giveScrollerLayout(scroller: HTMLElement, initialClientHeight: number) {
    let clientHeight = initialClientHeight
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
    return {
        resize(height: number) {
            clientHeight = height
        },
    }
}

// A list measures itself as it mounts, so a scroller created from now on has its layout from the start, given
// the first time the list reads or sets one of its sizes
function giveEveryScrollerLayout(clientHeight: number) {
    const sizes = [[HTMLElement.prototype, 'clientHeight'], [Element.prototype, 'scrollHeight'], [Element.prototype, 'scrollTop']] as const
    for(const [owner, name] of sizes) {
        const original = Object.getOwnPropertyDescriptor(owner, name)!
        Object.defineProperty(owner, name, {
            configurable: true,
            get(this: HTMLElement) {
                if(!this.classList.contains('grpc-message-list-scroller')) {
                    return original.get!.call(this)
                }
                giveScrollerLayout(this, clientHeight)
                return Reflect.get(this, name)
            },
            set(this: HTMLElement, value: number) {
                if(!this.classList.contains('grpc-message-list-scroller')) {
                    original.set!.call(this, value)
                    return
                }
                giveScrollerLayout(this, clientHeight)
                Reflect.set(this, name, value)
            },
        })
        layoutCleanups.push(() => Object.defineProperty(owner, name, original))
    }
}

// the numbers of the rows a user sees, each drawn with at least half of it inside the scroller
function rowNumbersInView(scroller: HTMLElement) {
    return ([...scroller.querySelectorAll('.grpc-message-list-row')] as HTMLElement[])
        .filter(row => {
            const middle = parseFloat(row.style.top) + ROW_HEIGHT / 2
            return middle >= scroller.scrollTop && middle <= scroller.scrollTop + scroller.clientHeight
        })
        .map(row => Number(row.firstElementChild!.textContent))
}

function numbers(first: number, last: number) {
    return Array.from({ length: last - first + 1 }, (_, index) => first + index)
}

async function userScrollsTo(scroller: HTMLElement, top: number) {
    scroller.scrollTop = top
    scroller.dispatchEvent(new Event('scroll'))
    await nextTick()
}

test('draws only the rows in view of a long call, each with its number, time, direction and one line of the message', async() => {
    const list = mountList({ events: Array.from({ length: 10000 }, (_, index) => message(index)) })
    giveScrollerLayout(list.scroller(), 10 * ROW_HEIGHT)
    await userScrollsTo(list.scroller(), 0)

    expect(list.rows().length).toBeLessThan(40)
    const [first, second] = list.rows()
    expect([...first.children].map(cell => cell.textContent!.trim())).toEqual(['1', '+0.00 s', '', '{ "text": "hi 0" }'])
    expect(first.querySelector('i')!.getAttribute('title')).toBe('Sent')
    expect(second.querySelector('i')!.getAttribute('title')).toBe('Received')

    // the last one is reachable
    await userScrollsTo(list.scroller(), 10000 * ROW_HEIGHT)
    expect(list.rows().at(-1)!.textContent).toContain('10000')
    list.unmount()
})

test('a live list follows the newest message, and once scrolled away offers Scroll to latest instead', async() => {
    const list = mountList({ events: [message(0)], live: true })
    giveScrollerLayout(list.scroller(), 5 * ROW_HEIGHT)
    expect(list.element.textContent).not.toContain('Scroll to latest')

    list.push(...Array.from({ length: 20 }, (_, index) => message(index + 1)))
    await nextTick()
    await nextTick()
    expect(list.scroller().scrollTop).toBe(16 * ROW_HEIGHT)

    await userScrollsTo(list.scroller(), 0)
    list.push(message(21))
    await nextTick()
    await nextTick()
    expect(list.scroller().scrollTop).toBe(0)
    const scrollToLatest = [...list.element.querySelectorAll('button')].find(button => button.textContent === 'Scroll to latest')!
    expect(scrollToLatest).toBeTruthy()

    scrollToLatest.click()
    await nextTick()
    await nextTick()
    expect(list.scroller().scrollTop).toBe(17 * ROW_HEIGHT)
    expect(list.element.textContent).not.toContain('Scroll to latest')
    list.unmount()
})

test('a row opens its whole message below the list, and a left out message says why', async() => {
    const list = mountList({ events: [message(0), { type: 'sent', omitted: true, time: 15 }] })
    giveScrollerLayout(list.scroller(), 5 * ROW_HEIGHT)
    await userScrollsTo(list.scroller(), 0)

    expect(list.rows()[1].textContent).toContain('(left out, a masked prompt value went into it)')

    list.rows()[0].click()
    await nextTick()
    const detail = list.element.querySelector('.grpc-message-list-detail') as HTMLElement
    expect(detail.querySelector('.grpc-message-list-pane-header')!.textContent).toContain('#1, sent at +0.00 s')
    expect(detail.querySelector('.cm-content')!.textContent).toContain('"text": "hi 0"')

    list.rows()[1].click()
    await nextTick()
    expect(list.element.querySelector('.grpc-message-list-detail')!.textContent).toContain('This message took a masked prompt value, so it was left out.')

    list.rows()[1].click()
    await nextTick()
    expect(list.element.querySelector('.grpc-message-list-detail')).toBeNull()
    list.unmount()
})

test('the list of a call that ended starts where the user left its live list', async() => {
    giveEveryScrollerLayout(5 * ROW_HEIGHT)
    const viewState: GrpcMessageListViewState = { scrollTop: null, stickToBottom: null, selectedIndex: null }
    const live = mountList({ events: Array.from({ length: 50 }, (_, index) => message(index)), live: true, viewState })
    await userScrollsTo(live.scroller(), 30 * ROW_HEIGHT)
    live.rows().find(row => row.textContent!.startsWith('32'))!.click()
    await nextTick()
    live.unmount()

    expect(viewState).toMatchObject({ scrollTop: 30 * ROW_HEIGHT, stickToBottom: false, selectedIndex: 31 })

    const finished = mountList({ events: Array.from({ length: 50 }, (_, index) => message(index)), live: false, viewState })
    await nextTick()
    expect(finished.scroller().scrollTop).toBe(30 * ROW_HEIGHT)
    expect(rowNumbersInView(finished.scroller())).toEqual(numbers(31, 35))
    expect(finished.element.querySelector('.grpc-message-list-pane-header')!.textContent).toContain('#32, received at')
    finished.unmount()
})

test('a list kept alive while its tab is not shown comes back where the user left it', async() => {
    const view = reactive({ shown: true })
    const events = markRaw(Array.from({ length: 50 }, (_, index) => message(index)))
    const otherTab = { render: () => h('div', 'Other tab') }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const listApp = createApp({
        render: () => h(KeepAlive, null, { default: () => view.shown ? h(GrpcMessageList, { events }) : h(otherTab) }),
    })
    listApp.config.globalProperties.$store = { state: reactive({ flags: { responseLineWrapping: false } }) }
    listApp.mount(element)
    const scroller = element.querySelector('.grpc-message-list-scroller') as HTMLElement
    giveScrollerLayout(scroller, 5 * ROW_HEIGHT)
    await userScrollsTo(scroller, 30 * ROW_HEIGHT)

    view.shown = false
    await nextTick()
    expect(element.textContent).toBe('Other tab')
    // a browser resets the scroll position of an element taken out of the page, happy-dom keeps it
    scroller.scrollTop = 0

    view.shown = true
    await nextTick()
    expect(element.querySelector('.grpc-message-list-scroller')).toBe(scroller)
    expect(scroller.scrollTop).toBe(30 * ROW_HEIGHT)
    expect(rowNumbersInView(scroller)).toEqual(numbers(31, 35))
    listApp.unmount()
    element.remove()
})

test('a list too long for the browser to make that tall still reaches its last row and its middle', async() => {
    // 26 px rows pass the spacer's 10,000,000 px limit at about 384,616 messages
    const count = 400000
    const list = mountList({ events: Array.from({ length: count }, (_, index) => message(index)) })
    giveScrollerLayout(list.scroller(), 10 * ROW_HEIGHT)
    await userScrollsTo(list.scroller(), count * ROW_HEIGHT)
    expect(list.scroller().scrollHeight).toBe(10000000)
    expect(rowNumbersInView(list.scroller())).toEqual(numbers(count - 9, count))

    await userScrollsTo(list.scroller(), (list.scroller().scrollHeight - list.scroller().clientHeight) / 2)
    expect(rowNumbersInView(list.scroller())).toEqual(numbers(count / 2 - 4, count / 2 + 5))
    list.unmount()
})

test('a row clicked in a list at its end stays in view when its message opens below and makes the list shorter', async() => {
    const resizeCallbacks: (() => void)[] = []
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) {
            resizeCallbacks.push(callback)
        }
        observe() {
            return undefined
        }
        disconnect() {
            return undefined
        }
    })
    const list = mountList({ events: Array.from({ length: 50 }, (_, index) => message(index)), live: true })
    const layout = giveScrollerLayout(list.scroller(), 10 * ROW_HEIGHT)
    await userScrollsTo(list.scroller(), 50 * ROW_HEIGHT)
    expect(rowNumbersInView(list.scroller())).toEqual(numbers(41, 50))

    list.rows().find(row => row.textContent!.startsWith('42'))!.click()
    // the message opens below the list, which is laid out shorter before the list measures itself
    layout.resize(6 * ROW_HEIGHT)
    await nextTick()
    // then the browser reports the new size
    resizeCallbacks.forEach(callback => callback())
    await nextTick()
    expect(list.element.querySelector('.grpc-message-list-pane-header')!.textContent).toContain('#42')
    expect(rowNumbersInView(list.scroller())).toContain(42)
    list.unmount()
})

test('a list at its end shows the last messages, which arrive in the same update that ends the call', async() => {
    const list = mountList({ events: [message(0)], live: true })
    giveScrollerLayout(list.scroller(), 5 * ROW_HEIGHT)
    list.push(...Array.from({ length: 10 }, (_, index) => message(index + 1)))
    await nextTick()
    await nextTick()
    expect(list.scroller().scrollTop).toBe(6 * ROW_HEIGHT)

    list.push(message(11), message(12))
    list.props.live = false
    await nextTick()
    await nextTick()
    expect(list.scroller().scrollTop).toBe(8 * ROW_HEIGHT)
    list.unmount()
})

test('a list with no messages says so, and says yet while the call runs', async() => {
    const live = mountList({ events: [], live: true })
    expect(live.element.textContent).toContain('No messages yet')
    live.props.live = false
    await nextTick()
    expect(live.element.textContent).toContain('No messages')
    expect(live.element.textContent).not.toContain('yet')
    live.unmount()
})

test('undecodable and unknown-field stream rows show a note and keep their bytes in the opened detail', async() => {
    const list = mountList({ events: [
        { type: 'received', bytes: 'CgVB', decodeError: 'Not a Reply: index out of range', time: 1 } as any,
        { type: 'received', json: '{"text":"known"}', bytes: 'CgVrbm93blAH', unknownFields: ['2', 'point.5', 'items.3', 'labels.value.4', 'extra.6'], time: 2 } as any,
    ] })
    expect(list.rows()[0].textContent).toContain('Could not be decoded')
    expect(list.rows()[1].textContent).toContain('Has fields the .proto files do not describe: 2, point.5, items.3, labels.value.4, extra.6')
    for(const [index, bytes] of [[0, 'CgVB'], [1, 'CgVrbm93blAH']] as const) {
        list.rows()[index].click()
        await nextTick()
        expect(list.element.querySelector('.grpc-message-list-detail')!.textContent).toContain(bytes)
        if(index === 1) {
            expect(list.element.querySelector('.grpc-message-list-detail')!.textContent).toContain('Has fields the .proto files do not describe: 2, point.5, items.3, labels.value.4, extra.6')
        }
    }
    list.unmount()
})

test('an opened stream message re-indents with the setting and offers its selection as an environment variable', async() => {
    localStorage.setItem('Restfox-IndentSize', '2')
    const list = mountList({ events: [{ type: 'received', json: '{"nested":{"value":"picked"}}', time: 1 }] })
    list.rows()[0].click()
    await nextTick()
    expect(list.element.querySelector('.cm-line:nth-child(3)')!.textContent).toBe('    "value": "picked"')
    localStorage.setItem('Restfox-IndentSize', '4')
    emitter.emit('editor_indent_size', 4)
    await nextTick()
    expect(list.element.querySelector('.cm-line:nth-child(3)')!.textContent).toBe('        "value": "picked"')
    const editor = EditorView.findFromDOM(list.element.querySelector('.cm-editor') as HTMLElement)!
    const start = editor.state.doc.toString().indexOf('picked')
    editor.dispatch({ selection: { anchor: start, head: start + 6 } })
    const action = list.element.querySelector('[title="Set selected text as environment variable"]') as HTMLElement
    expect(action).not.toBeNull()
    action.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(list.setEnvironmentVariable).toHaveBeenCalledWith('picked')
    list.unmount()
})

test('a large stream message asks before opening the viewer and resets for another message', async() => {
    const json = JSON.stringify({ text: 'x'.repeat(3 * 1024 * 1024) })
    const list = mountList({ events: [{ type: 'received', json, time: 1 }, { type: 'received', json, time: 2 }] })
    list.rows()[0].click()
    await nextTick()
    expect(list.element.textContent).toContain('Large Response Warning')
    expect(list.element.querySelector('.cm-editor')).toBeNull()
    const load = [...list.element.querySelectorAll('button')].find(button => button.textContent === 'Load Response')!
    load.click()
    await nextTick()
    expect(list.element.querySelector('.cm-editor')).not.toBeNull()
    list.rows()[1].click()
    await nextTick()
    expect(list.element.textContent).toContain('Large Response Warning')
    expect(list.element.querySelector('.cm-editor')).toBeNull()
    list.unmount()
})


test('re-indenting a stream message clears the selected environment variable text', async() => {
    const list = mountList({ events: [{ type: 'received', json: '{"text":"picked"}', time: 1 }] })
    list.rows()[0].click()
    await nextTick()
    const editor = EditorView.findFromDOM(list.element.querySelector('.cm-editor') as HTMLElement)!
    const start = editor.state.doc.toString().indexOf('picked')
    editor.dispatch({ selection: { anchor: start, head: start + 6 } })
    await nextTick()
    expect(list.element.querySelector('[title="Set selected text as environment variable"]')).not.toBeNull()
    localStorage.setItem('Restfox-IndentSize', '8')
    emitter.emit('editor_indent_size', 8)
    await nextTick()
    expect(list.element.querySelector('.cm-line:nth-child(2)')!.textContent).toBe('        "text": "picked"')
    ;(list.element.querySelector('[title="Set selected text as environment variable"]') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(list.setEnvironmentVariable).toHaveBeenCalledWith('')
    list.unmount()
})
