// @vitest-environment happy-dom

import { test, expect, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { useToast } from './toast'

afterEach(() => {
    document.body.innerHTML = ''
})

async function shownTexts() {
    await nextTick()
    return [...document.body.querySelectorAll('.v-toast__text')].map(text => text.textContent)
}

test('a message quoting a name or a server reply shows as typed and runs nothing, through every kind of toast', async() => {
    const message = 'Failed: <img src=x onerror="window.ranToast = true"> &amp; more'
    const toast = useToast()

    toast.error(message)
    toast.success(message)
    toast.open(message)
    toast.open({ message, type: 'info' })

    expect(document.body.querySelector('.v-toast img')).toBeNull()
    expect(await shownTexts()).toEqual([message, message, message, message])
})
