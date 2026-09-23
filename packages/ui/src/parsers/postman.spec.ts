// @vitest-environment edge-runtime

import { test, expect, describe } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { convertPostmanExportToRestfoxCollection, mergePostmanGlobals } from './postman'
import JSZip from 'jszip'
import { addSortOrderToTree, flattenTree } from '@/helpers'

test('importPostmanV2.0', async() => {
    const currentFolder = process.cwd()

    const testDataFolder = path.resolve(path.join(currentFolder,'test-data', 'postman-import-v2'))

    console.log('testDataFolder', testDataFolder)

    const inputFile = await readFile(path.join(testDataFolder, 'Argos.API.postman_collection.v2.0.json'), 'utf-8')
    const input = JSON.parse(inputFile)
    const outputFile = await readFile(path.join(testDataFolder, 'Restfox_2024-09-06.json'), 'utf-8')
    const expected = JSON.parse(outputFile)

    const converted: any = await convertPostmanExportToRestfoxCollection(input, false, expected.collection[0].workspaceId)

    const collectionTree = converted.collection
    addSortOrderToTree(collectionTree)
    const collection: any[] = JSON.parse(JSON.stringify(flattenTree(collectionTree)))

    collection.sort((a, b) => {
        return a.name.localeCompare(b.name)
    })

    collection.forEach((item) => {
        item.plugins = []
        delete item._id
        delete item.parentId
    })

    const expectedCollection: any[] = expected.collection

    expectedCollection.sort((a, b) => {
        return a.name.localeCompare(b.name)
    })

    expectedCollection.forEach((item) => {
        delete item._id
        delete item.parentId
    })

    writeFile(path.join(testDataFolder, 'test-snapshot.json'), JSON.stringify(collection, null, 2), 'utf-8')

    expect(collection).toEqual(expectedCollection)
})

test('importPostmanV2.1', async() => {
    const currentFolder = process.cwd()

    const testDataFolder = path.join(currentFolder, 'test-data', 'postman-import-v2')

    const inputFile = await readFile(path.join(testDataFolder, 'Argos.API.postman_collection.v2.1.json'), 'utf-8')
    const input = JSON.parse(inputFile)
    const outputFile = await readFile(path.join(testDataFolder, 'Restfox_2024-09-06.v2.1.json'), 'utf-8')
    const expected = JSON.parse(outputFile)

    const converted: any = await convertPostmanExportToRestfoxCollection(input, false, expected.collection[0].workspaceId)

    const collectionTree = converted.collection
    addSortOrderToTree(collectionTree)
    const collection: any[] = JSON.parse(JSON.stringify(flattenTree(collectionTree)))

    collection.sort((a, b) => {
        return a.name.localeCompare(b.name)
    })

    collection.forEach((item) => {
        item.plugins = []
        delete item._id
        delete item.parentId
    })

    const expectedCollection: any[] = expected.collection

    expectedCollection.sort((a, b) => {
        return a.name.localeCompare(b.name)
    })

    expectedCollection.forEach((item) => {
        delete item._id
        delete item.parentId
    })

    writeFile(path.join(testDataFolder, 'test-snapshot.v2.1.json'), JSON.stringify(collection, null, 2), 'utf-8')

    expect(collection).toEqual(expectedCollection)
})

// the request fields of Postman data dumps (Settings > Data > Export Data, "version": 1) as found in real exports: an
// older one keeps headers as text and has no headerData or queryParams, a newer one lists them and leaves out
// "enabled" on headers
describe('Postman data dump', () => {
    const dump = (requests: any[]) => ({ version: 1, collections: [{ id: 'c1', name: 'Pets', requests }], environments: [], headerPresets: [], globals: [] })

    test('a newer dump imports with its headers enabled, query parameters and form fields', async() => {
        const { collection, plugins } = await convertPostmanExportToRestfoxCollection(dump([{
            id: 'r1', collectionId: 'c1', name: 'Find', method: 'POST', url: 'localhost:8080/pets?name=cat',
            headers: 'Content-Type: application/x-www-form-urlencoded\n',
            headerData: [{ key: 'Content-Type', name: 'Content-Type', value: 'application/x-www-form-urlencoded', description: null, type: 'text' }],
            queryParams: [{ key: 'name', value: 'cat', equals: true, description: null, enabled: true }],
            dataMode: 'urlencoded',
            data: [{ key: 'kind', value: 'cat', type: 'text', enabled: true }, { key: 'age', value: '2', type: 'text', enabled: false }],
        }]), false, 'w')

        expect(plugins).toEqual([])
        const request = collection[0].children![0]
        expect(request.headers).toEqual([{ name: 'Content-Type', value: 'application/x-www-form-urlencoded', description: null, disabled: false }])
        expect(request.parameters).toEqual([{ name: 'name', value: 'cat', description: null, disabled: false }])
        expect(request.body).toEqual({ mimeType: 'application/x-www-form-urlencoded', params: [
            { name: 'kind', value: 'cat', description: undefined, disabled: false },
            { name: 'age', value: '2', description: undefined, disabled: true },
        ] })
    })

    test('an older dump imports its headers from the text, a line starting with // as disabled', async() => {
        const { collection } = await convertPostmanExportToRestfoxCollection(dump([{
            id: 'r1', collectionId: 'c1', name: 'Artist', method: 'GET', url: '{{website}}/api/v1/artists/16?fwreinit',
            headers: 'Accept: application/vnd.mywebsite+json; version=1\n//X-Debug: 1\nX-Empty:\n',
            dataMode: 'raw', data: [], rawModeData: '',
        }]), false, 'w')

        const request = collection[0].children![0]
        expect(request.url).toBe('{{website}}/api/v1/artists/16?fwreinit')
        expect(request.headers).toEqual([
            { name: 'Accept', value: 'application/vnd.mywebsite+json; version=1', disabled: false },
            { name: 'X-Debug', value: '1', disabled: true },
            { name: 'X-Empty', value: '', disabled: false },
        ])
        // Send takes the query from the url when there are no parameters
        expect(request.parameters).toBeUndefined()
    })

    test('folders keep their nesting and Postman\'s order, a request in no folder stays at the top', async() => {
        const { collection } = await convertPostmanExportToRestfoxCollection({ version: 1, collections: [{
            id: 'c1', name: 'Shop', order: ['r3'], folders_order: ['f1'],
            folders: [
                { id: 'f2', name: 'Orders', order: ['r2', 'r1'], folders_order: [] },
                { id: 'f1', name: 'Account', order: [], folders_order: ['f2'], auth: { type: 'bearer', bearer: [{ key: 'token', value: 't' }] } },
            ],
            requests: [
                { id: 'r1', name: 'List', method: 'GET', url: 'u', folder: 'f2', headers: '' },
                { id: 'r2', name: 'Create', method: 'POST', url: 'u', folder: 'f2', headers: '' },
                { id: 'r3', name: 'Login', method: 'POST', url: 'u', folder: null, headers: '' },
            ],
        }] }, false, 'w')

        const names = (items: any[]): any[] => items.map(item => item.children ? { [item.name]: names(item.children) } : item.name)
        expect(names(collection)).toEqual([{ Shop: [{ Account: [{ Orders: ['Create', 'List'] }] }, 'Login'] }])
        const account = collection[0].children![0]
        expect(account.authentication).toMatchObject({ type: 'bearer', token: 't' })
        expect(account.children![0].parentId).toBe('f1')
    })

    test('form data, a binary body, auth and scripts are imported', async() => {
        const { collection, plugins } = await convertPostmanExportToRestfoxCollection(dump([
            { id: 'r1', name: 'Upload', method: 'POST', url: 'u', headers: '', dataMode: 'params', data: [{ key: 'title', value: 'a', type: 'text', enabled: true }, { key: 'photo', value: { 0: {} }, type: 'file', enabled: true }], auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p' }] }, events: [{ listen: 'test', script: { exec: ['pm.environment.set("a", 1)'] } }] },
            { id: 'r2', name: 'Raw file', method: 'POST', url: 'u', headers: '', dataMode: 'binary', data: [] },
            { id: 'r3', name: 'Plain GET', method: 'GET', url: 'u', headers: '', dataMode: 'params', data: [] },
        ]), false, 'w')

        const [upload, rawFile, plainGet] = collection[0].children!
        expect(upload.body).toEqual({ mimeType: 'multipart/form-data', params: [
            { name: 'title', value: 'a', description: undefined, disabled: false, type: 'text' },
            { name: 'photo', value: '', description: undefined, disabled: false, type: 'file', files: [] },
        ] })
        expect(upload.authentication).toMatchObject({ type: 'basic', username: 'u', password: 'p' })
        expect(plugins).toMatchObject([{ collectionId: 'r1', code: { post_request: 'rf.setEnvVar("a", 1)' } }])
        expect(rawFile.body).toEqual({ mimeType: 'application/octet-stream' })
        expect(plainGet.body).toEqual({ mimeType: 'No Body' })
    })
})

describe('Postman collection v2.1', () => {
    const collectionOf = (items: any[], fields: Record<string, unknown> = {}) => ({ info: { _postman_id: 'c1', name: 'API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: items, ...fields })
    const requestItem = (request: Record<string, unknown>, fields: Record<string, unknown> = {}) => ({ id: 'r1', name: 'Request', request: { method: 'POST', url: { raw: 'https://example.test/' }, header: [], ...request }, ...fields })

    test('a request without headers or with a null description does not stop the import', async() => {
        const { collection } = await convertPostmanExportToRestfoxCollection(collectionOf([requestItem({ header: undefined, description: null })]), false, 'w')
        expect(collection[0].children![0]).toMatchObject({ headers: [], description: undefined })
    })

    test('form data keeps its fields, a file field keeps its name', async() => {
        const { collection } = await convertPostmanExportToRestfoxCollection(collectionOf([requestItem({ body: { mode: 'formdata', formdata: [{ key: 'title', value: 'a', type: 'text' }, { key: 'photo', type: 'file', src: '/home/me/a.png' }, { key: 'old', value: 'b', type: 'text', disabled: true }] } })]), false, 'w')
        const request = collection[0].children![0]
        expect(request.body).toEqual({ mimeType: 'multipart/form-data', params: [
            { name: 'title', value: 'a', description: undefined, disabled: false, type: 'text' },
            { name: 'photo', value: '', description: undefined, disabled: false, type: 'file', files: [] },
            { name: 'old', value: 'b', description: undefined, disabled: true, type: 'text' },
        ] })
        expect(request.headers).toEqual([])
    })

    test('a GraphQL body keeps its query and variables and gets the Content-Type Postman sends', async() => {
        const { collection } = await convertPostmanExportToRestfoxCollection(collectionOf([requestItem({ body: { mode: 'graphql', graphql: { query: '{ pets { name } }', variables: '{"limit": 2}' } } })]), false, 'w')
        const request = collection[0].children![0]
        expect(request.body!.mimeType).toBe('application/graphql')
        expect(JSON.parse(request.body!.text!)).toEqual({ query: '{ pets { name } }', variables: { limit: 2 } })
        expect(request.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }])
    })

    test('a file body imports as a binary body', async() => {
        const { collection } = await convertPostmanExportToRestfoxCollection(collectionOf([requestItem({ body: { mode: 'file', file: { src: '/home/me/a.pdf' } } })]), false, 'w')
        expect(collection[0].children![0].body).toEqual({ mimeType: 'application/octet-stream' })
    })

    test('the Content-Type Postman adds by itself is added, a typed one is kept, a body without a language gets none', async() => {
        const { collection } = await convertPostmanExportToRestfoxCollection(collectionOf([
            requestItem({ body: { mode: 'raw', raw: '{"a": 1}', options: { raw: { language: 'json' } } } }, { id: 'json' }),
            requestItem({ body: { mode: 'raw', raw: '<a/>', options: { raw: { language: 'xml' } } }, header: [{ key: 'content-type', value: 'text/xml' }] }, { id: 'typed' }),
            requestItem({ body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }] } }, { id: 'form' }),
            requestItem({ body: { mode: 'raw', raw: 'hello' } }, { id: 'text' }),
        ]), false, 'w')

        const headersOf = (id: string) => collection[0].children!.find(item => item._id === id)!.headers
        expect(headersOf('json')).toEqual([{ name: 'Content-Type', value: 'application/json' }])
        expect(headersOf('typed')).toEqual([{ name: 'content-type', value: 'text/xml', description: undefined, disabled: undefined }])
        expect(headersOf('form')).toEqual([{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }])
        expect(headersOf('text')).toEqual([])
    })

    test('folder auth and folder and collection scripts are imported, a folder without auth inherits', async() => {
        const { collection, plugins } = await convertPostmanExportToRestfoxCollection(collectionOf([
            { id: 'f1', name: 'Admin', auth: { type: 'bearer', bearer: [{ key: 'token', value: 't' }] }, event: [{ listen: 'prerequest', script: { exec: ['pm.environment.set("f", 1)'] } }], item: [requestItem({})] },
            { id: 'f2', name: 'Public', item: [] },
        ], { event: [{ listen: 'test', script: { exec: ['pm.environment.set("c", 1)'] } }, { listen: 'prerequest', script: { exec: [''] } }] }), false, 'w')

        const [admin, publicFolder] = collection[0].children!
        expect(admin.authentication).toMatchObject({ type: 'bearer', token: 't' })
        expect(publicFolder.authentication).toBeUndefined()
        expect(plugins).toMatchObject([
            { collectionId: 'f1', code: { pre_request: 'rf.setEnvVar("f", 1)' } },
            { collectionId: 'c1', code: { post_request: 'rf.setEnvVar("c", 1)' } },
        ])
    })
})

// environment and globals files as Postman exports them, older ones without _postman_variable_scope
describe('Postman environments and globals', () => {
    const collectionV21 = { info: { _postman_id: 'c1', name: 'API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ id: 'r1', name: 'Ping', request: { method: 'GET', url: { raw: '{{baseUrl}}/ping' }, header: [] } }] }
    const environmentFile = { id: 'e1', name: 'Local', values: [{ key: 'baseUrl', value: 'http://localhost', enabled: true }, { key: 'old', value: 'x', enabled: false }], _postman_variable_scope: 'environment' }
    const globalsFile = { id: 'g1', name: 'My Workspace Globals', values: [{ key: 'baseUrl', value: 'https://global.example', enabled: true }, { key: 'apiKey', value: 'k', type: 'secret', enabled: true }], _postman_variable_scope: 'globals' }

    test('an environment file imports as an environment without its disabled variables', async() => {
        const result = await convertPostmanExportToRestfoxCollection(environmentFile, false, 'w')
        expect(result).toMatchObject({ collection: [], plugins: [], environments: [{ name: 'Local', environment: { baseUrl: 'http://localhost' } }], globals: null })
    })

    test('an older environment file without a scope imports too, a variable without "enabled" counts as enabled', async() => {
        const result = await convertPostmanExportToRestfoxCollection({ id: 'e2', name: 'Old', timestamp: 1, values: [{ key: 'host', value: 'h', type: 'text' }] }, false, 'w')
        expect(result.environments).toEqual([{ name: 'Old', environment: { host: 'h' } }])
    })

    test('a globals file imports as globals', async() => {
        const result = await convertPostmanExportToRestfoxCollection(globalsFile, false, 'w')
        expect(result.globals).toEqual({ baseUrl: 'https://global.example', apiKey: 'k' })
        expect(result.environments).toEqual([])
    })

    test('globals go into every environment and an environment keeps its own value, without environments they become their own', () => {
        const environments = [{ name: 'Local', environment: { baseUrl: 'http://localhost' } }, { name: 'Prod', environment: {} }]
        expect(mergePostmanGlobals(environments, { baseUrl: 'g', apiKey: 'k' })).toEqual([
            { name: 'Local', environment: { baseUrl: 'http://localhost', apiKey: 'k' } },
            { name: 'Prod', environment: { baseUrl: 'g', apiKey: 'k' } },
        ])
        expect(mergePostmanGlobals([], { apiKey: 'k' })).toEqual([{ name: 'Postman Globals', environment: { apiKey: 'k' } }])
        expect(mergePostmanGlobals(environments, null)).toBe(environments)
    })

    test('a data dump imports its environments and globals', async() => {
        const result = await convertPostmanExportToRestfoxCollection({ version: 1, collections: [], environments: [{ id: 'e1', name: 'LOCALHOST', values: [{ key: 'APIHOST', value: 'localhost:8080', enabled: true }] }], globals: [{ key: 'token', value: 't', type: 'text', enabled: true }] }, false, 'w')
        expect(result.environments).toEqual([{ name: 'LOCALHOST', environment: { APIHOST: 'localhost:8080' } }])
        expect(result.globals).toEqual({ token: 't' })
    })

    test('the "<workspace> - globals" environments of a newer dump import as globals, together with its globals list', async() => {
        const result = await convertPostmanExportToRestfoxCollection({ version: 1, collections: [], environments: [
            { id: 'e1', name: 'Local', values: [{ key: 'test_var', value: 'local', enabled: true }] },
            { id: 'e2', name: 'My Workspace - globals', values: [{ key: 'test_var', value: 'global', enabled: true }, { key: 'other', value: 'o', enabled: true }] },
            { id: 'e3', name: 'Team Workspace - globals', values: [] },
        ], globals: [{ key: 'token', value: 't', enabled: true }] }, false, 'w')
        expect(result.environments).toEqual([{ name: 'Local', environment: { test_var: 'local' } }])
        expect(result.globals).toEqual({ test_var: 'global', other: 'o', token: 't' })
        expect(mergePostmanGlobals(result.environments, result.globals)).toEqual([{ name: 'Local', environment: { test_var: 'local', other: 'o', token: 't' } }])
    })

    test('a data export zip imports its collections and environments whatever the order of its files', async() => {
        const zip = new JSZip()
        zip.file('export/archive.json', JSON.stringify({ collection: { c1: true }, environment: { e1: true } }))
        zip.file('export/collection/c1.json', JSON.stringify(collectionV21))
        zip.file('export/environment/e1.json', JSON.stringify(environmentFile))
        const result = await convertPostmanExportToRestfoxCollection(await zip.generateAsync({ type: 'uint8array' }), true, 'w')

        expect(result.collection.map(item => item.name)).toEqual(['API'])
        expect(result.environments).toEqual([{ name: 'Local', environment: { baseUrl: 'http://localhost' } }])
    })
})
