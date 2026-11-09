import { test, expect, beforeEach, afterEach, vi, describe } from 'vitest'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import db from './db.js'
import dbHelpers from './db-helpers.js'
import { createRequire } from 'node:module'
// the instance db.js requires, which a vitest import would load a second time
const fileUtils = createRequire(import.meta.url)('./file-utils.js')
import { platformLocation, createDatabase } from '../shared/db.js'
import { createDbHelpers } from '../shared/db-helpers.js'
import { hashText, itemFileVersion } from '../shared/helpers.js'

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

function writeEnvironmentFiles(files) {
    fs.writeFileSync(path.join(workspace.location, 'restfox.json'), '{}')
    const envsDirPath = path.join(workspace.location, '_environments')
    fs.mkdirSync(envsDirPath, { recursive: true })
    for (const [name, text] of Object.entries(files)) {
        fs.writeFileSync(path.join(envsDirPath, name), text)
    }
    return envsDirPath
}

test('saving environments leaves an environment file it cannot read and deletes a removed one', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Prod.json': conflict, 'Old.json': '{}', 'Old.meta.json': '{"color":"red"}' })
    await db.updateWorkspace(workspace, { environments: [{ name: 'Default', environment: { a: '1' } }] })
    expect(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8')).toBe(conflict)
    expect(fs.readdirSync(envsDirPath).sort()).toEqual(['Default.json', 'Prod.json'])
})

test('an environment named as a file it cannot read is not saved, and the others are', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Prod.json': conflict, 'Old.json': '{}' })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Default', environment: { a: '1' } }, { name: 'Prod', environment: { token: 'new' } }] })
    expect(result.error).toMatch(/^Not saved, as .+Prod\.json cannot be read: .+ is not valid JSON\. Nothing was deleted$/)
    expect(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8')).toBe(conflict)
    // the others are saved, and nothing deleted
    expect(fs.readdirSync(envsDirPath).sort()).toEqual(['Default.json', 'Old.json', 'Prod.json'])
    expect(JSON.parse(fs.readFileSync(path.join(envsDirPath, 'Default.json'), 'utf8'))).toEqual({ a: '1' })
})

test('a folder environment named as a file it cannot read fails without changing it', async() => {
    const { newCollectionId } = await db.createCollection(workspace, { _id: 'folder', _type: 'request_group', name: 'Folder', parentId: null })
    const envsDirPath = path.join(workspace.location, 'Folder', '_environments')
    fs.mkdirSync(envsDirPath, { recursive: true })
    fs.writeFileSync(path.join(envsDirPath, 'Prod.json'), conflict)
    const result = await db.updateCollection(workspace, newCollectionId, { environments: [{ name: 'Prod', environment: {} }] })
    expect(result.error).toMatch(/^Not saved, as .+Prod\.json cannot be read/)
    expect(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8')).toBe(conflict)
})

test('a location gets the platform separators and no trailing one, and a relative one stays relative', () => {
    expect(platformLocation('work/api/')).toBe(path.join('work', 'api'))
    expect(platformLocation(`${workspace.location.replaceAll('\\', '/')}/`)).toBe(workspace.location)
    expect(platformLocation(path.parse(workspace.location).root)).toBe(path.parse(workspace.location).root)
})

test('a save refusing an environment says nothing was deleted only when it held back a removal', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Prod.json': conflict, 'Stage.json': conflict })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: {} }] })
    expect(result.error).toMatch(/^Not saved, as .+Prod\.json cannot be read: .+ is not valid JSON$/)
    expect(fs.readdirSync(envsDirPath).sort()).toEqual(['Prod.json', 'Stage.json'])
})

test('an environments save on a restfox.json it cannot read returns its error and writes nothing', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Default.json': '{}' })
    fs.writeFileSync(path.join(workspace.location, 'restfox.json'), conflict)
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Default', environment: { a: '1' } }] })
    expect(result.error).toMatch(/^Not saved, as .+restfox\.json cannot be read: .+ is not valid JSON$/)
    expect(fs.readFileSync(path.join(envsDirPath, 'Default.json'), 'utf8')).toBe('{}')
    expect(fs.readFileSync(path.join(workspace.location, 'restfox.json'), 'utf8')).toBe(conflict)
})

test('an environment whose file cannot be written is reported', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Prod.json': '{"a":"old"}' })
    fs.chmodSync(path.join(envsDirPath, 'Prod.json'), 0o444)
    try {
        const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: { a: 'new' } }] })
        expect(result.error).toMatch(/^Not saved, as .+Prod\.json could not be written: /)
    } finally {
        fs.chmodSync(path.join(envsDirPath, 'Prod.json'), 0o644)
    }
})

test('an environment file that cannot be deleted is reported', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Default.json': '{}', 'Old.json': '{}' })
    // as for a file another program holds open
    vi.spyOn(fsPromises, 'unlink').mockRejectedValueOnce(Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }))
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Default', environment: {} }] })
    expect(result.error).toMatch(/^Not deleted, as .+Old\.json could not be removed: EBUSY/)
    expect(fs.existsSync(path.join(envsDirPath, 'Old.json'))).toBe(true)
})

test('an environment color whose file cannot be read is left as it is', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Prod.json': '{}', 'Prod.meta.json': conflict })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: { a: '1' }, color: '#ffffff' }] })
    expect(result.error).toMatch(/^Not saved, as .+Prod\.meta\.json cannot be read: /)
    expect(fs.readFileSync(path.join(envsDirPath, 'Prod.meta.json'), 'utf8')).toBe(conflict)
    expect(JSON.parse(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8'))).toEqual({ a: '1' })
})

const differsInCase = 'Not saved, as the environment name prod differs from Prod only in case, which Windows and macOS save as one file'

test('an environment whose name differs from a saved one only in case is not saved, on any system', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Prod.json': '{"a":"1"}' })
    // in either order, the one already saved under its name is kept
    for (const environments of [
        [{ name: 'Prod', environment: { a: '1' } }, { name: 'prod', environment: {} }],
        [{ name: 'prod', environment: {} }, { name: 'Prod', environment: { a: '1' } }],
    ]) {
        const result = await db.updateWorkspace(workspace, { environments })
        expect(result.error).toBe(differsInCase)
        expect(fs.readdirSync(envsDirPath)).toEqual(['Prod.json'])
        expect(JSON.parse(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8'))).toEqual({ a: '1' })
    }
})

test('two new environments whose names differ only in case keep the first one\'s variables, on any system', async() => {
    const envsDirPath = writeEnvironmentFiles({})
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: { a: '1' } }, { name: 'prod', environment: {} }] })
    expect(result.error).toBe(differsInCase)
    expect(fs.readdirSync(envsDirPath)).toEqual(['Prod.json'])
    expect(JSON.parse(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8'))).toEqual({ a: '1' })
})

test('an environment whose name differs only in case from a file it cannot read is not saved', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Prod.json': conflict })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'prod', environment: { a: '1' } }] })
    // a case-insensitive file system reads Prod.json as prod.json
    expect(result.error).toMatch(new RegExp(`^(Not saved, as .+prod\\.json cannot be read: .+|${differsInCase})$`))
    expect(fs.readdirSync(envsDirPath)).toEqual(['Prod.json'])
    expect(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8')).toBe(conflict)
})

test('a folder copied or imported with environments whose names differ only in case is made, and the refusal comes with it', async() => {
    const result = await db.createCollections(workspace, [{ _id: 'folder', _type: 'request_group', name: 'Folder', parentId: null, environments: [{ name: 'Prod', environment: { a: '1' } }, { name: 'prod', environment: { b: '2' } }] }])
    expect(result.error).toBeNull()
    expect(result.results[0].environmentsError).toBe(`Folder: ${differsInCase}`)
    expect(fs.readdirSync(path.join(workspace.location, 'Folder', '_environments'))).toEqual(['Prod.json'])
})

test('an environment saved under a name ending in .META goes on being saved, and a new one is not', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Foo.META.json': '{"a":"1"}', 'Old.json': '{}' })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Foo.META', environment: { a: '2' } }] })
    expect(result.error).toBeNull()
    expect(fs.readdirSync(envsDirPath)).toEqual(['Foo.META.json'])
    expect(JSON.parse(fs.readFileSync(path.join(envsDirPath, 'Foo.META.json'), 'utf8'))).toEqual({ a: '2' })
    const added = await db.updateWorkspace(workspace, { environments: [{ name: 'Foo.META', environment: { a: '2' } }, { name: 'Bar.Meta', environment: {} }] })
    expect(added.error).toBe('Not saved, as the environment name Bar.Meta ends in .meta, which environment colors are saved under')
    expect(fs.readdirSync(envsDirPath)).toEqual(['Foo.META.json'])
})

test('an environment saved under a name ending in .META keeps its variables when the environment it names gets a color', async() => {
    for (const environments of [
        [{ name: 'Foo.META', environment: { token: 'secret' } }, { name: 'Foo', environment: {}, color: 'blue' }],
        [{ name: 'Foo', environment: {}, color: 'blue' }, { name: 'Foo.META', environment: { token: 'secret' } }],
    ]) {
        const envsDirPath = writeEnvironmentFiles({ 'Foo.META.json': '{"token":"secret"}' })
        const result = await db.updateWorkspace(workspace, { environments })
        expect(result.error).toBe('Not saved, as the color of the environment Foo would go in the file of the environment Foo.META, which Windows and macOS save as one file')
        expect(JSON.parse(fs.readFileSync(path.join(envsDirPath, 'Foo.META.json'), 'utf8'))).toEqual({ token: 'secret' })
        fs.rmSync(envsDirPath, { recursive: true })
    }
})

test('both of a pair whose names differ only in case, saved on a case-sensitive system, go on being saved', async(context) => {
    const envsDirPath = writeEnvironmentFiles({ 'Prod.json': '{"a":"1"}', 'prod.json': '{"b":"2"}' })
    // a case-insensitive file system holds them as one file
    if (fs.readdirSync(envsDirPath).length < 2) {
        context.skip()
    }
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: { a: '1' } }, { name: 'prod', environment: { b: '3' } }] })
    expect(result.error).toBeNull()
    expect(fs.readdirSync(envsDirPath).sort()).toEqual(['Prod.json', 'prod.json'])
    expect(JSON.parse(fs.readFileSync(path.join(envsDirPath, 'prod.json'), 'utf8'))).toEqual({ b: '3' })
})

test('an environment named as another one\'s color file is not saved over it', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Prod.json': '{}', 'Prod.meta.json': '{"color":"red"}', 'Old.json': '{}' })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: {}, color: 'red' }, { name: 'Prod.meta', environment: { a: '1' } }] })
    expect(result.error).toBe('Not saved, as the environment name Prod.meta ends in .meta, which environment colors are saved under. Nothing was deleted')
    expect(JSON.parse(fs.readFileSync(path.join(envsDirPath, 'Prod.meta.json'), 'utf8'))).toEqual({ color: 'red' })
    expect(fs.readdirSync(envsDirPath).sort()).toEqual(['Old.json', 'Prod.json', 'Prod.meta.json'])
})

test('renaming an environment keeps its color file when it cannot be read', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Old.json': '{}', 'Old.meta.json': conflict })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'New', environment: {} }] })
    expect(result.error).toBeNull()
    expect(fs.readdirSync(envsDirPath).sort()).toEqual(['New.json', 'Old.meta.json'])
    expect(fs.readFileSync(path.join(envsDirPath, 'Old.meta.json'), 'utf8')).toBe(conflict)
})

test('renaming an environment to the name of a file it cannot read keeps both files', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Prod.json': conflict, 'Old.json': '{"a":"1"}' })
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: { a: '1' } }] })
    expect(result.error).toMatch(/^Not saved, as .+Prod\.json cannot be read: .+\. Nothing was deleted$/)
    expect(fs.readFileSync(path.join(envsDirPath, 'Prod.json'), 'utf8')).toBe(conflict)
    expect(fs.readdirSync(envsDirPath).sort()).toEqual(['Old.json', 'Prod.json'])
    expect(fs.readFileSync(path.join(envsDirPath, 'Old.json'), 'utf8')).toBe('{"a":"1"}')
})

test('a file beside the environments that is not one, such as a backup, is neither loaded nor deleted', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Prod.json': '{"a":"1"}', 'Prod.json.bak': '{"a":"0"}' })
    expect((await db.getWorkspaceAtLocation(workspace.location, true)).environments.map(environment => environment.name)).toEqual(['Prod'])
    const result = await db.updateWorkspace(workspace, { environments: [{ name: 'Prod', environment: { a: '2' } }] })
    expect(result.error).toBeNull()
    expect(fs.readdirSync(envsDirPath).sort()).toEqual(['Prod.json', 'Prod.json.bak'])
})

test('an environment whose name holds .json loads under its own name and keeps its color', async() => {
    const envsDirPath = writeEnvironmentFiles({ 'Prod.json.backup.json': '{"a":"1"}', 'Prod.json.backup.meta.json': '{"color":"red"}', 'Prod.backup.json': '{"a":"2"}' })
    const { environments } = await db.getWorkspaceAtLocation(workspace.location, true)
    expect(environments.map(environment => [environment.name, environment.environment.a, environment.color]).sort()).toEqual([['Prod.backup', '2', undefined], ['Prod.json.backup', '1', 'red']])
    expect((await db.updateWorkspace(workspace, { environments })).error).toBeNull()
    expect(fs.readdirSync(envsDirPath).sort()).toEqual(['Prod.backup.json', 'Prod.json.backup.json', 'Prod.json.backup.meta.json'])
})

test('loading keeps the saved environment pick when the picked environment cannot be read', async() => {
    writeEnvironmentFiles({ 'Default.json': '{}', 'Prod.json': conflict })
    fs.writeFileSync(path.join(workspace.location, 'restfox.json'), '{"version":1,"name":"W","currentEnvironment":"Prod"}')
    const { newCollectionId } = await db.createCollection(workspace, { _id: 'folder', _type: 'request_group', name: 'Folder', parentId: null })
    const folderEnvsDirPath = path.join(workspace.location, 'Folder', '_environments')
    fs.mkdirSync(folderEnvsDirPath, { recursive: true })
    fs.writeFileSync(path.join(folderEnvsDirPath, 'Default.json'), '{}')
    fs.writeFileSync(path.join(folderEnvsDirPath, 'Prod.json'), conflict)
    fs.writeFileSync(path.join(workspace.location, 'Folder', '_.json'), '{"currentEnvironment":"Prod"}')

    // the first environment stands in until the file is fixed
    expect((await db.getWorkspaceAtLocation(workspace.location, true)).currentEnvironment).toBe('Default')
    expect((await dbHelpers.getCollection(new Map(), workspace)).find(item => item._id === newCollectionId).currentEnvironment).toBe('Default')
    expect(fs.readFileSync(path.join(workspace.location, 'restfox.json'), 'utf8')).toBe('{"version":1,"name":"W","currentEnvironment":"Prod"}')
    expect(fs.readFileSync(path.join(workspace.location, 'Folder', '_.json'), 'utf8')).toBe('{"currentEnvironment":"Prod"}')
})

test('a location typed with forward slashes or a trailing separator gives the same ids as the platform form', async() => {
    const typedWorkspace = { ...workspace, location: `${workspace.location.replaceAll('\\', '/')}/` }
    const folder = await db.createCollection(typedWorkspace, { _id: 'folder', _type: 'request_group', name: 'Folder', parentId: null })
    const request = await db.createCollection(typedWorkspace, { _id: 'request', _type: 'request', name: 'Get', parentId: folder.newCollectionId, url: '', method: 'GET', body: { mimeType: 'No Body' } })
    expect([folder.newCollectionId, request.newCollectionId]).toEqual(['/Folder', '/Folder/Get.json'])
    // the platform form reaches the same item
    expect(await db.getCollectionById(workspace, request.newCollectionId)).toMatchObject({ name: 'Get' })
    // deleting reads the id map from the location alone
    await db.deleteCollectionsByIds(typedWorkspace, [request.newCollectionId])
    expect(fs.existsSync(path.join(workspace.location, 'Folder', 'Get.json'))).toBe(false)
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

    const collection = await dbHelpers.getCollection(new Map(), workspace)

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
    expect(await dbHelpers.getCollection(new Map(), workspace)).toEqual([{ ...newer, _id: result.newCollectionId }])

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

    const collection = await dbHelpers.getCollection(new Map(), workspace)
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

function requestItem(name = 'Item') {
    return { _id: 'new', _type: 'request', name, parentId: null, workspaceId: workspace._id, method: 'GET', url: 'https://api.example/a', body: { mimeType: 'No Body' } }
}

// a workspace the loader accepts, with one request whose id, a path in the workspace, is returned
async function workspaceWithItem(item = requestItem()) {
    fs.writeFileSync(path.join(workspace.location, 'restfox.json'), JSON.stringify({ version: 1, name: 'W' }))
    const created = await db.createCollection(workspace, item)
    return { id: created.newCollectionId, version: created.version }
}

function fileVersion(name) {
    return itemFileVersion(fs.readFileSync(path.join(workspace.location, name), 'utf8'))
}

test('a whole item save made from the version on disk goes through and gives the new version', async() => {
    const { id, version } = await workspaceWithItem()
    expect(version).toBe(fileVersion('Item.json'))
    const loaded = await db.getCollectionForWorkspace(workspace, null)
    expect(loaded.versions).toEqual({ [id]: version })

    const result = await db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/b' }, version)

    expect(result).toEqual({ error: null, version: fileVersion('Item.json') })
    expect(readJson('Item.json').url).toBe('https://api.example/b')
})

test('a whole item save is refused when the file changed outside Restfox since its version, or the screen has none', async() => {
    const { id, version } = await workspaceWithItem()
    await db.getCollectionForWorkspace(workspace, null)
    const outside = JSON.stringify({ ...readJson('Item.json'), url: 'https://api.example/outside' }, null, 4)
    fs.writeFileSync(path.join(workspace.location, 'Item.json'), outside)

    for (const staleVersion of [version, null]) {
        const result = await db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/typed' }, staleVersion)
        expect(result.changedOutside).toBe(true)
        expect(fs.readFileSync(path.join(workspace.location, 'Item.json'), 'utf8')).toBe(outside)
    }

    // a page from before versions sends none and is not checked
    await db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/old-page' })
    expect(readJson('Item.json').url).toBe('https://api.example/old-page')
})

test('a refused socket save leaves its messages file alone, and a file deleted outside refuses a save', async() => {
    const { id, version } = await workspaceWithItem({ _id: 'new', _type: 'socket', name: 'Chat', parentId: null, workspaceId: workspace._id, clients: [{ id: 'c1', messages: [{ text: 'kept' }] }] })
    await db.getCollectionForWorkspace(workspace, null)
    const messagesPath = path.join(workspace.location, 'Chat.messages.json')
    const messagesBefore = fs.readFileSync(messagesPath, 'utf8')
    fs.writeFileSync(path.join(workspace.location, 'Chat.json'), JSON.stringify({ _type: 'socket', clients: [{ id: 'c1' }], outside: true }))

    const result = await db.updateCollection(workspace, id, { _type: 'socket', clients: [{ id: 'c1', messages: [{ text: 'typed' }] }] }, version)

    expect(result.changedOutside).toBe(true)
    expect(fs.readFileSync(messagesPath, 'utf8')).toBe(messagesBefore)

    fs.rmSync(path.join(workspace.location, 'Chat.json'))
    expect((await db.updateCollection(workspace, id, { _type: 'socket', clients: [] }, version)).changedOutside).toBe(true)
    expect(fs.existsSync(path.join(workspace.location, 'Chat.json'))).toBe(false)
})

test('a merge of one field keeps a change made outside Restfox and gives the versions before and after it', async() => {
    const { id } = await workspaceWithItem()
    await db.getCollectionForWorkspace(workspace, null)
    fs.writeFileSync(path.join(workspace.location, 'Item.json'), JSON.stringify({ ...readJson('Item.json'), url: 'https://api.example/outside' }, null, 4))
    const versionBefore = fileVersion('Item.json')

    const result = await db.updateCollection(workspace, id, { sortOrder: 3 })

    expect(result).toEqual({ error: null, versionBefore, version: fileVersion('Item.json') })
    expect(readJson('Item.json')).toMatchObject({ url: 'https://api.example/outside', sortOrder: 3 })
})

test('the version leaves out the sort order, which a whole save keeps as the file has it, so a sidebar change from another window refuses no save', async() => {
    const { id, version } = await workspaceWithItem()
    await db.getCollectionForWorkspace(workspace, null)
    // another window dragged the item
    const merged = await db.updateCollection(workspace, id, { sortOrder: 4 })
    expect(merged.versionBefore).toBe(version)
    expect(merged.version).toBe(version)

    const saved = await db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/typed', sortOrder: 1 }, version)

    expect(saved).toEqual({ error: null, version: fileVersion('Item.json') })
    expect(readJson('Item.json')).toMatchObject({ url: 'https://api.example/typed', sortOrder: 4 })
})

test('a merge into an item file deleted outside Restfox is refused rather than making the file again', async() => {
    const { id } = await workspaceWithItem()
    await db.getCollectionForWorkspace(workspace, null)
    fs.rmSync(path.join(workspace.location, 'Item.json'))

    const result = await db.updateCollection(workspace, id, { sortOrder: 3 })

    expect(result.changedOutside).toBe(true)
    expect(fs.existsSync(path.join(workspace.location, 'Item.json'))).toBe(false)
})

test('a save whose write fails partway, such as on a full disk, leaves the file as it was', async() => {
    const { id, version } = await workspaceWithItem()
    await db.getCollectionForWorkspace(workspace, null)
    const itemPath = path.join(workspace.location, 'Item.json')
    const textBefore = fs.readFileSync(itemPath, 'utf8')
    const writeFile = fsPromises.writeFile
    vi.spyOn(fsPromises, 'writeFile').mockImplementationOnce(async(target, text) => {
        await writeFile(target, String(text).slice(0, 10))
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    })

    await expect(db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/typed' }, version)).rejects.toThrow('ENOSPC')

    expect(fs.readFileSync(itemPath, 'utf8')).toBe(textBefore)
    expect(fs.readdirSync(workspace.location).filter(name => name.endsWith('.tmp'))).toEqual([])
    // the next save goes through, as the file still has the version the page holds
    expect((await db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/typed' }, version)).error).toBe(null)
})

test('a save keeps the file\'s permissions, and writes in place where the file beside it cannot be made or the file is another user\'s', async() => {
    const { id, version } = await workspaceWithItem()
    await db.getCollectionForWorkspace(workspace, null)
    const itemPath = path.join(workspace.location, 'Item.json')
    const save = async(url, from) => (await db.updateCollection(workspace, id, { ...requestItem(), url }, from)).version

    const chmod = vi.spyOn(fsPromises, 'chmod')
    let current = await save('https://api.example/mode', version)
    expect(chmod).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), fs.statSync(itemPath).mode & 0o7777)

    // a folder this process may not create files in
    const writeFile = fsPromises.writeFile
    vi.spyOn(fsPromises, 'writeFile').mockImplementationOnce(async() => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    }).mockImplementation(writeFile)
    current = await save('https://api.example/folder-not-writable', current)
    expect(readJson('Item.json').url).toBe('https://api.example/folder-not-writable')

    // a file system that cannot set permissions
    chmod.mockRejectedValueOnce(Object.assign(new Error('ENOSYS: function not implemented'), { code: 'ENOSYS' }))
    current = await save('https://api.example/no-chmod', current)
    expect(readJson('Item.json').url).toBe('https://api.example/no-chmod')
    expect(fs.readdirSync(workspace.location).filter(name => name.endsWith('.tmp'))).toEqual([])

    // a file another user or group owns
    const rename = vi.spyOn(fsPromises, 'rename')
    const { getuid, getgid } = process
    try {
        for (const [owner, ids] of [['user', { uid: 1, gid: 0 }], ['group', { uid: 0, gid: 1 }]]) {
            process.getuid = () => fs.statSync(itemPath).uid + ids.uid
            process.getgid = () => fs.statSync(itemPath).gid + ids.gid
            current = await save(`https://api.example/other-${owner}`, current)
            expect(readJson('Item.json').url).toBe(`https://api.example/other-${owner}`)
        }
    } finally {
        process.getuid = getuid
        process.getgid = getgid
    }
    expect(rename).not.toHaveBeenCalled()

    // a file with another hard link, which goes on showing the same text
    const linkPath = path.join(workspace.location, 'linked-copy.txt')
    fs.linkSync(itemPath, linkPath)
    await save('https://api.example/hard-linked', current)
    expect(JSON.parse(fs.readFileSync(linkPath, 'utf8')).url).toBe('https://api.example/hard-linked')
    expect(rename).not.toHaveBeenCalled()
})

test('a save to a request file that is a link replaces the file it points to, which a write failing partway leaves as it was', async(context) => {
    const { id, version } = await workspaceWithItem()
    const itemPath = path.join(workspace.location, 'Item.json')
    const targetPath = path.join(workspace.location, 'linked', 'Item.json')
    fs.mkdirSync(path.dirname(targetPath))
    fs.renameSync(itemPath, targetPath)
    try {
        fs.symlinkSync(targetPath, itemPath, 'file')
    } catch {
        // Windows makes links only with developer mode or as an administrator
        context.skip()
    }
    await db.getCollectionForWorkspace(workspace, null)
    const textBefore = fs.readFileSync(targetPath, 'utf8')
    const writeFile = fsPromises.writeFile
    vi.spyOn(fsPromises, 'writeFile').mockImplementationOnce(async(target, text) => {
        await writeFile(target, String(text).slice(0, 10))
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    })

    await expect(db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/typed' }, version)).rejects.toThrow('ENOSPC')
    expect(fs.readFileSync(targetPath, 'utf8')).toBe(textBefore)

    await db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/typed' }, version)
    expect(fs.lstatSync(itemPath).isSymbolicLink()).toBe(true)
    expect(JSON.parse(fs.readFileSync(targetPath, 'utf8')).url).toBe('https://api.example/typed')
})

test('a move into a folder from a page whose ids came from before the server started reaches the folder', async() => {
    fs.writeFileSync(path.join(workspace.location, 'restfox.json'), JSON.stringify({ version: 1, name: 'W' }))
    const folder = await db.createCollection(workspace, { _id: 'f', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: workspace._id })
    const { id } = await workspaceWithItem()
    await db.getCollectionForWorkspace(workspace, null)
    const restarted = createDatabase(fileUtils, dbHelpers, createRequire(import.meta.url)('dotenv'))

    expect((await restarted.updateCollection(workspace, id, { parentId: folder.newCollectionId })).error).toBe(null)
    expect(fs.existsSync(path.join(workspace.location, 'Folder', 'Item.json'))).toBe(true)
    expect((await restarted.updateCollection(workspace, '/Folder/Item.json', { parentId: '/Gone' })).changedOutside).toBe(true)
})

test('a scan whose read fails leaves the ids the page holds reaching their files, renamed ones included', async() => {
    const { id, version } = await workspaceWithItem()
    await db.getCollectionForWorkspace(workspace, null)
    await db.updateCollection(workspace, id, { name: 'Renamed' })
    // the instance db.js requires
    const requiredDbHelpers = createRequire(import.meta.url)('./db-helpers.js')
    vi.spyOn(requiredDbHelpers, 'getCollection').mockRejectedValueOnce(Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }))

    const failed = await db.getCollectionForWorkspace(workspace, null)
    expect(failed.error.message).toBe('EIO: i/o error')

    const saved = await db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/after-failed-scan' }, version)
    expect(saved.error).toBe(null)
    expect(readJson('Renamed.json').url).toBe('https://api.example/after-failed-scan')

    // and one that fails before it reads, as the workspace is checked
    vi.spyOn(requiredDbHelpers, 'ensureRestfoxCollection').mockRejectedValueOnce(Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }))
    expect((await db.getCollectionForWorkspace(workspace, null)).error.message).toBe('EIO: i/o error')
    const savedAgain = await db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/after-failed-check' }, saved.version)
    expect(savedAgain.error).toBe(null)
})

test('a save from a page whose ids came from before the server started reaches the file, still checked against its version', async() => {
    const { id, version } = await workspaceWithItem()
    await db.getCollectionForWorkspace(workspace, null)
    // a server started again, which has scanned nothing yet
    const restarted = createDatabase(fileUtils, dbHelpers, createRequire(import.meta.url)('dotenv'))

    expect((await restarted.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/after-restart' }, version)).error).toBe(null)
    expect(readJson('Item.json').url).toBe('https://api.example/after-restart')
    expect((await restarted.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/stale' }, version)).changedOutside).toBe(true)
    // an id that is not a path inside the workspace reaches nothing, even where a file is
    const outsideName = `${path.basename(workspace.location)}-outside.json`
    const outsidePath = path.join(workspace.location, '..', outsideName)
    fs.writeFileSync(outsidePath, fs.readFileSync(path.join(workspace.location, 'Item.json')))
    try {
        const outsideVersion = itemFileVersion(fs.readFileSync(outsidePath, 'utf8'))
        expect((await restarted.updateCollection(workspace, `/../${outsideName}`, { ...requestItem(), url: 'https://api.example/escaped' }, outsideVersion)).changedOutside).toBe(true)
        expect(JSON.parse(fs.readFileSync(outsidePath, 'utf8')).url).not.toBe('https://api.example/escaped')
    } finally {
        fs.rmSync(outsidePath, { force: true })
    }
})

test('moving a socket into a folder takes its messages along', async() => {
    fs.writeFileSync(path.join(workspace.location, 'restfox.json'), JSON.stringify({ version: 1, name: 'W' }))
    const folder = await db.createCollection(workspace, { _id: 'f', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: workspace._id })
    const socket = await db.createCollection(workspace, { _id: 's', _type: 'socket', name: 'Chat', parentId: null, workspaceId: workspace._id, clients: [{ id: 'c1', messages: [{ text: 'kept' }] }] })

    await db.updateCollection(workspace, socket.newCollectionId, { parentId: folder.newCollectionId })

    expect(fs.existsSync(path.join(workspace.location, 'Chat.messages.json'))).toBe(false)
    expect(readJson('Folder/Chat.messages.json')).toEqual({ c1: [{ text: 'kept' }] })
})

test('a sort order update writes in place, as it reaches every sibling, and is still known as Restfox\'s own, while other one-field updates replace the file', async() => {
    const { id } = await workspaceWithItem()
    await db.getCollectionForWorkspace(workspace, null)
    const itemPath = path.join(workspace.location, 'Item.json')
    const rename = vi.spyOn(fsPromises, 'rename')

    await db.updateCollection(workspace, id, { sortOrder: 3 })
    expect(rename).not.toHaveBeenCalled()
    expect(readJson('Item.json').sortOrder).toBe(3)
    expect(fileUtils.ownWrites.get(itemPath)).toMatchObject({ kind: 'file', hash: hashText(fs.readFileSync(itemPath, 'utf8')) })

    await db.updateCollection(workspace, id, { headers: [{ name: 'X', value: '1' }] })
    expect(rename).toHaveBeenCalledOnce()
    expect(readJson('Item.json')).toMatchObject({ sortOrder: 3, headers: [{ name: 'X', value: '1' }] })
})

test('opening a workspace writes neither its settings nor a folder\'s when an environment has to stand in for the pick', async() => {
    const config = path.join(workspace.location, 'restfox.json')
    fs.writeFileSync(config, JSON.stringify({ version: 1, name: 'W' }))
    fs.mkdirSync(path.join(workspace.location, 'Folder'))
    const folderConfig = path.join(workspace.location, 'Folder', '_.json')
    fs.writeFileSync(folderConfig, JSON.stringify({ sortOrder: 0, currentEnvironment: 'Gone' }))
    const before = [fs.readFileSync(config, 'utf8'), fs.readFileSync(folderConfig, 'utf8')]

    const loaded = await db.getCollectionForWorkspace(workspace, null)

    expect([fs.readFileSync(config, 'utf8'), fs.readFileSync(folderConfig, 'utf8')]).toEqual(before)
    expect(loaded.workspace.currentEnvironment).toBe('Default')
    expect(loaded.collection.find(item => item.name === 'Folder').currentEnvironment).toBe('Default')
})

test('a save of environments is checked against the version of the whole set, before anything is written or deleted', async() => {
    await workspaceWithItem()
    const envs = path.join(workspace.location, '_environments')
    const first = await db.updateWorkspace(workspace, { environments: [{ name: 'Default', environment: { token: 'page' } }] })
    const loaded = await db.getCollectionForWorkspace(workspace, null)
    expect(first.version).toBe(loaded.environmentVersions[''])
    expect(loaded.workspace.environmentsVersion).toBe(undefined)
    const page = loaded.workspace.environments

    const saved = await db.updateWorkspace(workspace, { environments: [{ name: 'Default', environment: { token: 'typed' } }] }, first.version)
    expect(saved.error).toBe(null)
    expect(saved.version).not.toBe(first.version)
    expect(JSON.parse(fs.readFileSync(path.join(envs, 'Default.json'), 'utf8')).token).toBe('typed')

    // changed outside and added outside
    fs.writeFileSync(path.join(envs, 'Default.json'), JSON.stringify({ token: 'outside' }))
    fs.writeFileSync(path.join(envs, 'Staging.json'), JSON.stringify({ added: 'outside' }))
    const refused = await db.updateWorkspace(workspace, { environments: page }, saved.version)
    expect(refused.changedOutside).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(envs, 'Default.json'), 'utf8')).token).toBe('outside')
    expect(fs.existsSync(path.join(envs, 'Staging.json'))).toBe(true)

    // a page from before versions sends none and is not checked
    await db.updateWorkspace(workspace, { environments: page })
    expect(fs.existsSync(path.join(envs, 'Staging.json'))).toBe(false)
})

test('a load\'s version of a set is of the texts it read, so a change landing during the load is refused', async() => {
    fs.writeFileSync(path.join(workspace.location, 'restfox.json'), JSON.stringify({ version: 1, name: 'W' }))
    const file = path.join(workspace.location, '_environments', 'Default.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ token: 'old' }))
    const realRead = fsPromises.readFile.bind(fsPromises)
    let changed = false
    const spy = vi.spyOn(fsPromises, 'readFile').mockImplementation(async(target, ...rest) => {
        const text = await realRead(target, ...rest)
        if (!changed && String(target) === file) {
            changed = true
            fs.writeFileSync(file, JSON.stringify({ token: 'outside' }))
        }
        return text
    })
    const loaded = await db.getCollectionForWorkspace(workspace, null)
    spy.mockRestore()

    const refused = await db.updateWorkspace(workspace, { environments: [{ name: 'Default', environment: { token: 'stale' } }] }, loaded.environmentVersions[''])
    expect(refused.changedOutside).toBe(true)
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ token: 'outside' })
})

test('a save\'s version is of what it wrote, so a file added outside during the save is not taken as seen', async() => {
    const dir = path.join(workspace.location, 'Folder', '_environments')
    fs.mkdirSync(dir, { recursive: true })
    const added = path.join(dir, 'Staging.json')
    let wrote = false
    const helpers = createDbHelpers({
        ...fileUtils,
        writeFileJson: async(...args) => {
            const text = await fileUtils.writeFileJson(...args)
            if (!wrote) {
                wrote = true
                fs.writeFileSync(added, '{}')
            }
            return text
        },
    }, value => value)

    const first = await helpers.saveEnvironments(dir, [{ name: 'Default', environment: { a: '1' } }])
    const next = await helpers.saveEnvironments(dir, [{ name: 'Default', environment: { a: '2' } }], first.version)

    expect(next.changedOutside).toBe(true)
    expect(fs.existsSync(added)).toBe(true)
})

test('a save\'s version is the one a load then reads, with colors written and environments and colors deleted', async() => {
    fs.writeFileSync(path.join(workspace.location, 'restfox.json'), JSON.stringify({ version: 1, name: 'W' }))
    const save = environments => db.updateWorkspace(workspace, { environments })
    const loadedVersion = async() => (await db.getCollectionForWorkspace(workspace, null)).environmentVersions['']

    const both = await save([{ name: 'A', color: '#111', environment: { a: '1' } }, { name: 'B', color: '#222', environment: { b: '1' } }])
    expect(both.version).toBe(await loadedVersion())
    const one = await save([{ name: 'A', color: '#111', environment: { a: '1' } }])
    expect(one.version).toBe(await loadedVersion())
})

test('a new folder\'s set has the version a load reads, with and without environments', async() => {
    fs.writeFileSync(path.join(workspace.location, 'restfox.json'), JSON.stringify({ version: 1, name: 'W' }))
    const empty = await db.createCollection(workspace, { _id: 'a', _type: 'request_group', name: 'Empty', parentId: null, workspaceId: workspace._id, sortOrder: 0 })
    const filled = await db.createCollection(workspace, { _id: 'b', _type: 'request_group', name: 'Filled', parentId: null, workspaceId: workspace._id, environments: [{ name: 'Default', environment: { a: '1' } }], currentEnvironment: 'Default' })
    const loaded = await db.getCollectionForWorkspace(workspace, null)

    expect(empty.environmentsVersion).toBe(loaded.environmentVersions[empty.newCollectionId])
    expect(filled.environmentsVersion).toBe(loaded.environmentVersions[filled.newCollectionId])
    expect(empty.environmentsVersion).not.toBe(filled.environmentsVersion)
})

test('a folder\'s environments are checked the same way', async() => {
    await workspaceWithItem()
    const folder = await db.createCollection(workspace, { _id: 'f', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: workspace._id })
    fs.writeFileSync(path.join(workspace.location, 'Folder', '_.json'), '{}')
    const loaded = await db.getCollectionForWorkspace(workspace, null)
    const version = loaded.environmentVersions[folder.newCollectionId]
    expect(version).toEqual(expect.any(String))
    const saved = await db.updateCollection(workspace, folder.newCollectionId, { environments: [{ name: 'Default', environment: { a: 1 } }] }, version)
    expect(saved.error).toBe(null)
    fs.writeFileSync(path.join(workspace.location, 'Folder', '_environments', 'Default.json'), JSON.stringify({ a: 'outside' }))
    expect((await db.updateCollection(workspace, folder.newCollectionId, { environments: [{ name: 'Default', environment: { a: 2 } }] }, saved.version)).changedOutside).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(workspace.location, 'Folder', '_environments', 'Default.json'), 'utf8')).a).toBe('outside')
})

test('a folder duplicated or imported keeps its headers and auth', async() => {
    fs.writeFileSync(path.join(workspace.location, 'restfox.json'), JSON.stringify({ version: 1, name: 'W' }))
    const headers = [{ name: 'X-Folder', value: '1' }]
    const authentication = { type: 'bearer', token: 't' }
    const { results } = await db.createCollections(workspace, [{ _id: 'f', _type: 'request_group', name: 'Copy', parentId: null, workspaceId: workspace._id, headers, authentication }])

    const loaded = await db.getCollectionForWorkspace(workspace, null)
    const folder = loaded.collection.find(item => item.name === 'Copy')
    expect(folder.headers).toEqual(headers)
    expect(folder.authentication).toEqual(authentication)
    expect(results[0].version).toBe(loaded.versions[folder._id])
})

test('a script saved with no base, as it was typed before the page knew of it, is refused', async() => {
    const { id } = await workspaceWithItem()
    const code = { pre_request: 'file', post_request: '' }
    await db.createPlugin(workspace, { _id: 'p1', type: 'script', name: null, code, collectionId: id, enabled: true })
    await db.getCollectionForWorkspace(workspace, null)

    expect((await db.updatePlugin(workspace, id, 'p1', { code: { pre_request: 'typed', post_request: '' } }, null)).changedOutside).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(workspace.location, 'Item.plugins.json'), 'utf8'))[0].code).toEqual(code)
})

test('a script\'s save reaches a request after the server restarted, and is refused for an id it cannot find', async() => {
    const { id } = await workspaceWithItem()
    const code = { pre_request: 'file', post_request: '' }
    await db.createPlugin(workspace, { _id: 'p1', type: 'script', name: null, code, collectionId: id, enabled: true })
    await db.getCollectionForWorkspace(workspace, null)
    const restarted = createDatabase(fileUtils, dbHelpers, createRequire(import.meta.url)('dotenv'))
    const typed = { pre_request: 'typed', post_request: '' }

    expect((await restarted.updatePlugin(workspace, id, 'p1', { code: typed }, code))?.changedOutside).toBeFalsy()
    expect(JSON.parse(fs.readFileSync(path.join(workspace.location, 'Item.plugins.json'), 'utf8'))[0].code).toEqual(typed)
    expect((await restarted.updatePlugin(workspace, '/Gone.json', 'p1', { code: typed }, typed)).changedOutside).toBe(true)

    const pluginsFile = path.join(workspace.location, 'Item.plugins.json')
    const restartedOnce = () => createDatabase(fileUtils, dbHelpers, createRequire(import.meta.url)('dotenv'))
    await restartedOnce().createPlugin(workspace, { _id: 'p2', type: 'script', name: null, code, collectionId: id, enabled: true })
    expect(JSON.parse(fs.readFileSync(pluginsFile, 'utf8')).map(plugin => plugin._id)).toEqual(['p1', 'p2'])
    await restartedOnce().deletePlugin(workspace, id, 'p2')
    expect(JSON.parse(fs.readFileSync(pluginsFile, 'utf8')).map(plugin => plugin._id)).toEqual(['p1'])
})

test('a folder\'s headers and auth are checked against their version, which a pick, a sort order or a collapse leaves alone', async() => {
    const { id: requestId } = await workspaceWithItem()
    const folder = await db.createCollection(workspace, { _id: 'f', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: workspace._id })
    expect(folder.version).toEqual(expect.any(String))
    const file = path.join(workspace.location, 'Folder', '_.json')
    fs.writeFileSync(file, '{}')
    const id = folder.newCollectionId
    const loaded = await db.getCollectionForWorkspace(workspace, null)
    const version = loaded.versions[id]
    expect(version).toBe(folder.version)
    const merge = async(fields, from) => db.updateCollection(workspace, id, fields, from)

    expect((await merge({ currentEnvironment: 'Other' })).version).toBe(version)
    expect((await merge({ sortOrder: 3 })).version).toBe(version)
    const saved = await merge({ headers: [{ name: 'X', value: '1' }] }, version)
    expect(saved.error).toBe(null)
    expect(saved.versionBefore).toBe(version)
    expect(saved.version).not.toBe(version)

    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), authentication: { type: 'outside' } }))
    const refused = await merge({ headers: [{ name: 'X', value: 'stale' }] }, saved.version)
    expect(refused.changedOutside).toBe(true)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).headers[0].value).toBe('1')
    // sent without a version, by what is not an edit of them, they go through
    expect((await merge({ headers: [{ name: 'X', value: 'unchecked' }] })).error).toBe(null)
    // a request's file has no folder settings to compare
    expect((await db.updateCollection(workspace, requestId, { sortOrder: 9 }, 'not a folder version')).error).toBe(null)
})

test('OAuth 2.0 tokens are set into the auth a request or folder file has now', async() => {
    const oauth = { type: 'oauth2', grantType: 'client_credentials', clientId: 'id', token: 'old', refreshToken: 'old-refresh' }
    const { id: requestId, version } = await workspaceWithItem({ ...requestItem(), authentication: oauth })
    const folder = await db.createCollection(workspace, { _id: 'f', _type: 'request_group', name: 'Folder', parentId: null, workspaceId: workspace._id, authentication: oauth })
    const folderFile = path.join(workspace.location, 'Folder', '_.json')
    const loaded = await db.getCollectionForWorkspace(workspace, null)
    const save = (id, oauthTokens) => db.updateCollection(workspace, id, { oauthTokens })

    // an edit of the auth saved meanwhile, here outside Restfox, is kept
    const requestFile = path.join(workspace.location, 'Item.json')
    fs.writeFileSync(requestFile, JSON.stringify({ ...readJson('Item.json'), authentication: { ...oauth, scope: 'edited' } }))
    const editedVersion = fileVersion('Item.json')
    const saved = await save(requestId, { token: 'new', refreshToken: 'new-refresh' })
    expect(saved).toEqual({ error: null, versionBefore: editedVersion, version: fileVersion('Item.json') })
    expect(editedVersion).not.toBe(version)
    expect(readJson('Item.json').authentication).toEqual({ ...oauth, scope: 'edited', token: 'new', refreshToken: 'new-refresh' })
    // a reply without a refresh token: null removes it, left out it stays
    await save(requestId, { token: 'newer', refreshToken: null })
    expect(readJson('Item.json').authentication).toEqual({ ...oauth, scope: 'edited', token: 'newer', refreshToken: undefined })
    expect('refreshToken' in readJson('Item.json').authentication).toBe(false)

    const folderSaved = await save(folder.newCollectionId, { token: 'folder-token' })
    expect(folderSaved.versionBefore).toBe(loaded.versions[folder.newCollectionId])
    expect(folderSaved.version).not.toBe(folderSaved.versionBefore)
    expect(JSON.parse(fs.readFileSync(folderFile, 'utf8')).authentication).toEqual({ ...oauth, token: 'folder-token' })

    // an auth changed to another type since the click takes nothing
    fs.writeFileSync(requestFile, JSON.stringify({ ...readJson('Item.json'), authentication: { type: 'bearer', token: 'typed' } }))
    const before = fs.readFileSync(requestFile, 'utf8')
    expect(await save(requestId, { token: 'late' })).toEqual({ error: null, notOAuth2: true })
    expect(fs.readFileSync(requestFile, 'utf8')).toBe(before)

    // a file gone, and an id the server does not know, are changed outside
    fs.rmSync(requestFile)
    expect((await save(requestId, { token: 'late' })).changedOutside).toBe(true)
    expect(fs.existsSync(requestFile)).toBe(false)
    expect((await save('/Gone.json', { token: 'late' })).changedOutside).toBe(true)
})

test('a script\'s code is checked against the code it was made from, and only its code', async() => {
    await workspaceWithItem()
    await db.createPlugin(workspace, { _id: 'p1', type: 'script', name: 's', code: { pre_request: 'page', post_request: '' }, enabled: true })
    await db.createPlugin(workspace, { _id: 'p2', type: 'script', name: 't', code: { pre_request: 'other', post_request: '' }, enabled: true })
    const file = path.join(workspace.location, fs.readdirSync(workspace.location).find(name => name.endsWith('plugins.json')))
    const base = { pre_request: 'page', post_request: '' }

    // another script of the file changed outside refuses nothing
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
    onDisk[1].code.pre_request = 'other changed outside'
    fs.writeFileSync(file, JSON.stringify(onDisk))
    await db.updatePlugin(workspace, null, 'p1', { code: { pre_request: 'typed', post_request: '' } }, base)
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))[0].code.pre_request).toBe('typed')

    const changed = JSON.parse(fs.readFileSync(file, 'utf8'))
    changed[0].code.pre_request = 'outside'
    fs.writeFileSync(file, JSON.stringify(changed))
    const refused = await db.updatePlugin(workspace, null, 'p1', { code: { pre_request: 'stale', post_request: '' } }, { pre_request: 'typed', post_request: '' })
    expect(refused.changedOutside).toBe(true)
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))[0].code.pre_request).toBe('outside')

    // a toggle is not a change to the code
    await db.updatePlugin(workspace, null, 'p1', { enabled: false }, { pre_request: 'typed', post_request: '' })
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))[0].enabled).toBe(false)

    // gone from the file
    fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')).slice(1)))
    expect((await db.updatePlugin(workspace, null, 'p1', { code: { pre_request: 'x', post_request: '' } }, { pre_request: 'outside', post_request: '' })).changedOutside).toBe(true)
})

test('a save of an item whose name is near the limit on a file name goes through', async() => {
    const { id, version } = await workspaceWithItem(requestItem('a'.repeat(240)))
    await db.getCollectionForWorkspace(workspace, null)

    const saved = await db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/long-name' }, version)

    expect(saved.error).toBe(null)
    expect(readJson(`${'a'.repeat(240)}.json`).url).toBe('https://api.example/long-name')
})

test('duplicating a socket under the name of the item it copies leaves that item\'s messages alone', async() => {
    const { version } = await workspaceWithItem({ _id: 'new', _type: 'socket', name: 'Chat', parentId: null, workspaceId: workspace._id, clients: [{ id: 'c1', messages: [{ text: 'newer' }] }] })
    const messagesBefore = fs.readFileSync(path.join(workspace.location, 'Chat.messages.json'), 'utf8')

    const result = await db.createCollection(workspace, { _id: 'copy', _type: 'socket', name: 'Chat', parentId: null, workspaceId: workspace._id, clients: [{ id: 'c1', messages: [{ text: 'older copy' }] }] })

    expect(result.error).toBe('Cannot create Chat as it already exists')
    expect(fs.readFileSync(path.join(workspace.location, 'Chat.messages.json'), 'utf8')).toBe(messagesBefore)
    expect(fileVersion('Chat.json')).toBe(version)
})

test('a write that fails forgets what Restfox left at the path, so a change there is not taken for its own', async() => {
    const { id, version } = await workspaceWithItem()
    await db.getCollectionForWorkspace(workspace, null)
    const itemPath = path.join(workspace.location, 'Item.json')
    expect(fileUtils.ownWrites.get(itemPath)).toMatchObject({ kind: 'file', hash: hashText(fs.readFileSync(itemPath, 'utf8')) })

    fs.chmodSync(itemPath, 0o444)
    try {
        await expect(db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/failed' }, version)).rejects.toThrow()
    } finally {
        fs.chmodSync(itemPath, 0o666)
    }

    expect(fileUtils.ownWrites.has(itemPath)).toBe(false)
})

test('an id from before a rename reaches the renamed file for one more scan, and no file after the next', async() => {
    const { id } = await workspaceWithItem()
    await db.getCollectionForWorkspace(workspace, null)
    await db.updateCollection(workspace, id, { name: 'Renamed' })
    await db.getCollectionForWorkspace(workspace, null)
    const version = fileVersion('Renamed.json')

    // a save the screen sent while that scan ran, with the id it still had
    const saved = await db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/after-rename' }, version)
    expect(saved.error).toBe(null)
    expect(readJson('Renamed.json').url).toBe('https://api.example/after-rename')
    expect(fs.existsSync(path.join(workspace.location, 'Item.json'))).toBe(false)

    await db.getCollectionForWorkspace(workspace, null)
    const textBefore = fs.readFileSync(path.join(workspace.location, 'Renamed.json'), 'utf8')
    await expect(db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/stale' })).rejects.toThrow()
    // a page that holds the item, such as another window, reloads rather than failing on every edit
    expect((await db.updateCollection(workspace, id, { ...requestItem(), url: 'https://api.example/stale' }, saved.version)).changedOutside).toBe(true)
    expect((await db.updateCollection(workspace, id, { sortOrder: 2 })).changedOutside).toBe(true)
    expect(fs.readFileSync(path.join(workspace.location, 'Renamed.json'), 'utf8')).toBe(textBefore)
})

test('an id kept from before a rename that a new item takes stays that item\'s at the next scan, and an import with a kept id creates its item', async() => {
    const { id } = await workspaceWithItem(requestItem('a'))
    await db.getCollectionForWorkspace(workspace, null)
    await db.updateCollection(workspace, id, { name: 'b' })
    await db.getCollectionForWorkspace(workspace, null)

    // an import of an export made before the rename, whose item has the id kept for b
    const imported = await db.createCollections(workspace, [{ ...requestItem('a'), _id: id, sortOrder: 7 }])
    expect(imported.results[0].newCollectionId).toBe(id)
    expect(fs.existsSync(path.join(workspace.location, 'a.json'))).toBe(true)
    expect(readJson('b.json').sortOrder).toBe(undefined)

    const loaded = await db.getCollectionForWorkspace(workspace, null)
    expect(loaded.idMap.get(id)).toBe(id)
    await db.updateCollection(workspace, id, { ...requestItem('a'), url: 'https://api.example/new-a' }, fileVersion('a.json'))
    expect(readJson('a.json').url).toBe('https://api.example/new-a')
})

describe('the watcher', () => {
    let events
    let spareWorkspace

    beforeEach(() => {
        events = []
        globalThis.electronApplicationWindow = { webContents: { send: (channel, event, changedPath, controlledChange) => events.push({ event, path: changedPath, controlledChange }) } }
        spareWorkspace = { _id: 'spare', _type: 'file', location: fs.mkdtempSync(path.join(os.tmpdir(), 'restfox-db-spec-spare-')) }
    })

    afterEach(async() => {
        // the watcher moves off the folder the test deletes
        await db.getCollectionForWorkspace(spareWorkspace, null, true)
        fs.rmSync(spareWorkspace.location, { recursive: true, force: true })
    })

    const eventsFor = name => events.filter(event => event.path === path.join(workspace.location, name))
    // Restfox's writes go through the queue the IPC handlers use, as in the app
    const queued = run => db.operationQueue.enqueue(run)

    async function watchWithItem() {
        const item = await workspaceWithItem()
        await db.getCollectionForWorkspace(workspace, null, true)
        await db.whenWorkspaceWatcherReady()
        return item
    }

    // A change made outside Restfox is reported with the text it left, so every report after it, also a late one of
    // Restfox's own earlier write, finds that text and calls it outside
    async function expectOutsideChangeReported(name, change) {
        const from = eventsFor(name).length
        change()
        await vi.waitFor(() => expect(eventsFor(name).slice(from).at(-1)?.controlledChange).toBe(false), { timeout: 10000 })
    }

    test('a change made outside Restfox after quick writes it reports as one is not taken for Restfox\'s own', async() => {
        let { id, version } = await watchWithItem()
        for (const letter of 'abcdef') {
            version = (await queued(() => db.updateCollection(workspace, id, { ...requestItem(), url: `https://api.example/${letter}` }, version))).version
        }
        await vi.waitFor(() => expect(eventsFor('Item.json').length).toBeGreaterThan(0), { timeout: 10000 })
        expect(eventsFor('Item.json').every(event => event.controlledChange)).toBe(true)

        await expectOutsideChangeReported('Item.json', () => {
            fs.writeFileSync(path.join(workspace.location, 'Item.json'), JSON.stringify({ ...readJson('Item.json'), url: 'https://api.example/outside' }, null, 4))
        })
    }, 20000)

    test('a rename by Restfox is its own', async() => {
        const { id } = await watchWithItem()
        await queued(() => db.updateCollection(workspace, id, { name: 'Renamed' }))
        await vi.waitFor(() => {
            expect(eventsFor('Renamed.json').length).toBeGreaterThan(0)
            expect(eventsFor('Item.json').length).toBeGreaterThan(0)
        }, { timeout: 10000 })
        // the previous test's folder, deleted as it ends, can still be reported here
        const workspaceEvents = events.filter(event => event.path.startsWith(workspace.location + path.sep))
        expect(workspaceEvents.filter(event => !event.controlledChange)).toEqual([])
    }, 20000)

    test('once another program changed a file, text Restfox wrote there before is not taken for its own', async() => {
        await watchWithItem()
        const itemPath = path.join(workspace.location, 'Item.json')
        expect(fileUtils.ownWrites.has(itemPath)).toBe(true)

        await expectOutsideChangeReported('Item.json', () => {
            fs.writeFileSync(itemPath, JSON.stringify({ ...readJson('Item.json'), url: 'https://api.example/other-branch' }, null, 4))
        })

        // a checkout back to the branch with Restfox's text then reloads too
        expect(fileUtils.ownWrites.has(itemPath)).toBe(false)
    }, 20000)

    test('a file changed while another workspace was shown, then checked out back to Restfox\'s text, is not taken for its own', async() => {
        await watchWithItem()
        const itemPath = path.join(workspace.location, 'Item.json')
        const restfoxText = fs.readFileSync(itemPath, 'utf8')
        await db.getCollectionForWorkspace(spareWorkspace, null, true)
        fs.writeFileSync(itemPath, JSON.stringify({ ...readJson('Item.json'), url: 'https://api.example/other-branch' }, null, 4))
        await db.getCollectionForWorkspace(workspace, null, true)
        await db.whenWorkspaceWatcherReady()

        await expectOutsideChangeReported('Item.json', () => {
            fs.writeFileSync(itemPath, restfoxText)
        })
    }, 20000)

    test('a change the watcher reported as a reload replaced it is not taken for Restfox\'s own when checked out back', async() => {
        await watchWithItem()
        const itemPath = path.join(workspace.location, 'Item.json')
        const restfoxText = fs.readFileSync(itemPath, 'utf8')
        // a slow call holds the queue, so the watcher's check of the change below waits behind it
        let releaseQueue
        queued(() => new Promise(resolve => {
            releaseQueue = resolve
        }))
        const enqueue = vi.spyOn(db.operationQueue, 'enqueue')
        fs.writeFileSync(itemPath, JSON.stringify({ ...readJson('Item.json'), url: 'https://api.example/outside' }, null, 4))
        await vi.waitFor(() => expect(enqueue).toHaveBeenCalled(), { timeout: 10000 })
        // the reload the change leads to replaces the watcher before that check runs
        await db.getCollectionForWorkspace(workspace, null, true)
        await db.whenWorkspaceWatcherReady()
        releaseQueue()
        await queued(async() => undefined)

        await expectOutsideChangeReported('Item.json', () => {
            fs.writeFileSync(itemPath, restfoxText)
        })
    }, 20000)

    test('a reload that cannot read the folder for a moment leaves the watcher on it', async() => {
        await watchWithItem()
        const requiredDbHelpers = createRequire(import.meta.url)('./db-helpers.js')
        vi.spyOn(requiredDbHelpers, 'ensureRestfoxCollection').mockRejectedValueOnce(Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }))

        expect((await db.getCollectionForWorkspace(workspace, null, true)).error.message).toBe('EIO: i/o error')

        await expectOutsideChangeReported('Item.json', () => {
            fs.writeFileSync(path.join(workspace.location, 'Item.json'), JSON.stringify({ ...readJson('Item.json'), url: 'https://api.example/outside' }, null, 4))
        })
    }, 20000)

    test('loading another workspace for an export or a copy leaves the watcher on the one shown', async() => {
        await watchWithItem()
        const other = { _id: 'other', _type: 'file', location: fs.mkdtempSync(path.join(os.tmpdir(), 'restfox-db-spec-other-')) }
        try {
            await db.getCollectionForWorkspace(other, null)
            await expectOutsideChangeReported('Item.json', () => {
                fs.writeFileSync(path.join(workspace.location, 'Item.json'), JSON.stringify({ ...readJson('Item.json'), url: 'https://api.example/outside' }, null, 4))
            })
        } finally {
            fs.rmSync(other.location, { recursive: true, force: true })
        }
    }, 20000)
})
