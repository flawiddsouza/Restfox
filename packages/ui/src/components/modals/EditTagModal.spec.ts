// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
vi.mock('@/store', () => ({ store: { state: { activeWorkspace: { _id: 'w' }, collection: [] as any[] }, dispatch: vi.fn() } }))
vi.mock('@/db', () => ({ getResponsesByCollectionId: vi.fn(), getCollectionForWorkspace: vi.fn(async() => ({ collection: [] })) }))
import EditTagModal from './EditTagModal.vue'
import { store } from '@/store'
import { getResponsesByCollectionId } from '@/db'
import * as grpc from '@/utils/grpc-calls'
const apps: App[] = []
const response = (value: string) => ({ _id: value, collectionId: 'login', headers: [['content-type', 'application/json']], buffer: new TextEncoder().encode(JSON.stringify({ old: value, current: 'new' })).buffer, createdAt: Date.now() })
beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    vi.mocked(getResponsesByCollectionId).mockReset().mockResolvedValue([response('saved')] as any)
    vi.mocked(store.dispatch).mockReset().mockResolvedValue(response('fresh'))
    store.state.collection = [{ _id: 'login', _type: 'request', name: 'Login', workspaceId: 'w', parentId: null }]
    grpc.resetGrpcCalls()
})
afterEach(() => {
    apps.splice(0).forEach(app => app.unmount()); grpc.resetGrpcCalls(); vi.unstubAllGlobals()
})
function mountModal(request = 'login') {
    const element = document.createElement('div')
    const app = createApp({ render: () => h(EditTagModal, { showModal: true, activeTab: { _id: 'source', workspaceId: 'w', _type: 'request', name: 'Source', parentId: null }, parsedFunc: { functionName: 'response', parameters: { request, attribute: 'body', path: '$.old', behavior: 'always', maxAge: 60 } }, updateFunc: vi.fn() }) })
    app.provide('store', store)
    app.provide('$toast', { success: vi.fn() })
    app.config.globalProperties.$store = store
    app.mount(element); apps.push(app)
    const preview = () => element.querySelector('textarea')?.value ?? ''
    const refresh = () => [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Refresh')!.click()
    return { element, preview, refresh }
}
test('initially missing targets show the existing placeholder', async() => {
    const modal = mountModal('deleted')
    await vi.waitFor(() => expect(modal.preview()).toContain('<no value found>'))
    expect(store.dispatch).not.toHaveBeenCalled()
})
test('Refresh on a tag with no value keeps the existing placeholder', async() => {
    const modal = mountModal('deleted')
    await vi.waitFor(() => expect(modal.preview()).toBe('<no value found>'))
    modal.refresh()
    await nextTick()
    await vi.waitFor(() => expect(modal.preview()).toBe('<no value found>'))
    expect(store.dispatch).not.toHaveBeenCalled()
})
for(const kind of ['stream', 'missing', 'unknown', 'saved']) {
    test(`real gRPC preview preserves the ${kind} policy`, async() => {
        const item = { _id: 'g', _type: 'grpc' as const, workspaceId: 'w', parentId: null, name: 'G', grpc: { service: 'Demo', method: 'Call' } }
        store.state.collection.push(item)
        if(kind === 'stream' || kind === 'missing') {
            grpc.grpcItemSchemaKeys[grpc.getGrpcItemKey(item)] = 'schema'
            grpc.grpcSchemas.schema = { loading: false, schema: { source: 'reflection', services: [{ name: 'Demo', methods: kind === 'missing' ? [] : [{ name: 'Call', requestStream: false, responseStream: true }] }] }, loadedAt: 1, error: null, errorCode: null, failedAt: null } as any
        }
        vi.mocked(getResponsesByCollectionId).mockResolvedValue(kind === 'saved' ? [{ _id: 'saved', collectionId: 'g', createdAt: 1, grpc: { service: 'Demo', method: 'Call', kind: 'unary', ended: 'completed', status: { code: 0 }, events: [{ type: 'received', json: '{"old":"offline"}' }] } }] as any : [])
        const modal = mountModal('g')
        await vi.waitFor(() => expect(modal.preview()).toContain(kind === 'saved' ? 'offline' : kind === 'unknown' ? '<no value found>' : 'A response tag can read only a unary gRPC call'))
        expect(store.dispatch).not.toHaveBeenCalled()
    })
}
