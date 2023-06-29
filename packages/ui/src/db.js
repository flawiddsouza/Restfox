import Dexie from 'dexie'
import 'dexie-export-import'

export const db = new Dexie('Restfox')

db.version(5).stores({
    workspaces: '_id',
    collections: '_id, workspaceId',
    plugins: '_id, workspaceId, collectionId',
    responses: '_id, collectionId'
})

export async function exportDB() {
    const blob = await db.export()
    return blob
}

export async function importDB(file) {
    await db.delete()
    await db.open()
    await db.import(file)
    document.location.reload()
}

// Workspaces

export async function getAllWorkspaces() {
    return db.workspaces.toCollection().reverse().sortBy('updatedAt')
}

export async function putWorkspace(workspace) {
    await db.workspaces.put(workspace)
}

export async function updateWorkspace(workspaceId, updatedFields) {
    await db.workspaces.update(workspaceId, updatedFields)
}

export async function deleteWorkspace(workspaceId) {
    await db.workspaces.delete(workspaceId)
}

// Collections

export async function getAllCollectionIdsForGivenWorkspace(workspaceId) {
    return db.collections.where({ workspaceId }).primaryKeys()
}

export async function getCollectionForWorkspace(workspaceId, type = null) {
    let where = {
        workspaceId
    }

    if(type) {
        where._type = type
    }

    return db.collections.where(where).toArray()
}

export async function getCollectionById(collectionId) {
    return db.collections.where({ ':id': collectionId }).first()
}

export async function createCollection(collection) {
    await db.collections.put(collection)
}

export async function createCollections(collections) {
    await db.collections.bulkPut(collections)
}

export async function updateCollection(collectionId, updatedFields) {
    await db.collections.update(collectionId, updatedFields)
}

export async function modifyCollections(workspaceId) {
    await db.collections.toCollection().modify({ workspaceId })
}

export async function deleteCollectionsByWorkspaceId(workspaceId) {
    await db.collections.where({ workspaceId }).delete()
}

export async function deleteCollectionsByIds(collectionIds) {
    await db.collections.where(':id').anyOf(collectionIds).delete()
}

// Responses

export async function getResponsesByCollectionId(collectionId) {
    return db.responses.where({ collectionId }).reverse().sortBy('createdAt')
}

export async function createResponse(response) {
    await db.responses.put(response)
}

export async function updateResponse(responseId, updatedFields) {
    await db.responses.update(responseId, updatedFields)
}

export async function deleteResponse(responseId) {
    await db.responses.where({ _id: responseId }).delete()
}

export async function deleteResponsesByIds(responseIds) {
    await db.responses.where(':id').anyOf(responseIds).delete()
}

export async function deleteResponsesByCollectionIds(collectionIds) {
    await db.responses.where('collectionId').anyOf(collectionIds).delete()
}

export async function deleteResponsesByCollectionId(collectionId) {
    await db.responses.where({ collectionId }).delete()
}

// Plugins

export async function getAllPlugins() {
    return db.plugins.toArray()
}

export async function createPlugin(plugin) {
    await db.plugins.put(plugin)
}

export async function updatePlugin(pluginId, updatedFields) {
    await db.plugins.update(pluginId, updatedFields)
}

export async function deletePlugin(pluginId) {
    await db.plugins.where({ _id: pluginId }).delete()
}

export async function deletePluginsByWorkspace(workspaceId) {
    await db.plugins.where({ workspaceId }).delete()
}

export async function deletePluginsByCollectionIds(collectionIds) {
    await db.plugins.where('collectionId').anyOf(collectionIds).delete()
}
