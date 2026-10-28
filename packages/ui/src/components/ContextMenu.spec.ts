// @vitest-environment happy-dom

import { test, expect, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import ContextMenu from './ContextMenu.vue'

afterEach(() => {
    document.body.innerHTML = ''
})

test('a menu given a width narrower than its least width stays inside the window at the width it is drawn at, and under its control', async() => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
    const props = reactive({ show: false })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const app = createApp({
        render: () => h(ContextMenu, {
            options: [{ type: 'option', label: 'DEADLINE_EXCEEDED (4)', value: 'a' }],
            show: props.show,
            // a dropdown 199 px wide at the right edge of the window, as the gRPC response history's
            x: 1081,
            y: 40,
            width: 199,
        }),
    })
    app.config.globalProperties.$store = { state: reactive({ openContextMenuElement: null }) }
    app.mount(element)

    // the stylesheet's least width, which happy-dom does not load
    const menu = element.querySelector('.context-menu') as HTMLElement
    menu.style.minWidth = '240px'

    props.show = true
    for(let i = 0; i < 4; i++) {
        await nextTick()
    }

    const left = parseFloat(menu.style.left)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(left + 240).toBe(1280)
    app.unmount()
})

function mountMenu(options: any[], selectedOption?: any) {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const app = createApp({
        render: () => h(ContextMenu, { options, show: true, x: 0, y: 0, selectedOption }),
    })
    app.config.globalProperties.$store = { state: reactive({ openContextMenuElement: null }) }
    app.mount(element)
    return { element, unmount: () => app.unmount() }
}

test('a label from collection data, such as an imported environment name, shows as typed and runs nothing', () => {
    const name = 'Prod <img src=x onerror="window.ranLabel = true"> &amp; more'
    const menu = mountMenu([{ type: 'option', label: name, value: 'Prod' }])

    const item = menu.element.querySelector('.context-menu-item')!
    expect(item.querySelector('img')).toBeNull()
    expect(item.textContent!.trim()).toBe(name)
    menu.unmount()
})

test('an environment option draws its color dot two spaces before its name, in the text color when it has no color', () => {
    const menu = mountMenu([
        { type: 'option', label: '<b>Prod</b>', value: 'Prod', color: '#ff0000' },
        { type: 'option', label: 'Old', value: 'Old', color: undefined },
    ])

    const [prod, old] = [...menu.element.querySelectorAll('.context-menu-item')]
    const prodDot = prod.querySelector('i.fa.fa-circle') as HTMLElement
    expect(prodDot.style.color).toBe('#ff0000')
    expect(prod.querySelector('b')).toBeNull()
    expect(prodDot.parentElement!.textContent).toBe('\u00a0\u00a0<b>Prod</b>')
    const oldDot = old.querySelector('i.fa.fa-circle') as HTMLElement
    expect(oldDot.style.color).toBe('')
    expect(oldDot.parentElement!.textContent).toBe('\u00a0\u00a0Old')
    menu.unmount()
})

test('an entry laid out in HTML, such as a response history entry, keeps its layout, and the selected one is ticked', () => {
    const first = { _id: 'r1' }
    const second = { _id: 'r2' }
    const menu = mountMenu([
        { type: 'option', labelHtml: '<div class="tag">200 OK</div>', value: first },
        { type: 'option', labelHtml: '<div class="tag">404 Not Found</div>', value: second },
    ], second)

    const [one, two] = [...menu.element.querySelectorAll('.context-menu-item')]
    expect(one.querySelector('.tag')!.textContent).toBe('200 OK')
    expect(one.querySelector('.fa-check')).toBeNull()
    expect((one.querySelector('.selected-indicator') as HTMLElement).style.marginLeft).toBe('1rem')
    expect(two.querySelector('.fa-check')).not.toBeNull()
    expect((two.querySelector('.selected-indicator') as HTMLElement).style.marginRight).toBe('0.3rem')
    menu.unmount()
})
