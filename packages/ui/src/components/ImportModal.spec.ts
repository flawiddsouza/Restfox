// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest'
import { createApp, nextTick, reactive, type App } from 'vue'
vi.mock('@/db', async(importOriginal) => ({ ...await importOriginal<typeof import('@/db')>(), getCollectionForWorkspace: vi.fn() }))
import ImportModal from './ImportModal.vue'
import { getCollectionForWorkspace } from '@/db'
import { emitter } from '@/event-bus'
import type { CollectionItem, Workspace } from '@/global'

const apps: App[] = []

afterEach(() => {
    apps.splice(0).forEach(app => app.unmount())
    vi.mocked(getCollectionForWorkspace).mockReset()
})

const folder = (id: string, name: string, parentId: string | null, sortOrder: number) => ({ _id: id, _type: 'request_group', name, parentId, workspaceId: 'w', sortOrder }) as CollectionItem

function mountImportModal() {
    const state = reactive({
        activeWorkspace: { _id: 'w', name: 'W', _type: 'file' } as Workspace,
        collection: [
            folder('b', 'Billing', null, 1),
            folder('a', 'Auth', null, -1),
            { _id: 'r', _type: 'request', name: 'Login', parentId: 'a', workspaceId: 'w', sortOrder: 0 } as CollectionItem,
            folder('a/inner', 'Tokens', 'a', 0.5),
        ],
        collectionTree: [],
        showImportModal: false,
        showImportAsCurlModal: false,
        showImportModalSelectedRequestGroupId: null as string | null,
    })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const app = createApp(ImportModal)
    app.config.globalProperties.$store = { state, commit: vi.fn((name: string, value: unknown) => {
        if(name === 'showImportModal') {
            state.showImportModal = value as boolean
        }
        if(name === 'showImportModalSelectedRequestGroupId') {
            state.showImportModalSelectedRequestGroupId = value as string | null
        }
    }), dispatch: vi.fn() }
    app.mount(element)
    apps.push(app)
    return { state, element }
}

const importIntoOptions = (element: HTMLElement) => [...element.querySelectorAll('select')].at(-1)!.querySelectorAll('option')

test('the closed dialog reads no storage, on a workspace opened or a folder added, renamed or moved', async() => {
    const { state } = mountImportModal()
    state.activeWorkspace = { _id: 'w2', name: 'W2', _type: 'file' } as Workspace
    await nextTick()
    emitter.emit('request_group', 'added')
    await nextTick()

    expect(getCollectionForWorkspace).not.toHaveBeenCalled()
})

// a nested folder's name follows its parent's and the arrow with two spaces, as the dialog has always shown it
test('Import Into lists the folders the page holds, in their order, under their parents\' names, also one added since', async() => {
    const { state, element } = mountImportModal()
    state.showImportModal = true
    await nextTick()

    expect([...importIntoOptions(element)].map(option => option.textContent)).toEqual(['Root of the workspace', 'Auth', 'Auth →  Tokens', 'Billing'])

    state.collection.push(folder('c', 'Cart', null, 2))
    await nextTick()
    expect([...importIntoOptions(element)].map(option => option.textContent)).toEqual(['Root of the workspace', 'Auth', 'Auth →  Tokens', 'Billing', 'Cart'])
    // the names the page shows are left as they are
    expect(state.collection.find(item => item._id === 'a/inner')?.name).toBe('Tokens')
    expect(getCollectionForWorkspace).not.toHaveBeenCalled()
})

test('a folder event or another workspace clears the folder picked to import into, as before', async() => {
    const { state } = mountImportModal()
    state.showImportModalSelectedRequestGroupId = 'a'
    emitter.emit('request_group', 'renamed')
    expect(state.showImportModalSelectedRequestGroupId).toBe(null)

    state.showImportModalSelectedRequestGroupId = 'a'
    state.activeWorkspace = { _id: 'w2', name: 'W2', _type: 'file' } as Workspace
    await nextTick()
    expect(state.showImportModalSelectedRequestGroupId).toBe(null)
})
