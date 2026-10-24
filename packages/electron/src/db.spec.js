import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import db from './db.js'

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

function requestItem() {
    return { _id: 'request-1', _type: 'request', name: 'Get', parentId: null, workspaceId: workspace._id, url: 'http://localhost/', method: 'GET', body: { mimeType: 'No Body' } }
}

function readJson(name) {
    return JSON.parse(fs.readFileSync(path.join(workspace.location, name), 'utf8'))
}

test('history of an item in one workspace goes to that workspace, though another workspace has an item at the same path', async() => {
    const otherWorkspace = { _id: 'workspace-2', _type: 'file', location: fs.mkdtempSync(path.join(os.tmpdir(), 'restfox-db-spec-')) }
    try {
        const { newCollectionId } = await db.createCollection(workspace, { ...requestItem(), name: 'Chat' })
        // the other workspace, opened later, has its own Chat
        await db.createCollection(otherWorkspace, { ...requestItem(), name: 'Chat', workspaceId: otherWorkspace._id })

        const call = (id, createdAt) => ({ _id: id, collectionId: newCollectionId, createdAt, buffer: Buffer.from('hi'), request: { body: null, original: requestItem() } })
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
