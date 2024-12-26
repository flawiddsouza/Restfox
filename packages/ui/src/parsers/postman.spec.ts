// @vitest-environment edge-runtime

import { test, expect } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { convertPostmanExportToRestfoxCollection } from './postman'
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
