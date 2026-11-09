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
import { setOAuthTokens } from '@/utils/oauth-tokens'
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
    // the store sets the tokens on the item's objects, of which the panel's item is one
    const saveAsTheStoreDoes = (payload: any) => {
        if(payload.clicked.id === collectionItem._id) {
            setOAuthTokens(collectionItem.authentication, payload.tokens)
        }
        return true
    }
    const store = { state: { activeWorkspace: { _id: 'w' } }, dispatch: vi.fn(async(action: string, payload?: any): Promise<any> => action === 'saveOAuthTokens' ? saveAsTheStoreDoes(payload) : { environment: { CLIENT: '{% prompt(title=\'Credential\') %}', SECRET: '{% prompt(title=\'Credential\') %}', TOKEN_URL: 'https://fresh.test/token', AUTH_URL: 'https://fresh.test/authorize' }, parentHeaders: {}, requestParentArray: [] }) }
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
    // the state goes into the folder clicked too
    expect(savedAuthentication.get('a')?.state).toEqual(expect.any(String))
    expect(url.searchParams.get('state')).toBe(savedAuthentication.get('a')?.state)
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

// a token reply the test releases itself, as a slow server's
function heldTokenReply() {
    let release!: (body: object) => void
    const reply = new Promise<Response>(resolve => {
        release = body => resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', vi.fn(() => reply))
    return release
}

function mountFolderPanel({ setsObjects = true } = {}) {
    const oauth = { type: 'oauth2', grantType: 'client_credentials', clientId: 'client-a', accessTokenUrl: 'https://a.test/token', refreshToken: 'refresh-a' }
    // the folders' objects in the store, which the Folder panel is given and copies
    const folderA = reactive({ _id: 'a', _type: 'request_group', name: 'A', workspaceId: 'w', parentId: null, headers: [], authentication: oauth })
    const folderB = reactive({ ...folderA, _id: 'b', name: 'B', authentication: { ...oauth, clientId: 'client-b', token: 'own-b', refreshToken: 'own-refresh-b' } })
    const objects: Record<string, typeof folderA> = { a: folderA, b: folderB }
    const saves: { collectionId: string, authentication: RequestAuthentication }[] = []
    const environmentResult = { environment: {}, parentHeaders: {}, requestParentArray: [] }
    const store = {
        state: { flags: {}, activeWorkspace: { _id: 'w' } },
        dispatch: vi.fn(async(action: string, payload: any) => {
            if(action === 'updateCollectionItem') {
                saves.push({ collectionId: payload.collectionId, authentication: structuredClone(payload.authentication) })
                return { error: null }
            }
            if(action === 'getEnvironmentForRequest') {
                return environmentResult
            }
            // as the store does, on the item's objects, unless the file changed outside Restfox meanwhile
            if(action === 'saveOAuthTokens') {
                if(setsObjects) {
                    setOAuthTokens(objects[payload.clicked.id].authentication, payload.tokens)
                }
                return true
            }
            throw new Error(`Unexpected action: ${action}`)
        }),
    }
    const props = reactive({ collectionItem: folderA as any })
    const element = document.createElement('div')
    const app = createApp({ render: () => h(FolderPanel, props) })
    app.provide('store', store)
    app.config.globalProperties.$store = store
    app.config.errorHandler = vi.fn()
    app.mount(element)
    apps.push(app)
    const click = (text: string) => [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text)!.click()
    const shownToken = () => element.querySelector('td.user-select label[for="access-token"]')?.textContent?.trim()
    const saveCalls = () => store.dispatch.mock.calls.filter(call => call[0] === 'saveOAuthTokens').map(call => call[1])
    return { app, store, props, folderA, folderB, saves, click, shownToken, saveCalls }
}

for(const action of ['Get Token', 'Refresh Token']) {
    test(`Folder panel > ${action}, the reply arriving after another folder was opened, goes to the folder clicked and not the one shown`, async() => {
        const release = heldTokenReply()
        const panel = mountFolderPanel()
        await nextTick()
        panel.click(action)
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
        panel.props.collectionItem = panel.folderB
        await nextTick()
        const savesBefore = panel.saves.length
        release({ access_token: 'fresh-token', refresh_token: 'new-refresh' })

        await vi.waitFor(() => expect(toast.success).toHaveBeenCalledOnce())
        const [payload] = panel.saveCalls()
        expect(payload).toMatchObject({ workspaceId: 'w', name: 'A', tokens: { token: 'fresh-token', refreshToken: 'new-refresh' } })
        expect(payload.clicked.id).toBe('a')
        // the folder shown is neither changed nor saved
        await nextTick()
        expect(panel.saves.slice(savesBefore)).toEqual([])
        expect(panel.shownToken()).toBe('own-b')
        expect(panel.folderB.authentication).toMatchObject({ token: 'own-b', refreshToken: 'own-refresh-b' })
        expect(panel.app.config.errorHandler).not.toHaveBeenCalled()
    })
}

for(const between of ['nothing', 'a request']) {
    test(`Folder panel > Get Token, the folder shown again after ${between} in between, shows the tokens in its copy, whose next save carries them`, async() => {
        const release = heldTokenReply()
        const panel = mountFolderPanel()
        await nextTick()
        panel.click('Get Token')
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
        if(between === 'a request') {
            // the Folder panel's Auth panel goes, and comes back with a new copy of the folder
            panel.props.collectionItem = { _id: 'r', _type: 'request', name: 'R', workspaceId: 'w', parentId: null }
            await nextTick()
            panel.props.collectionItem = panel.folderA
            await nextTick()
        }
        release({ access_token: 'fresh-token' })

        await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('OAuth token obtained successfully!'))
        await nextTick()
        expect(panel.shownToken()).toBe('fresh-token')
        // a reply without a refresh token leaves the folder without one
        const saved = panel.saves.at(-1)!
        expect(saved.collectionId).toBe('a')
        expect(saved.authentication.token).toBe('fresh-token')
        expect('refreshToken' in saved.authentication).toBe(false)
    })
}

test('Folder panel > a token set on a folder whose auth is not OAuth 2.0, such as a Bearer one, does not reach its copy', async() => {
    const panel = mountFolderPanel()
    panel.folderA.authentication = { type: 'bearer', token: 'typed' } as any
    panel.props.collectionItem = { ...panel.folderB }
    await nextTick()
    panel.props.collectionItem = panel.folderA
    await nextTick()
    const savesBefore = panel.saves.length
    ;(panel.folderA.authentication as RequestAuthentication).token = 'set elsewhere'
    await nextTick()
    await nextTick()
    expect(panel.saves.slice(savesBefore)).toEqual([])
})

for(const changed of ['the copy', 'the folder']) {
    test(`Folder panel > a token set on the folder while ${changed} is no longer OAuth 2.0 does not reach the copy`, async() => {
        const panel = mountFolderPanel()
        if(changed === 'the copy') {
            // the copy is made while the folder is Bearer, as after the user picked it with its save still to land
            panel.folderA.authentication = { type: 'bearer', token: 'typed' } as any
            panel.props.collectionItem = panel.folderB
            await nextTick()
            panel.props.collectionItem = panel.folderA
            await nextTick()
            panel.folderA.authentication = { type: 'oauth2', grantType: 'client_credentials' } as any
        } else {
            await nextTick()
            panel.folderA.authentication = { type: 'bearer', token: 'typed' } as any
        }
        await nextTick()
        const savesBefore = panel.saves.length
        ;(panel.folderA.authentication as RequestAuthentication).token = 'set elsewhere'
        await nextTick()
        await nextTick()
        expect(panel.saves.slice(savesBefore)).toEqual([])
    })
}

test('Folder panel > opening another OAuth 2.0 folder saves neither, nor gives the first the other\'s tokens', async() => {
    const panel = mountFolderPanel()
    await nextTick()
    const savesBefore = panel.saves.length
    panel.props.collectionItem = panel.folderB
    await nextTick()
    await nextTick()
    panel.props.collectionItem = panel.folderA
    await nextTick()
    await nextTick()
    expect(panel.saves.slice(savesBefore).filter(save => save.authentication?.token !== undefined && save.collectionId === 'a')).toEqual([])
    expect(panel.folderA.authentication).not.toHaveProperty('token')
    expect(panel.folderB.authentication).toMatchObject({ token: 'own-b', refreshToken: 'own-refresh-b' })
    expect(panel.shownToken()).toBe('N/A')
})

test('Folder panel > given a request, as it is while a request tab is shown, does not save the request when its tokens change', async() => {
    const panel = mountFolderPanel()
    const request = reactive({ _id: 'r', _type: 'request', name: 'R', workspaceId: 'w', parentId: null, headers: [], authentication: { type: 'oauth2', grantType: 'client_credentials', scope: 'old-scope' } as RequestAuthentication })
    panel.props.collectionItem = request
    await nextTick()
    // edited in the request's own panel, on the same object
    request.authentication.scope = 'typed-scope'
    await nextTick()
    const savesBefore = panel.saves.length
    setOAuthTokens(request.authentication, { token: 'fresh-token' })
    await nextTick()
    await nextTick()
    expect(panel.saves.slice(savesBefore)).toEqual([])
})

test('Folder panel > Get Token leaves its copy alone when the folder\'s objects did not take the tokens', async() => {
    const release = heldTokenReply()
    const panel = mountFolderPanel({ setsObjects: false })
    await nextTick()
    panel.click('Get Token')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const savesBefore = panel.saves.length
    release({ access_token: 'fresh-token' })

    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledOnce())
    await nextTick()
    expect(panel.saves.slice(savesBefore)).toEqual([])
    expect(panel.shownToken()).toBe('N/A')
})
for(const action of ['Get Token', 'Refresh Token']) {
    test(`request ${action}, the reply arriving after another tab was opened, goes to the request clicked`, async() => {
        const release = heldTokenReply()
        const modal = mountAuth('request', 'client_credentials')
        const itemB = { ...modal.collectionItem, _id: 'b', authentication: { ...modal.collectionItem.authentication, token: 'own-b' } }
        modal.click(action)
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
        modal.props.collectionItem = itemB
        await nextTick()
        release({ access_token: 'fresh-token', refresh_token: 'new-refresh' })

        await vi.waitFor(() => expect(toast.success).toHaveBeenCalledOnce())
        const payload = modal.store.dispatch.mock.calls.find(call => call[0] === 'saveOAuthTokens')![1]
        expect(payload).toMatchObject({ workspaceId: 'w', name: 'R', tokens: { token: 'fresh-token', refreshToken: 'new-refresh' } })
        expect(payload.clicked.id).toBe('r')
        expect(itemB.authentication.token).toBe('own-b')
    })
}

test('Refresh Token, a reply without a refresh token, keeps the one saved', async() => {
    const modal = mountAuth('request', 'client_credentials')
    vi.stubGlobal('fetch', vi.fn(async() => new Response('{"access_token":"fresh-token"}', { status: 200, headers: { 'Content-Type': 'application/json' } })))
    modal.click('Refresh Token')
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledOnce())
    const payload = modal.store.dispatch.mock.calls.find(call => call[0] === 'saveOAuthTokens')![1]
    expect(payload.tokens).toEqual({ token: 'fresh-token' })
    expect(modal.collectionItem.authentication).toMatchObject({ token: 'fresh-token', refreshToken: 'refresh-token' })
})

for(const action of ['Get Token', 'Refresh Token']) {
    test(`${action} whose tokens were not saved shows no success`, async() => {
        const modal = mountAuth('request', 'client_credentials')
        const dispatch = modal.store.dispatch.getMockImplementation()!
        modal.store.dispatch.mockImplementation(async(name: string, payload?: any) => name === 'saveOAuthTokens' ? false : dispatch(name, payload))
        modal.click(action)
        await vi.waitFor(() => expect(modal.store.dispatch).toHaveBeenCalledWith('saveOAuthTokens', expect.anything()))
        await nextTick()
        expect(toast.success).not.toHaveBeenCalled()
        expect(modal.collectionItem.authentication).toMatchObject({ refreshToken: 'refresh-token' })
        expect((modal.collectionItem.authentication as RequestAuthentication).token).toBeUndefined()
    })
}
