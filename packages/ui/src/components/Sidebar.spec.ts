// @vitest-environment happy-dom

import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createApp, nextTick, reactive, type App } from 'vue'
import Sidebar from './Sidebar.vue'

// unmounted after each test, so no listener of theirs outlives it
const mountedApps: App[] = []

beforeEach(() => {
    // the modals read their last choices
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    })
})

afterEach(() => {
    mountedApps.splice(0).forEach(app => app.unmount())
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

function mountSidebar() {
    const state = reactive({
        collection: [] as any[],
        collectionTree: [] as any[],
        collectionFilter: '',
        activeSidebarItemForContextMenu: null as any,
        sidebarContextMenuElement: null,
        openContextMenuElement: null,
        activeWorkspace: { _id: 'w1', _type: 'local', name: 'Workspace', location: null },
        activeTab: null,
        flags: { disableSSLVerification: false },
        plugins: { workspace: [] },
    })
    const store = {
        state,
        getters: { collectionTreeFiltered: [] },
        commit: vi.fn(),
        dispatch: vi.fn(async(action: string) => {
            if(action === 'getEnvironmentForRequest') {
                return { environment: {}, parentHeaders: {}, parentAuthentication: undefined }
            }
        }),
    }
    const toast = { success: vi.fn(), error: vi.fn() }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const app = createApp(Sidebar)
    app.config.globalProperties.$store = store
    app.config.globalProperties.$toast = toast
    app.config.errorHandler = vi.fn()
    app.provide('store', store)
    app.mount(element)
    mountedApps.push(app)

    // the menu SidebarItem opens on a right click
    const openMenu = async(item: Record<string, any>) => {
        state.activeSidebarItemForContextMenu = item
        await nextTick()
        return [...element.querySelectorAll<HTMLButtonElement>('.context-menu-item')].map(option => option.textContent!.trim())
    }
    const clickOption = (label: string) => [...element.querySelectorAll<HTMLButtonElement>('.context-menu-item')].find(option => option.textContent!.trim() === label)!.click()

    return { state, store, toast, element, openMenu, clickOption }
}

test('an HTTP request\'s menu is unchanged', async() => {
    const sidebar = mountSidebar()
    expect(await sidebar.openMenu({ _id: 'r1', _type: 'request', name: 'Request', method: 'GET', parentId: null, workspaceId: 'w1' })).toEqual([
        'Actions', 'Duplicate', 'Export', 'Copy as Curl', 'Generate Code', 'Plugins', 'Delete', '', 'Properties',
    ])
})

test('a gRPC request\'s menu has Copy as grpcurl after Export, and no Copy as Curl, Generate Code or Plugins', async() => {
    const sidebar = mountSidebar()
    expect(await sidebar.openMenu({ _id: 'g1', _type: 'grpc', name: 'Demo.SayHello', parentId: null, workspaceId: 'w1', url: 'localhost:50051', grpc: { service: 'demo.v1.Demo', method: 'SayHello' } })).toEqual([
        'Actions', 'Duplicate', 'Export', 'Copy as grpcurl', 'Delete', '', 'Properties',
    ])
})

test('an item of a type only a newer version knows can be duplicated, exported and deleted', async() => {
    const sidebar = mountSidebar()
    expect(await sidebar.openMenu({ _id: 'f1', _type: 'some-future-type', name: 'From a newer version', parentId: null, workspaceId: 'w1' })).toEqual([
        'Actions', 'Duplicate', 'Export', 'Delete',
    ])
})

test('Copy as grpcurl copies the call\'s command, and with no method chosen says why and copies nothing', async() => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const sidebar = mountSidebar()
    await sidebar.openMenu({ _id: 'g1', _type: 'grpc', name: 'Demo.SayHello', parentId: null, workspaceId: 'w1', url: 'localhost:50051', grpc: { service: 'demo.v1.Demo', method: 'SayHello' } })
    sidebar.clickOption('Copy as grpcurl')
    await vi.waitFor(() => expect(sidebar.toast.success).toHaveBeenCalledWith('Copied to clipboard'))
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^grpcurl -plaintext .*localhost:50051 demo\.v1\.Demo\/SayHello$/))

    writeText.mockClear()
    sidebar.toast.success.mockClear()
    sidebar.state.activeSidebarItemForContextMenu = null
    await nextTick()
    await sidebar.openMenu({ _id: 'g1', _type: 'grpc', name: 'New gRPC Request', parentId: null, workspaceId: 'w1', url: 'localhost:50051', grpc: {} })

    sidebar.clickOption('Copy as grpcurl')
    await vi.waitFor(() => expect(sidebar.toast.error).toHaveBeenCalled())

    expect(sidebar.toast.error).toHaveBeenCalledWith('Cannot copy as grpcurl: Choose a method first')
    expect(sidebar.toast.success).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
})

test('Copy as Curl shows an environment error and copies nothing', async() => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const sidebar = mountSidebar()
    sidebar.store.dispatch.mockRejectedValueOnce(new Error('Could not resolve tag'))
    await sidebar.openMenu({ _id: 'r1', _type: 'request', name: 'Request', method: 'GET', parentId: null, workspaceId: 'w1' })

    sidebar.clickOption('Copy as Curl')
    await vi.waitFor(() => expect(sidebar.toast.error).toHaveBeenCalledWith('Failed to copy to clipboard : Could not resolve tag'))
    expect(sidebar.toast.success).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
})
