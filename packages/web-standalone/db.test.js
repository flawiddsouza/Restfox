import fs from 'fs'
import fsPromises from 'fs/promises'
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

function grpcItem(workspace) {
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

const readJson = (workspace, name) => JSON.parse(fs.readFileSync(path.join(workspace.location, name), 'utf8'))

const pluginScopes = ['request', 'folder', 'workspace']

for (const writer of ['createPlugin', 'createPlugins', 'updatePlugin', 'deletePlugin', 'single-field', 'socket messages']) {
    test(`${writer} fails on a read error without changing the file`, t => withWorkspace(async workspace => {
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
        t.mock.method(fsPromises, 'readFile', (filePath, ...args) => {
            if (filePath === targetPath) {
                return Promise.reject(error)
            }
            return readFile(filePath, ...args)
        })
        if (writer === 'single-field') {
            assert.match((await write()).error, /Cannot read file/)
        } else {
            await assert.rejects(write(), { message: /^Not saved, as .+ cannot be read: Cannot read file$/ })
        }
        assert.equal(fs.readFileSync(targetPath, 'utf8'), '[]\n')
    }))
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
        test(`${writer} rejects conflicted ${scope} plugins without changing the file`, () => withWorkspace(async workspace => {
            const { collectionId, pluginPath } = await pluginTarget(workspace, scope)
            fs.writeFileSync(pluginPath, conflict)
            await assert.rejects(writePlugin(workspace, collectionId, writer), { message: /^Not saved, as .+ cannot be read: .+ is not valid JSON/ })
            assert.equal(fs.readFileSync(pluginPath, 'utf8'), conflict)
        }))
    }

    for (const writer of ['createPlugin', 'createPlugins']) {
        test(`${writer} creates missing ${scope} plugins`, () => withWorkspace(async workspace => {
            const { collectionId, pluginPath } = await pluginTarget(workspace, scope)
            await writePlugin(workspace, collectionId, writer)
            assert.deepEqual(JSON.parse(fs.readFileSync(pluginPath, 'utf8')).map(plugin => plugin._id), ['ours'])
        }))
    }

    test(`updatePlugin rejects a missing id in ${scope} plugins`, () => withWorkspace(async workspace => {
        const { collectionId, pluginPath } = await pluginTarget(workspace, scope)
        await assert.rejects(db.updatePlugin(workspace, collectionId, 'absent', { code: 'changed' }))
        assert.equal(fs.existsSync(pluginPath), false)
    }))

    test(`updatePlugin rejects an absent id in an existing ${scope} plugins file`, () => withWorkspace(async workspace => {
        const { collectionId, pluginPath } = await pluginTarget(workspace, scope)
        fs.writeFileSync(pluginPath, '[]\n')
        await assert.rejects(db.updatePlugin(workspace, collectionId, 'absent', { code: 'changed' }), /not found/)
        assert.equal(fs.readFileSync(pluginPath, 'utf8'), '[]\n')
    }))

    test(`deletePlugin succeeds for absent ${scope} plugins`, () => withWorkspace(async workspace => {
        const { collectionId, pluginPath } = await pluginTarget(workspace, scope)
        await db.deletePlugin(workspace, collectionId, 'absent')
        assert.equal(fs.existsSync(pluginPath), false)
        fs.writeFileSync(pluginPath, '[]\n')
        await db.deletePlugin(workspace, collectionId, 'absent')
        assert.equal(fs.readFileSync(pluginPath, 'utf8'), '[]\n')
    }))
}

for (const scope of ['request', 'folder']) {
    test(`single-field updates return an error for conflicted ${scope} config without changing the file`, () => withWorkspace(async workspace => {
        const { collectionId } = await pluginTarget(workspace, scope)
        const configPath = path.join(workspace.location, scope === 'folder' ? 'Item/_.json' : 'Item.json')
        fs.writeFileSync(configPath, conflict)
        const result = await db.updateCollection(workspace, collectionId, { sortOrder: 2 })
        assert.match(result.error, /^Not saved, as .+ cannot be read: .+ is not valid JSON/)
        assert.equal(fs.readFileSync(configPath, 'utf8'), conflict)
    }))
}

test('single-field updates create missing folder config', () => withWorkspace(async workspace => {
    const { collectionId } = await pluginTarget(workspace, 'folder')
    await db.updateCollection(workspace, collectionId, { sortOrder: 2 })
    assert.deepEqual(readJson(workspace, 'Item/_.json'), { sortOrder: 2 })
}))

test('socket saves reject conflicted messages without changing either file', () => withWorkspace(async workspace => {
    const { newCollectionId } = await db.createCollection(workspace, { _id: 'socket', _type: 'socket', name: 'Socket', parentId: null })
    const itemPath = path.join(workspace.location, 'Socket.json')
    const messagesPath = path.join(workspace.location, 'Socket.messages.json')
    const item = fs.readFileSync(itemPath, 'utf8')
    fs.writeFileSync(messagesPath, conflict)
    await assert.rejects(db.updateCollection(workspace, newCollectionId, { _type: 'socket', clients: [{ id: 'client', messages: ['new'] }] }), { message: /^Not saved, as .+ cannot be read: .+ is not valid JSON/ })
    assert.equal(fs.readFileSync(messagesPath, 'utf8'), conflict)
    assert.equal(fs.readFileSync(itemPath, 'utf8'), item)
}))

test('socket saves create missing messages', () => withWorkspace(async workspace => {
    const { newCollectionId } = await db.createCollection(workspace, { _id: 'socket', _type: 'socket', name: 'Socket', parentId: null })
    await db.updateCollection(workspace, newCollectionId, { _type: 'socket', clients: [{ id: 'client', messages: ['new'] }] })
    assert.deepEqual(readJson(workspace, 'Socket.messages.json'), { client: ['new'] })
}))

function writeEnvironmentFiles(workspace, files) {
    const envsDirPath = path.join(workspace.location, '_environments')
    fs.mkdirSync(envsDirPath, { recursive: true })
    for (const [name, text] of Object.entries(files)) {
        fs.writeFileSync(path.join(envsDirPath, name), text)
    }
    return envsDirPath
}

test('saving environments leaves an environment file it cannot read and deletes a removed one', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, { 'Prod.json': conflict, 'Old.json': '{}', 'Old.meta.json': '{"color":"red"}' })
    await db.updateWorkspace(workspace, { environments: [{ name: 'Default', environment: { a: '1' } }] })
    assert.equal(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8'), conflict)
    assert.deepEqual(fs.readdirSync(envsDirPath).sort(), ['Default.json', 'Prod.json'])
}))

test('an environment named as a file it cannot read is not saved, and the others are', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, { 'Prod.json': conflict, 'Old.json': '{}' })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Default', environment: { a: '1' } }, { name: 'Prod', environment: { token: 'new' } }] })
    assert.match(result.error, /^Not saved, as .+Prod\.json cannot be read: .+ is not valid JSON\. Nothing was deleted$/)
    assert.equal(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8'), conflict)
    // the others are saved, and nothing deleted
    assert.deepEqual(fs.readdirSync(envsDirPath).sort(), ['Default.json', 'Old.json', 'Prod.json'])
    assert.deepEqual(readJson(workspace, '_environments/Default.json'), { a: '1' })
}))

test('a save refusing an environment says nothing was deleted only when it held back a removal', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, { 'Prod.json': conflict, 'Stage.json': conflict })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: {} }] })
    assert.match(result.error, /^Not saved, as .+Prod\.json cannot be read: .+ is not valid JSON$/)
    assert.deepEqual(fs.readdirSync(envsDirPath).sort(), ['Prod.json', 'Stage.json'])
}))

test('an environments save on a restfox.json it cannot read returns its error and writes nothing', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, { 'Default.json': '{}' })
    fs.writeFileSync(path.join(workspace.location, 'restfox.json'), conflict)
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Default', environment: { a: '1' } }] })
    assert.match(result.error, /^Not saved, as .+restfox\.json cannot be read: .+ is not valid JSON$/)
    assert.equal(fs.readFileSync(path.join(envsDirPath, 'Default.json'), 'utf8'), '{}')
    assert.equal(fs.readFileSync(path.join(workspace.location, 'restfox.json'), 'utf8'), conflict)
}))

test('an environment whose file cannot be written is reported', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, { 'Prod.json': '{"a":"old"}' })
    fs.chmodSync(path.join(envsDirPath, 'Prod.json'), 0o444)
    try {
        const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: { a: 'new' } }] })
        assert.match(result.error, /^Not saved, as .+Prod\.json could not be written: /)
    } finally {
        fs.chmodSync(path.join(envsDirPath, 'Prod.json'), 0o644)
    }
}))

test('an environment color whose file cannot be read is left as it is', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, { 'Prod.json': '{}', 'Prod.meta.json': conflict })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: { a: '1' }, color: '#ffffff' }] })
    assert.match(result.error, /^Not saved, as .+Prod\.meta\.json cannot be read: /)
    assert.equal(fs.readFileSync(path.join(envsDirPath, 'Prod.meta.json'), 'utf8'), conflict)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8')), { a: '1' })
}))

test('two environments whose names differ only in case keep both sets of variables', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, { 'Prod.json': '{"a":"1"}' })
    const caseInsensitive = fs.existsSync(path.join(envsDirPath, 'prod.json'))
    // in either order, the one already saved under its name is kept
    for (const environments of [
        [{ name: 'Prod', environment: { a: '1' } }, { name: 'prod', environment: {} }],
        [{ name: 'prod', environment: {} }, { name: 'Prod', environment: { a: '1' } }],
    ]) {
        const result = await db.updateWorkspace(workspace, { environments })
        if (caseInsensitive) {
            assert.match(result.error, /^Not saved, as the environment prod is the same file as Prod on this system$/)
            assert.deepEqual(fs.readdirSync(envsDirPath), ['Prod.json'])
            assert.deepEqual(JSON.parse(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8')), { a: '1' })
        } else {
            assert.equal(result.error, null)
            assert.deepEqual(fs.readdirSync(envsDirPath).sort(), ['Prod.json', 'prod.json'])
        }
    }
}))

test('two new environments whose names differ only in case keep the first one\'s variables', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, {})
    const caseInsensitive = fs.existsSync(path.join(workspace.location, '_ENVIRONMENTS'))
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: { a: '1' } }, { name: 'prod', environment: {} }] })
    if (caseInsensitive) {
        assert.match(result.error, /^Not saved, as the environment prod is the same file as Prod on this system$/)
        assert.deepEqual(fs.readdirSync(envsDirPath), ['Prod.json'])
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8')), { a: '1' })
    } else {
        assert.equal(result.error, null)
        assert.deepEqual(fs.readdirSync(envsDirPath).sort(), ['Prod.json', 'prod.json'])
    }
}))

test('an environment named as another one\'s color file is not saved over it', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, { 'Prod.json': '{}', 'Prod.meta.json': '{"color":"red"}', 'Old.json': '{}' })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: {}, color: 'red' }, { name: 'Prod.meta', environment: { a: '1' } }] })
    assert.equal(result.error, 'Not saved, as the environment name Prod.meta ends in .meta, which environment colors are saved under. Nothing was deleted')
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(envsDirPath, 'Prod.meta.json'), 'utf8')), { color: 'red' })
    assert.deepEqual(fs.readdirSync(envsDirPath).sort(), ['Old.json', 'Prod.json', 'Prod.meta.json'])
}))

test('renaming an environment keeps its color file when it cannot be read', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, { 'Old.json': '{}', 'Old.meta.json': conflict })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'New', environment: {} }] })
    assert.equal(result.error, null)
    assert.deepEqual(fs.readdirSync(envsDirPath).sort(), ['New.json', 'Old.meta.json'])
    assert.equal(fs.readFileSync(path.join(envsDirPath, 'Old.meta.json'), 'utf8'), conflict)
}))

test('renaming an environment to the name of a file it cannot read keeps both files', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, { 'Prod.json': conflict, 'Old.json': '{"a":"1"}' })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: { a: '1' } }] })
    assert.match(result.error, /^Not saved, as .+Prod\.json cannot be read: .+\. Nothing was deleted$/)
    assert.equal(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8'), conflict)
    assert.deepEqual(fs.readdirSync(envsDirPath).sort(), ['Old.json', 'Prod.json'])
    assert.equal(fs.readFileSync(path.join(envsDirPath, 'Old.json'), 'utf8'), '{"a":"1"}')
}))

test('a file beside the environments that is not one, such as a backup, is neither loaded nor deleted', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, { 'Prod.json': '{"a":"1"}', 'Prod.json.bak': '{"a":"0"}' })
    assert.deepEqual((await db.getWorkspaceAtLocation(workspace.location, true)).environments.map(environment => environment.name), ['Prod'])
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: { a: '2' } }] })
    assert.equal(result.error, null)
    assert.deepEqual(fs.readdirSync(envsDirPath).sort(), ['Prod.json', 'Prod.json.bak'])
}))

test('an environment whose name holds .json loads under its own name and keeps its color', () => withWorkspace(async workspace => {
    const envsDirPath = writeEnvironmentFiles(workspace, { 'Prod.json.backup.json': '{"a":"1"}', 'Prod.json.backup.meta.json': '{"color":"red"}', 'Prod.backup.json': '{"a":"2"}' })
    const { environments } = await db.getWorkspaceAtLocation(workspace.location, true)
    assert.deepEqual(environments.map(environment => [environment.name, environment.environment.a, environment.color]).sort(), [['Prod.backup', '2', undefined], ['Prod.json.backup', '1', 'red']])
    assert.equal((await db.updateWorkspace(workspace, { environments })).error, null)
    assert.deepEqual(fs.readdirSync(envsDirPath).sort(), ['Prod.backup.json', 'Prod.json.backup.json', 'Prod.json.backup.meta.json'])
}))

test('loading keeps the saved environment pick when the picked environment cannot be read', () => withWorkspace(async workspace => {
    writeEnvironmentFiles(workspace, { 'Default.json': '{}', 'Prod.json': conflict })
    fs.writeFileSync(path.join(workspace.location, 'restfox.json'), '{"version":1,"name":"W","currentEnvironment":"Prod"}')
    const { newCollectionId } = await db.createCollection(workspace, { _id: 'folder', _type: 'request_group', name: 'Folder', parentId: null })
    const folderEnvsDirPath = path.join(workspace.location, 'Folder', '_environments')
    fs.mkdirSync(folderEnvsDirPath, { recursive: true })
    fs.writeFileSync(path.join(folderEnvsDirPath, 'Default.json'), '{}')
    fs.writeFileSync(path.join(folderEnvsDirPath, 'Prod.json'), conflict)
    fs.writeFileSync(path.join(workspace.location, 'Folder', '_.json'), '{"currentEnvironment":"Prod"}')

    // the first environment stands in until the file is fixed
    assert.equal((await db.getWorkspaceAtLocation(workspace.location, true)).currentEnvironment, 'Default')
    const loaded = await db.getCollectionForWorkspace(workspace, null)
    assert.equal(loaded.collection.find(item => item._id === newCollectionId).currentEnvironment, 'Default')
    assert.equal(fs.readFileSync(path.join(workspace.location, 'restfox.json'), 'utf8'), '{"version":1,"name":"W","currentEnvironment":"Prod"}')
    assert.equal(fs.readFileSync(path.join(workspace.location, 'Folder', '_.json'), 'utf8'), '{"currentEnvironment":"Prod"}')
}))

test('a location typed with forward slashes or a trailing separator loads its items at the root', () => withWorkspace(async workspace => {
    const typedWorkspace = { ...workspace, location: `${workspace.location.replaceAll('\\', '/')}/` }
    await db.createCollection(typedWorkspace, { _id: 'request', _type: 'request', name: 'Get', parentId: null, url: '', method: 'GET', body: { mimeType: 'No Body' } })
    const loaded = await db.getCollectionForWorkspace(typedWorkspace, null)
    assert.equal(loaded.error, null)
    assert.deepEqual(loaded.collection.map(item => [item._id, item.parentId]), [['/Get.json', null]])
    // deleting reads the id map from the location alone
    const deleted = await db.deleteCollectionsByIds(typedWorkspace, ['/Get.json'])
    assert.equal(deleted?.error ?? null, null)
    assert.equal(fs.existsSync(path.join(workspace.location, 'Get.json')), false)
}))


test('a request type only a newer version knows is created as its own file, loads back whole and takes its history', () => withWorkspace(async workspace => {
    // as a duplicate or an import of a workspace that holds one does
    const newer = { _id: 'newer-1', _type: 'newer-kind', name: 'From Later', parentId: null, workspaceId: workspace._id, url: 'x://y', settings: { deep: [1, 2] } }
    const result = await db.createCollection(workspace, structuredClone(newer))
    assert.equal(result.error, null)
    assert.deepEqual(readJson(workspace, 'From Later.json'), { _type: 'newer-kind', url: 'x://y', settings: { deep: [1, 2] } })

    await db.createResponse(workspace, { _id: 'response-1', collectionId: result.newCollectionId, createdAt: 1, newer: { saved: true } })
    assert.deepEqual((await db.getResponsesByCollectionId(workspace, result.newCollectionId)).map(response => response._id), ['response-1'])
    // saved as it is, a request of its own too
    await db.createResponse(workspace, { _id: 'response-2', collectionId: result.newCollectionId, createdAt: 2, request: { url: 'x://y', frames: [1] } })
    assert.deepEqual(readJson(workspace, 'From Later.responses.json'), [
        { _id: 'response-1', createdAt: 1, newer: { saved: true } },
        { _id: 'response-2', createdAt: 2, request: { url: 'x://y', frames: [1] } },
    ])
    // with a body but no HTTP request, or a request without the parts an HTTP one has
    await db.createResponse(workspace, { _id: 'response-3', collectionId: result.newCollectionId, createdAt: 3, buffer: [1, 2, 3] })
    await db.createResponse(workspace, { _id: 'response-4', collectionId: result.newCollectionId, createdAt: 4, buffer: [4], request: { url: 'x://y' } })
    const responses = await db.getResponsesByCollectionId(workspace, result.newCollectionId)
    assert.deepEqual(responses.find(response => response._id === 'response-3'), { _id: 'response-3', collectionId: result.newCollectionId, createdAt: 3, buffer: [1, 2, 3] })
    assert.deepEqual(responses.find(response => response._id === 'response-4'), { _id: 'response-4', collectionId: result.newCollectionId, createdAt: 4, buffer: [4], request: { url: 'x://y' } })

    // a change this version would make to it is not written, as it may not know what the item needs
    await db.updateCollection(workspace, result.newCollectionId, { ...newer, _id: result.newCollectionId, url: 'changed' })
    assert.equal(readJson(workspace, 'From Later.json').url, 'x://y')

    const { collection } = await db.getCollectionForWorkspace(workspace, null)
    assert.deepEqual(collection, [{ ...newer, _id: result.newCollectionId }])
}))

test('a gRPC item is stored in its own item file, like a request, and loads back', () => withWorkspace(async workspace => {
    const result = await db.createCollection(workspace, grpcItem(workspace))
    assert.equal(result.error, null)

    // id, name, parent and workspace come from the file's place, as for a request
    const { _id, name, parentId, workspaceId, ...stored } = grpcItem(workspace)
    assert.deepEqual(readJson(workspace, 'Say Hello.json'), stored)

    await db.updateCollection(workspace, result.newCollectionId, {
        ...grpcItem(workspace),
        _id: result.newCollectionId,
        url: 'grpcs://api.example.com',
        grpc: { service: 'demo.v1.Demo', method: 'Count' },
    })
    assert.equal(readJson(workspace, 'Say Hello.json').url, 'grpcs://api.example.com')

    const { collection } = await db.getCollectionForWorkspace(workspace, null)
    assert.deepEqual(collection, [{
        ...grpcItem(workspace),
        _id: result.newCollectionId,
        url: 'grpcs://api.example.com',
        grpc: { service: 'demo.v1.Demo', method: 'Count' },
    }])
}))

test('a gRPC call in response history is saved and read back as it was', () => withWorkspace(async workspace => {
    const { newCollectionId } = await db.createCollection(workspace, grpcItem(workspace))

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
    const { collectionId: _, ...callStored } = call
    assert.deepEqual(readJson(workspace, 'Say Hello.responses.json'), [callStored])
    assert.deepEqual(await db.getResponsesByCollectionId(workspace, newCollectionId), [call])
}))

test('an entry without a body still has the files of its HTTP request saved and read back', () => withWorkspace(async workspace => {
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
    assert.deepEqual(readJson(workspace, 'From Later.responses.json'), [{
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

    const bytesRead = text => Array.from(Buffer.from(text))
    assert.deepEqual(await db.getResponsesByCollectionId(workspace, newCollectionId), [{
        _id: 'response-1',
        collectionId: newCollectionId,
        createdAt: 1,
        request: {
            body: { name: 'sent.txt', type: 'text/plain', buffer: bytesRead('sent') },
            original: {
                body: {
                    mimeType: 'multipart/form-data',
                    fileName: { name: 'a.txt', type: 'text/plain', buffer: bytesRead('file a') },
                    params: [{ name: 'upload', type: 'file', files: [{ name: 'b.txt', type: 'text/plain', buffer: bytesRead('file b') }] }],
                },
            },
        },
    }])
}))

test('a workspace without gRPC items loads as before', () => withWorkspace(async workspace => {
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

    await db.createResponse(workspace, {
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
    })

    const { collection } = await db.getCollectionForWorkspace(workspace, null)
    assert.deepEqual(collection.map(item => [item._type, item.name]).sort(), [['request', 'Get'], ['socket', 'Socket']])

    const [responseRead] = await db.getResponsesByCollectionId(workspace, newCollectionId)
    assert.equal(Buffer.from(responseRead.buffer).toString(), 'hi')
}))

test('history of an item in one workspace goes to that workspace, though another workspace opened later has an item at the same path', () => withWorkspace(async workspace => {
    const { newCollectionId } = await db.createCollection(workspace, { ...grpcItem(workspace), name: 'Chat' })

    await withWorkspace(async otherWorkspace => {
        await db.createCollection(otherWorkspace, { ...grpcItem(otherWorkspace), name: 'Chat' })

        const call = (id, createdAt) => ({ _id: id, collectionId: newCollectionId, createdAt, grpc: { url: 'localhost:50051', service: 'demo.v1.Demo', method: 'SayHello', kind: 'unary', events: [], headers: [], trailers: [], status: { code: 0, name: 'OK', details: '' }, timeTaken: 1, ended: 'completed' } })
        await db.createResponse(workspace, call('response-1', 1))
        await db.createResponse(workspace, call('response-2', 2))
        await db.deleteResponsesByIds(workspace, newCollectionId, ['response-1'])

        const responsesFile = location => path.join(location, 'Chat.responses.json')
        assert.deepEqual(JSON.parse(fs.readFileSync(responsesFile(workspace.location), 'utf8')).map(response => response._id), ['response-2'])
        assert.equal(fs.existsSync(responsesFile(otherWorkspace.location)), false)
        assert.deepEqual((await db.getResponsesByCollectionId(workspace, newCollectionId)).map(response => response._id), ['response-2'])
    })
}))

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

for(const kind of ['grpc', 'http']) {
    test(`file workspace routes save and reload ${kind} history larger than 50 MB`, () => withWorkspace(async workspace => {
        const server = await new Promise(resolve => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
        })
        const post = (name, body) => fetch(`http://127.0.0.1:${server.address().port}/api/${name}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        })
        try {
            const created = await post('createCollection', { workspace, collection: grpcItem(workspace) })
            const { result: { newCollectionId } } = await created.json()
            const text = kind === 'grpc' ? 'x'.repeat(51 * 1024 * 1024) : null
            const buffer = kind === 'http' ? new Array(13 * 1024 * 1024).fill(255) : null
            const response = { _id: 'large-response', collectionId: newCollectionId, createdAt: 1,
                ...(kind === 'grpc' ? { grpc: { events: [{ type: 'received', json: text, time: 1 }] } } : { buffer }),
            }
            const saved = await post('createResponse', { workspace, response })
            assert.equal(saved.status, 200)
            await saved.json()
            const loaded = await post('getResponsesByCollectionId', { workspace, collectionId: newCollectionId })
            assert.equal(loaded.status, 200)
            const { result } = await loaded.json()
            assert.equal(result.length, 1)
            if(kind === 'grpc') {
                assert.equal(result[0].grpc.events[0].json === text, true)
            } else {
                assert.equal(result[0].buffer.length, buffer.length)
                assert.equal(result[0].buffer.every(value => value === 255), true)
            }
        } finally {
            server.closeAllConnections()
            await new Promise(resolve => server.close(resolve))
        }
    }))
}
