// @vitest-environment happy-dom

import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, type App } from 'vue'

// the store response tags send through
vi.mock('@/store', () => ({
    store: {
        state: { activeWorkspace: { _id: 'w' }, collection: [{ _id: 'login', _type: 'request', workspaceId: 'w', name: 'Login' }] },
        dispatch: vi.fn(),
    },
}))

vi.mock('@/db', () => ({
    getResponsesByCollectionId: vi.fn(async() => []),
}))

vi.mock('../CodeMirrorEditor.vue', () => ({
    default: defineComponent({
        props: { modelValue: { type: String, default: '' } },
        setup: props => () => h('pre', { class: 'generated-code' }, props.modelValue),
    }),
}))

import GenerateCodeModal from './GenerateCodeModal.vue'
import { store as tagStore } from '@/store'
import constants from '@/constants'

// the reply of the tag's request
const sentResponse = () => ({ _id: 'sent', collectionId: 'login', status: 200, statusText: 'OK', headers: [['content-type', 'application/json']], buffer: new TextEncoder().encode('{"token":"fresh"}').buffer, createdAt: Date.now() })

// unmounted after each test, so Modal's window key listener goes with it
const mountedApps: App[] = []

beforeEach(() => {
    const storage = new Map<string, string>([
        [constants.LOCAL_STORAGE_KEY.GENERATE_CODE_LANGUAGE, 'shell'],
        [constants.LOCAL_STORAGE_KEY.GENERATE_CODE_CLIENT, 'curl'],
    ])
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    })
    vi.mocked(tagStore.dispatch).mockReset().mockResolvedValue(sentResponse())
})

afterEach(() => {
    mountedApps.splice(0).forEach(app => app.unmount())
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const tag = `{% response(request='login', attribute='body', path='$.token', behavior='always') %}`

function mountModal() {
    const props = reactive({ showModal: false, collectionItem: null as any })
    const store = {
        state: reactive({ activeWorkspace: { _id: 'w' } }),
        dispatch: vi.fn(async() => ({ environment: {}, parentHeaders: {}, parentAuthentication: undefined, requestParentArray: [] })),
    }
    const element = document.createElement('div')
    document.body.appendChild(element)
    const app = createApp({
        render: () => h(GenerateCodeModal, {
            ...props,
            'onUpdate:showModal': (value: boolean) => {
                props.showModal = value
            },
        }),
    })
    app.config.globalProperties.$store = store
    app.mount(element)
    mountedApps.push(app)
    const code = () => element.querySelector('.generated-code')?.textContent ?? ''
    const startOpening = () => {
        props.collectionItem = { _id: 'command', workspaceId: 'w', _type: 'request', name: 'Command', method: 'GET', url: `https://example.test/${tag}`, headers: [], parameters: [], body: { mimeType: 'No Body' } }
        props.showModal = true
    }
    const selectClient = (client: string) => {
        const select = element.querySelectorAll('select')[1]
        select.value = client
        select.dispatchEvent(new Event('change'))
    }
    return {
        props,
        store,
        code,
        startOpening,
        selectClient,
        async open() {
            startOpening()
            await vi.waitFor(() => expect(code()).toContain('https://example.test/fresh'))
        },
        async pickClient(client: string) {
            selectClient(client)
            await vi.waitFor(() => expect(code()).toContain(client === 'wget' ? 'wget' : 'curl'))
        },
    }
}

test('failure from a closed opening cannot clear the reopened preparation', async() => {
    let failOld!: (error: Error) => void
    let finishNew!: (response: any) => void
    vi.mocked(tagStore.dispatch).mockReset()
        .mockImplementationOnce(() => new Promise((_resolve, reject) => {
            failOld = reject
        }))
        .mockImplementationOnce(() => new Promise(resolve => {
            finishNew = resolve
        }))
    const modal = mountModal()
    modal.startOpening()
    await vi.waitFor(() => expect(sends()).toBe(1))
    modal.props.showModal = false
    await nextTick()
    modal.startOpening()
    await vi.waitFor(() => expect(sends()).toBe(2))
    failOld(new Error('old failed'))
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    modal.selectClient('wget')
    await nextTick()
    expect(sends()).toBe(2)
    finishNew(sentResponse())
    await vi.waitFor(() => expect(modal.code()).toContain('wget'))
    expect(sends()).toBe(2)
})

const sends = () => vi.mocked(tagStore.dispatch).mock.calls.filter(([action]: any[]) => action === 'sendRequest').length
const environmentResolves = (store: { dispatch: { mock: { calls: any[][] } } }) => store.dispatch.mock.calls.filter(([action]) => action === 'getEnvironmentForRequest').length

test('a client picked after an environment failure resolves anew and shows its code', async() => {
    const modal = mountModal()
    modal.store.dispatch.mockRejectedValueOnce(new Error('Environment unavailable'))
    modal.startOpening()
    await vi.waitFor(() => expect(modal.code()).toBe('Environment unavailable'))
    expect(environmentResolves(modal.store)).toBe(1)
    expect(sends()).toBe(0)

    await modal.pickClient('wget')
    expect(modal.code()).toContain('https://example.test/fresh')
    expect(environmentResolves(modal.store)).toBe(2)
    expect(sends()).toBe(1)
})

test('changing the client reuses the tag values of this opening, opening again works them out anew', async() => {
    const modal = mountModal()
    await modal.open()
    expect(sends()).toBe(1)

    await modal.pickClient('wget')
    await modal.pickClient('curl')
    expect(sends()).toBe(1)
    expect(environmentResolves(modal.store)).toBe(1)

    await modal.open()
    expect(sends()).toBe(2)
    expect(environmentResolves(modal.store)).toBe(2)
})

test('a client picked while the tags still resolve sends once and shows the picked client\'s code', async() => {
    let finish: (response: any) => void = () => undefined
    vi.mocked(tagStore.dispatch).mockReset().mockImplementationOnce(() => new Promise(resolve => {
        finish = resolve
    }))
    const modal = mountModal()
    modal.startOpening()
    await vi.waitFor(() => expect(sends()).toBe(1))
    modal.selectClient('wget')
    await nextTick()
    finish(sentResponse())
    await vi.waitFor(() => expect(modal.code()).toContain('wget'))
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    expect(modal.code()).toContain('wget')
    expect(sends()).toBe(1)
})
