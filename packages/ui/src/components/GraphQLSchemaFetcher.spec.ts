// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import GraphQLSchemaFetcher from './GraphQLSchemaFetcher.vue'
const apps: App[] = []
afterEach(() => {
    apps.splice(0).forEach(app => app.unmount()); vi.unstubAllGlobals()
})
test('schema environment errors settle in the panel and retry uses the request pipeline', async() => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    const fetch = vi.fn(async() => new Response('{"data":{"__schema":{"types":[]}}}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const collectionItem = { _id: 'r', _type: 'request', workspaceId: 'w', name: 'R', parentId: null, url: 'https://example.test/graphql', method: 'POST' }
    const store = { state: { flags: {} }, dispatch: vi.fn(async() => ({ environment: {}, parentHeaders: { 'X-Inherited': ['present'] }, parentAuthentication: undefined, requestParentArray: [] })) }
    store.dispatch.mockRejectedValueOnce(new Error('Could not resolve tag'))
    const element = document.createElement('div')
    const app = createApp(GraphQLSchemaFetcher, { collectionItem, isVisible: true })
    app.provide('store', store)
    const vm = app.mount(element) as unknown as { fetchSchema: () => Promise<void> }
    apps.push(app)
    await vm.fetchSchema()
    await nextTick()
    expect(element.querySelector('.error')?.textContent).toContain('Could not resolve tag')
    expect(element.querySelector('.loading')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    await vm.fetchSchema()
    await nextTick()
    expect(store.dispatch).toHaveBeenCalledWith('getEnvironmentForRequest', expect.objectContaining({ collectionItem, mode: 'send' }))
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]).toBeDefined()
    expect(element.querySelector('.error')).toBeNull()
    expect(element.querySelector('.loading')).toBeNull()
})
