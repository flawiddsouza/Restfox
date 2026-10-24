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
