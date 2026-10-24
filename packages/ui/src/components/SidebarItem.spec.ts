// @vitest-environment happy-dom

import { test, expect, vi, afterEach } from 'vitest'
import { createApp, nextTick, reactive, type App } from 'vue'
import SidebarItem from './SidebarItem.vue'

// unmounted after each test, so no listener of theirs outlives it
const mountedApps: App[] = []

afterEach(() => {
    mountedApps.splice(0).forEach(app => app.unmount())
    document.body.innerHTML = ''
})

function mountItem(sidebarItem: Record<string, any>) {
    const state = reactive({
        activeTab: null,
        collectionFilter: '',
    })
    const store = { state, commit: vi.fn(), dispatch: vi.fn(async() => ({})) }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const app = createApp(SidebarItem, { sidebarItem })
    app.config.globalProperties.$store = store
    app.mount(element)
    mountedApps.push(app)
    return { store, element }
}

const futureItem = { _id: 'item1', _type: 'some-future-type', name: 'From a newer version', parentId: null }

test('clicking an item of a type only a newer version knows opens it in a tab, as a request does', async() => {
    const request = mountItem({ _id: 'item2', _type: 'request', name: 'Request', parentId: null, method: 'GET', body: { mimeType: 'No Body' } })
    request.element.querySelector<HTMLElement>('.sidebar-item')!.click()

    const future = mountItem(futureItem)
    future.element.querySelector<HTMLElement>('.sidebar-item')!.click()

    expect(request.store.dispatch.mock.calls).toEqual([['addTab', expect.objectContaining({ _id: 'item2' })]])
    expect(future.store.dispatch.mock.calls).toEqual([['addTab', expect.objectContaining({ _id: 'item1', _type: 'some-future-type' })]])
})

test('double-clicking an item of a type only a newer version knows starts renaming it', async() => {
    const { element } = mountItem(futureItem)
    element.querySelector<HTMLElement>('.sidebar-item')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await nextTick()

    expect(element.querySelector<HTMLInputElement>('.sidebar-item input')?.value).toBe('From a newer version')
})
