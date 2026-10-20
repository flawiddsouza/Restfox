// @vitest-environment happy-dom

import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createApp, h, nextTick, reactive, markRaw } from 'vue'
import ResponseEventList from './ResponseEventList.vue'
import type { EventStreamItem } from '@/global'

const ROW_HEIGHT = 26

beforeEach(() => {
    // jsonStringify reads the indent size, Node 25 and later hide happy-dom's localStorage
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

function chatItem(index: number, content: string): EventStreamItem {
    return { index, data: JSON.stringify({ choices: [{ index: 0, delta: { content } }] }) }
}

type Props = { items: EventStreamItem[], pending?: EventStreamItem | null, live?: boolean, view?: string, times?: number[] | null }

function mountList(initialProps: Props) {
    const props = reactive({ pending: null, live: false, view: 'events', times: null, ...initialProps, items: markRaw(initialProps.items) })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const listApp = createApp({
        render: () => h(ResponseEventList, props),
    })
    // the line wrapping flag the detail pane's viewer reads
    listApp.config.globalProperties.$store = { state: reactive({ flags: { responseLineWrapping: false } }) }
    listApp.mount(element)
    return {
        props,
        element,
        setItems(items: EventStreamItem[]) {
            props.items = markRaw(items)
        },
        rows: () => [...element.querySelectorAll('.response-event-list-row')] as HTMLElement[],
        rowTexts: () => [...element.querySelectorAll('.response-event-list-row')].map(row => [...row.children].map(cell => cell.textContent!.trim())),
        scroller: () => element.querySelector('.response-event-list-scroller') as HTMLElement,
        unmount: () => {
            listApp.unmount()
            element.remove()
        },
    }
}

// happy-dom does no layout, so the scroller gets the sizes a browser would give it
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

async function userScrollsTo(scroller: HTMLElement, top: number) {
    scroller.scrollTop = top
    scroller.dispatchEvent(new Event('scroll'))
    await nextTick()
}

test('draws only the rows in view of a long list, and every row stays reachable', async() => {
    const items = Array.from({ length: 100000 }, (_, index) => chatItem(index, `word${index} `))
    const list = mountList({ items })

    const spacer = list.element.querySelector('.response-event-list-spacer') as HTMLElement
    expect(spacer.style.height).toBe(`${100000 * ROW_HEIGHT}px`)
    expect(list.rows().length).toBeLessThan(60)
    expect(list.rowTexts()[0][0]).toBe('1')

    giveScrollerLayout(list.scroller(), 260)
    await userScrollsTo(list.scroller(), 99990 * ROW_HEIGHT)
    const numbers = list.rowTexts().map(cells => Number(cells[0]))
    expect(numbers).toContain(100000)
    expect(numbers).toContain(99991)
    expect(list.rows().length).toBeLessThan(60)

    list.unmount()
})

test('the extracted text covers every event, not only the drawn ones', () => {
    const items = Array.from({ length: 20000 }, (_, index) => chatItem(index, 'a'))
    const list = mountList({ items })

    const extracted = list.element.querySelector('.response-event-list-extracted-text')!
    expect(extracted.textContent).toBe('a'.repeat(20000))

    list.unmount()
})

test('rows show number, event, id and a one line data preview, comments dimmed, an incomplete event marked', () => {
    const list = mountList({
        items: [
            { index: 0, data: 'line one\nline two', event: 'update', id: '7' },
            { index: 1, data: 'keepalive', comment: true },
            { index: 2, data: '{"a":', incomplete: true },
        ],
    })

    expect(list.rowTexts()).toEqual([
        ['1', 'update', '7', 'line one line two'],
        ['2', '', '', 'comment keepalive'],
        ['3', '', '', 'incomplete {"a":'],
    ])
    expect(list.rows()[1].classList.contains('response-event-list-row-comment')).toBe(true)

    list.unmount()
})

test('the event being received shows last, marked as receiving', () => {
    const list = mountList({ items: [chatItem(0, 'Hi')], pending: { index: 1, data: 'partial' }, live: true })

    const rows = list.rows()
    expect(rows).toHaveLength(2)
    expect(rows[1].classList.contains('response-event-list-row-pending')).toBe(true)
    expect(list.rowTexts()[1]).toEqual(['2', 'receiving partial'])

    list.unmount()
})

test('a time column shows when arrival times are known, and is left out otherwise', () => {
    const withTimes = mountList({ items: [chatItem(0, 'a'), chatItem(1, 'b')], times: [312, 1240] })
    expect(withTimes.element.querySelector('.response-event-list-columns')!.textContent).toContain('Time')
    expect(withTimes.rowTexts().map(cells => cells[1])).toEqual(['+0.31 s', '+1.24 s'])
    withTimes.unmount()

    const withoutTimes = mountList({ items: [chatItem(0, 'a')] })
    expect(withoutTimes.element.querySelector('.response-event-list-columns')!.textContent).not.toContain('Time')
    expect(withoutTimes.rowTexts()[0]).toHaveLength(2)
    withoutTimes.unmount()
})

test('the lines view has no event and id columns', () => {
    const list = mountList({ items: [{ index: 0, data: '{"done":false}' }], view: 'lines' })
    expect(list.rowTexts()).toEqual([['1', '{"done":false}']])
    list.unmount()
})

test('extracted text joins the matches of the inferred path and grows as events arrive', async() => {
    const items = [chatItem(0, 'Hel'), { index: 1, data: 'ping', comment: true }]
    const list = mountList({ items, live: true })

    const input = list.element.querySelector('.response-event-list-path input') as HTMLInputElement
    expect(input.value).toBe('$.choices[0].delta.content')
    expect(list.element.querySelector('.response-event-list-extracted-text')!.textContent).toBe('Hel')

    list.setItems([...items, chatItem(2, 'lo'), { index: 3, data: '[DONE]' }])
    await nextTick()
    expect(list.element.querySelector('.response-event-list-extracted-text')!.textContent).toBe('Hello')

    list.unmount()
})

test('a typed path replaces the inferred one, and a path matching nothing says so', async() => {
    const list = mountList({ items: [chatItem(0, 'Hel'), chatItem(1, 'lo')] })

    const input = list.element.querySelector('.response-event-list-path input') as HTMLInputElement
    input.value = '$.choices[0].index'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    expect(list.element.querySelector('.response-event-list-extracted-text')).toBeNull()
    expect(list.element.querySelector('.response-event-list-no-match')!.textContent).toBe('No events matched')

    input.value = '$.choices[0].delta.content'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    expect(list.element.querySelector('.response-event-list-extracted-text')!.textContent).toBe('Hello')

    list.unmount()
})

test('no extracted text pane without a path', () => {
    const list = mountList({ items: [{ index: 0, data: 'plain text' }] })
    expect(list.element.querySelector('.response-event-list-extracted')).toBeNull()
    expect((list.element.querySelector('.response-event-list-path input') as HTMLInputElement).value).toBe('')
    list.unmount()
})

test('clicking a row shows its data pretty printed, clicking it again hides it', async() => {
    const list = mountList({ items: [{ index: 0, data: '{"a":{"b":1}}' }, { index: 1, data: 'not json' }] })

    // the lines the detail pane's viewer draws
    const detailText = () => [...list.element.querySelectorAll('.response-event-list-detail-text .cm-line')].map(line => line.textContent).join('\n')

    list.rows()[0].click()
    await nextTick()
    expect(detailText()).toBe('{\n    "a": {\n        "b": 1\n    }\n}')

    list.rows()[1].click()
    await nextTick()
    expect(detailText()).toBe('not json')

    list.rows()[1].click()
    await nextTick()
    expect(list.element.querySelector('.response-event-list-detail')).toBeNull()

    list.unmount()
})

test('while live, the list follows new events only when scrolled to the bottom', async() => {
    const items = Array.from({ length: 50 }, (_, index) => chatItem(index, 'x'))
    const list = mountList({ items, live: true })
    const scroller = list.scroller()
    giveScrollerLayout(scroller, 260)

    // at the bottom: new events scroll into view
    await userScrollsTo(scroller, 50 * ROW_HEIGHT)
    list.setItems([...items, chatItem(50, 'x')])
    await nextTick()
    await nextTick()
    expect(scroller.scrollTop).toBe(51 * ROW_HEIGHT - 260)
    expect(list.element.querySelector('.response-event-list-scroll-to-latest')).toBeNull()

    // scrolled up: the position stays and the control shows
    await userScrollsTo(scroller, 100)
    expect(list.element.querySelector('.response-event-list-scroll-to-latest')).not.toBeNull()
    list.setItems([...items, chatItem(50, 'x'), chatItem(51, 'x')])
    await nextTick()
    await nextTick()
    expect(scroller.scrollTop).toBe(100)

    // the control scrolls down and following resumes
    ;(list.element.querySelector('.response-event-list-scroll-to-latest') as HTMLElement).click()
    await nextTick()
    await nextTick()
    expect(scroller.scrollTop).toBe(52 * ROW_HEIGHT - 260)
    expect(list.element.querySelector('.response-event-list-scroll-to-latest')).toBeNull()
    list.setItems([...items, chatItem(50, 'x'), chatItem(51, 'x'), chatItem(52, 'x')])
    await nextTick()
    await nextTick()
    expect(scroller.scrollTop).toBe(53 * ROW_HEIGHT - 260)

    list.unmount()
})

test('a finished response shows no scroll control and does not follow', async() => {
    const list = mountList({ items: Array.from({ length: 50 }, (_, index) => chatItem(index, 'x')) })
    giveScrollerLayout(list.scroller(), 260)
    await userScrollsTo(list.scroller(), 100)
    expect(list.element.querySelector('.response-event-list-scroll-to-latest')).toBeNull()
    list.unmount()
})

test('a scroll event that arrives after the list is gone, as when a stream ends while scrolling, does nothing', async() => {
    const errors: unknown[] = []
    const list = mountList({ items: [chatItem(0, 'a')], live: true })
    const scroller = list.scroller()
    list.unmount()
    window.addEventListener('error', event => errors.push(event.error))
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args))
    scroller.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(errors).toEqual([])
})

test('malformed data logs nothing', async() => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => vi.spyOn(console, method))
    const list = mountList({
        items: [
            { index: 0, data: '{"choices": [' },
            { index: 1, data: '\u0000�' },
            { index: 2, data: '{"choices":[{"delta":{"content":5}}]}' },
        ],
        live: true,
    })
    const input = list.element.querySelector('.response-event-list-path input') as HTMLInputElement
    input.value = '$..[?(@ ==='
    input.dispatchEvent(new Event('input'))
    await nextTick()
    list.rows()[0].click()
    await nextTick()
    list.unmount()
    for(const spy of spies) {
        expect(spy).not.toHaveBeenCalled()
    }
})

test('the event and id columns show when the first event has one', () => {
    const plain = mountList({ items: [chatItem(0, 'a'), chatItem(1, 'b')] })
    expect(plain.element.querySelector('.response-event-list-columns')!.textContent).toBe('#Data')
    plain.unmount()

    const named = mountList({ items: [{ index: 0, data: 'keepalive', comment: true }, { index: 1, data: 'x', event: 'ping' }, chatItem(2, 'a')] })
    expect(named.element.querySelector('.response-event-list-columns')!.textContent).toBe('#EventData')
    named.unmount()

    const withIds = mountList({ items: [{ index: 0, data: 'x', id: '1' }] })
    expect(withIds.element.querySelector('.response-event-list-columns')!.textContent).toBe('#IDData')
    withIds.unmount()
})

test('the columns stay as they are while events arrive, a comment or a named event later on is marked in its row', async() => {
    const items = [chatItem(0, 'a'), chatItem(1, 'b')]
    const list = mountList({ items, live: true })
    const columns = () => list.element.querySelector('.response-event-list-columns')!.textContent

    expect(columns()).toBe('#Data')
    list.setItems([...items, { index: 2, data: 'keepalive', comment: true }, { index: 3, data: 'x', event: 'ping', id: '9' }])
    await nextTick()
    expect(columns()).toBe('#Data')
    expect(list.rowTexts().slice(2)).toEqual([['3', 'comment keepalive'], ['4', 'ping x']])

    // the detail pane names what the row has no column for
    list.rows()[3].click()
    await nextTick()
    expect(list.element.querySelector('.response-event-list-detail .response-event-list-pane-header span')!.textContent).toBe('Event 4, ping, ID 9')

    list.unmount()
})

test('a row clicked near the bottom stays in view when the detail pane opens below it', async() => {
    const list = mountList({ items: Array.from({ length: 50 }, (_, index) => chatItem(index, 'x')) })
    const scroller = list.scroller()
    giveScrollerLayout(scroller, 260)
    // the detail pane takes 100 px from the list
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => list.element.querySelector('.response-event-list-detail') ? 160 : 260 })

    list.rows()[8].click()
    await nextTick()
    await nextTick()

    expect(scroller.scrollTop).toBeLessThanOrEqual(8 * ROW_HEIGHT)
    expect(scroller.scrollTop + 160).toBeGreaterThanOrEqual(9 * ROW_HEIGHT)
    expect(list.rowTexts().map(cells => cells[0])).toContain('9')

    list.unmount()
})

test('a list taller than a browser lets an element be still reaches every row', async() => {
    // Firefox stops an element at about 17.9 million px, which 26 px rows pass at about 690,000 events
    const count = 800000
    const items = Array.from({ length: count }, (_, index) => ({ index, data: `e${index}` }))
    const list = mountList({ items })
    const spacer = list.element.querySelector('.response-event-list-spacer') as HTMLElement
    const spacerHeight = parseFloat(spacer.style.height)
    expect(spacerHeight).toBeLessThan(17000000)

    const scroller = list.scroller()
    giveScrollerLayout(scroller, 260)
    const numbers = () => list.rowTexts().map(cells => Number(cells[0]))
    const rowTops = () => list.rows().map(row => parseFloat(row.style.top))

    await userScrollsTo(scroller, spacerHeight)
    expect(numbers()).toContain(count)
    // the last row sits at the bottom of the view
    const last = list.rows().find(row => row.firstElementChild!.textContent!.trim() === String(count))!
    expect(parseFloat(last.style.top) + ROW_HEIGHT).toBeCloseTo(scroller.scrollTop + 260, 0)

    await userScrollsTo(scroller, (spacerHeight - 260) / 2)
    const middle = numbers()
    expect(Math.min(...middle)).toBeLessThan(count / 2)
    expect(Math.max(...middle)).toBeGreaterThan(count / 2)
    rowTops().forEach(top => {
        expect(top).toBeGreaterThanOrEqual(0)
        expect(top).toBeLessThan(spacerHeight)
    })

    // a one pixel scroll still moves the rows
    const before = rowTops()[0]
    await userScrollsTo(scroller, scroller.scrollTop + 1)
    expect(rowTops()[0]).not.toBe(before)

    list.unmount()
})
