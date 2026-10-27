// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, type App } from 'vue'
vi.mock('./RequestPanelHeaders.vue', () => ({ default: defineComponent({ props: ['collectionItemEnvironmentResolved'], setup: props => () => h('pre', { class: 'hover-values' }, JSON.stringify(props.collectionItemEnvironmentResolved)) }) }))
vi.mock('./RequestPanelAuth.vue', () => ({ default: defineComponent({ setup: () => () => null }) }))
vi.mock('@/db', async(importOriginal) => ({ ...await importOriginal<typeof import('@/db')>(), getResponsesByCollectionId: vi.fn(async() => []) }))
import FolderPanel from './FolderPanel.vue'
import { getResponsesByCollectionId } from '@/db'
import { store } from '@/store'
import type { CollectionItem, Workspace } from '@/global'

const apps: App[] = []
let previousCollection: CollectionItem[]
let previousWorkspace: Workspace | null

beforeEach(() => {
    previousCollection = store.state.collection
    previousWorkspace = store.state.activeWorkspace
    vi.stubGlobal('localStorage', { getItem: () => null })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(getResponsesByCollectionId).mockReset().mockResolvedValue([])
    store.state.activeWorkspace = { _id: 'w', name: 'W', _type: 'local' } as Workspace
})

afterEach(() => {
    apps.splice(0).forEach(app => app.unmount())
    store.state.collection = previousCollection
    store.state.activeWorkspace = previousWorkspace
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

function mountPanel(environment: Record<string, string>) {
    const login = { _id: 'login', _type: 'request', name: 'Login', workspaceId: 'w', parentId: null } as CollectionItem
    const folderA = { _id: 'a', _type: 'request_group', name: 'A', workspaceId: 'w', parentId: null, environment, headers: [], authentication: { type: 'No Auth' } } as CollectionItem
    const folderBEnvironment: Record<string, string> = { VALUE: 'B' }
    const folderB = { ...folderA, _id: 'b', name: 'B', environment: folderBEnvironment }
    store.state.collection = [login, folderA, folderB]
    const props = reactive({ collectionItem: folderA })
    const element = document.createElement('div')
    const app = createApp({ render: () => h(FolderPanel, props) })
    app.config.globalProperties.$store = { state: store.state, dispatch: vi.fn((action, payload) => action === 'updateCollectionItem' ? Promise.resolve({ error: null }) : store.dispatch(action, payload)) }
    app.config.errorHandler = vi.fn()
    app.mount(element)
    apps.push(app)
    return { props, folderB, app, values: () => element.querySelector('.hover-values')?.textContent }
}

for(const failed of [false, true]) {
    for(const firstEndsFirst of [false, true]) {
        test(`a late folder load cannot replace the next folder's previews or log, failure: ${failed}, A ends first: ${firstEndsFirst}`, async() => {
            let finishA!: () => void
            let finishB!: () => void
            vi.mocked(getResponsesByCollectionId).mockImplementationOnce(() => new Promise(resolve => {
                finishA = () => resolve([])
            })).mockImplementationOnce(() => new Promise(resolve => {
                finishB = () => resolve([])
            }))
            const tag = `{% response(request='login', attribute='body', path='$.token', behavior='never') %}`
            const panel = mountPanel({ TOKEN: tag, ...(failed ? { INVALID: '{% invalid-function() %}' } : {}) })
            await vi.waitFor(() => expect(getResponsesByCollectionId).toHaveBeenCalledOnce())
            panel.folderB.environment.TOKEN = tag
            panel.props.collectionItem = panel.folderB
            await vi.waitFor(() => expect(getResponsesByCollectionId).toHaveBeenCalledTimes(2))
            const settle = async() => {
                for(let index = 0; index < 30; index++) {
                    await Promise.resolve()
                }
                await nextTick()
            }
            if(firstEndsFirst) {
                finishA()
                await settle()
                expect(panel.values()).toBe('{}')
                expect(console.error).not.toHaveBeenCalled()
            }
            finishB()
            await vi.waitFor(() => expect(panel.values()).toBe(JSON.stringify({ VALUE: 'B', TOKEN: '<no value found>' })))
            if(!firstEndsFirst) {
                finishA()
                await settle()
            }
            expect(panel.values()).toBe(JSON.stringify({ VALUE: 'B', TOKEN: '<no value found>' }))
            expect(console.error).not.toHaveBeenCalled()
            expect(panel.app.config.errorHandler).not.toHaveBeenCalled()
        })
    }
}

test('a current folder load logs an unexpected error and the next folder still loads', async() => {
    const panel = mountPanel({ INVALID: '{% invalid-function() %}' })
    await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('Error loading environment variables:', expect.any(Error)))
    expect(panel.values()).toBe('{}')
    panel.props.collectionItem = panel.folderB
    await vi.waitFor(() => expect(panel.values()).toBe(JSON.stringify({ VALUE: 'B' })))
    expect(panel.app.config.errorHandler).not.toHaveBeenCalled()
})
