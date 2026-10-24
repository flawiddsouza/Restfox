// @vitest-environment happy-dom

import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import Tab from './Tab.vue'

beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    })
})

// unmounted after each test, so no listener of theirs outlives it
const mountedApps: App[] = []

afterEach(() => {
    mountedApps.splice(0).forEach(app => app.unmount())
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

test('an item of a type only a newer version knows shows a notice and is left as it is', async() => {
    const futureItem = {
        _id: 'item1',
        _type: 'some-future-type',
        name: 'From a newer version',
        workspaceId: 'w1',
        parentId: null,
        futureField: { nested: ['kept'] },
    }
    const savedCopy = structuredClone(futureItem)
    const state = reactive({
        activeMobilePanel: null,
        activeWorkspace: { _id: 'w1', _type: 'local' },
        flags: {},
        settings: {},
        plugins: { workspace: [], global: [] },
        tabEnvironmentResolved: {},
        requestResponses: {},
        requestResponseStatus: {},
        requestResponseStreams: {},
        requestAbortController: {},
        responses: {},
        responseChunkTimes: {},
        extractPathInputs: {},
        collection: [futureItem],
        collectionTree: [futureItem],
        tabs: [futureItem],
        activeTab: futureItem,
    })
    const store = { state, getters: {}, commit: vi.fn(), dispatch: vi.fn<(action: string, payload?: unknown) => Promise<unknown>>(async() => ({ environment: {} })) }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const app = createApp({
        render: () => h(Tab, {
            collectionItem: state.activeTab,
            requestResponseLayoutTopBottom: false,
            requestPanelResized: () => undefined,
        }),
    })
    // Tab reads the store with useStore, the panels it holds read this.$store
    app.provide('store', store)
    app.config.globalProperties.$store = store
    app.mount(element)
    mountedApps.push(app)
    await nextTick()
    // past the request panel's debounced saves
    await new Promise(resolve => setTimeout(resolve, 1000))

    const notice = element.querySelector('.tab-unknown-type')
    expect(notice?.textContent).toBe('This request was made with a newer version of Restfox. Update Restfox to open it.')
    expect((element.querySelector('.request-response-panels.left-right') as HTMLElement).style.display).toBe('none')

    expect(JSON.parse(JSON.stringify(state.activeTab))).toEqual(savedCopy)
    expect(store.commit).not.toHaveBeenCalled()
    // the folder panel, mounted hidden, reads the environment, which changes nothing
    expect(store.dispatch.mock.calls.map(call => call[0])).toEqual(['getEnvironmentForRequest'])
})
