// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, type App } from 'vue'
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('@/utils/toast', () => ({ useToast: () => toast }))
vi.mock('./CodeMirrorSingleLine.vue', () => ({ default: defineComponent({ setup: () => () => h('input') }) }))
import RequestPanelAuth from './RequestPanelAuth.vue'
import FolderPanel from './FolderPanel.vue'
import type { RequestAuthentication } from '@/global'
import { forgetPromptValues } from '@/utils/prompt-tag'
const apps: App[] = []
beforeEach(() => {
    vi.clearAllMocks()
    forgetPromptValues()
    vi.stubGlobal('localStorage', { getItem: () => null })
    vi.stubGlobal('fetch', vi.fn(async() => new Response('{"access_token":"fresh-token","refresh_token":"new-refresh"}', { status: 200, headers: { 'Content-Type': 'application/json' } })))
    window.createPrompt = vi.fn(async() => 'entered')
})
afterEach(() => {
    apps.splice(0).forEach(app => app.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (window as any).createPrompt
})
function mountAuth(type: 'request' | 'request_group', grantType: string) {
    const collectionItem = reactive({ _id: 'r', _type: type, name: 'R', workspaceId: 'w', parentId: null, authentication: { type: 'oauth2', grantType, clientId: '{{CLIENT}}', clientSecret: '{{SECRET}}', accessTokenUrl: '{{TOKEN_URL}}', authorizationUrl: '{{AUTH_URL}}', redirectUri: 'https://example.test/callback', authorizationCode: 'code', refreshToken: 'refresh-token' } })
    const store = { state: { activeWorkspace: { _id: 'w' } }, dispatch: vi.fn(async() => ({ environment: { CLIENT: '{% prompt(title=\'Credential\') %}', SECRET: '{% prompt(title=\'Credential\') %}', TOKEN_URL: 'https://fresh.test/token', AUTH_URL: 'https://fresh.test/authorize' }, parentHeaders: {}, requestParentArray: [] })) }
    const element = document.createElement('div')
    const props = reactive({ collectionItem, collectionItemEnvironmentResolved: { TOKEN_URL: 'https://stale.test/token' }, flags: {} as any })
    const app = createApp({ render: () => h(RequestPanelAuth, props) })
    app.provide('store', store)
    app.config.errorHandler = vi.fn()
    app.mount(element); apps.push(app)
    const click = (text: string) => [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text)!.click()
    return { store, app, click, collectionItem, props }
}
for(const type of ['request', 'request_group'] as const) {
    for(const action of ['Get Token', 'Refresh Token', 'Get Authorization Code']) {
        test(`${type} ${action} resolves fresh send environment with one prompt resolver`, async() => {
            const modal = mountAuth(type, action === 'Get Authorization Code' ? 'authorization_code' : 'client_credentials')
            const open = vi.spyOn(window, 'open').mockImplementation(() => null)
            const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
            modal.click(action)
            await vi.waitFor(() => expect(action === 'Get Authorization Code' ? open : fetch).toHaveBeenCalledOnce())
            expect(modal.store.dispatch).toHaveBeenCalledWith('getEnvironmentForRequest', expect.objectContaining({ collectionItem: modal.collectionItem, mode: 'send', includeSelf: type === 'request_group' }))
            expect(window.createPrompt).toHaveBeenCalledOnce()
            if(action === 'Get Authorization Code') {
                expect(open.mock.calls[0][0]).toContain('https://fresh.test/authorize?')
                expect(copy).not.toHaveBeenCalled()
                expect(toast.info).toHaveBeenCalledWith('Authorization URL opened in browser. Copy the authorization code from the redirect URL.')
            } else {
                expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://fresh.test/token')
                expect(modal.collectionItem.authentication).toMatchObject({ token: 'fresh-token' })
            }
            expect(modal.app.config.errorHandler).not.toHaveBeenCalled()
            open.mockRestore()
        })
    }
}
for(const type of ['request', 'request_group'] as const) {
    for(const action of ['Get Token', 'Refresh Token', 'Get Authorization Code']) {
        test(`${type} ${action} keeps the clicked item while its environment waits`, async() => {
            const modal = mountAuth(type, action === 'Get Authorization Code' ? 'authorization_code' : 'client_credentials')
            Object.assign(modal.collectionItem.authentication, { clientId: 'client-a', clientSecret: 'secret-a', usePKCE: true })
            const itemB = { ...modal.collectionItem, _id: 'b', authentication: { ...modal.collectionItem.authentication, clientId: 'client-b', clientSecret: 'secret-b', accessTokenUrl: 'https://b.test/token', authorizationUrl: 'https://b.test/authorize', refreshToken: 'refresh-b' } }
            const itemBBefore = structuredClone(itemB)
            let release!: () => void
            modal.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
                release = () => resolve({ environment: { CLIENT: 'client-a', SECRET: 'secret-a', TOKEN_URL: 'https://a.test/token', AUTH_URL: 'https://a.test/authorize' }, parentHeaders: {}, requestParentArray: [] })
            }))
            const open = vi.spyOn(window, 'open').mockImplementation(() => null)
            try {
                modal.click(action)
                expect(modal.store.dispatch).toHaveBeenCalledOnce()
                modal.props.collectionItem = itemB
                await nextTick()
                expect(fetch).not.toHaveBeenCalled()
                expect(open).not.toHaveBeenCalled()
                release()
                await vi.waitFor(() => expect(action === 'Get Authorization Code' ? open : fetch).toHaveBeenCalledOnce())
                if(action === 'Get Authorization Code') {
                    const url = new URL(open.mock.calls[0][0] as string)
                    expect(url.origin + url.pathname).toBe('https://a.test/authorize')
                    expect(url.searchParams.get('client_id')).toBe('client-a')
                    const verifier = (modal.collectionItem.authentication as { codeVerifier?: string }).codeVerifier
                    expect(verifier).toHaveLength(50)
                    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
                    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
                    expect(url.searchParams.get('code_challenge')).toBe(challenge)
                    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
                    expect(itemB).toEqual(itemBBefore)
                } else {
                    const [url, options] = vi.mocked(fetch).mock.calls[0]
                    expect(url).toBe('https://a.test/token')
                    const body = new URLSearchParams(options?.body as string)
                    expect(body.get('client_id')).toBe('client-a')
                    expect(body.get('client_secret')).toBe('secret-a')
                    if(action === 'Refresh Token') {
                        expect(body.get('refresh_token')).toBe('refresh-token')
                    }
                }
                expect(modal.app.config.errorHandler).not.toHaveBeenCalled()
            } finally {
                open.mockRestore()
            }
        })
    }
}
test('PKCE turned on while the environment waits applies from the next click, and no item gets a verifier', async() => {
    const modal = mountAuth('request_group', 'authorization_code')
    Object.assign(modal.collectionItem.authentication, { clientId: 'client-a', usePKCE: false })
    const itemB = { ...modal.collectionItem, _id: 'b', authentication: { ...modal.collectionItem.authentication, clientId: 'client-b', usePKCE: true, codeVerifier: 'verifier-b' } }
    let release!: () => void
    modal.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
        release = () => resolve({ environment: { CLIENT: 'client-a', SECRET: 'secret-a', TOKEN_URL: 'https://a.test/token', AUTH_URL: 'https://a.test/authorize' }, parentHeaders: {}, requestParentArray: [] })
    }))
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    modal.click('Get Authorization Code')
    expect(modal.store.dispatch).toHaveBeenCalledOnce()
    ;(modal.collectionItem.authentication as { usePKCE?: boolean }).usePKCE = true
    modal.props.collectionItem = itemB
    await nextTick()
    release()
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
    const url = new URL(open.mock.calls[0][0] as string)
    expect(url.searchParams.get('client_id')).toBe('client-a')
    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect((modal.collectionItem.authentication as { codeVerifier?: string }).codeVerifier).toBeUndefined()
    expect(itemB.authentication.codeVerifier).toBe('verifier-b')
    expect(modal.app.config.errorHandler).not.toHaveBeenCalled()
})

test('FolderPanel saves the clicked folder PKCE verifier before its environment waits', async() => {
    const folderA = { _id: 'a', _type: 'request_group', name: 'A', workspaceId: 'w', parentId: null, headers: [], authentication: { type: 'oauth2', grantType: 'authorization_code', clientId: 'client-a', authorizationUrl: 'https://a.test/authorize', redirectUri: 'https://example.test/callback', usePKCE: true, codeVerifier: '' } }
    const folderB = { ...folderA, _id: 'b', name: 'B', authentication: { ...folderA.authentication, clientId: 'client-b' } }
    const savedAuthentication = new Map<string, RequestAuthentication>([
        ['a', { ...folderA.authentication }],
        ['b', { ...folderB.authentication }],
    ])
    const environmentResult = { environment: {}, parentHeaders: {}, requestParentArray: [] }
    let release!: () => void
    const store = {
        state: { flags: {}, activeWorkspace: { _id: 'w' } },
        dispatch: vi.fn(async(action: string, payload: any) => {
            if(action === 'updateCollectionItem') {
                savedAuthentication.set(payload.collectionId, structuredClone(payload.authentication))
                return { error: null }
            }
            if(action === 'getEnvironmentForRequest') {
                if(payload.mode === 'display') {
                    return environmentResult
                }
                return new Promise(resolve => {
                    release = () => resolve(environmentResult)
                })
            }
            throw new Error(`Unexpected action: ${action}`)
        }),
    }
    const props = reactive({ collectionItem: folderA })
    const element = document.createElement('div')
    const app = createApp({ render: () => h(FolderPanel, props) })
    app.provide('store', store)
    app.config.globalProperties.$store = store
    app.config.errorHandler = vi.fn()
    app.mount(element)
    apps.push(app)
    await nextTick()

    let opened!: (url: URL) => void
    const authorizationOpened = new Promise<URL>(resolve => {
        opened = resolve
    })
    const open = vi.spyOn(window, 'open').mockImplementation(url => {
        opened(new URL(url as string))
        return null
    })
    const button = [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Get Authorization Code')!
    button.click()
    await nextTick()
    expect(open).not.toHaveBeenCalled()
    expect(store.dispatch).toHaveBeenCalledWith('getEnvironmentForRequest', expect.objectContaining({ collectionItem: expect.objectContaining({ _id: 'a' }), mode: 'send', includeSelf: true }))
    props.collectionItem = folderB
    await nextTick()
    release()
    const url = await authorizationOpened
    await nextTick()

    const verifier = savedAuthentication.get('a')?.codeVerifier
    expect(verifier).toHaveLength(50)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    expect(url.origin + url.pathname).toBe('https://a.test/authorize')
    expect(url.searchParams.get('client_id')).toBe('client-a')
    expect(url.searchParams.get('code_challenge')).toBe(challenge)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(savedAuthentication.get('b')).toEqual(folderB.authentication)
    expect(app.config.errorHandler).not.toHaveBeenCalled()
})

test('a click-time environment failure is reported without fetching a token', async() => {
    const modal = mountAuth('request', 'client_credentials')
    const error = new Error('Could not resolve tag', { cause: 'display-error' })
    modal.store.dispatch.mockRejectedValueOnce(error)
    modal.click('Get Token')
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not resolve tag'))
    expect(fetch).not.toHaveBeenCalled()
    expect(modal.app.config.errorHandler).not.toHaveBeenCalled()
})

test('Refresh Token still sends the clicked refresh token after opening a folder without authentication', async() => {
    const modal = mountAuth('request_group', 'client_credentials')
    let release!: () => void
    modal.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
        release = () => resolve({ environment: { CLIENT: 'clicked-client', SECRET: 'clicked-secret', TOKEN_URL: 'https://clicked.test/token', AUTH_URL: 'https://clicked.test/authorize' }, parentHeaders: {}, requestParentArray: [] })
    }))
    modal.click('Refresh Token')
    expect(modal.store.dispatch).toHaveBeenCalledOnce()
    modal.props.collectionItem = { _id: 'folder', _type: 'request_group', name: 'Folder', workspaceId: 'w', parentId: null } as typeof modal.collectionItem
    await nextTick()
    expect(fetch).not.toHaveBeenCalled()
    release()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://clicked.test/token')
    const body = new URLSearchParams(options?.body as string)
    expect(body.get('client_id')).toBe('clicked-client')
    expect(body.get('client_secret')).toBe('clicked-secret')
    expect(body.get('refresh_token')).toBe('refresh-token')
    expect(toast.success).toHaveBeenCalledWith('OAuth token refreshed successfully!')
    expect(modal.props.collectionItem.authentication).toBeUndefined()
    expect(modal.app.config.errorHandler).not.toHaveBeenCalled()
})

for(const action of ['Get Token', 'Refresh Token', 'Get Authorization Code']) {
    test(`${action} keeps the clicked authentication when it is replaced while its environment waits`, async() => {
        const modal = mountAuth('request', action === 'Get Authorization Code' ? 'authorization_code' : 'client_credentials')
        Object.assign(modal.collectionItem.authentication, { clientId: 'client-a', clientSecret: 'secret-a' })
        let release!: () => void
        modal.store.dispatch.mockImplementationOnce(() => new Promise(resolve => {
            release = () => resolve({ environment: { CLIENT: 'client-a', SECRET: 'secret-a', TOKEN_URL: 'https://a.test/token', AUTH_URL: 'https://a.test/authorize' }, parentHeaders: {}, requestParentArray: [] })
        }))
        const open = vi.spyOn(window, 'open').mockImplementation(() => null)
        try {
            modal.click(action)
            modal.props.collectionItem.authentication = { ...modal.collectionItem.authentication, clientId: 'client-b', clientSecret: 'secret-b', accessTokenUrl: 'https://b.test/token', authorizationUrl: 'https://b.test/authorize' }
            await nextTick()
            expect(fetch).not.toHaveBeenCalled()
            expect(open).not.toHaveBeenCalled()
            release()
            await vi.waitFor(() => expect(action === 'Get Authorization Code' ? open : fetch).toHaveBeenCalledOnce())
            if(action === 'Get Authorization Code') {
                const url = new URL(open.mock.calls[0][0] as string)
                expect(url.origin + url.pathname).toBe('https://a.test/authorize')
                expect(url.searchParams.get('client_id')).toBe('client-a')
            } else {
                const [url, options] = vi.mocked(fetch).mock.calls[0]
                expect(url).toBe('https://a.test/token')
                const body = new URLSearchParams(options?.body as string)
                expect(body.get('client_id')).toBe('client-a')
                expect(body.get('client_secret')).toBe('secret-a')
            }
            expect(modal.app.config.errorHandler).not.toHaveBeenCalled()
        } finally {
            open.mockRestore()
        }
    })
}
