// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from 'vitest'

// every workspace is a file workspace, whose history goes through window.electronIPC
vi.mock('dexie', () => {
    class Dexie {
        version() {
            return {
                stores: (schema: Record<string, string>) => {
                    for(const table of Object.keys(schema)) {
                        (this as any)[table] = { get: async() => ({ _id: 'workspace-1', _type: 'file', location: '/w' }) }
                    }
                },
            }
        }
    }
    return { default: Dexie }
})
vi.mock('@flawiddsouza/dexie-export-import', () => ({}))

const electronIPC = {
    getResponsesByCollectionId: vi.fn(),
    createResponse: vi.fn(),
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
