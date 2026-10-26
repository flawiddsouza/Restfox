import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import db from './db.js'
import dbHelpers from './db-helpers.js'

let workspace

beforeEach(() => {
    // the file workspace code logs every call
    vi.spyOn(console, 'log').mockImplementation(() => {})
    workspace = {
        _id: 'workspace-1',
        _type: 'file',
        location: fs.mkdtempSync(path.join(os.tmpdir(), 'restfox-db-spec-')),
    }
})

afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(workspace.location, { recursive: true, force: true })
})

function grpcItem() {
    return {
        _id: 'grpc-1',
        _type: 'grpc',
        name: 'Say Hello',
        parentId: null,
        workspaceId: workspace._id,
        url: 'localhost:50051',
        grpc: {
            service: 'demo.v1.Demo',
            method: 'SayHello',
            protoFiles: [{ path: 'demo/v1/demo.proto', text: 'syntax = "proto3";\n' }],
        },
        body: { mimeType: 'application/json', text: '{\n    "name": "{{ name }}"\n}' },
        headers: [{ name: 'x-api-key', value: 'secret' }],
        authentication: { type: 'bearer', token: 'abc' },
    }
}

function readJson(name) {
    return JSON.parse(fs.readFileSync(path.join(workspace.location, name), 'utf8'))
}

const pluginScopes = ['request', 'folder', 'workspace']

for (const writer of ['createPlugin', 'createPlugins', 'updatePlugin', 'deletePlugin', 'single-field', 'socket messages']) {
    test(`${writer} fails on a read error without changing the file`, async() => {
        const { collectionId, pluginPath } = await pluginTarget(workspace, 'request')
        let targetPath = pluginPath
        let write = () => writePlugin(workspace, collectionId, writer)
        if (writer === 'single-field') {
            targetPath = path.join(workspace.location, 'Item.json')
            write = () => db.updateCollection(workspace, collectionId, { sortOrder: 2 })
        }
        if (writer === 'socket messages') {
            targetPath = path.join(workspace.location, 'Item.messages.json')
            write = () => db.updateCollection(workspace, collectionId, { _type: 'socket', clients: [{ id: 'client', messages: [] }] })
        }
        fs.writeFileSync(targetPath, '[]\n')
        const readFile = fsPromises.readFile
        const error = Object.assign(new Error('Cannot read file'), { code: 'EACCES' })
        vi.spyOn(fsPromises, 'readFile').mockImplementation((filePath, ...args) => {
            if (filePath === targetPath) {
                return Promise.reject(error)
            }
            return readFile(filePath, ...args)
        })
        if (writer === 'single-field') {
            expect((await write()).error).toMatch(/Cannot read file/)
        } else {
            await expect(write()).rejects.toThrow(/^Not saved, as .+ cannot be read: Cannot read file$/)
        }
        expect(fs.readFileSync(targetPath, 'utf8')).toBe('[]\n')
    })
}


async function pluginTarget(workspace, scope) {
    if (scope === 'workspace') {
        return { collectionId: null, pluginPath: path.join(workspace.location, '_.plugins.json') }
    }
    const { newCollectionId } = await db.createCollection(workspace, {
        _id: 'item', _type: scope === 'folder' ? 'request_group' : 'request',
        name: 'Item', parentId: null, workspaceId: workspace._id,
    })
    return {
        collectionId: newCollectionId,
        pluginPath: path.join(workspace.location, scope === 'folder' ? 'Item/_.plugins.json' : 'Item.plugins.json'),
    }
}

const conflict = '<<<<<<< HEAD\n[{"_id":"ours","code":"ours"}]\n=======\n[{"_id":"theirs","code":"theirs"}]\n>>>>>>> branch\n'

function writePlugin(workspace, collectionId, writer) {
    const plugin = { _id: 'ours', name: 'Changed', code: 'changed', workspaceId: workspace._id, collectionId }
    if (writer === 'createPlugin') {
        return db.createPlugin(workspace, plugin)
    }
    if (writer === 'createPlugins') {
        return db.createPlugins(workspace, [plugin])
    }
    if (writer === 'updatePlugin') {
        return db.updatePlugin(workspace, collectionId, plugin._id, { code: plugin.code })
    }
    return db.deletePlugin(workspace, collectionId, plugin._id)
}

for (const scope of pluginScopes) {
    for (const writer of ['createPlugin', 'createPlugins', 'updatePlugin', 'deletePlugin']) {
        test(`${writer} rejects conflicted ${scope} plugins without changing the file`, async() => {
            const { collectionId, pluginPath } = await pluginTarget(workspace, scope)
            fs.writeFileSync(pluginPath, conflict)
            await expect(writePlugin(workspace, collectionId, writer)).rejects.toThrow(/^Not saved, as .+ cannot be read: .+ is not valid JSON/)
            expect(fs.readFileSync(pluginPath, 'utf8')).toBe(conflict)
        })
    }

    for (const writer of ['createPlugin', 'createPlugins']) {
        test(`${writer} creates missing ${scope} plugins`, async() => {
            const { collectionId, pluginPath } = await pluginTarget(workspace, scope)
            await writePlugin(workspace, collectionId, writer)
            expect(JSON.parse(fs.readFileSync(pluginPath, 'utf8')).map(plugin => plugin._id)).toEqual(['ours'])
        })
    }

    test(`updatePlugin rejects a missing id in ${scope} plugins`, async() => {
        const { collectionId, pluginPath } = await pluginTarget(workspace, scope)
        await expect(db.updatePlugin(workspace, collectionId, 'absent', { code: 'changed' })).rejects.toThrow()
        expect(fs.existsSync(pluginPath)).toBe(false)
    })

    test(`updatePlugin rejects an absent id in an existing ${scope} plugins file`, async() => {
        const { collectionId, pluginPath } = await pluginTarget(workspace, scope)
        fs.writeFileSync(pluginPath, '[]\n')
        await expect(db.updatePlugin(workspace, collectionId, 'absent', { code: 'changed' })).rejects.toThrow(/not found/)
        expect(fs.readFileSync(pluginPath, 'utf8')).toBe('[]\n')
    })

    test(`deletePlugin succeeds for absent ${scope} plugins`, async() => {
        const { collectionId, pluginPath } = await pluginTarget(workspace, scope)
        await db.deletePlugin(workspace, collectionId, 'absent')
        expect(fs.existsSync(pluginPath)).toBe(false)
        fs.writeFileSync(pluginPath, '[]\n')
        await db.deletePlugin(workspace, collectionId, 'absent')
        expect(fs.readFileSync(pluginPath, 'utf8')).toBe('[]\n')
    })
}

for (const scope of ['request', 'folder']) {
    test(`single-field updates return an error for conflicted ${scope} config without changing the file`, async() => {
        const { collectionId } = await pluginTarget(workspace, scope)
        const configPath = path.join(workspace.location, scope === 'folder' ? 'Item/_.json' : 'Item.json')
        fs.writeFileSync(configPath, conflict)
        const result = await db.updateCollection(workspace, collectionId, { sortOrder: 2 })
        expect(result.error).toMatch(/^Not saved, as .+ cannot be read: .+ is not valid JSON/)
        expect(fs.readFileSync(configPath, 'utf8')).toBe(conflict)
    })
}

test('single-field updates create missing folder config', async() => {
    const { collectionId } = await pluginTarget(workspace, 'folder')
    await db.updateCollection(workspace, collectionId, { sortOrder: 2 })
    expect(readJson('Item/_.json')).toEqual({ sortOrder: 2 })
})

test('socket saves reject conflicted messages without changing either file', async() => {
    const { newCollectionId } = await db.createCollection(workspace, { _id: 'socket', _type: 'socket', name: 'Socket', parentId: null })
    const itemPath = path.join(workspace.location, 'Socket.json')
    const messagesPath = path.join(workspace.location, 'Socket.messages.json')
    const item = fs.readFileSync(itemPath, 'utf8')
    fs.writeFileSync(messagesPath, conflict)
    await expect(db.updateCollection(workspace, newCollectionId, { _type: 'socket', clients: [{ id: 'client', messages: ['new'] }] })).rejects.toThrow(/^Not saved, as .+ cannot be read: .+ is not valid JSON/)
    expect(fs.readFileSync(messagesPath, 'utf8')).toBe(conflict)
    expect(fs.readFileSync(itemPath, 'utf8')).toBe(item)
})

test('socket saves create missing messages', async() => {
    const { newCollectionId } = await db.createCollection(workspace, { _id: 'socket', _type: 'socket', name: 'Socket', parentId: null })
    await db.updateCollection(workspace, newCollectionId, { _type: 'socket', clients: [{ id: 'client', messages: ['new'] }] })
    expect(readJson('Socket.messages.json')).toEqual({ client: ['new'] })
})


test('a gRPC item is stored in its own item file, like a request', async() => {
    const result = await db.createCollection(workspace, grpcItem())

    expect(result.error).toBe(null)
    expect(result.newCollectionId).toBe('/Say Hello.json')

    // id, name, parent and workspace come from the file's place, as for a request
    expect(readJson('Say Hello.json')).toEqual({
        _type: 'grpc',
        url: 'localhost:50051',
        grpc: grpcItem().grpc,
        body: grpcItem().body,
        headers: grpcItem().headers,
        authentication: grpcItem().authentication,
    })

    const collection = await dbHelpers.getCollection(new Map(), [], workspace)

    expect(collection).toEqual([{
        ...grpcItem(),
        _id: result.newCollectionId,
        workspaceId: workspace._id,
    }])
})

test('a request type only a newer version knows is created as its own file, loads back whole and takes its history', async() => {
    // as a duplicate or an import of a workspace that holds one does
    const newer = { _id: 'newer-1', _type: 'newer-kind', name: 'From Later', parentId: null, workspaceId: workspace._id, url: 'x://y', settings: { deep: [1, 2] } }
    const result = await db.createCollection(workspace, structuredClone(newer))

    expect(result.error).toBe(null)
    expect(result.newCollectionId).toBe('/From Later.json')
    expect(readJson('From Later.json')).toEqual({ _type: 'newer-kind', url: 'x://y', settings: { deep: [1, 2] } })
    expect(await dbHelpers.getCollection(new Map(), [], workspace)).toEqual([{ ...newer, _id: result.newCollectionId }])

    await db.createResponse(workspace, { _id: 'response-1', collectionId: result.newCollectionId, createdAt: 1, newer: { saved: true } })
    expect((await db.getResponsesByCollectionId(workspace, result.newCollectionId)).map(response => response._id)).toEqual(['response-1'])
    // saved as it is, a request of its own too
    await db.createResponse(workspace, { _id: 'response-2', collectionId: result.newCollectionId, createdAt: 2, request: { url: 'x://y', frames: [1] } })
    expect(readJson('From Later.responses.json')).toEqual([
        { _id: 'response-1', createdAt: 1, newer: { saved: true } },
        { _id: 'response-2', createdAt: 2, request: { url: 'x://y', frames: [1] } },
    ])
    // with a body but no HTTP request, or a request without the parts an HTTP one has
    await db.createResponse(workspace, { _id: 'response-3', collectionId: result.newCollectionId, createdAt: 3, buffer: new Uint8Array([1, 2, 3]).buffer })
    await db.createResponse(workspace, { _id: 'response-4', collectionId: result.newCollectionId, createdAt: 4, buffer: new Uint8Array([4]).buffer, request: { url: 'x://y' } })
    const responses = await db.getResponsesByCollectionId(workspace, result.newCollectionId)
    expect(responses.find(response => response._id === 'response-3')).toEqual({ _id: 'response-3', collectionId: result.newCollectionId, createdAt: 3, buffer: Buffer.from([1, 2, 3]) })
    expect(responses.find(response => response._id === 'response-4')).toEqual({ _id: 'response-4', collectionId: result.newCollectionId, createdAt: 4, buffer: Buffer.from([4]), request: { url: 'x://y' } })

    // a change this version would make to it is not written, as it may not know what the item needs
    await db.updateCollection(workspace, result.newCollectionId, { ...newer, _id: result.newCollectionId, url: 'changed' })
    expect(readJson('From Later.json').url).toBe('x://y')
})

test('a change to a gRPC item is written to its file', async() => {
    const { newCollectionId } = await db.createCollection(workspace, grpcItem())

    await db.updateCollection(workspace, newCollectionId, {
        ...grpcItem(),
        _id: newCollectionId,
        url: 'grpcs://api.example.com',
        grpc: { service: 'demo.v1.Demo', method: 'Count' },
    })

    const saved = readJson('Say Hello.json')
    expect(saved.url).toBe('grpcs://api.example.com')
    expect(saved.grpc).toEqual({ service: 'demo.v1.Demo', method: 'Count' })
    expect(saved._id).toBeUndefined()
    expect(saved.name).toBeUndefined()
})

test('a gRPC call in response history is saved and read back as it was', async() => {
    const { newCollectionId } = await db.createCollection(workspace, grpcItem())

    const call = {
        _id: 'response-1',
        collectionId: newCollectionId,
        createdAt: 1760000000000,
        grpc: {
            url: 'localhost:50051',
            service: 'demo.v1.Demo',
            method: 'SayHello',
            kind: 'unary',
            events: [
                { type: 'sent', json: '{\n  "name": "a"\n}', time: 1 },
                { type: 'received', json: '{\n  "message": "Hello a"\n}', time: 5 },
            ],
            headers: [['x-echo-a', '1']],
            trailers: [],
            status: { code: 0, name: 'OK', details: '' },
            timeTaken: 6,
            ended: 'completed',
        },
    }

    await db.createResponse(workspace, structuredClone(call))

    // the file is the item's, so the entries leave out its id
    const callStored = { ...call }
    delete callStored.collectionId
    expect(readJson('Say Hello.responses.json')).toEqual([callStored])

    expect(await db.getResponsesByCollectionId(workspace, newCollectionId)).toEqual([call])
})

test('an entry without a body still has the files of its HTTP request saved and read back', async() => {
    const { newCollectionId } = await db.createCollection(workspace, { _id: 'newer-1', _type: 'newer-kind', name: 'From Later', parentId: null, workspaceId: workspace._id })

    const bytes = text => new TextEncoder().encode(text).buffer
    await db.createResponse(workspace, {
        _id: 'response-1',
        collectionId: newCollectionId,
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
    })

    const base64 = text => Buffer.from(text).toString('base64')
    expect(readJson('From Later.responses.json')).toEqual([{
        _id: 'response-1',
        createdAt: 1,
        request: {
            body: { name: 'sent.txt', type: 'text/plain', buffer: base64('sent') },
            original: {
                body: {
                    mimeType: 'multipart/form-data',
                    fileName: { name: 'a.txt', type: 'text/plain', buffer: base64('file a') },
                    params: [{ name: 'upload', type: 'file', files: [{ name: 'b.txt', type: 'text/plain', buffer: base64('file b') }] }],
                },
            },
        },
    }])

    expect(await db.getResponsesByCollectionId(workspace, newCollectionId)).toEqual([{
        _id: 'response-1',
        collectionId: newCollectionId,
        createdAt: 1,
        request: {
            body: { name: 'sent.txt', type: 'text/plain', buffer: Buffer.from('sent') },
            original: {
                body: {
                    mimeType: 'multipart/form-data',
                    fileName: { name: 'a.txt', type: 'text/plain', buffer: Buffer.from('file a') },
                    params: [{ name: 'upload', type: 'file', files: [{ name: 'b.txt', type: 'text/plain', buffer: Buffer.from('file b') }] }],
                },
            },
        },
    }])
})

test('a workspace without gRPC items loads as before', async() => {
    const request = {
        _id: 'request-1',
        _type: 'request',
        name: 'Get',
        parentId: null,
        workspaceId: workspace._id,
        url: 'http://localhost/',
        method: 'GET',
        body: { mimeType: 'No Body' },
    }
    const { newCollectionId } = await db.createCollection(workspace, structuredClone(request))
    await db.createCollection(workspace, { _id: 'socket-1', _type: 'socket', name: 'Socket', parentId: null, workspaceId: workspace._id })

    const response = {
        _id: 'response-1',
        collectionId: newCollectionId,
        createdAt: 1,
        url: 'http://localhost/',
        status: 200,
        statusText: 'OK',
        headers: [],
        mimeType: 'text/plain',
        buffer: new TextEncoder().encode('hi').buffer,
        timeTaken: 1,
        request: { method: 'GET', query: '', headers: {}, body: null, original: request },
        testResults: [],
    }
    await db.createResponse(workspace, structuredClone(response))

    const collection = await dbHelpers.getCollection(new Map(), [], workspace)
    expect(collection.map(item => [item._type, item.name]).sort()).toEqual([['request', 'Get'], ['socket', 'Socket']])

    const [responseRead] = await db.getResponsesByCollectionId(workspace, newCollectionId)
    expect(Buffer.from(responseRead.buffer).toString()).toBe('hi')
})

test('history of an item in one workspace goes to that workspace, though another workspace has an item at the same path', async() => {
    const otherWorkspace = { _id: 'workspace-2', _type: 'file', location: fs.mkdtempSync(path.join(os.tmpdir(), 'restfox-db-spec-')) }
    try {
        const { newCollectionId } = await db.createCollection(workspace, { ...grpcItem(), name: 'Chat' })
        // the other workspace, opened later, has its own Chat
        await db.createCollection(otherWorkspace, { ...grpcItem(), name: 'Chat', workspaceId: otherWorkspace._id })

        const call = (id, createdAt) => ({ _id: id, collectionId: newCollectionId, createdAt, grpc: { url: 'localhost:50051', service: 'demo.v1.Demo', method: 'SayHello', kind: 'unary', events: [], headers: [], trailers: [], status: { code: 0, name: 'OK', details: '' }, timeTaken: 1, ended: 'completed' } })
        await db.createResponse(workspace, call('response-1', 1))
        await db.createResponse(workspace, call('response-2', 2))
        await db.deleteResponsesByIds(workspace, newCollectionId, ['response-1'])

        expect(readJson('Chat.responses.json').map(response => response._id)).toEqual(['response-2'])
        expect(fs.existsSync(path.join(otherWorkspace.location, 'Chat.responses.json'))).toBe(false)
        expect((await db.getResponsesByCollectionId(workspace, newCollectionId)).map(response => response._id)).toEqual(['response-2'])
    } finally {
        fs.rmSync(otherWorkspace.location, { recursive: true, force: true })
    }
})

test('renaming or moving a folder leaves a folder whose name starts the same alone', async() => {
    const item = (name, parentId, extra = {}) => ({ _id: name, _type: 'request', name, parentId, workspaceId: workspace._id, url: 'http://localhost/', method: 'GET', body: { mimeType: 'No Body' }, ...extra })
    const folder = await db.createCollection(workspace, { _id: 'f1', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: workspace._id })
    const folder2 = await db.createCollection(workspace, { _id: 'f2', _type: 'request_group', name: 'Folder2', parentId: null, workspaceId: workspace._id })
    const target = await db.createCollection(workspace, { _id: 'f3', _type: 'request_group', name: 'Target', parentId: null, workspaceId: workspace._id })
    const chat = await db.createCollection(workspace, item('Chat', folder2.newCollectionId))

    await db.updateCollection(workspace, folder.newCollectionId, { name: 'Renamed' })
    // a change to the other folder's item right after is saved
    await db.updateCollection(workspace, chat.newCollectionId, item('Chat', folder2.newCollectionId, { url: 'http://changed/' }))
    expect(readJson('Folder2/Chat.json').url).toBe('http://changed/')

    // the folder keeps its id until the next load
    await db.updateCollection(workspace, folder.newCollectionId, { parentId: target.newCollectionId })
    await db.updateCollection(workspace, chat.newCollectionId, item('Chat', folder2.newCollectionId, { url: 'http://changed-again/' }))
    expect(readJson('Folder2/Chat.json').url).toBe('http://changed-again/')
})
