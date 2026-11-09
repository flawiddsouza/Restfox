// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from 'vitest'
import type { Plugin } from './global'

// every workspace is a file workspace, whose history goes through window.electronIPC, unless a test gives browser
// rows, which make workspace-1 a browser workspace whose collections are those rows
const browserRows = vi.hoisted(() => ({ collections: null as Map<string, any> | null, workspaceRemoved: false }))
vi.mock('dexie', () => {
    class Dexie {
        version() {
            return {
                stores: (schema: Record<string, string>) => {
                    for(const table of Object.keys(schema)) {
                        (this as any)[table] = {
                            get: async(id: string) => browserRows.collections === null ? { _id: 'workspace-1', _type: 'file', location: '/w' } : table === 'collections' ? structuredClone(browserRows.collections.get(id)) : browserRows.workspaceRemoved ? undefined : { _id: 'workspace-1', _type: 'browser' },
                            put: async(row: any) => browserRows.collections?.set(row._id, structuredClone(row)),
                            update: async() => 1,
                        }
                    }
                },
            }
        }
        transaction(_mode: string, _table: unknown, run: () => Promise<unknown>) {
            return run()
        }
    }
    return { default: Dexie }
})
vi.mock('@flawiddsouza/dexie-export-import', () => ({}))

const electronIPC = {
    updateCollection: vi.fn(),
    getResponsesByCollectionId: vi.fn(),
    createResponse: vi.fn(),
    getWorkspaceAtLocation: vi.fn(),
    updateWorkspace: vi.fn(),
}

async function importDb() {
    vi.resetModules()
    vi.stubEnv('MODE', 'desktop-electron')
    vi.stubGlobal('electronIPC', electronIPC)
    return import('./db')
}

beforeEach(() => {
    vi.clearAllMocks()
})

test('an inactive file workspace read includes its current environments', async() => {
    const { getFileWorkspace } = await importDb()
    const workspace = { version: 1, name: 'A', environment: { token: 'saved' }, environments: [{ name: 'Default', environment: { token: 'saved' } }] }
    electronIPC.getWorkspaceAtLocation.mockResolvedValue(workspace)
    expect(await getFileWorkspace('/workspaces/A')).toEqual(workspace)
    expect(electronIPC.getWorkspaceAtLocation).toHaveBeenCalledWith('/workspaces/A', true)
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

test('an inactive file workspace read forwards environments through web-standalone', async() => {
    vi.resetModules()
    vi.stubEnv('MODE', 'web-standalone')
    const workspace = { version: 1, name: 'A', environment: { token: 'saved' } }
    const fetch = vi.fn(async() => ({ json: async() => ({ result: workspace }) }))
    vi.stubGlobal('fetch', fetch)
    const { getFileWorkspace } = await import('./db')
    expect(await getFileWorkspace('/workspaces/A')).toEqual(workspace)
    expect(fetch).toHaveBeenCalledWith('/api/getWorkspaceAtLocation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: '/workspaces/A', getEnvironments: true }),
    })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

test('a file workspace save that throws returns its error, but not one that changes the location', async() => {
    const { updateWorkspace } = await importDb()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    electronIPC.updateWorkspace.mockRejectedValue(new Error('EACCES: permission denied, mkdir \'/w/_environments\''))
    expect(await updateWorkspace('workspace-1', { environments: [] })).toEqual({ error: 'EACCES: permission denied, mkdir \'/w/_environments\'' })
    // a rename, which the Edit dialog sends with the location it has
    expect(await updateWorkspace('workspace-1', { name: 'B', location: '/w' })).toEqual({ error: 'EACCES: permission denied, mkdir \'/w/_environments\'' })
    // a location being corrected is saved without it, also when the storage returns one
    expect(await updateWorkspace('workspace-1', { location: '/v' })).toEqual({ error: null })
    electronIPC.updateWorkspace.mockResolvedValue({ error: 'Not saved, as /w/restfox.json cannot be read' })
    expect(await updateWorkspace('workspace-1', { name: 'B', location: '/v' })).toEqual({ error: null })
    const renamed = { name: 'B', location: '/w' }
    expect(await updateWorkspace('workspace-1', renamed)).toEqual({ error: 'Not saved, as /w/restfox.json cannot be read' })
    // the name is not saved, nor shown, which the store reads from the same fields
    expect(renamed).toEqual({ location: '/w' })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

test('a file workspace read reports an unavailable file transport', async() => {
    vi.resetModules()
    vi.stubEnv('MODE', 'development')
    const { getFileWorkspace } = await import('./db')
    await expect(getFileWorkspace('/workspaces/A')).rejects.toThrow('File workspaces are not available')
    vi.unstubAllEnvs()
})

test('history of a kind only a newer version knows, with a body but no HTTP request or one without its parts, is read and saved as it is', async() => {
    const { createResponse, getResponsesByCollectionId } = await importDb()

    electronIPC.getResponsesByCollectionId.mockResolvedValue([
        { _id: 'response-1', collectionId: 'newer-1', createdAt: 1, buffer: [1, 2, 3] },
        { _id: 'response-2', collectionId: 'newer-1', createdAt: 2, buffer: [4], request: { url: 'x://y' } },
    ])
    const responses = await getResponsesByCollectionId('workspace-1', 'newer-1')
    expect(responses.map(response => [response._id, new Uint8Array(response.buffer)])).toEqual([['response-1', new Uint8Array([1, 2, 3])], ['response-2', new Uint8Array([4])]])
    expect(responses[1].request).toEqual({ url: 'x://y' })

    const entry = { _id: 'response-3', collectionId: 'newer-1', createdAt: 3, buffer: new Uint8Array([5]).buffer, request: { url: 'x://y' } }
    await createResponse('workspace-1', entry as any)
    expect(electronIPC.createResponse.mock.calls[0][1]).toEqual(entry)
})

test('history without a body still has the files of its HTTP request read and saved', async() => {
    const { createResponse, getResponsesByCollectionId } = await importDb()

    const bytes = (text: string) => Array.from(new TextEncoder().encode(text))
    electronIPC.getResponsesByCollectionId.mockResolvedValue([{
        _id: 'response-1',
        collectionId: 'newer-1',
        createdAt: 1,
        request: {
            body: { name: 'sent.txt', type: 'text/plain', buffer: bytes('sent') },
            original: {
                body: {
                    mimeType: 'multipart/form-data',
                    fileName: { name: 'a.txt', type: 'text/plain', buffer: bytes('file a') },
                    params: [{ name: 'upload', type: 'file', files: [{ name: 'b.txt', type: 'text/plain', buffer: bytes('file b') }] }],
                },
            },
        },
    }])
    const [response] = await getResponsesByCollectionId('workspace-1', 'newer-1') as any[]
    expect(response.buffer).toBeUndefined()
    const files = [response.request.body, response.request.original.body.fileName, response.request.original.body.params[0].files[0]]
    expect(files.every(file => file instanceof File)).toBe(true)
    expect(await Promise.all(files.map(file => file.text()))).toEqual(['sent', 'file a', 'file b'])

    await createResponse('workspace-1', response)
    const saved = electronIPC.createResponse.mock.calls[0][1]
    expect(saved.buffer).toBeUndefined()
    const filesSaved = [saved.request.body, saved.request.original.body.fileName, saved.request.original.body.params[0].files[0]]
    expect(filesSaved.map(file => [file.name, file.type, new TextDecoder().decode(file.buffer)])).toEqual([
        ['sent.txt', 'text/plain', 'sent'],
        ['a.txt', 'text/plain', 'file a'],
        ['b.txt', 'text/plain', 'file b'],
    ])
})

test('plugins a duplicate made in 0.41.0 left are skipped, so each item runs its plugin once and a duplicate keeps its own', async() => {
    const { withoutDuplicateLeftovers } = await importDb()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const plugin = (_id: string, workspaceId: string | null, collectionId: string, createdAt: number, name: string | null = null): Plugin => ({
        _id, type: 'script', name, code: { pre_request: '', post_request: '' }, workspaceId, collectionId, enabled: true, createdAt, updatedAt: createdAt,
    })
    const ids = (plugins: { _id: string }[]) => plugins.map(item => item._id)

    // A's request, imported, then A duplicated as B: the source keeps its own and gets a copy tagged with B
    expect(ids(withoutDuplicateLeftovers([plugin('own', 'A', 'request-a', 1), plugin('left by B', 'B', 'request-a', 2)], 'A'))).toEqual(['own'])
    // B's copy of that request has its own plugin tagged with A, alone on its item
    expect(ids(withoutDuplicateLeftovers([plugin('B own', 'A', 'request-b', 2)], 'B'))).toEqual(['B own'])
    // B duplicated as C: B's item gets a newer copy tagged with C beside its own, also mistagged
    expect(ids(withoutDuplicateLeftovers([plugin('left by C', 'C', 'request-b', 3), plugin('B own', 'A', 'request-b', 2)], 'B'))).toEqual(['B own'])

    // rightly tagged plugins and ones of another kind or name stay, however many an item has
    expect(ids(withoutDuplicateLeftovers([
        plugin('typed in the editor', null, 'request-a', 1),
        plugin('imported', 'A', 'request-a', 2),
        plugin('named', 'B', 'request-a', 3, 'Sign'),
        // a plugin added in the Plugins modal, which has no type
        { ...plugin('other kind', 'B', 'request-a', 4), type: undefined, code: '' },
    ], 'A'))).toEqual(['typed in the editor', 'imported', 'named', 'other kind'])
})

test('a save calls onSending once its body files are read and its data handed to the storage, not before', async() => {
    const { updateCollection } = await importDb()
    let finishReading!: (buffer: ArrayBuffer) => void
    const file = new File(['body'], 'body.bin')
    vi.spyOn(file, 'arrayBuffer').mockReturnValue(new Promise(resolve => {
        finishReading = resolve
    }))
    electronIPC.updateCollection.mockResolvedValue({ error: null, version: 'v2' })
    const onSending = vi.fn()

    const saving = updateCollection('workspace-1', '/R.json', { _type: 'request', body: { mimeType: 'application/octet-stream', fileName: file } } as never, 'v1', onSending)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onSending).not.toHaveBeenCalled()
    expect(electronIPC.updateCollection).not.toHaveBeenCalled()

    finishReading(new ArrayBuffer(4))
    expect(await saving).toEqual({ error: null, version: 'v2' })
    expect(onSending).toHaveBeenCalledOnce()
    expect(electronIPC.updateCollection.mock.invocationCallOrder[0]).toBeLessThan(onSending.mock.invocationCallOrder[0])
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

test('OAuth 2.0 tokens go to a file workspace as one merge, sent without a version', async() => {
    const { saveOAuthTokens } = await importDb()
    electronIPC.updateCollection.mockResolvedValue({ error: null, versionBefore: 'v1', version: 'v2' })
    const onSending = vi.fn()
    expect(await saveOAuthTokens('workspace-1', '/R.json', { token: 't', refreshToken: null }, onSending)).toEqual({ error: null, versionBefore: 'v1', version: 'v2' })
    expect(electronIPC.updateCollection).toHaveBeenCalledWith(expect.objectContaining({ _id: 'workspace-1' }), '/R.json', { oauthTokens: { token: 't', refreshToken: null } }, undefined)
    expect(onSending).toHaveBeenCalledOnce()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

test('OAuth 2.0 tokens are set into the auth a browser workspace row has now', async() => {
    const { saveOAuthTokens } = await importDb()
    const oauth = { type: 'oauth2', clientId: 'id', scope: 'edited meanwhile', token: 'old', refreshToken: 'old-refresh' }
    browserRows.collections = new Map([['r', { _id: 'r', name: 'R', workspaceId: 'workspace-1', url: 'https://api.example', authentication: oauth }]])
    try {
        // left out, as a Refresh Token reply without one, the refresh token stays
        expect(await saveOAuthTokens('workspace-1', 'r', { token: 'new' })).toEqual({ error: null })
        expect(browserRows.collections.get('r')).toEqual({ _id: 'r', name: 'R', workspaceId: 'workspace-1', url: 'https://api.example', authentication: { ...oauth, token: 'new' } })
        // null, as a Get Token reply without one, removes it rather than saving null
        await saveOAuthTokens('workspace-1', 'r', { token: 'newer', refreshToken: null })
        expect('refreshToken' in browserRows.collections.get('r').authentication).toBe(false)
        await saveOAuthTokens('workspace-1', 'r', { token: 'newest', refreshToken: 'new-refresh' })
        expect(browserRows.collections.get('r').authentication).toEqual({ ...oauth, token: 'newest', refreshToken: 'new-refresh' })

        browserRows.collections.set('r', { ...browserRows.collections.get('r'), authentication: { type: 'bearer', token: 'typed' } })
        expect(await saveOAuthTokens('workspace-1', 'r', { token: 'late' })).toEqual({ error: null, notOAuth2: true })
        expect(browserRows.collections.get('r').authentication).toEqual({ type: 'bearer', token: 'typed' })
        // deleted, such as in another browser tab
        expect((await saveOAuthTokens('workspace-1', 'gone', { token: 'late' })).changedOutside).toBe(true)
        expect(browserRows.collections.has('gone')).toBe(false)
        // a file workspace removed from the list, whose items have no rows
        browserRows.workspaceRemoved = true
        expect((await saveOAuthTokens('workspace-1', '/R.json', { token: 'late' })).changedOutside).toBe(true)
        expect(electronIPC.updateCollection).not.toHaveBeenCalled()
    } finally {
        browserRows.collections = null
        browserRows.workspaceRemoved = false
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
    }
})
