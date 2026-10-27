// @vitest-environment happy-dom

import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createApp, h, KeepAlive, nextTick, reactive } from 'vue'
import type { CollectionItem } from '@/global'
import type { GrpcSchema } from '@/utils/grpc'

const transport = vi.hoisted(() => ({
    isGrpcAvailable: vi.fn(() => true),
    loadGrpcSchema: vi.fn(),
    startGrpcCall: vi.fn(),
}))

vi.mock('@/utils/grpc-transport', () => transport)
vi.mock('@/db', async(importOriginal) => ({ ...await importOriginal<typeof import('@/db')>(), getResponsesByCollectionId: vi.fn(async() => []) }))

import GrpcRequestPanel from './GrpcRequestPanel.vue'
import { getGrpcItemKey, grpcCalls, resetGrpcCalls } from '@/utils/grpc-calls'
import { getResponsesByCollectionId } from '@/db'
import { store as tagStore } from '@/store'

// what grpc-calls keeps an item's call by
const itemKey = (id: string) => getGrpcItemKey({ workspaceId: 'w1', _id: id })

const schema: GrpcSchema = {
    source: 'reflection',
    services: [{
        name: 'demo.v1.Demo',
        methods: [
            { name: 'SayHello', path: '/demo.v1.Demo/SayHello', requestStream: false, responseStream: false, inputType: 'demo.v1.HelloRequest', outputType: 'demo.v1.HelloReply', example: '{\n  "name": ""\n}' },
            { name: 'Count', path: '/demo.v1.Demo/Count', requestStream: false, responseStream: true, inputType: 'demo.v1.CountRequest', outputType: 'demo.v1.CountReply', example: '{\n  "to": 0,\n  "intervalMs": 0\n}' },
            { name: 'Chat', path: '/demo.v1.Demo/Chat', requestStream: true, responseStream: true, inputType: 'demo.v1.ChatMessage', outputType: 'demo.v1.ChatMessage', example: '{\n  "text": ""\n}' },
        ],
    }],
}

// lets the awaited steps of a load or send run
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
    resetGrpcCalls()
    transport.isGrpcAvailable.mockReturnValue(true)
    transport.loadGrpcSchema.mockReset()
    transport.loadGrpcSchema.mockResolvedValue(schema)
    transport.startGrpcCall.mockReset()
    transport.startGrpcCall.mockReturnValue({ send: vi.fn(), end: vi.fn(), cancel: vi.fn() })
    vi.mocked(getResponsesByCollectionId).mockReset().mockResolvedValue([])
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (window as any).createPrompt
    document.body.innerHTML = ''
})

// the window's alert-confirm-prompt, where the panel opens its confirms
function stubConfirm(createConfirm: (...args: any[]) => Promise<boolean>, ownerDocument = document) {
    const container = ownerDocument.createElement('alert-confirm-prompt')
    Object.assign(container, { createConfirm })
    ownerDocument.body.appendChild(container)
}

function grpcItem(fields: Partial<CollectionItem> = {}): CollectionItem {
    return {
        _id: 'item1',
        _type: 'grpc',
        name: 'New gRPC Request',
        parentId: null,
        workspaceId: 'w1',
        url: 'localhost:50051',
        body: { mimeType: 'application/json', text: '{}' },
        grpc: {},
        ...fields,
    }
}

async function mountPanel(fields: Partial<CollectionItem> = {}, siblings: CollectionItem[] = [], ownerDocument = document, environmentError: Error | null = null, resolveEnvironment?: (payload: any) => Promise<any>) {
    const state = reactive({
        activeTab: null as CollectionItem | null,
        activeWorkspace: { _id: fields.workspaceId ?? 'w1', location: null },
        tabEnvironmentResolved: {} as Record<string, any>,
        flags: { hidePasswordFields: false, disableSSLVerification: false },
        requestResponses: {} as Record<string, any>,
        requestResponseStatus: {} as Record<string, string>,
        responses: {} as Record<string, any[]>,
        skipPersistingActiveTab: false,
        collection: [] as CollectionItem[],
    })
    state.activeTab = grpcItem(fields)
    const item = state.activeTab
    state.collection.push(item, ...siblings)
    const dispatch = vi.fn(async(action: string, payload: any) => {
        if(action === 'getEnvironmentForRequest') {
            if(resolveEnvironment) {
                return resolveEnvironment(payload)
            }
            if(environmentError) {
                throw environmentError
            }
            return { environment: {}, parentHeaders: {}, parentAuthentication: undefined, requestParentArray: [] }
        }
        if(action === 'updateCollectionItemName') {
            return { error: null, name: payload.name }
        }
        if(action === 'saveResponse') {
            return
        }
        throw new Error(`unexpected action ${action}`)
    })
    const element = ownerDocument.createElement('div')
    ownerDocument.body.appendChild(element)
    const panelApp = createApp({
        render: () => h('div', { class: 'request-panel' }, [h(GrpcRequestPanel, { activeTab: item })]),
    })
    panelApp.provide('store', { state, dispatch, commit: vi.fn() })
    panelApp.provide('$toast', { error: vi.fn(), success: vi.fn() })
    panelApp.mount(element)
    // the methods load when the item opens
    await settle()
    await nextTick()
    return {
        state,
        item,
        dispatch,
        element,
        action: () => element.querySelector('[data-testid="grpc-request-panel-action-button"]') as HTMLButtonElement,
        targetTag: () => element.querySelector('.grpc-request-panel-target-tag') as HTMLElement | null,
        async chooseMethod(name: string) {
            const pickerButton = element.querySelector('.grpc-method-picker-button') as HTMLElement
            pickerButton.click()
            await nextTick()
            await settle()
            const option = [...element.querySelectorAll('.grpc-method-picker-option')].find(button => button.querySelector('.grpc-method-picker-option-name')!.textContent === name) as HTMLElement
            option.click()
            await settle()
            await nextTick()
        },
        unmount: () => {
            panelApp.unmount()
            element.remove()
        },
    }
}

test('a pre-key environment failure is visible and settled, and a failed reload keeps earlier methods', async() => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const panel = await mountPanel({}, [], document, new Error('environment broken'))
    ;(panel.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLElement).click()
    await nextTick()
    const status = () => panel.element.querySelector('.grpc-request-panel-proto-status')!
    expect(status().textContent).toContain('environment broken')
    const reload = () => [...status().querySelectorAll('button')].find(button => button.textContent === 'Reload') as HTMLButtonElement
    expect(reload().disabled).toBe(false)
    expect(transport.loadGrpcSchema).not.toHaveBeenCalled()
    panel.dispatch.mockImplementation(async(action: string) => {
        if(action === 'getEnvironmentForRequest') {
            return { environment: {}, parentHeaders: {}, parentAuthentication: undefined, requestParentArray: [] }
        }
        throw new Error(`unexpected action ${action}`)
    })
    reload().click()
    await vi.waitFor(() => expect(status().textContent).toContain('1 service, 3 methods'))
    vi.mocked(Date.now).mockReturnValue(2000)
    panel.dispatch.mockRejectedValueOnce(new Error('reload preparation failed'))
    reload().click()
    await vi.waitFor(() => expect(status().textContent).toContain('reload preparation failed'))
    expect(status().textContent).toContain('Last loaded')
    expect(reload().disabled).toBe(false)
    panel.unmount()
})

test('a newer successful load of a shared schema replaces an earlier preparation error in Proto', async() => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    window.createPrompt = vi.fn(async() => null)
    const first = await mountPanel({ headers: [{ name: 'authorization', value: `{% prompt(title='Token') %}` }] })
    let second: Awaited<ReturnType<typeof mountPanel>> | undefined
    try {
        (first.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLElement).click()
        await nextTick()
        const status = () => first.element.querySelector('.grpc-request-panel-proto-status')!
        const reload = [...status().querySelectorAll('button')].find(button => button.textContent === 'Reload') as HTMLButtonElement
        reload.click()
        await vi.waitFor(() => expect(status().textContent).toContain('Prompt "Token" was cancelled'))
        vi.mocked(Date.now).mockReturnValue(2000)
        second = await mountPanel({ _id: 'other' })
        expect(transport.loadGrpcSchema).toHaveBeenCalledOnce()
        expect(status().textContent).toContain('1 service, 3 methods')
        expect(status().textContent).not.toContain('Could not load methods')
        vi.mocked(Date.now).mockReturnValue(3000)
        transport.loadGrpcSchema.mockRejectedValueOnce(new Error('newer server load failed'))
        ;(second.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLElement).click()
        await nextTick()
        const secondStatus = second.element.querySelector('.grpc-request-panel-proto-status')!
        ;([...secondStatus.querySelectorAll('button')].find(button => button.textContent === 'Reload') as HTMLButtonElement).click()
        await vi.waitFor(() => expect(status().textContent).toContain('newer server load failed'))
        expect(status().textContent).not.toContain('Prompt "Token" was cancelled')
    } finally {
        first.unmount()
        second?.unmount()
    }
})

for(const preparationFailure of ['folder response tag', 'cancelled Reload prompt']) {
    test(`Send replaces the ${preparationFailure} error with loaded methods in Proto`, async() => {
        const login = grpcItem({ _id: 'login', _type: 'request', grpc: undefined })
        const folder = grpcItem({ _id: 'folder', _type: 'request_group', environment: { TOKEN: `{% response(request='login', attribute='body', path='$.token', behavior='always') %}` } })
        const previousCollection = tagStore.state.collection
        const previousWorkspace = tagStore.state.activeWorkspace
        tagStore.state.activeWorkspace = { _id: 'w1', _type: 'local', environment: {} } as any
        tagStore.state.collection = [login, folder]
        const dispatch = tagStore.dispatch.bind(tagStore)
        const sendLogin = vi.spyOn(tagStore, 'dispatch').mockImplementation((action: any, payload?: any) => action === 'sendRequest'
            ? Promise.resolve({ status: 200, headers: [['content-type', 'application/json']], buffer: new TextEncoder().encode('{"token":"fresh"}').buffer })
            : dispatch(action, payload))
        window.createPrompt = vi.fn(async() => null)
        const panel = await mountPanel({
            parentId: preparationFailure === 'folder response tag' ? folder._id : null,
            headers: [{ name: 'authorization', value: preparationFailure === 'folder response tag' ? '{{TOKEN}}' : `{% prompt(title='Token') %}` }],
            grpc: { service: 'demo.v1.Demo', method: 'SayHello' },
        }, [], document, null, payload => tagStore.dispatch('getEnvironmentForRequest', payload))
        try {
            (panel.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLElement).click()
            await nextTick()
            const status = () => panel.element.querySelector('.grpc-request-panel-proto-status')!
            if(preparationFailure === 'cancelled Reload prompt') {
                const reload = [...status().querySelectorAll('button')].find(button => button.textContent === 'Reload') as HTMLButtonElement
                reload.click()
            }
            await vi.waitFor(() => expect(status().textContent).toContain('Could not load methods'))
            expect(transport.loadGrpcSchema).not.toHaveBeenCalled()
            vi.mocked(window.createPrompt).mockResolvedValue('answered')
            panel.action().click()
            await vi.waitFor(() => expect(transport.startGrpcCall).toHaveBeenCalledOnce())
            transport.startGrpcCall.mock.calls[0][1]({ type: 'status', code: 0, name: 'OK', details: '', trailers: [], time: 2 })
            await vi.waitFor(() => expect(status().textContent).toContain('1 service, 3 methods'))
            expect(status().textContent).not.toContain('Could not load methods')
            expect(status().textContent).not.toContain('Last loaded')
            if(preparationFailure === 'folder response tag') {
                expect(sendLogin.mock.calls.filter(([action]: any[]) => action === 'sendRequest')).toHaveLength(1)
            }
        } finally {
            panel.unmount()
            tagStore.state.collection = previousCollection
            tagStore.state.activeWorkspace = previousWorkspace
        }
    })
}

for(const preparationFailure of ['folder response tag', 'cancelled Reload prompt']) {
    for(const connectionFailure of [false, true]) {
        test(`Send's failed methods load replaces the ${preparationFailure} error in Proto, connection failure: ${connectionFailure}`, async() => {
            vi.spyOn(Date, 'now').mockReturnValue(1000)
            const login = grpcItem({ _id: 'login', _type: 'request', grpc: undefined })
            const folder = grpcItem({ _id: 'folder', _type: 'request_group', environment: { TOKEN: `{% response(request='login', attribute='body', path='$.token', behavior='always') %}` } })
            const previousCollection = tagStore.state.collection
            const previousWorkspace = tagStore.state.activeWorkspace
            tagStore.state.activeWorkspace = { _id: 'w1', _type: 'local', environment: {} } as any
            tagStore.state.collection = [login, folder]
            const dispatch = tagStore.dispatch.bind(tagStore)
            const sendLogin = vi.spyOn(tagStore, 'dispatch').mockImplementation((action: any, payload?: any) => action === 'sendRequest'
                ? Promise.resolve({ status: 200, headers: [['content-type', 'application/json']], buffer: new TextEncoder().encode('{"token":"fresh"}').buffer })
                : dispatch(action, payload))
            window.createPrompt = vi.fn(async() => null)
            const panel = await mountPanel({
                parentId: preparationFailure === 'folder response tag' ? folder._id : null,
                headers: [{ name: 'authorization', value: preparationFailure === 'folder response tag' ? '{{TOKEN}}' : `{% prompt(title='Token') %}` }],
                grpc: { service: 'demo.v1.Demo', method: 'SayHello' },
            }, [], document, null, payload => tagStore.dispatch('getEnvironmentForRequest', payload))
            try {
                (panel.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLElement).click()
                await nextTick()
                const status = () => panel.element.querySelector('.grpc-request-panel-proto-status')!
                if(preparationFailure === 'cancelled Reload prompt') {
                    const reload = [...status().querySelectorAll('button')].find(button => button.textContent === 'Reload') as HTMLButtonElement
                    reload.click()
                }
                const previousError = preparationFailure === 'folder response tag' ? 'Could not resolve tag' : 'Prompt "Token" was cancelled'
                await vi.waitFor(() => expect(status().textContent).toContain(previousError))
                expect(transport.loadGrpcSchema).not.toHaveBeenCalled()
                vi.mocked(Date.now).mockReturnValue(2000)
                vi.mocked(window.createPrompt).mockResolvedValue('answered')
                const serverError = connectionFailure ? 'localhost:50051 refused the connection' : 'The server does not offer server reflection'
                transport.loadGrpcSchema.mockRejectedValueOnce(Object.assign(new Error(serverError), connectionFailure
                    ? { code: 'CONNECTION_FAILED', grpcStatus: { code: 14, name: 'UNAVAILABLE' } }
                    : { code: 'REFLECTION_UNIMPLEMENTED' }))
                panel.action().click()
                await vi.waitFor(() => expect(grpcCalls[itemKey(panel.item._id)]?.phase).toBe('ended'))
                expect(transport.loadGrpcSchema).toHaveBeenCalledOnce()
                expect(transport.startGrpcCall).not.toHaveBeenCalled()
                expect(status().textContent).toContain(serverError)
                expect(status().textContent).not.toContain(previousError)
                expect((status().querySelector('button') as HTMLButtonElement).disabled).toBe(false)
                if(preparationFailure === 'folder response tag') {
                    expect(sendLogin.mock.calls.filter(([action]: any[]) => action === 'sendRequest')).toHaveLength(1)
                }
            } finally {
                panel.unmount()
                tagStore.state.collection = previousCollection
                tagStore.state.activeWorkspace = previousWorkspace
            }
        })
    }
}

for(const firstEndsFirst of [true, false]) {
    test(`a failed gRPC target preview cannot replace a newer environment at the same URL, first ends first: ${firstEndsFirst}`, async() => {
        const previousCollection = tagStore.state.collection
        const previousWorkspace = tagStore.state.activeWorkspace
        tagStore.state.activeWorkspace = { _id: 'w1' } as any
        tagStore.state.collection = [grpcItem({ _id: 'g', grpc: { service: 'Demo', method: 'Stream' } })]
        const panel = await mountPanel({ url: '{{TARGET}}' })
        let finishFirst!: (responses: any) => void
        vi.mocked(getResponsesByCollectionId).mockImplementationOnce(() => new Promise(resolve => {
            finishFirst = resolve
        }))
        try {
            panel.state.tabEnvironmentResolved[panel.item._id] = { TARGET: `{% response(request='g', attribute='body', path='$.token', behavior='never') %}` }
            await vi.waitFor(() => expect(getResponsesByCollectionId).toHaveBeenCalledOnce())
            if(firstEndsFirst) {
                finishFirst([{ grpc: { service: 'Demo', method: 'Stream', kind: 'serverStream', ended: 'completed' } }])
                await vi.waitFor(() => expect(panel.targetTag()?.getAttribute('title')).toContain('has no spaces'))
            }
            panel.state.tabEnvironmentResolved[panel.item._id] = { TARGET: 'grpcs://new.test:443' }
            await vi.waitFor(() => expect(panel.targetTag()?.getAttribute('title')).toContain('new.test:443'))
            if(!firstEndsFirst) {
                finishFirst([{ grpc: { service: 'Demo', method: 'Stream', kind: 'serverStream', ended: 'completed' } }])
                for(let index = 0; index < 30; index++) {
                    await Promise.resolve()
                }
                await nextTick()
            }
            expect(panel.targetTag()?.getAttribute('title')).toContain('new.test:443')
        } finally {
            panel.unmount()
            tagStore.state.collection = previousCollection
            tagStore.state.activeWorkspace = previousWorkspace
        }
    })
}

for(const [url, reason] of [
    ['', 'Enter the server address to load its methods.'],
    ['ftp://localhost:50051', 'A gRPC server address starts with grpc://, grpcs://, http://, https:// or no scheme, not ftp://'],
    ['{{ADDRESS}}', 'The variable ADDRESS has no value in the environment'],
]) {
    test(`an unusable address ${JSON.stringify(url)} keeps the method and Proto guidance without Reload`, async() => {
        const panel = await mountPanel({ url })
        try {
            (panel.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLButtonElement).click()
            await nextTick()
            const status = panel.element.querySelector('.grpc-request-panel-proto-status')!
            expect(status.textContent?.trim()).toBe(reason)
            expect(status.querySelector('button')).toBeNull()
            ;(panel.element.querySelector('.grpc-method-picker-button') as HTMLButtonElement).click()
            await nextTick()
            const picker = panel.element.querySelector('.grpc-method-picker-dropdown')!
            await vi.waitFor(() => expect(picker.textContent?.trim()).toBe(reason))
            expect(picker.querySelector('button')).toBeNull()
            expect(transport.loadGrpcSchema).not.toHaveBeenCalled()
        } finally {
            panel.unmount()
        }
    })
}

test('Send waits for a method, and the button says what it will do for the chosen one', async() => {
    const panel = await mountPanel()
    expect(panel.action().textContent!.trim()).toBe('Send')
    expect(panel.action().disabled).toBe(true)
    expect(panel.action().title).toBe('Choose a method first')

    await panel.chooseMethod('Count')
    expect(panel.action().textContent!.trim()).toBe('Send')
    expect(panel.action().disabled).toBe(false)

    await panel.chooseMethod('Chat')
    expect(panel.action().textContent!.trim()).toBe('Start')
    panel.unmount()
})

test('in a browser Send stays off and says why', async() => {
    transport.isGrpcAvailable.mockReturnValue(false)
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'SayHello' } })
    expect(panel.action().disabled).toBe(true)
    expect(panel.action().title).toBe('gRPC calls need the Restfox desktop app or a self-hosted Restfox. Browsers cannot make them.')
    expect(transport.loadGrpcSchema).not.toHaveBeenCalled()
    panel.unmount()
})

test('choosing a method fills an untouched message with its example and names a new request after it', async() => {
    const panel = await mountPanel()
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(1)

    await panel.chooseMethod('SayHello')
    expect(panel.item.grpc).toEqual({ service: 'demo.v1.Demo', method: 'SayHello' })
    expect(panel.item.body!.text).toBe('{\n    "name": ""\n}')
    expect(panel.dispatch).toHaveBeenCalledWith('updateCollectionItemName', { _id: 'item1', _type: 'grpc', name: 'Demo.SayHello' })
    expect(panel.item.name).toBe('Demo.SayHello')

    // the previous method's untouched example is replaced too, and a name that is still the previous method's
    // follows the method
    await panel.chooseMethod('Count')
    expect(panel.item.body!.text).toBe('{\n    "to": 0,\n    "intervalMs": 0\n}')
    expect(panel.item.name).toBe('Demo.Count')

    // a message the user wrote stays
    panel.item.body!.text = '{ "to": 3 }'
    await panel.chooseMethod('SayHello')
    expect(panel.item.body!.text).toBe('{ "to": 3 }')
    expect(panel.item.name).toBe('Demo.SayHello')

    // a name the user gave is kept
    panel.item.name = 'Greet Ada'
    await panel.chooseMethod('Chat')
    expect(panel.item.name).toBe('Greet Ada')
    expect(panel.dispatch.mock.calls.filter(([action]) => action === 'updateCollectionItemName')).toHaveLength(3)
    panel.unmount()
})

test('the address tag tells TLS from plaintext as typed, and an address that cannot be called', async() => {
    const panel = await mountPanel()
    expect(panel.targetTag()!.textContent!.trim()).toBe('Plaintext')

    panel.item.url = 'grpc.example.com'
    await settle()
    expect(panel.targetTag()!.textContent!.trim()).toBe('TLS')

    panel.item.url = 'localhost:50051/demo'
    await settle()
    expect(panel.targetTag()!.textContent!.trim()).toBe('Invalid')
    expect(panel.targetTag()!.classList.contains('red')).toBe(true)
    expect(panel.targetTag()!.title).toBe('A gRPC server address has no path, such as localhost:50051')

    panel.item.url = ''
    await settle()
    expect(panel.targetTag()).toBeNull()
    panel.unmount()
})

test('Ctrl+Enter does the button\'s action instead of the app\'s HTTP send', async() => {
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'SayHello' } })
    const appSend = vi.fn()
    window.addEventListener('keydown', appSend)

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await settle()
    await settle()

    expect(appSend).not.toHaveBeenCalled()
    expect(transport.startGrpcCall).toHaveBeenCalledTimes(1)
    expect(grpcCalls[itemKey('item1')].phase).toBe('connecting')
    expect(panel.action().textContent!.trim()).toBe('Cancel')

    // another tab's key press is not this panel's
    panel.state.activeTab = grpcItem({ _id: 'other' })
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    expect(appSend).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', appSend)
    panel.unmount()
})

test('Ctrl+Enter in the method search picks the highlighted method rather than sending', async() => {
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'SayHello' } })
    ;(panel.element.querySelector('.grpc-method-picker-button') as HTMLElement).click()
    await nextTick()
    await settle()
    const search = panel.element.querySelector('.grpc-method-picker-dropdown input') as HTMLInputElement
    search.value = 'Count'
    search.dispatchEvent(new Event('input'))
    await nextTick()

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await settle()
    await nextTick()

    expect(panel.item.grpc).toEqual({ service: 'demo.v1.Demo', method: 'Count' })
    expect(transport.startGrpcCall).not.toHaveBeenCalled()
    panel.unmount()
})

test('a panel in a window of its own takes Ctrl+Enter there and leaves the main window\'s to the panel there', async() => {
    // a window of its own, as the one Move to New Window opens. The portal moves the element in before the panel
    // mounts, as here
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const ownWindow = frame.contentWindow!
    const moved = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'SayHello' } }, [], ownWindow.document)
    // the main window shows another item
    moved.state.activeTab = grpcItem({ _id: 'other' })

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await settle()
    expect(transport.startGrpcCall).not.toHaveBeenCalled()

    ownWindow.document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await settle()
    await settle()
    expect(transport.startGrpcCall).toHaveBeenCalledTimes(1)
    moved.unmount()
})

test('a panel moved to a window of its own asks its confirms in that window', async() => {
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'SayHello', protoFiles: [{ path: 'demo/v1/demo.proto', text: 'syntax = "proto3";' }] } })
    const mainConfirm = vi.fn(async() => false)
    stubConfirm(mainConfirm)
    const movedConfirm = vi.fn(async() => false)
    // a window of its own, as the one Move to New Window opens
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const otherDocument = frame.contentWindow!.document
    stubConfirm(movedConfirm, otherDocument)
    otherDocument.body.appendChild(panel.element)

    ;(panel.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLElement).click()
    await nextTick()
    ;(panel.element.querySelector('.grpc-request-panel-proto-remove') as HTMLElement).click()
    await settle()

    expect(movedConfirm).toHaveBeenCalledTimes(1)
    expect(mainConfirm).not.toHaveBeenCalled()
    panel.unmount()
})

test('a bidi stream has Send message and End stream under the message, usable while the stream takes messages', async() => {
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'Chat' }, body: { mimeType: 'application/json', text: '{ "text": "hi" }' } })
    const footerButtons = () => [...panel.element.querySelectorAll('.request-panel-body-footer button')].map(button => button.textContent!.trim())
    const footerButton = (label: string) => [...panel.element.querySelectorAll('.request-panel-body-footer button')].find(button => button.textContent!.trim() === label) as HTMLButtonElement
    const streamButtons = () => ['End stream', 'Send message'].map(label => [footerButton(label).disabled, footerButton(label).title])
    // in place from the start, so the footer does not change as the call opens and ends
    expect(footerButtons()).toEqual(['Beautify JSON', 'Generate example', 'End stream', 'Send message'])
    expect(streamButtons()).toEqual([[true, 'Start opens the stream'], [true, 'Start opens the stream']])

    panel.action().click()
    await settle()
    await settle()
    await nextTick()
    expect(panel.action().textContent!.trim()).toBe('Stop')
    // messages go out once the stream is connected
    expect(streamButtons()).toEqual([[true, 'The stream opens once the server answers'], [true, 'The stream opens once the server answers']])
    transport.startGrpcCall.mock.calls[0][1]({ type: 'connected', time: 1 })
    await nextTick()
    expect(streamButtons().map(([disabled]) => disabled)).toEqual([false, false])

    const controller = transport.startGrpcCall.mock.results[0].value
    footerButton('Send message').click()
    await settle()
    expect(controller.send).toHaveBeenCalledWith('{ "text": "hi" }')

    footerButton('End stream').click()
    await nextTick()
    expect(controller.end).toHaveBeenCalledTimes(1)
    expect(streamButtons()).toEqual([[true, 'You ended the stream'], [true, 'You ended the stream']])
    expect(footerButtons()).toEqual(['Beautify JSON', 'Generate example', 'End stream', 'Send message'])
    panel.unmount()
})

test('a method that takes one request has no stream buttons', async() => {
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'Count' } })
    expect([...panel.element.querySelectorAll('.request-panel-body-footer button')].map(button => button.textContent!.trim())).toEqual(['Beautify JSON', 'Generate example'])
    panel.unmount()
})

test('a message clicked before End stream that fails to resolve after it says it was not sent, until the call ends', async() => {
    let answerPrompt: (value: string | null) => void = () => undefined
    window.createPrompt = vi.fn(() => new Promise(resolve => {
        answerPrompt = resolve
    }))
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'Chat' }, body: { mimeType: 'application/json', text: `{ "text": "{% prompt(title='Text') %}" }` } })
    const footerButton = (label: string) => [...panel.element.querySelectorAll('.request-panel-body-footer button')].find(button => button.textContent!.trim() === label) as HTMLButtonElement
    const sendError = () => panel.element.querySelector('.grpc-request-panel-send-error')
    panel.action().click()
    await settle()
    await settle()
    const controller = transport.startGrpcCall.mock.results[0].value
    const onEvent = transport.startGrpcCall.mock.calls[0][1]
    onEvent({ type: 'connected', time: 1 })
    await nextTick()

    footerButton('Send message').click()
    await settle()
    footerButton('End stream').click()
    await nextTick()
    answerPrompt(null)
    await settle()
    await nextTick()

    expect(controller.send).not.toHaveBeenCalled()
    expect(controller.end).toHaveBeenCalledTimes(1)
    expect(sendError()?.textContent).toBe('Message not sent: Prompt "Text" was cancelled')

    onEvent({ type: 'status', code: 0, name: 'OK', details: '', trailers: [], time: 2 })
    await settle()
    await nextTick()
    expect(sendError()).toBeNull()
    panel.unmount()
})

test('an end of the stream that fails says the stream was not ended, and End stream can be clicked again', async() => {
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'Chat' }, body: { mimeType: 'application/json', text: '{}' } })
    const footerButton = (label: string) => [...panel.element.querySelectorAll('.request-panel-body-footer button')].find(button => button.textContent!.trim() === label) as HTMLButtonElement
    const streamError = () => panel.element.querySelector('.grpc-request-panel-send-error')
    panel.action().click()
    await settle()
    await settle()
    const controller = transport.startGrpcCall.mock.results[0].value
    const onEvent = transport.startGrpcCall.mock.calls[0][1]
    onEvent({ type: 'connected', time: 1 })
    await nextTick()

    footerButton('End stream').click()
    await settle()
    onEvent({ type: 'endError', message: 'The server could not end the stream: 503 Service Unavailable', time: 2 })
    await nextTick()
    expect(streamError()?.textContent).toBe('Stream not ended: The server could not end the stream: 503 Service Unavailable')
    expect(footerButton('End stream').disabled).toBe(false)

    footerButton('End stream').click()
    await settle()
    expect(controller.end).toHaveBeenCalledTimes(2)
    expect(streamError()).toBeNull()
    panel.unmount()
})

test('Generate example asks before replacing a message the user wrote', async() => {
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'SayHello' }, body: { mimeType: 'application/json', text: '{ "name": "Ada" }' } })
    const createConfirm = vi.fn(async() => false)
    stubConfirm(createConfirm)
    const generate = () => [...panel.element.querySelectorAll('.request-panel-body-footer button')].find(button => button.textContent!.trim() === 'Generate example') as HTMLButtonElement

    generate().click()
    await settle()
    expect(createConfirm).toHaveBeenCalledTimes(1)
    expect(panel.item.body!.text).toBe('{ "name": "Ada" }')

    createConfirm.mockResolvedValue(true)
    generate().click()
    await settle()
    expect(panel.item.body!.text).toBe('{\n    "name": ""\n}')
    panel.unmount()
})

test('the Proto tab says what is loaded, and going back to reflection asks before removing the files', async() => {
    const panel = await mountPanel()
    const protoTab = panel.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLElement
    protoTab.click()
    await nextTick()
    expect(panel.element.querySelector('.grpc-request-panel-proto-status')!.textContent).toMatch(/^1 service, 3 methods from server reflection, \d\d:\d\d [AP]M/)

    // .proto files with none added shows the way to add them
    const segments = () => [...panel.element.querySelectorAll('.grpc-request-panel-segmented button')] as HTMLButtonElement[]
    segments()[1].click()
    await nextTick()
    expect([...panel.element.querySelectorAll('.grpc-request-panel-proto-buttons button')].map(button => button.textContent)).toEqual(['Add files', 'Add folder'])
    expect(segments()[1].getAttribute('aria-checked')).toBe('true')

    panel.item.grpc = { protoFiles: [{ path: 'demo/v1/demo.proto', text: 'syntax = "proto3";' }, { path: 'demo/v1/types.proto', text: '' }] }
    await settle()
    await nextTick()
    expect([...panel.element.querySelectorAll('.grpc-request-panel-proto-path')].map(cell => cell.textContent)).toEqual(['demo/v1/demo.proto', 'demo/v1/types.proto'])
    expect(transport.loadGrpcSchema.mock.calls.at(-1)![0].protoFiles).toHaveLength(2)

    const createConfirm = vi.fn(async() => false)
    stubConfirm(createConfirm)
    segments()[0].click()
    await settle()
    expect(createConfirm.mock.calls[0]).toEqual(['Remove the 2 .proto files from this request and load its methods from server reflection? Other requests keep their files.', 'Remove files'])
    expect(panel.item.grpc!.protoFiles).toHaveLength(2)

    createConfirm.mockResolvedValue(true)
    segments()[0].click()
    await settle()
    expect(panel.item.grpc!.protoFiles).toEqual([])
    expect(segments()[0].getAttribute('aria-checked')).toBe('true')
    panel.unmount()
})

test('Reload stays in place while the methods load, disabled until they have', async() => {
    const panel = await mountPanel()
    ;(panel.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLElement).click()
    await nextTick()
    const reload = () => [...panel.element.querySelectorAll('.grpc-request-panel-proto-status button')].find(button => button.textContent === 'Reload') as HTMLButtonElement | undefined
    expect(reload()?.disabled).toBe(false)

    let finishLoad: (value: unknown) => void = () => undefined
    transport.loadGrpcSchema.mockReturnValue(new Promise(resolve => finishLoad = resolve))
    reload()!.click()
    await settle()
    await nextTick()
    expect(reload()?.disabled).toBe(true)
    expect(reload()?.title).toBe('The methods are loading')

    finishLoad(schema)
    await settle()
    await nextTick()
    expect(reload()?.disabled).toBe(false)
    panel.unmount()
})

test('cancelling a send while methods load leaves the Proto tab ready to reload', async() => {
    const loads: { signal: AbortSignal, resolve: (schema: GrpcSchema) => void }[] = []
    transport.loadGrpcSchema.mockImplementation((spec, signal: AbortSignal) => new Promise<GrpcSchema>((resolve, reject) => {
        loads.push({ signal, resolve })
        signal.addEventListener('abort', () => reject(new Error('The methods load was stopped')), { once: true })
    }))
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'SayHello' } })
    ;(panel.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLElement).click()
    await nextTick()
    const status = () => panel.element.querySelector('.grpc-request-panel-proto-status')!
    const reload = () => [...status().querySelectorAll('button')].find(button => button.textContent === 'Reload') as HTMLButtonElement | undefined
    expect(reload()?.disabled).toBe(true)

    panel.action().click()
    await settle()
    expect(loads).toHaveLength(2)
    expect(panel.action().textContent!.trim()).toBe('Cancel')
    panel.action().click()
    await settle()
    await nextTick()
    expect(loads[1].signal.aborted).toBe(true)
    expect(loads[0].signal.aborted).toBe(false)
    expect(status().textContent).toContain('Methods not loaded yet.')
    expect(reload()?.disabled).toBe(false)

    reload()!.click()
    await settle()
    expect(loads).toHaveLength(3)
    loads[2].resolve(schema)
    loads[0].resolve(schema)
    await settle()
    await nextTick()
    expect(status().textContent).toMatch(/^1 service, 3 methods from server reflection,/)
    expect(reload()?.disabled).toBe(false)
    panel.unmount()
})

test('opening the method list after a failed load shows the failure, it loads again only on Retry', async() => {
    transport.loadGrpcSchema.mockRejectedValue(Object.assign(new Error('localhost:50051 refused the connection'), { code: 'CONNECTION_FAILED' }))
    const panel = await mountPanel()
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(1)

    ;(panel.element.querySelector('.grpc-method-picker-button') as HTMLElement).click()
    await settle()
    await nextTick()
    expect(transport.loadGrpcSchema).toHaveBeenCalledTimes(1)
    expect(panel.element.querySelector('.grpc-method-picker-dropdown')!.textContent).toContain('localhost:50051 refused the connection')
    panel.unmount()
})

test('Ctrl+Enter in the message of a stream that no longer takes messages does nothing, rather than stop it', async() => {
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'Chat' } })
    panel.action().click()
    await settle()
    await settle()
    const controller = transport.startGrpcCall.mock.results[0].value
    transport.startGrpcCall.mock.calls[0][1]({ type: 'connected', time: 1 })
    await nextTick()
    const editorContent = () => panel.element.querySelector('.grpc-request-panel-editor .cm-content') as HTMLElement
    const pressSend = () => editorContent().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))

    pressSend()
    await settle()
    expect(controller.send).toHaveBeenCalledTimes(1)

    ;([...panel.element.querySelectorAll('.request-panel-body-footer button')].find(button => button.textContent!.trim() === 'End stream') as HTMLButtonElement).click()
    await nextTick()
    pressSend()
    await settle()
    expect(controller.send).toHaveBeenCalledTimes(1)
    expect(controller.cancel).not.toHaveBeenCalled()
    panel.unmount()
})

test('Ctrl+Enter on Send message just clicked sends the next message on the open stream, rather than stop it', async() => {
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'Chat' }, body: { mimeType: 'application/json', text: '{ "text": "hi" }' } })
    panel.action().click()
    await settle()
    await settle()
    const controller = transport.startGrpcCall.mock.results[0].value
    transport.startGrpcCall.mock.calls[0][1]({ type: 'connected', time: 1 })
    await nextTick()
    const sendButton = [...panel.element.querySelectorAll('.request-panel-body-footer button')].find(button => button.textContent!.trim() === 'Send message') as HTMLButtonElement

    sendButton.click()
    await settle()
    sendButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await settle()
    expect(controller.send).toHaveBeenCalledTimes(2)
    expect(controller.cancel).not.toHaveBeenCalled()

    // outside the Message tab the key stops the stream, as the button beside the address says
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await settle()
    expect(controller.cancel).toHaveBeenCalledTimes(1)
    panel.unmount()
})

test('End stream, which goes away once clicked, leaves focus in the message, where Ctrl+Enter does not stop the stream', async() => {
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'Chat' } })
    panel.action().click()
    await settle()
    await settle()
    const controller = transport.startGrpcCall.mock.results[0].value
    transport.startGrpcCall.mock.calls[0][1]({ type: 'connected', time: 1 })
    await nextTick()
    const endButton = [...panel.element.querySelectorAll('.request-panel-body-footer button')].find(button => button.textContent!.trim() === 'End stream') as HTMLButtonElement

    endButton.focus()
    endButton.click()
    await settle()
    expect(document.activeElement?.closest('.grpc-request-panel-editor')).not.toBe(null)
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await settle()
    expect(controller.cancel).not.toHaveBeenCalled()
    panel.unmount()
})

test('a .proto file changed to another text of the same length loads its methods again', async() => {
    const panel = await mountPanel({ grpc: { protoFiles: [{ path: 'a.proto', text: 'int32 count = 1;' }] } })
    const loads = transport.loadGrpcSchema.mock.calls.length
    panel.item.grpc!.protoFiles = [{ path: 'a.proto', text: 'int64 count = 1;' }]
    await settle()
    await nextTick()
    expect(transport.loadGrpcSchema.mock.calls.length).toBe(loads + 1)
    panel.unmount()
})

test('the Proto tab says why an address it cannot call loads no methods', async() => {
    const panel = await mountPanel({ url: 'localhost:50051/foo' })
    ;(panel.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLElement).click()
    await settle()
    await nextTick()
    expect(panel.element.querySelector('.grpc-request-panel-proto-status')!.textContent).toContain('A gRPC server address has no path, such as localhost:50051')
    panel.unmount()
})

test('choosing a method leaves the name New gRPC Request when another item in the folder has the method\'s name', async() => {
    const sibling = grpcItem({ _id: 'item2', name: 'Demo.SayHello' })
    const panel = await mountPanel({}, [sibling])
    await panel.chooseMethod('SayHello')
    expect(panel.dispatch.mock.calls.filter(([action]) => action === 'updateCollectionItemName')).toHaveLength(0)
    expect(panel.item.name).toBe('New gRPC Request')
    panel.unmount()
})

test('Generate example says why it is off for the case at hand', async() => {
    transport.isGrpcAvailable.mockReturnValue(false)
    const browser = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'SayHello' } })
    const generate = () => [...browser.element.querySelectorAll('.request-panel-body-footer button')].find(button => button.textContent!.trim() === 'Generate example') as HTMLButtonElement
    expect(generate().disabled).toBe(true)
    expect(generate().title).toBe('An example is made from the method, whose fields load in the Restfox desktop app or a self-hosted Restfox')
    browser.unmount()
})

test('removing a .proto file asks first, naming it', async() => {
    const panel = await mountPanel({ grpc: { protoFiles: [{ path: 'demo/v1/demo.proto', text: '' }, { path: 'demo/v1/types.proto', text: '' }] } })
    ;(panel.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLElement).click()
    await nextTick()
    const createConfirm = vi.fn(async() => false)
    stubConfirm(createConfirm)
    ;(panel.element.querySelector('.grpc-request-panel-proto-remove') as HTMLElement).click()
    await settle()
    expect(createConfirm.mock.calls[0]).toEqual(['Remove demo/v1/demo.proto from this request? Other requests keep their files.', 'Remove'])
    expect(panel.item.grpc!.protoFiles).toHaveLength(2)

    createConfirm.mockResolvedValue(true)
    ;(panel.element.querySelector('.grpc-request-panel-proto-remove') as HTMLElement).click()
    await settle()
    expect(panel.item.grpc!.protoFiles!.map(protoFile => protoFile.path)).toEqual(['demo/v1/types.proto'])
    panel.unmount()
})

test('a narrower address bar first drops the TLS label and the service name, then the kind, so the address keeps room', async() => {
    const resizeCallbacks: (() => void)[] = []
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) {
            resizeCallbacks.push(callback)
        }
        observe() {
            return undefined
        }
        disconnect() {
            return undefined
        }
    })
    // happy-dom does no layout
    let addressBarWidth = 700
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) {
        return this.classList.contains('grpc-request-panel-address-bar') ? addressBarWidth : 0
    })
    const panel = await mountPanel()
    const addressBar = panel.element.querySelector('.grpc-request-panel-address-bar') as HTMLElement
    const picker = panel.element.querySelector('.grpc-method-picker') as HTMLElement
    const fitAt = async(width: number) => {
        addressBarWidth = width
        resizeCallbacks.forEach(callback => callback())
        await nextTick()
        return [addressBar.className.match(/address-bar-(full|narrow|compact)\b/)?.[1], picker.className.match(/picker-(full|narrow|compact)\b/)?.[1]]
    }
    expect(await fitAt(700)).toEqual(['full', 'full'])
    expect(await fitAt(500)).toEqual(['narrow', 'narrow'])
    expect(await fitAt(400)).toEqual(['compact', 'compact'])
    expect(await fitAt(700)).toEqual(['full', 'full'])
    panel.unmount()
})

test('tabs that do not fit the panel become a list of them, as HTTP\'s do', async() => {
    // happy-dom does no layout: each tab 100 px wide, the panel 300 px
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) {
        return this.classList.contains('request-panel-tab') ? 100 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) {
        return this.classList.contains('grpc-request-panel-tabs-row') ? 300 : 0
    })
    const panel = await mountPanel()
    await nextTick()
    const select = panel.element.querySelector('[data-testid="grpc-request-panel-tab-select"]') as HTMLSelectElement
    expect([...select.options].map(option => option.textContent)).toEqual(['Message', 'Metadata', 'Auth', 'Proto', 'Docs'])
    select.value = 'Proto'
    select.dispatchEvent(new Event('change'))
    await nextTick()
    expect(panel.element.querySelector('.grpc-request-panel-proto')).not.toBeNull()
    panel.unmount()
})

// panels kept alive under KeepAlive keyed by the item, as Frame keeps them, the shown one picked by `shown.id`
async function mountKeptAlivePanels(items: CollectionItem[]) {
    const state = reactive({
        activeTab: null as CollectionItem | null,
        activeWorkspace: { _id: 'w1', location: null },
        tabEnvironmentResolved: {} as Record<string, any>,
        flags: { hidePasswordFields: false, disableSSLVerification: false },
        requestResponses: {} as Record<string, any>,
        requestResponseStatus: {} as Record<string, string>,
        responses: {} as Record<string, any[]>,
        skipPersistingActiveTab: false,
        collection: [] as CollectionItem[],
    })
    state.collection.push(...items)
    state.activeTab = state.collection[0]
    const element = document.createElement('div')
    document.body.appendChild(element)
    const panelApp = createApp({
        render: () => h('div', { class: 'request-panel' }, [
            h(KeepAlive, () => h(GrpcRequestPanel, { key: state.activeTab!._id, activeTab: state.activeTab! })),
        ]),
    })
    panelApp.provide('store', { state, dispatch: vi.fn(async() => ({ environment: {}, parentHeaders: {}, parentAuthentication: undefined, requestParentArray: [] })), commit: vi.fn() })
    panelApp.provide('$toast', { error: vi.fn(), success: vi.fn() })
    panelApp.mount(element)
    await settle()
    await nextTick()
    return {
        state,
        element,
        async show(id: string) {
            state.activeTab = state.collection.find(item => item._id === id)!
            await nextTick()
            await settle()
        },
        unmount: () => panelApp.unmount(),
    }
}

const pressSendHotkey = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))

test('.proto files added to the item from outside the panel, as a file workspace reloaded from disk, show as .proto files', async() => {
    const panel = await mountPanel()
    ;(panel.element.querySelector('[data-testid="grpc-request-panel-tab-Proto"]') as HTMLElement).click()
    await nextTick()
    const segments = () => [...panel.element.querySelectorAll('.grpc-request-panel-segmented button')] as HTMLButtonElement[]
    expect(segments()[0].getAttribute('aria-checked')).toBe('true')

    panel.item.grpc!.protoFiles = [{ path: 'demo/v1/demo.proto', text: 'syntax = "proto3";' }]
    await settle()
    await nextTick()
    expect(segments()[1].getAttribute('aria-checked')).toBe('true')
    expect([...panel.element.querySelectorAll('.grpc-request-panel-proto-path')].map(cell => cell.textContent)).toEqual(['demo/v1/demo.proto'])
    panel.unmount()
})

test('Beautify JSON indents by the indent size Settings has now', async() => {
    const panel = await mountPanel({ body: { mimeType: 'application/json', text: '{"name":"Ada"}' } })
    const beautify = () => ([...panel.element.querySelectorAll('.request-panel-body-footer button')].find(button => button.textContent!.trim() === 'Beautify JSON') as HTMLButtonElement).click()

    beautify()
    await nextTick()
    expect(panel.item.body!.text).toBe('{\n    "name": "Ada"\n}')

    localStorage.setItem('Restfox-IndentSize', '2')
    panel.item.body!.text = '{"name":"Ada"}'
    await nextTick()
    beautify()
    await nextTick()
    expect(panel.item.body!.text).toBe('{\n  "name": "Ada"\n}')
    panel.unmount()
})

test('a panel kept alive out of sight leaves Ctrl+Enter alone, and shown again handles it once', async() => {
    // the panels' key listeners on the window, so a hidden panel that still listened shows even where the
    // active tab check would turn its key press away
    const keyListeners = new Set<unknown>()
    const addEventListener = window.addEventListener.bind(window)
    const removeEventListener = window.removeEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: any, options?: any) => {
        if(type === 'keydown' && options === true) {
            keyListeners.add(listener)
        }
        addEventListener(type, listener, options)
    })
    vi.spyOn(window, 'removeEventListener').mockImplementation((type: string, listener: any, options?: any) => {
        if(type === 'keydown' && options === true) {
            keyListeners.delete(listener)
        }
        removeEventListener(type, listener, options)
    })
    const panels = await mountKeptAlivePanels([
        grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'SayHello' } }),
        grpcItem({ _id: 'item2', grpc: { service: 'demo.v1.Demo', method: 'SayHello' } }),
    ])
    await panels.show('item2')
    await panels.show('item1')
    await panels.show('item2')
    expect(keyListeners.size).toBe(1)

    pressSendHotkey()
    await settle()
    await settle()
    expect(transport.startGrpcCall).toHaveBeenCalledTimes(1)
    expect(grpcCalls[itemKey('item1')]).toBeUndefined()
    expect(grpcCalls[itemKey('item2')].phase).toBe('connecting')

    await panels.show('item1')
    expect(keyListeners.size).toBe(1)
    pressSendHotkey()
    await settle()
    await settle()
    expect(transport.startGrpcCall).toHaveBeenCalledTimes(2)
    // handled twice, the second press would have cancelled the call it started
    expect(grpcCalls[itemKey('item1')].phase).toBe('connecting')
    expect(transport.startGrpcCall.mock.results[1].value.cancel).not.toHaveBeenCalled()
    panels.unmount()
})

test('two file workspaces with an item at the same path each send, end and stop only their own call', async() => {
    transport.startGrpcCall.mockImplementation(() => ({ send: vi.fn(), end: vi.fn(), cancel: vi.fn() }))
    const chat = { grpc: { service: 'demo.v1.Demo', method: 'Chat' }, _id: 'Chat.json' }
    const footerButton = (panel: { element: HTMLElement }, label: string) => [...panel.element.querySelectorAll('.request-panel-body-footer button')].find(button => button.textContent!.trim() === label) as HTMLButtonElement | undefined
    const start = async(panel: Awaited<ReturnType<typeof mountPanel>>, callNumber: number) => {
        panel.action().click()
        await settle()
        await settle()
        transport.startGrpcCall.mock.calls[callNumber][1]({ type: 'connected', time: 1 })
        await nextTick()
        return transport.startGrpcCall.mock.results[callNumber].value
    }

    const panelA = await mountPanel({ ...chat, workspaceId: 'wA', body: { mimeType: 'application/json', text: '{ "text": "from A" }' } })
    const callA = await start(panelA, 0)
    expect(panelA.action().textContent!.trim()).toBe('Stop')
    panelA.unmount()

    // the other workspace opened: its item has no call of its own yet
    const panelB = await mountPanel({ ...chat, workspaceId: 'wB', body: { mimeType: 'application/json', text: '{ "text": "from B" }' } })
    expect(panelB.action().textContent!.trim()).toBe('Start')
    expect(footerButton(panelB, 'Send message')!.disabled).toBe(true)

    const callB = await start(panelB, 1)
    expect(callA.cancel).not.toHaveBeenCalled()
    footerButton(panelB, 'Send message')!.click()
    await settle()
    expect(callB.send).toHaveBeenCalledWith('{ "text": "from B" }')
    footerButton(panelB, 'End stream')!.click()
    await nextTick()
    expect(callB.end).toHaveBeenCalledTimes(1)
    panelB.action().click()
    expect(callB.cancel).toHaveBeenCalledTimes(1)
    expect(callA.send).not.toHaveBeenCalled()
    expect(callA.end).not.toHaveBeenCalled()
    expect(callA.cancel).not.toHaveBeenCalled()
    panelB.unmount()

    // back in the first workspace its stream is still open and takes messages
    const panelA2 = await mountPanel({ ...chat, workspaceId: 'wA', body: { mimeType: 'application/json', text: '{ "text": "from A" }' } })
    expect(panelA2.action().textContent!.trim()).toBe('Stop')
    footerButton(panelA2, 'Send message')!.click()
    await settle()
    expect(callA.send).toHaveBeenCalledWith('{ "text": "from A" }')
    panelA2.unmount()
})


test('the method and address stay disabled during a call and unlock when it ends', async() => {
    let onEvent!: (event: any) => void
    transport.startGrpcCall.mockImplementation((_spec, emit) => {
        onEvent = emit
        return { send: vi.fn(), end: vi.fn(), cancel: vi.fn() }
    })
    const panel = await mountPanel({ grpc: { service: 'demo.v1.Demo', method: 'Chat' } })
    const picker = () => panel.element.querySelector('.grpc-method-picker-button') as HTMLButtonElement
    panel.action().click()
    await settle()
    await nextTick()
    expect(picker().disabled).toBe(true)
    expect(picker().title).toBe('Stop the call before changing the method')
    // not inert, which would also hide the reason on hover
    expect(panel.element.querySelector('.code-mirror-input-container')!.hasAttribute('inert')).toBe(false)
    expect((panel.element.querySelector('.code-mirror-input-container') as HTMLElement).title).toBe('Stop the call before changing the address')
    expect(panel.element.querySelector('.grpc-request-panel-address-bar .cm-content')!.getAttribute('contenteditable')).toBe('false')
    picker().click()
    await nextTick()
    expect(panel.element.querySelector('.grpc-method-picker-dropdown')).toBeNull()
    expect(panel.item.grpc!.method).toBe('Chat')
    onEvent({ type: 'status', code: 0, name: 'OK', details: '', trailers: [], time: 1 })
    await settle()
    await nextTick()
    expect(picker().disabled).toBe(false)
    expect(panel.element.querySelector('.code-mirror-input-container')!.hasAttribute('inert')).toBe(false)
    expect(panel.element.querySelector('.grpc-request-panel-address-bar .cm-content')!.getAttribute('contenteditable')).toBe('true')
    await panel.chooseMethod('SayHello')
    expect(panel.item.grpc!.method).toBe('SayHello')
    panel.unmount()
})
