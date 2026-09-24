// @vitest-environment happy-dom

import { test, expect } from 'vitest'
import { createApp, reactive, nextTick } from 'vue'
import CodeMirrorResponsePanelPreview from './CodeMirrorResponsePanelPreview.vue'

function mountPreview(responseLineWrapping: boolean) {
    const state = reactive({ flags: { responseLineWrapping } })
    const element = document.createElement('div')
    const app = createApp(CodeMirrorResponsePanelPreview, { modelValue: '{"a": 1}' })
    app.config.globalProperties.$store = { state }
    app.mount(element)
    const wrapsLines = () => element.querySelector('.cm-content')!.classList.contains('cm-lineWrapping')
    return { state, wrapsLines, unmount: () => app.unmount() }
}

test('long lines wrap when the setting is on', () => {
    const preview = mountPreview(true)
    expect(preview.wrapsLines()).toBe(true)
    preview.unmount()
})

test('long lines do not wrap when the setting is off', () => {
    const preview = mountPreview(false)
    expect(preview.wrapsLines()).toBe(false)
    preview.unmount()
})

test('an open preview follows the setting when it changes', async() => {
    const preview = mountPreview(true)

    preview.state.flags.responseLineWrapping = false
    await nextTick()
    expect(preview.wrapsLines()).toBe(false)

    preview.state.flags.responseLineWrapping = true
    await nextTick()
    expect(preview.wrapsLines()).toBe(true)

    preview.unmount()
})
