// @vitest-environment happy-dom

import { test, expect, vi, afterEach } from 'vitest'
import { KeepAlive, createApp, h, nextTick, reactive } from 'vue'
import GrpcMethodPicker from './GrpcMethodPicker.vue'
import type { GrpcCallKind } from '@/global'
import type { GrpcSchema } from '@/utils/grpc'
import type { GrpcSchemaEntry } from '@/utils/grpc-calls'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

const method = (name: string, requestStream = false, responseStream = false) => ({ name, path: `/x/${name}`, requestStream, responseStream, inputType: 'x.In', outputType: 'x.Out', example: '{}' })

const schema: GrpcSchema = {
    source: 'reflection',
    services: [
        { name: 'demo.v1.Demo', methods: [method('SayHello'), method('Count', false, true), method('Chat', true, true)] },
        { name: 'shop.v2.Orders', methods: [method('ListOrders', false, true), method('GetOrder'), method('Order10'), method('Order2')] },
    ],
}

function loadedEntry(): GrpcSchemaEntry {
    return { loading: false, schema, loadedAt: 1, error: null, errorCode: null, failedAt: null }
}

function mountPicker(initial: Partial<{ service: string, method: string, kind: GrpcCallKind | null, schemaEntry: GrpcSchemaEntry | null, source: 'reflection' | 'proto', unavailableReason: string | null }> = {}) {
    const props = reactive({ service: '', method: '', kind: null, schemaEntry: loadedEntry(), source: 'reflection', unavailableReason: null, ...initial }) as InstanceType<typeof GrpcMethodPicker>['$props']
    const emitted: { name: string, args: unknown[] }[] = []
    const element = document.createElement('div')
    document.body.appendChild(element)
    const pickerApp = createApp({
        render: () => h(GrpcMethodPicker, {
            ...props,
            onSelect: (...args: unknown[]) => emitted.push({ name: 'select', args }),
            onOpen: () => emitted.push({ name: 'open', args: [] }),
            onRetry: () => emitted.push({ name: 'retry', args: [] }),
            onUseProtoFiles: () => emitted.push({ name: 'use-proto-files', args: [] }),
        }),
    })
    pickerApp.mount(element)
    const button = () => element.querySelector('.grpc-method-picker-button') as HTMLButtonElement
    return {
        props,
        element,
        emitted,
        button,
        async open() {
            button().click()
            await nextTick()
            await nextTick()
        },
        dropdown: () => element.querySelector('.grpc-method-picker-dropdown') as HTMLElement | null,
        search: () => element.querySelector('.grpc-method-picker-search input') as HTMLInputElement,
        options: () => [...element.querySelectorAll('.grpc-method-picker-option')].map(option => option.querySelector('.grpc-method-picker-option-name')!.textContent),
        highlighted: () => element.querySelector('.grpc-method-picker-option-highlighted .grpc-method-picker-option-name')?.textContent ?? null,
        async type(query: string) {
            const search = element.querySelector('.grpc-method-picker-search input') as HTMLInputElement
            search.value = query
            search.dispatchEvent(new Event('input'))
            await nextTick()
        },
        async press(key: string) {
            const search = element.querySelector('.grpc-method-picker-search input') as HTMLInputElement
            search.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
            await nextTick()
        },
        unmount: () => pickerApp.unmount(),
    }
}

test('the button shows the short service name, the method and its kind, the full name in its title', () => {
    const picker = mountPicker({ service: 'demo.v1.Demo', method: 'Count', kind: 'serverStream' })
    expect(picker.button().querySelector('.grpc-method-picker-button-name')!.textContent).toBe('Demo ▸ Count')
    expect(picker.button().querySelector('.grpc-method-picker-kind')!.textContent).toBe('server stream')
    expect(picker.button().title).toBe('demo.v1.Demo/Count, server stream')

    const empty = mountPicker()
    expect(empty.button().textContent!.trim()).toBe('Choose a method')
    picker.unmount()
    empty.unmount()
})

test('opening lists the methods by service with their kinds, ticks the chosen one and focuses the search', async() => {
    const picker = mountPicker({ service: 'shop.v2.Orders', method: 'GetOrder' })
    await picker.open()

    expect(picker.emitted.map(event => event.name)).toEqual(['open'])
    expect([...picker.element.querySelectorAll('.grpc-method-picker-group')].map(group => group.textContent)).toEqual(['demo.v1.Demo', 'shop.v2.Orders'])
    expect(picker.options()).toEqual(['SayHello', 'Count', 'Chat', 'ListOrders', 'GetOrder', 'Order10', 'Order2'])
    const kinds = [...picker.element.querySelectorAll('.grpc-method-picker-option .grpc-method-picker-kind')].map(kind => kind.textContent)
    expect(kinds.slice(0, 3)).toEqual(['unary', 'server stream', 'bidi stream'])
    expect(picker.element.querySelector('.grpc-method-picker-option-check-shown')!.closest('button')!.textContent).toContain('GetOrder')
    // reopening highlights the chosen method
    expect(picker.highlighted()).toBe('GetOrder')
    expect(document.activeElement).toBe(picker.search())
    picker.unmount()
})

test('typing ranks the matches, highlights the best one and Enter chooses it', async() => {
    const picker = mountPicker()
    await picker.open()

    await picker.type('order')
    expect(picker.options()).toEqual(['Order2', 'Order10', 'GetOrder', 'ListOrders'])
    expect(picker.highlighted()).toBe('Order2')
    // the service shows beside each method while searching, there are no headings
    expect(picker.element.querySelectorAll('.grpc-method-picker-group')).toHaveLength(0)

    await picker.press('ArrowDown')
    await picker.press('ArrowDown')
    expect(picker.highlighted()).toBe('GetOrder')
    await picker.press('ArrowUp')
    expect(picker.highlighted()).toBe('Order10')

    // the best match again once the query changes
    await picker.type('order get')
    expect(picker.options()).toEqual(['GetOrder'])
    expect(picker.highlighted()).toBe('GetOrder')

    await picker.press('Enter')
    expect(picker.emitted.at(-1)!.name).toBe('select')
    expect(picker.emitted.at(-1)!.args[0]).toMatchObject({ service: 'shop.v2.Orders', method: { name: 'GetOrder' } })
    expect(picker.dropdown()).toBeNull()
    expect(document.activeElement).toBe(picker.button())
    picker.unmount()
})

test('Enter with no match chooses nothing', async() => {
    const picker = mountPicker()
    await picker.open()
    await picker.type('zzz')
    expect(picker.element.textContent).toContain('No methods match "zzz"')
    await picker.press('Enter')
    expect(picker.emitted.filter(event => event.name === 'select')).toHaveLength(0)
    expect(picker.dropdown()).not.toBeNull()
    picker.unmount()
})

test('Escape and a press outside close the list, Escape returns focus to the button', async() => {
    const picker = mountPicker()
    await picker.open()
    picker.search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(picker.dropdown()).toBeNull()
    expect(document.activeElement).toBe(picker.button())

    await picker.open()
    const background = picker.element.querySelector('.grpc-method-picker-background') as HTMLElement
    background.click()
    await nextTick()
    expect(picker.dropdown()).toBeNull()
    picker.unmount()
})

test('the list stays inside the window and opens upward when there is more room above', async() => {
    const picker = mountPicker()
    vi.spyOn(picker.button(), 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 732, left: 900, right: 1000, width: 100, height: 32, x: 900, y: 700, toJSON: () => ({}) })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    await picker.open()
    const style = picker.dropdown()!.style
    expect(style.bottom).toBe('68px')
    expect(style.top).toBe('')
    // right-aligned to the button, and never past the window's left edge
    expect(parseFloat(style.left) + parseFloat(style.width)).toBeLessThanOrEqual(1000)
    expect(parseFloat(style.left)).toBeGreaterThanOrEqual(8)
    picker.unmount()
})

test('loading shows only once it takes a moment, a failed reflection offers Retry and .proto files', async() => {
    vi.useFakeTimers()
    const picker = mountPicker({ schemaEntry: { loading: true, schema: null, loadedAt: null, error: null, errorCode: null, failedAt: null } })
    await picker.open()
    expect(picker.element.textContent).not.toContain('Loading methods')
    vi.advanceTimersByTime(250)
    await nextTick()
    expect(picker.element.textContent).toContain('Loading methods from the server')

    picker.props.schemaEntry = { loading: false, schema: null, loadedAt: null, error: 'The server does not offer server reflection', errorCode: 'REFLECTION_UNIMPLEMENTED', failedAt: 2 }
    await nextTick()
    expect(picker.element.textContent).toContain('The server does not offer server reflection')
    const buttons = [...picker.element.querySelectorAll('.grpc-method-picker-actions button')] as HTMLButtonElement[]
    expect(buttons.map(button => button.textContent)).toEqual(['Retry', 'Use .proto files'])
    buttons[0].click()
    buttons[1].click()
    expect(picker.emitted.map(event => event.name)).toEqual(['open', 'retry', 'use-proto-files'])
    picker.unmount()
})

test('a server with no services, a list not loaded yet and a build that cannot load each say so', async() => {
    const empty = mountPicker({ schemaEntry: { ...loadedEntry(), schema: { source: 'proto', services: [] } }, source: 'proto' })
    await empty.open()
    expect(empty.element.textContent).toContain('The .proto files define no services.')
    empty.unmount()

    const notLoaded = mountPicker({ schemaEntry: null })
    await notLoaded.open()
    expect(notLoaded.element.textContent).toContain('The methods have not been loaded.')
    const loadMethods = notLoaded.element.querySelector('.grpc-method-picker-actions button') as HTMLButtonElement
    loadMethods.click()
    expect(notLoaded.emitted.map(event => event.name)).toEqual(['open', 'retry'])
    notLoaded.unmount()

    const browser = mountPicker({ schemaEntry: null, unavailableReason: 'Loading methods needs the Restfox desktop app or a self-hosted Restfox.' })
    await browser.open()
    expect(browser.element.textContent).toContain('Loading methods needs the Restfox desktop app')
    browser.unmount()
})

test('Escape closes the list wherever focus is, such as on the page after a click on a heading', async() => {
    const picker = mountPicker()
    await picker.open()
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(picker.dropdown()).toBeNull()
    expect(document.activeElement).toBe(picker.button())
    picker.unmount()
})

test('in a tab moved to a window of its own, the list fits that window and Escape there closes it', async() => {
    const picker = mountPicker()
    // a window of its own, as the one Move to New Window opens, shorter than the main window
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const ownWindow = frame.contentWindow!
    Object.defineProperty(ownWindow, 'innerHeight', { configurable: true, value: 400 })
    Object.defineProperty(ownWindow, 'innerWidth', { configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    ownWindow.document.body.appendChild(picker.element)
    vi.spyOn(picker.button(), 'getBoundingClientRect').mockReturnValue({ top: 300, bottom: 332, left: 900, right: 1000, width: 100, height: 32, x: 900, y: 300, toJSON: () => ({}) })

    await picker.open()
    // 60 px left below it in its own window, so it opens upward
    expect(picker.dropdown()!.style.bottom).toBe('100px')

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(picker.dropdown()).not.toBeNull()
    ownWindow.document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(picker.dropdown()).toBeNull()
    picker.unmount()
})

test('methods that arrive while the list is open bring the search box with focus, so typing and Enter work', async() => {
    const picker = mountPicker({ schemaEntry: { loading: true, schema: null, loadedAt: null, error: null, errorCode: null, failedAt: null } })
    await picker.open()
    expect(picker.search()).toBeNull()

    picker.props.schemaEntry = loadedEntry()
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(picker.search())
    await picker.type('chat')
    await picker.press('Enter')
    expect(picker.emitted.find(event => event.name === 'select')?.args[0]).toMatchObject({ service: 'demo.v1.Demo', method: expect.objectContaining({ name: 'Chat' }) })
    picker.unmount()
})

test('methods that arrive again while a search is typed keep the highlighted method', async() => {
    const picker = mountPicker({ service: 'demo.v1.Demo', method: 'SayHello' })
    await picker.open()
    await picker.type('order')
    await picker.press('ArrowDown')
    const highlighted = picker.highlighted()
    expect(highlighted).not.toBe(picker.options()[0])

    // such as a Reload the list's Retry started
    picker.props.schemaEntry = { ...loadedEntry(), schema: { ...schema, services: [...schema.services] }, loadedAt: 2 }
    await nextTick()
    await nextTick()
    expect(picker.highlighted()).toBe(highlighted)
    picker.unmount()
})

test('.proto files are offered for reflection that failed, not for a connection that did', async() => {
    const connection = mountPicker({ schemaEntry: { loading: false, schema: null, loadedAt: null, error: '127.0.0.1:50051 refused the connection', errorCode: 'CONNECTION_FAILED', failedAt: 2 } })
    await connection.open()
    expect([...connection.element.querySelectorAll('.grpc-method-picker-actions button')].map(button => button.textContent)).toEqual(['Retry'])
    connection.unmount()

    const reflection = mountPicker({ schemaEntry: { loading: false, schema: null, loadedAt: null, error: 'Server reflection failed: INTERNAL: oops', errorCode: 'REFLECTION_FAILED', failedAt: 2 } })
    await reflection.open()
    expect([...reflection.element.querySelectorAll('.grpc-method-picker-actions button')].map(button => button.textContent)).toEqual(['Retry', 'Use .proto files'])
    reflection.unmount()
})

test('there is no search box while there are no methods to search', async() => {
    const browser = mountPicker({ schemaEntry: null, unavailableReason: 'Loading methods needs the Restfox desktop app or a self-hosted Restfox.' })
    await browser.open()
    expect(browser.element.querySelector('.grpc-method-picker-search')).toBeNull()
    browser.unmount()
})

test('services the server listed but did not describe are named under the methods', async() => {
    const picker = mountPicker({ schemaEntry: { ...loadedEntry(), schema: { ...schema, missingServices: ['missing.Gone'] } } })
    await picker.open()
    expect(picker.element.textContent).toContain('The server lists missing.Gone but did not describe it, so it is not shown.')
    picker.unmount()
})

test('the arrow keys keep the highlighted method in view, with its service heading when it is the first of its group', async() => {
    const picker = mountPicker()
    await picker.open()
    // happy-dom does no layout: a list 100 px tall, headings 20 px and methods 30 px, one after the other
    const list = picker.element.querySelector('.grpc-method-picker-list') as HTMLElement
    let scrollTop = 0
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 100 })
    Object.defineProperty(list, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
            scrollTop = Math.max(0, Math.min(value, 250 - 100))
        },
    })
    let offsetTop = 0
    for(const row of [...list.children] as HTMLElement[]) {
        const top = offsetTop
        const height = row.classList.contains('grpc-method-picker-group') ? 20 : 30
        Object.defineProperty(row, 'offsetTop', { configurable: true, get: () => top })
        Object.defineProperty(row, 'offsetHeight', { configurable: true, get: () => height })
        offsetTop += height
    }
    expect(offsetTop).toBe(250)

    await picker.press('ArrowDown')
    expect(picker.highlighted()).toBe('Count')
    expect(list.scrollTop).toBe(0)
    // Chat ends at 110 px
    await picker.press('ArrowDown')
    expect(picker.highlighted()).toBe('Chat')
    expect(list.scrollTop).toBe(10)
    for(let press = 0; press < 4; press++) {
        await picker.press('ArrowDown')
    }
    expect(picker.highlighted()).toBe('Order2')
    expect(list.scrollTop).toBe(150)

    await picker.press('ArrowUp')
    await picker.press('ArrowUp')
    expect(picker.highlighted()).toBe('GetOrder')
    expect(list.scrollTop).toBe(150)
    // ListOrders starts at 130 px, under the shop.v2.Orders heading at 110 px
    await picker.press('ArrowUp')
    expect(picker.highlighted()).toBe('ListOrders')
    expect(list.scrollTop).toBe(110)
    picker.unmount()
})

test('an open list closes when its tab is switched away, so the tab comes back with it closed', async() => {
    const view = reactive({ shown: true })
    const otherTab = { render: () => h('div', 'Other tab') }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const pickerApp = createApp({
        render: () => h(KeepAlive, null, { default: () => view.shown ? h(GrpcMethodPicker, { schemaEntry: loadedEntry() }) : h(otherTab) }),
    })
    pickerApp.mount(element)
    const button = element.querySelector('.grpc-method-picker-button') as HTMLButtonElement
    button.click()
    await nextTick()
    expect(element.querySelector('.grpc-method-picker-dropdown')).not.toBeNull()

    view.shown = false
    await nextTick()
    expect(element.textContent).toBe('Other tab')
    view.shown = true
    await nextTick()
    expect(element.querySelector('.grpc-method-picker-button')).toBe(button)
    expect(element.querySelector('.grpc-method-picker-dropdown')).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    pickerApp.unmount()
})

test('a reload that failed keeps the methods it had and says it failed', async() => {
    const picker = mountPicker({ schemaEntry: { loading: false, schema, loadedAt: 1, error: 'connect ECONNREFUSED 127.0.0.1:50051', errorCode: null, failedAt: 2 } })
    await picker.open()
    expect(picker.element.textContent).toContain('Reload failed: connect ECONNREFUSED 127.0.0.1:50051')
    expect(picker.options()).toHaveLength(7)
    picker.unmount()
})
