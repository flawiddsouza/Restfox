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
import * as codeGeneration from '@/utils/generate-code'

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
    await vi.waitFor(() => expect(sends()).toBe(2))
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

for(const failed of [false, true]) {
    test(`an earlier pick ending after the later pick keeps the later code, failed: ${failed}`, async() => {
        let finish: (code: string) => void = () => undefined
        const earlierCode = new Promise<string>((resolve, reject) => {
            finish = failed ? message => reject(new Error(message)) : resolve
        })
        const generateCode = vi.spyOn(codeGeneration, 'generateCode').mockReturnValueOnce(earlierCode)
        const modal = mountModal()
        modal.startOpening()
        await vi.waitFor(() => expect(generateCode).toHaveBeenCalledOnce())

        await modal.pickClient('wget')
        const laterCode = modal.code()
        finish(failed ? 'Could not generate code' : 'earlier curl command')
        for(let index = 0; index < 30; index++) {
            await Promise.resolve()
        }
        await nextTick()
        expect(modal.code()).toBe(laterCode)
    })
}

test('an earlier pick failing after a later pick succeeded keeps the tag values, so the next pick sends nothing again', async() => {
    let fail: (error: Error) => void = () => undefined
    const generateCode = vi.spyOn(codeGeneration, 'generateCode').mockReturnValueOnce(new Promise<string>((_resolve, reject) => {
        fail = reject
    }))
    const modal = mountModal()
    modal.startOpening()
    await vi.waitFor(() => expect(generateCode).toHaveBeenCalledOnce())
    await modal.pickClient('wget')
    fail(new Error('Could not generate code'))
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    await modal.pickClient('curl')
    expect(sends()).toBe(1)
})

test('a prompt cancelled in the latest pick is asked again by the next pick', async() => {
    window.createPrompt = vi.fn(async() => null) as any
    const modal = mountModal()
    modal.props.collectionItem = { _id: 'command', workspaceId: 'w', _type: 'request', name: 'Command', method: 'GET', url: 'https://example.test/{% prompt(title=\'Token\') %}', headers: [], parameters: [], body: { mimeType: 'No Body' } }
    modal.props.showModal = true
    await vi.waitFor(() => expect(modal.code()).toContain('cancelled'))
    vi.mocked(window.createPrompt).mockResolvedValue('answered')
    await modal.pickClient('wget')
    expect(window.createPrompt).toHaveBeenCalledTimes(2)
    expect(modal.code()).toContain('https://example.test/answered')
    delete (window as any).createPrompt
})

test('a prompt cancelled after a language change is asked again by the next pick', async() => {
    let cancel!: () => void
    window.createPrompt = vi.fn(() => new Promise(resolve => {
        cancel = () => resolve(null)
    })) as any
    const modal = mountModal()
    modal.props.collectionItem = { _id: 'command', workspaceId: 'w', _type: 'request', name: 'Command', method: 'GET', url: 'https://example.test/{% prompt(title=\'Token\') %}', headers: [], parameters: [], body: { mimeType: 'No Body' } }
    modal.props.showModal = true
    await vi.waitFor(() => expect(window.createPrompt).toHaveBeenCalledOnce())
    const language = document.querySelectorAll('select')[0]
    language.value = 'shell'
    language.dispatchEvent(new Event('change'))
    await nextTick()
    cancel()
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    vi.mocked(window.createPrompt).mockResolvedValue('answered')
    await modal.pickClient('wget')
    expect(window.createPrompt).toHaveBeenCalledTimes(2)
    expect(modal.code()).toContain('https://example.test/answered')
    delete (window as any).createPrompt
})

test('an environment failing after a language change is resolved again by the next pick', async() => {
    const modal = mountModal()
    let fail!: (error: Error) => void
    modal.store.dispatch.mockImplementationOnce(() => new Promise((_resolve, reject) => {
        fail = reject
    }))
    modal.startOpening()
    await vi.waitFor(() => expect(environmentResolves(modal.store)).toBe(1))
    const language = document.querySelectorAll('select')[0]
    language.value = 'shell'
    language.dispatchEvent(new Event('change'))
    await nextTick()
    fail(new Error('Environment unavailable'))
    for(let index = 0; index < 30; index++) {
        await Promise.resolve()
    }
    await modal.pickClient('wget')
    expect(environmentResolves(modal.store)).toBe(2)
    expect(modal.code()).toContain('https://example.test/fresh')
})

test('opening for another request shows none of the previous request\'s code while its own resolves', async() => {
    const modal = mountModal()
    await modal.open()
    modal.props.showModal = false
    await nextTick()
    let finish!: () => void
    modal.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
        finish = () => resolve({ environment: {}, parentHeaders: {}, parentAuthentication: undefined, requestParentArray: [] })
    }))
    modal.props.collectionItem = { _id: 'other', workspaceId: 'w', _type: 'request', name: 'Other', method: 'GET', url: 'https://other.test/', headers: [], parameters: [], body: { mimeType: 'No Body' } }
    modal.props.showModal = true
    await vi.waitFor(() => expect(environmentResolves(modal.store)).toBe(2))
    await nextTick()
    expect(modal.code()).toBe('')
    finish()
    await vi.waitFor(() => expect(modal.code()).toContain('https://other.test/'))
})

for(const change of ['another language', 'an opening for another request']) {
    test(`a pick ending after ${change} does not show its code there`, async() => {
        let finish: (code: string) => void = () => undefined
        const generateCode = vi.spyOn(codeGeneration, 'generateCode').mockReturnValueOnce(new Promise<string>(resolve => {
            finish = resolve
        }))
        const modal = mountModal()
        modal.startOpening()
        await vi.waitFor(() => expect(generateCode).toHaveBeenCalledOnce())
        if(change === 'another language') {
            // a client of the same key in another language, such as fetch
            const targets: { key: string, clients: { key: string }[] }[] = codeGeneration.getAvailableTargets()
            const [target, otherTarget, client] = targets.flatMap(target => targets.flatMap(other => other.key === target.key ? [] : target.clients
                .filter(client => other.clients.some(({ key }) => key === client.key))
                .map(client => [target.key, other.key, client.key])))[0]
            const pick = async(language: string) => {
                const languageSelect = document.querySelectorAll('select')[0]
                languageSelect.value = language
                languageSelect.dispatchEvent(new Event('change'))
                await nextTick()
                modal.selectClient(client)
            }
            generateCode.mockReset().mockImplementationOnce(() => new Promise<string>(resolve => {
                finish = resolve
            })).mockImplementation(async() => 'code of the later language')
            await pick(target)
            await vi.waitFor(() => expect(generateCode).toHaveBeenCalledOnce())
            await pick(otherTarget)
            await vi.waitFor(() => expect(modal.code()).toBe('code of the later language'))
        } else {
            modal.props.showModal = false
            await nextTick()
            await modal.open()
        }
        await nextTick()
        const laterCode = modal.code()
        finish('earlier curl command')
        for(let index = 0; index < 30; index++) {
            await Promise.resolve()
        }
        await nextTick()
        expect(modal.code()).toBe(laterCode)
        expect(modal.code()).not.toContain('earlier curl command')
    })
}
