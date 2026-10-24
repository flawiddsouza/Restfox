import fs from 'fs'
import os from 'os'
import path from 'path'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as db from './src/db.js'
import app from './app.js'

// the file workspace code logs every call
const consoleLog = console.log

test.beforeEach(() => {
    console.log = () => {}
})

test.afterEach(() => {
    console.log = consoleLog
})

async function withWorkspace(run) {
    // a new empty folder, which loading turns into a workspace
    const workspace = {
        _id: 'workspace-1',
        _type: 'file',
        location: fs.mkdtempSync(path.join(os.tmpdir(), 'restfox-db-test-')),
    }

    try {
        const loaded = await db.getCollectionForWorkspace(workspace, null)
        assert.equal(loaded.error, null)
        await run(workspace)
    } finally {
        fs.rmSync(workspace.location, { recursive: true, force: true })
    }
}

test('renaming or moving a folder leaves a folder whose name starts the same alone', () => withWorkspace(async workspace => {
    const item = (name, parentId, extra = {}) => ({ _id: name, _type: 'request', name, parentId, workspaceId: workspace._id, url: 'http://localhost/', method: 'GET', body: { mimeType: 'No Body' }, ...extra })
    const folder = await db.createCollection(workspace, { _id: 'f1', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: workspace._id })
    const folder2 = await db.createCollection(workspace, { _id: 'f2', _type: 'request_group', name: 'Folder2', parentId: null, workspaceId: workspace._id })
    const target = await db.createCollection(workspace, { _id: 'f3', _type: 'request_group', name: 'Target', parentId: null, workspaceId: workspace._id })
    const chat = await db.createCollection(workspace, item('Chat', folder2.newCollectionId))

    await db.updateCollection(workspace, folder.newCollectionId, { name: 'Renamed' })
    // a change to the other folder's item right after is saved
    await db.updateCollection(workspace, chat.newCollectionId, item('Chat', folder2.newCollectionId, { url: 'http://changed/' }))
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace.location, 'Folder2', 'Chat.json'), 'utf8')).url, 'http://changed/')

    // the folder keeps its id until the next load
    await db.updateCollection(workspace, folder.newCollectionId, { parentId: target.newCollectionId })
    await db.updateCollection(workspace, chat.newCollectionId, item('Chat', folder2.newCollectionId, { url: 'http://changed-again/' }))
    assert.equal(JSON.parse(fs.readFileSync(path.join(workspace.location, 'Folder2', 'Chat.json'), 'utf8')).url, 'http://changed-again/')

    // the reload maps the other folder's item to itself, so its open tab stays
    const reloaded = await db.getCollectionForWorkspace(workspace, null)
    assert.equal(new Map(reloaded.idMap).get(chat.newCollectionId), chat.newCollectionId)
}))

test('file workspace routes save and reload http history larger than 50 MB', () => withWorkspace(async workspace => {
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
    })
    const post = (name, body) => fetch(`http://127.0.0.1:${server.address().port}/api/${name}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    try {
        const created = await post('createCollection', { workspace, collection: { _id: 'request-1', _type: 'request', name: 'Get', parentId: null, workspaceId: workspace._id, url: 'http://localhost/', method: 'GET', body: { mimeType: 'No Body' } } })
        const { result: { newCollectionId } } = await created.json()
        const buffer = new Array(13 * 1024 * 1024).fill(255)
        const response = { _id: 'large-response', collectionId: newCollectionId, createdAt: 1,
            buffer, request: { body: null, original: { body: { mimeType: 'No Body' } } },
        }
        const saved = await post('createResponse', { workspace, response })
        assert.equal(saved.status, 200)
        await saved.json()
        const loaded = await post('getResponsesByCollectionId', { workspace, collectionId: newCollectionId })
        assert.equal(loaded.status, 200)
        const { result } = await loaded.json()
        assert.equal(result.length, 1)
        assert.equal(result[0].buffer.length, buffer.length)
        assert.equal(result[0].buffer.every(value => value === 255), true)
    } finally {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
    }
}))
