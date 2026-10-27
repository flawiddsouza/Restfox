// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, type App } from 'vue'
vi.mock('@/components/CodeMirrorEditor.vue', () => ({ default: defineComponent({ props: ['envVariables'], setup: props => () => h('pre', { class: 'hover-values' }, JSON.stringify(props.envVariables)) }) }))
vi.mock('@/db', async(importOriginal) => ({ ...await importOriginal<typeof import('@/db')>(), getResponsesByCollectionId: vi.fn(async() => []) }))
import EnvironmentModal from './EnvironmentModal.vue'
import { emitter } from '@/event-bus'
import { store } from '@/store'
import { getGrpcItemKey, grpcItemSchemaKeys, grpcSchemas, resetGrpcCalls } from '@/utils/grpc-calls'
import type { CollectionItem, Workspace } from '@/global'
const apps: App[] = []
beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
    apps.splice(0).forEach(app => app.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
function mountModal() {
    const props = reactive({ showModal: false, collectionItem: { _id: 'a', _type: 'request_group', workspaceId: 'w', name: 'A' } })
    const store = { state: { activeWorkspace: { _id: 'w' } }, dispatch: vi.fn<(action: string, payload: unknown) => Promise<{ environment: Record<string, string> }>>(async() => ({ environment: { VALUE: 'new' } })), commit: vi.fn() }
    const element = document.createElement('div')
    const app = createApp({ render: () => h(EnvironmentModal, props) })
    app.config.globalProperties.$store = store
    app.config.globalProperties.$toast = { error: vi.fn() }
    app.config.errorHandler = vi.fn()
    app.mount(element); apps.push(app)
    return { props, store, app, values: () => element.querySelector('.hover-values')?.textContent }
}
test('a failed inherited response tag keeps other hover values and shows the placeholder for that tag', async() => {
    const collection = store.state.collection
    const workspace = store.state.activeWorkspace
    const grpc = { _id: 'g', _type: 'grpc', name: 'Stream', workspaceId: 'w', parentId: null, grpc: { service: 'Demo', method: 'Stream' } } as CollectionItem
    const folder = { _id: 'parent', _type: 'request_group', name: 'Parent', workspaceId: 'w', parentId: null, environment: { VALUE: 'kept', TOKEN: '{% response(request=\'g\', attribute=\'body\', path=\'$.token\', behavior=\'never\') %}' } } as CollectionItem
    store.state.activeWorkspace = { _id: 'w', name: 'W' } as Workspace
    store.state.collection = [grpc, folder]
    grpcItemSchemaKeys[getGrpcItemKey(grpc)] = 'stream-schema'
    grpcSchemas['stream-schema'] = { loading: false, error: null, errorCode: null, loadedAt: 1, failedAt: null, schema: { source: 'reflection', services: [{ name: 'Demo', methods: [{ name: 'Stream', path: '/Demo/Stream', requestStream: false, responseStream: true, inputType: 'A', outputType: 'B', example: '{}' }] }] } }
    try {
        const modal = mountModal()
        Object.assign(modal.props.collectionItem, { parentId: 'parent' })
        modal.store.dispatch.mockImplementationOnce((action, payload) => store.dispatch(action, payload))
        modal.props.showModal = true
        await vi.waitFor(() => expect(modal.values()).toBe(JSON.stringify({ VALUE: 'kept', TOKEN: '<no value found>' })))
        expect(console.error).not.toHaveBeenCalled()
        expect(modal.app.config.errorHandler).not.toHaveBeenCalled()
    } finally {
        store.state.collection = collection
        store.state.activeWorkspace = workspace
        resetGrpcCalls()
    }
})
test('a real reload failure clears previous hover values and logs', async() => {
    const modal = mountModal()
    modal.props.showModal = true
    await vi.waitFor(() => expect(modal.values()).toContain('new'))
    modal.store.dispatch.mockRejectedValueOnce(new Error('history broken'))
    emitter.emit('dotenv', 'reloaded')
    await vi.waitFor(() => expect(modal.values()).toBe('{}'))
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'history broken' }))
    expect(modal.app.config.errorHandler).not.toHaveBeenCalled()
})
test('a closed modal ignores dotenv reload and has no current opening', async() => {
    const modal = mountModal()
    emitter.emit('dotenv', 'reloaded')
    await nextTick()
    expect(modal.store.dispatch).not.toHaveBeenCalled()
})
for(const failed of [false, true]) {
    test(`a load finishing while closed cannot change the next opening, failure: ${failed}`, async() => {
        const modal = mountModal()
        modal.props.showModal = true
        await vi.waitFor(() => expect(modal.values()).toContain('new'))
        let finishOld!: () => void
        let finishNew!: () => void
        modal.store.dispatch.mockImplementationOnce(() => new Promise((resolve, reject) => {
            finishOld = () => failed ? reject(new Error('closed failure')) : resolve({ environment: { VALUE: 'closed' } })
        })).mockImplementationOnce(() => new Promise(resolve => {
            finishNew = () => resolve({ environment: { VALUE: 'reopened' } })
        }))
        emitter.emit('dotenv', 'reloaded')
        modal.props.showModal = false
        await nextTick()
        finishOld()
        for(let index = 0; index < 30; index++) {
            await Promise.resolve()
        }
        // Sidebar passes this same collection object when reopening its Environment modal.
        modal.props.showModal = true
        await nextTick()
        expect(modal.values()).toContain('new')
        expect(console.error).not.toHaveBeenCalled()
        finishNew()
        await vi.waitFor(() => expect(modal.values()).toContain('reopened'))
    })
}
for(const failed of [false, true]) {
    for(const firstEndsFirst of [false, true]) {
        test(`an old opening cannot publish or clear B, failure: ${failed}, A ends first: ${firstEndsFirst}`, async() => {
            const modal = mountModal()
            let finishA!: () => void
            let finishB!: () => void
            modal.store.dispatch.mockImplementationOnce(() => new Promise((resolve, reject) => {
                finishA = () => failed ? reject(new Error('old failure')) : resolve({ environment: { VALUE: 'old' } })
            })).mockImplementationOnce(() => new Promise(resolve => {
                finishB = () => resolve({ environment: { VALUE: 'B' } })
            }))
            modal.props.showModal = true
            await nextTick()
            modal.props.showModal = false
            await nextTick()
            modal.props.collectionItem = { ...modal.props.collectionItem, _id: 'b', name: 'B' }
            modal.props.showModal = true
            await nextTick()
            if(firstEndsFirst) {
                finishA(); await nextTick(); await nextTick()
            }
            finishB()
            await vi.waitFor(() => expect(modal.values()).toContain('B'))
            if(!firstEndsFirst) {
                finishA(); await nextTick(); await nextTick()
            }
            expect(modal.values()).toContain('B')
            expect(console.error).not.toHaveBeenCalled()
            expect(modal.app.config.errorHandler).not.toHaveBeenCalled()
        })
    }
}

for(const failed of [false, true]) {
    test(`a superseded load in the same opening cannot publish or clear, failure: ${failed}`, async() => {
        const modal = mountModal()
        let finishOld!: () => void
        modal.store.dispatch.mockImplementationOnce(() => new Promise((resolve, reject) => {
            finishOld = () => failed ? reject(new Error('old failure')) : resolve({ environment: { VALUE: 'old' } })
        }))
        modal.props.showModal = true
        await nextTick()
        emitter.emit('dotenv', 'reloaded')
        await vi.waitFor(() => expect(modal.values()).toContain('new'))
        finishOld()
        for(let index = 0; index < 30; index++) {
            await Promise.resolve()
        }
        await nextTick()
        expect(modal.values()).toContain('new')
        expect(console.error).not.toHaveBeenCalled()
    })
}
