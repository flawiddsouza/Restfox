// @vitest-environment happy-dom

import { test, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick, reactive, ref, type App } from 'vue'
import AddGrpcRequestModal from './AddGrpcRequestModal.vue'

// unmounted after each test, so Modal's window key listener goes with it
const mountedApps: App[] = []

afterEach(() => {
    mountedApps.splice(0).forEach(app => app.unmount())
    document.body.innerHTML = ''
})

function mountModal(parentId: string | null, dispatchResult: { error?: string } = {}) {
    const shown = ref(false)
    const store = {
        state: reactive({}),
        dispatch: vi.fn(async() => dispatchResult),
    }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const app = createApp({
        render: () => h(AddGrpcRequestModal, {
            showModal: shown.value,
            'onUpdate:showModal': (value: boolean) => {
                shown.value = value
            },
            parentId,
        }),
    })
    app.provide('store', store)
    app.mount(element)
    mountedApps.push(app)
    return {
        shown,
        store,
        nameInput: () => element.querySelector<HTMLInputElement>('input[type="text"]'),
        async submit() {
            element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
            await nextTick()
            await nextTick()
        },
    }
}

test('creating dispatches a gRPC item with the typed name under the parent, then closes', async() => {
    const modal = mountModal('folder1')
    modal.shown.value = true
    await nextTick()

    const input = modal.nameInput()!
    expect(input.value).toBe('New gRPC Request')
    input.value = 'Greeter.SayHello'
    input.dispatchEvent(new Event('input'))
    await modal.submit()

    expect(modal.store.dispatch).toHaveBeenCalledTimes(1)
    expect(modal.store.dispatch).toHaveBeenCalledWith('createCollectionItem', {
        type: 'grpc',
        name: 'Greeter.SayHello',
        parentId: 'folder1',
    })
    expect(modal.shown.value).toBe(false)
    expect(modal.nameInput()).toBeNull()
})

test('a failed create keeps the modal open', async() => {
    const modal = mountModal(null, { error: 'failed' })
    modal.shown.value = true
    await nextTick()

    await modal.submit()

    expect(modal.store.dispatch).toHaveBeenCalledWith('createCollectionItem', {
        type: 'grpc',
        name: 'New gRPC Request',
        parentId: null,
    })
    expect(modal.shown.value).toBe(true)
})

test('reopening resets the name', async() => {
    const modal = mountModal(null)
    modal.shown.value = true
    await nextTick()

    const input = modal.nameInput()!
    input.value = 'Typed and abandoned'
    input.dispatchEvent(new Event('input'))
    modal.shown.value = false
    await nextTick()

    modal.shown.value = true
    await nextTick()

    expect(modal.nameInput()!.value).toBe('New gRPC Request')
})
