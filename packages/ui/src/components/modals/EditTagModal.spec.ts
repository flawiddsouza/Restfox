// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
vi.mock('@/store', () => ({ store: { state: { activeWorkspace: { _id: 'w' }, collection: [] as any[] }, dispatch: vi.fn() } }))
vi.mock('@/db', () => ({ getResponsesByCollectionId: vi.fn(), getCollectionForWorkspace: vi.fn(async() => ({ collection: [] })) }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/utils/toast', () => ({ useToast: () => toast }))
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
    toast.error.mockReset()
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
    const path = (value: string) => {
        const input = [...element.querySelectorAll<HTMLInputElement>('input[type=text]')].find(input => input.value === '$.old')!; input.value = value; input.dispatchEvent(new Event('input'))
    }
    return { element, preview, refresh, path }
}
for(const failed of [true, false]) {
    test(`a slow Refresh cannot replace a newer path preview, failure: ${failed}`, async() => {
        const modal = mountModal()
        await vi.waitFor(() => expect(modal.preview()).toContain('saved'))
        let finish!: () => void
        vi.mocked(store.dispatch).mockImplementationOnce(() => new Promise((resolve, reject) => {
            finish = () => failed ? reject(new Error('old failure')) : resolve(response('old result'))
        }))
        modal.refresh()
        await vi.waitFor(() => expect(store.dispatch).toHaveBeenCalledOnce())
        modal.path('$.current')
        await vi.waitFor(() => expect(modal.preview()).toContain('new'))
        // the preview read again once Refresh ends waits here, so what Refresh itself shows is seen
        let release!: () => void
        vi.mocked(getResponsesByCollectionId).mockImplementationOnce(() => new Promise(resolve => {
            release = () => resolve([response('saved')] as any)
        }))
        finish()
        for(let index = 0; index < 30; index++) {
            await Promise.resolve()
        }
        await nextTick()
        expect(modal.preview()).toContain('new')
        expect(modal.preview()).not.toContain('old failure')
        expect(modal.preview()).not.toContain('old result')
        // the newer preview keeps the box, and a failed Refresh still says so
        if(failed) {
            expect(toast.error).toHaveBeenCalledWith('old failure')
        } else {
            expect(toast.error).not.toHaveBeenCalled()
        }
        release()
        await vi.waitFor(() => expect(modal.preview()).toContain('new'))
    })
}
const replyWith = (current: string) => ({ ...response(current), buffer: new TextEncoder().encode(JSON.stringify({ current })).buffer })
for(const failed of [true, false]) {
    test(`a slow path preview cannot replace a newer Refresh, failure: ${failed}`, async() => {
        const modal = mountModal()
        await vi.waitFor(() => expect(modal.preview()).toContain('saved'))
        let finish!: () => void
        vi.mocked(getResponsesByCollectionId).mockImplementationOnce(() => new Promise((resolve, reject) => {
            finish = () => failed ? reject(new Error('old failure')) : resolve([replyWith('old result')] as any)
        }))
        modal.path('$.current')
        await vi.waitFor(() => expect(getResponsesByCollectionId).toHaveBeenCalledTimes(2))
        vi.mocked(store.dispatch).mockResolvedValueOnce(replyWith('refreshed'))
        modal.refresh()
        await vi.waitFor(() => expect(modal.preview()).toContain('refreshed'))
        finish()
        for(let index = 0; index < 30; index++) {
            await Promise.resolve()
        }
        await nextTick()
        expect(modal.preview()).toContain('refreshed')
        // a preview of a path edit is no action of its own, so an overtaken one fails quietly
        expect(toast.error).not.toHaveBeenCalled()
    })
}
for(const firstEndsFirst of [true, false]) {
    test(`two Refreshes show the second one's reply, first ends first: ${firstEndsFirst}`, async() => {
        const modal = mountModal()
        await vi.waitFor(() => expect(modal.preview()).toContain('saved'))
        modal.path('$.current')
        await vi.waitFor(() => expect(modal.preview()).toContain('new'))
        const finishes: (() => void)[] = []
        for(const current of ['first', 'second']) {
            vi.mocked(store.dispatch).mockImplementationOnce(() => new Promise(resolve => {
                finishes.push(() => resolve(replyWith(current)))
            }))
        }
        modal.refresh()
        modal.refresh()
        await vi.waitFor(() => expect(finishes).toHaveLength(2))
        const order = firstEndsFirst ? [0, 1] : [1, 0]
        finishes[order[0]]()
        for(let index = 0; index < 30; index++) {
            await Promise.resolve()
        }
        await nextTick()
        expect(modal.preview()).toBe(firstEndsFirst ? 'Loading...' : 'second')
        finishes[order[1]]()
        for(let index = 0; index < 30; index++) {
            await Promise.resolve()
        }
        await nextTick()
        expect(modal.preview()).toBe('second')
    })
}
test('a slow path preview overtaken by another path edit is not read again once it ends', async() => {
    const modal = mountModal()
    await vi.waitFor(() => expect(modal.preview()).toContain('saved'))
    let finish!: () => void
    vi.mocked(getResponsesByCollectionId).mockImplementationOnce(() => new Promise(resolve => {
        finish = () => resolve([response('saved')] as any)
    }))
    modal.path('$.current')
    await vi.waitFor(() => expect(getResponsesByCollectionId).toHaveBeenCalledTimes(2))
    const input = [...modal.element.querySelectorAll<HTMLInputElement>('input[type=text]')].find(input => input.value === '$.current')!
    input.value = '$.old'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(getResponsesByCollectionId).toHaveBeenCalledTimes(3))
    finish()
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    await nextTick()
    expect(getResponsesByCollectionId).toHaveBeenCalledTimes(3)
    expect(modal.preview()).toContain('saved')
})
test('a slow Refresh that saves a newer reply after a newer path preview shows that path read from the newer reply', async() => {
    const modal = mountModal()
    await vi.waitFor(() => expect(modal.preview()).toContain('saved'))
    const refreshed = { ...response('refreshed'), buffer: new TextEncoder().encode(JSON.stringify({ current: 'refreshed' })).buffer }
    let finish!: () => void
    vi.mocked(store.dispatch).mockImplementationOnce(() => new Promise(resolve => {
        finish = () => {
            vi.mocked(getResponsesByCollectionId).mockResolvedValue([refreshed] as any)
            resolve(refreshed)
        }
    }))
    modal.refresh()
    await vi.waitFor(() => expect(store.dispatch).toHaveBeenCalledOnce())
    modal.path('$.current')
    await vi.waitFor(() => expect(modal.preview()).toContain('new'))
    finish()
    await vi.waitFor(() => expect(modal.preview()).toContain('refreshed'))
})
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
