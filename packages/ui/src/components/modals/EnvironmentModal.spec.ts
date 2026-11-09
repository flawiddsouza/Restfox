// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, type App } from 'vue'
vi.mock('@/components/CodeMirrorEditor.vue', () => ({ default: defineComponent({ props: { envVariables: { type: Object, default: undefined }, modelValue: { type: String, default: undefined } }, emits: ['update:modelValue'], setup: (props, { emit }) => () => h('pre', { class: 'hover-values', 'data-text': props.modelValue, onInput: (event: CustomEvent) => emit('update:modelValue', event.detail) }, JSON.stringify(props.envVariables)) }) }))
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
    const props = reactive({ showModal: false, collectionItemOpened: { _id: 'a', _type: 'request_group', workspaceId: 'w', name: 'A' } })
    const store = { state: reactive({ activeWorkspace: { _id: 'w' }, collection: [] as Record<string, unknown>[] }), dispatch: vi.fn<(action: string, payload: unknown) => Promise<{ environment: Record<string, string> }>>(async() => ({ environment: { VALUE: 'new' } })), commit: vi.fn() }
    const element = document.createElement('div')
    const app = createApp({ render: () => h(EnvironmentModal, props) })
    app.config.globalProperties.$store = store
    app.config.globalProperties.$toast = { error: vi.fn(), info: vi.fn() }
    app.config.errorHandler = vi.fn()
    app.mount(element); apps.push(app)
    return {
        props, store, app, element,
        values: () => element.querySelector('.hover-values')?.textContent,
        text: () => element.querySelector('.hover-values')?.getAttribute('data-text'),
        type: (text: string) => element.querySelector('.hover-values')?.dispatchEvent(new CustomEvent('input', { detail: text })),
    }
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
        Object.assign(modal.props.collectionItemOpened, { parentId: 'parent' })
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
            modal.props.collectionItemOpened = { ...modal.props.collectionItemOpened, _id: 'b', name: 'B' }
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

test('opening the window on an environment saves nothing', async() => {
    const modal = mountModal()
    Object.assign(modal.props.collectionItemOpened, { environment: { token: 'file' } })
    modal.props.showModal = true
    await vi.waitFor(() => expect(modal.values()).toContain('new'))
    expect(modal.store.commit).not.toHaveBeenCalled()
})

test('after a reload replaced the folder, an edit reaches the folder as the store holds it', async() => {
    const { modal } = await openOnFolderEnvironments()
    const replaced = reactive({ ...JSON.parse(JSON.stringify(modal.props.collectionItemOpened)) })
    modal.store.state.collection = [replaced]
    await flushWatchers()
    expect(modal.store.commit).not.toHaveBeenCalled()
    modal.type('{"value":"typed"}')
    await flushWatchers()
    expect(replaced.environment).toEqual({ value: 'typed' })
    expect(modal.store.commit).toHaveBeenCalled()
})

test('a reload that left the set alone leaves the text being typed', async() => {
    const { modal } = await openOnFolderEnvironments()
    modal.type('{ still typing')
    await flushWatchers()
    modal.store.state.collection = [{ ...JSON.parse(JSON.stringify(modal.props.collectionItemOpened)) }]
    await flushWatchers()
    expect(modal.text()).toBe('{ still typing')
})

test('an environment changed outside in the desktop app does not close the window', async() => {
    const { modal, closed } = await openOnFolderEnvironments()
    emitter.emit('environment', { name: 'updated', data: { path: 'x' } })
    await flushWatchers()
    expect(closed).not.toHaveBeenCalled()
    expect(modal.element.querySelector('.hover-values')).not.toBeNull()
})

test('a new environment\'s list is asked to be saved before the pick that names it', async() => {
    const { modal } = await openOnFolderEnvironments()
    const answers = ['New', '#111']
    Object.assign(window, { createPrompt: vi.fn(async() => answers.shift()) })
    ;[...modal.element.querySelectorAll('button')].find(button => button.textContent === 'Add Environment')?.click()
    await vi.waitFor(() => expect(modal.store.commit).toHaveBeenCalledWith('updateCollectionItemCurrentEnvironment', expect.anything()))
    const names = modal.store.commit.mock.calls.map(([name]) => name)
    expect(names.indexOf('updateCollectionItemEnvironments')).toBeGreaterThanOrEqual(0)
    expect(names.indexOf('updateCollectionItemEnvironments')).toBeLessThan(names.indexOf('updateCollectionItemCurrentEnvironment'))
})

test('an import to merge with an environment removed while its dialog was open adds it instead', async() => {
    const collectionItem: { environments: { name: string, environment: Record<string, string> }[] } = { environments: [{ name: 'Prod', environment: {} }] }
    const window_ = window as unknown as { createPrompt: unknown, createConfirm: unknown }
    window_.createPrompt = vi.fn(async() => '#111')
    window_.createConfirm = vi.fn(async() => {
        collectionItem.environments = [{ name: 'Other', environment: {} }]
        return true
    })
    const component = {
        collectionItem,
        get environments() {
            return collectionItem.environments
        },
        environmentToSave: {},
        changeEnvironment: vi.fn(),
        saveEnvironments: vi.fn(),
        $refs: new Proxy({}, { get: () => [{ scrollIntoView: vi.fn() }] }),
    }
    await (EnvironmentModal as unknown as { methods: { addEnvironment: (this: unknown, name: string, environment: Record<string, string>) => Promise<void> } }).methods.addEnvironment.call(component, 'Prod', { imported: '1' })
    expect(collectionItem.environments.map(environment => environment.name)).toEqual(['Other', 'Prod'])
})

test('text typed after opening on text that did not change is saved', async() => {
    const modal = mountModal()
    modal.props.showModal = true
    await vi.waitFor(() => expect(modal.values()).toContain('new'))
    modal.type('{"typed":"yes"}')
    await flushWatchers()
    expect(modal.store.commit).toHaveBeenCalledWith('updateCollectionItemEnvironment', expect.objectContaining({ environment: { typed: 'yes' } }))
})

test('an edit made after opening is saved', () => {
    const component = { environment: '{"token":"typed"}', environmentToSave: {}, parseError: '', environmentLoadedNotEdited: false, saveEnvironment: vi.fn() }
    ;(EnvironmentModal as unknown as { watch: { environment: (this: unknown) => void } }).watch.environment.call(component)
    expect(component.saveEnvironment).toHaveBeenCalledOnce()
    expect(component.environmentToSave).toEqual({ token: 'typed' })
})

const environmentOf = (name: string, value: string, color = '#000') => ({ name, color, environment: { value } })
const loadedOutside = () => ({ environment: { value: 'outside' }, currentEnvironment: 'Default', environments: [environmentOf('Default', 'outside'), environmentOf('Added', 'added')] })

async function openOnFolderEnvironments() {
    const closed = vi.fn()
    const modal = mountModal()
    Object.assign(modal.props, { 'onUpdate:showModal': closed })
    Object.assign(modal.props.collectionItemOpened, { environment: { value: 'page' }, currentEnvironment: 'Default', environments: [environmentOf('Default', 'page')] })
    modal.props.showModal = true
    await vi.waitFor(() => expect(modal.values()).toContain('new'))
    return { modal, closed }
}

// what a reload does for the set a window shows: the store takes the folder as read, then the window is told
function reloadBrings(modal: ReturnType<typeof mountModal>, read: Record<string, unknown>) {
    modal.store.state.collection = [{ ...JSON.parse(JSON.stringify(modal.props.collectionItemOpened)), ...read }]
    emitter.emit('environmentsChangedOutside', { workspaceId: 'w', collectionId: 'a', read })
}

const savedLists = (modal: ReturnType<typeof mountModal>) => modal.store.commit.mock.calls.filter(([name]) => name === 'updateCollectionItemEnvironments').map(([, payload]) => JSON.parse(JSON.stringify(payload)).environments)
const flushWatchers = async() => {
    await nextTick()
    await nextTick()
}

test('an outside change to the folder it shows puts what was loaded in the window, which stays open and saves nothing', async() => {
    const { modal, closed } = await openOnFolderEnvironments()
    reloadBrings(modal, loadedOutside())
    await flushWatchers()
    expect(closed).not.toHaveBeenCalled()
    expect(JSON.parse(String(modal.text()))).toEqual({ value: 'outside' })
    expect([...modal.element.querySelectorAll('.environment-sidebar-item')].map(item => item.textContent?.trim())).toEqual(['Default', 'Added'])
    expect(modal.store.commit).not.toHaveBeenCalled()
    expect(modal.app.config.globalProperties.$toast.info).toHaveBeenCalledOnce()
})

test.each([
    ['another folder', { workspaceId: 'w', collectionId: 'b', read: loadedOutside() }],
    ['the same folder id in another workspace', { workspaceId: 'x', collectionId: 'a', read: loadedOutside() }],
    ['the workspace, while it shows a folder', { workspaceId: 'w', collectionId: null, read: loadedOutside() }],
])('an outside change to %s leaves the window alone', async(_label, change) => {
    const { modal, closed } = await openOnFolderEnvironments()
    emitter.emit('environmentsChangedOutside', change)
    await flushWatchers()
    expect(closed).not.toHaveBeenCalled()
    expect(JSON.parse(String(modal.text()))).toEqual({ value: 'page' })
    expect(modal.app.config.globalProperties.$toast.info).not.toHaveBeenCalled()
})

test('a closed window ignores an outside change', async() => {
    const modal = mountModal()
    const environmentBefore = JSON.stringify(modal.props.collectionItemOpened)
    reloadBrings(modal, loadedOutside())
    await flushWatchers()
    expect(JSON.stringify(modal.props.collectionItemOpened)).toBe(environmentBefore)
    expect(modal.app.config.globalProperties.$toast.info).not.toHaveBeenCalled()
})

test('the folder it shows being removed outside closes the window, even with text that is not JSON yet', async() => {
    const { modal, closed } = await openOnFolderEnvironments()
    modal.type('{ not json')
    await flushWatchers()
    emitter.emit('environmentsChangedOutside', { workspaceId: 'w', collectionId: 'a', read: null })
    await flushWatchers()
    expect(closed).toHaveBeenCalledWith(false)
    expect(modal.store.commit).not.toHaveBeenCalled()
})

test('text that is not JSON yet gives way to what was loaded, with its error gone', async() => {
    const { modal, closed } = await openOnFolderEnvironments()
    modal.type('{ not json')
    await flushWatchers()
    expect(modal.element.querySelector('.box:not(.box-hidden)')).not.toBeNull()
    reloadBrings(modal, loadedOutside())
    await flushWatchers()
    expect(modal.element.querySelector('.box:not(.box-hidden)')).toBeNull()
    expect(JSON.parse(String(modal.text()))).toEqual({ value: 'outside' })
    expect(closed).not.toHaveBeenCalled()
    expect(modal.store.commit).not.toHaveBeenCalled()
})

test('an edit after an outside change saves onto what was loaded', async() => {
    const { modal } = await openOnFolderEnvironments()
    reloadBrings(modal, loadedOutside())
    await flushWatchers()
    modal.type('{"value":"typed"}')
    await flushWatchers()
    expect(savedLists(modal).at(-1)).toEqual([{ ...environmentOf('Default', 'typed') }, environmentOf('Added', 'added')])
})

describe('a dialog open when the environments change outside', () => {
    async function openDialogOn(item: 'Rename' | 'Change color' | 'Delete', environments: ReturnType<typeof environmentOf>[]) {
        const opened = await openOnFolderEnvironments()
        Object.assign(opened.modal.props.collectionItemOpened, { environments })
        await nextTick()
        let answer!: (value: unknown) => void
        const dialog = vi.fn(() => new Promise(resolve => answer = resolve))
        Object.assign(window, { createPrompt: dialog, createConfirm: dialog })
        ;(opened.modal.element.querySelector('.environment-sidebar-item-menu') as HTMLElement).click()
        await nextTick()
        ;([...opened.modal.element.querySelectorAll('.context-menu > div')].find(entry => entry.textContent === item) as HTMLElement).click()
        await nextTick()
        expect(dialog).toHaveBeenCalledOnce()
        return { ...opened, answer: (value: unknown) => answer(value) }
    }

    test('a color goes onto the environment that was loaded, and the rest of what was loaded is kept', async() => {
        const { modal, answer } = await openDialogOn('Change color', [environmentOf('Default', 'page')])
        reloadBrings(modal, loadedOutside())
        answer('#fff')
        await flushWatchers()
        expect(savedLists(modal).at(-1)).toEqual([environmentOf('Default', 'outside', '#fff'), environmentOf('Added', 'added')])
    })

    test('cancelling Change color leaves the color and saves nothing', async() => {
        const { modal, answer } = await openDialogOn('Change color', [environmentOf('Default', 'page', '#123')])
        answer(null)
        await flushWatchers()
        expect(savedLists(modal)).toEqual([])
        expect(modal.props.collectionItemOpened).toHaveProperty('environments.0.color', '#123')
    })

    test('a rename goes onto the environment that was loaded', async() => {
        const { modal, answer } = await openDialogOn('Rename', [environmentOf('Default', 'page')])
        reloadBrings(modal, loadedOutside())
        answer('Renamed')
        await flushWatchers()
        expect(savedLists(modal)[0]).toEqual([{ ...environmentOf('Renamed', 'outside') }, environmentOf('Added', 'added')])
    })

    test('a delete keeps what was added outside', async() => {
        const { modal, answer } = await openDialogOn('Delete', [environmentOf('Default', 'page'), environmentOf('Other', 'page')])
        reloadBrings(modal, loadedOutside())
        answer(true)
        await flushWatchers()
        expect(savedLists(modal)[0]).toEqual([environmentOf('Added', 'added')])
    })

    test('a delete does not remove the last environment left once the dialog is answered', async() => {
        const { modal, answer } = await openDialogOn('Delete', [environmentOf('Default', 'page'), environmentOf('Other', 'page')])
        reloadBrings(modal, { environment: { value: 'page' }, currentEnvironment: 'Default', environments: [environmentOf('Default', 'page')] })
        answer(true)
        await flushWatchers()
        expect(savedLists(modal)).toEqual([])
        expect(modal.app.config.errorHandler).not.toHaveBeenCalled()
    })

    test.each(['Rename', 'Change color', 'Delete'] as const)('%s of an environment removed outside saves nothing', async(item) => {
        const { modal, answer } = await openDialogOn(item, [environmentOf('Default', 'page'), environmentOf('Other', 'page')])
        reloadBrings(modal, { environment: { value: 'added' }, currentEnvironment: 'Added', environments: [environmentOf('Added', 'added')] })
        answer(item === 'Delete' ? true : 'x')
        await flushWatchers()
        expect(savedLists(modal)).toEqual([])
        expect(modal.app.config.errorHandler).not.toHaveBeenCalled()
    })
})