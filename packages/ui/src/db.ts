import Dexie from 'dexie'
import 'dexie-export-import'

export class RestfoxDatabase extends Dexie {
    workspaces!: Dexie.Table<any>
    collections!: Dexie.Table<any>
    plugins!: Dexie.Table<any>
    responses!: Dexie.Table<any>

    constructor() {
        super('Restfox')

        // Define the database schema
        this.version(5).stores({
            workspaces: '_id',
            collections: '_id, workspaceId',
            plugins: '_id, workspaceId, collectionId',
            responses: '_id, collectionId',
        })
    }
}

export const db = new RestfoxDatabase()

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
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.getCollectionForWorkspace(workspace, type)
        }
    }

    const where: any = {
        workspaceId
    }

    if(type) {
        where._type = type
    }

    // @ts-expect-error toArray does work on where, not sure why typescript is complaining
    return db.collections.where(where).toArray()
}

export async function getCollectionById(workspaceId, collectionId) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.getCollectionById(workspace, collectionId)
        }
    }

    return db.collections.where({ ':id': collectionId }).first()
}

export async function createCollection(workspaceId, collection) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.createCollection(workspace, collection)
        }
    }

    await db.collections.put(collection)
}

export async function createCollections(workspaceId, collections) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.createCollections(workspace, collections)
        }
    }

    await db.collections.bulkPut(collections)
}

export async function updateCollection(workspaceId, collectionId, updatedFields) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.updateCollection(workspace, collectionId, updatedFields)
        }
    }

    await db.collections.update(collectionId, updatedFields)
}

export async function modifyCollections(workspaceId) {
    await db.collections.toCollection().modify({ workspaceId })
}

export async function deleteCollectionsByWorkspaceId(workspaceId) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.deleteCollectionsByWorkspaceId(workspace)
        }
    }

    await db.collections.where({ workspaceId }).delete()
}

export async function deleteCollectionsByIds(workspaceId, collectionIds) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.deleteCollectionsByIds(workspace, collectionIds)
        }
    }

    await db.collections.where(':id').anyOf(collectionIds).delete()
}

// Responses

export async function getResponsesByCollectionId(workspaceId, collectionId) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.getResponsesByCollectionId(workspace, collectionId)
        }
    }

    return db.responses.where({ collectionId }).reverse().sortBy('createdAt')
}

export async function createResponse(workspaceId, response) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.createResponse(workspace, response)
        }
    }

    await db.responses.put(response)
}

export async function updateResponse(workspaceId, collectionId, responseId, updatedFields) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.updateResponse(workspace, collectionId, responseId, updatedFields)
        }
    }

    await db.responses.update(responseId, updatedFields)
}

export async function deleteResponse(workspaceId, collectionId, responseId) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.deleteResponse(workspace, collectionId, responseId)
        }
    }

    await db.responses.where({ _id: responseId }).delete()
}

export async function deleteResponsesByIds(workspaceId, collectionId, responseIds) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.deleteResponsesByIds(workspace, collectionId, responseIds)
        }
    }

    await db.responses.where(':id').anyOf(responseIds).delete()
}

export async function deleteResponsesByCollectionIds(workspaceId, collectionIds) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.deleteResponsesByCollectionIds(workspace, collectionIds)
        }
    }

    await db.responses.where('collectionId').anyOf(collectionIds).delete()
}

export async function deleteResponsesByCollectionId(workspaceId, collectionId) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.deleteResponsesByCollectionId(workspace, collectionId)
        }
    }

    await db.responses.where({ collectionId }).delete()
}

// Plugins

export async function getGlobalPlugins() {
    // we can't use where here because where null of workspaceId and collectionId is not supported by indexedDB
    const allPlugins = await db.plugins.toArray()
    return allPlugins.filter(plugin => plugin.workspaceId == null && plugin.collectionId == null)
}

export async function getWorkspacePlugins(workspaceId: string) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.getWorkspacePlugins(workspace)
        }
    }

    const workspacePlugins = await db.plugins.where({ workspaceId }).toArray()

    const collectionIds = await getAllCollectionIdsForGivenWorkspace(workspaceId)
    const collectionItemPlugins = await db.plugins.where('collectionId').anyOf(collectionIds).toArray()

    return [
        ...workspacePlugins,
        ...collectionItemPlugins
    ]
}

export async function createPlugin(plugin, workspaceId = null) {
    if(import.meta.env.MODE === 'desktop-electron' && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.createPlugin(workspace, plugin)
        }
    }

    await db.plugins.put(plugin)
}

export async function updatePlugin(pluginId, updatedFields, workspaceId = null, collectionId = null) {
    if(import.meta.env.MODE === 'desktop-electron' && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.updatePlugin(workspace, collectionId, pluginId, updatedFields)
        }
    }

    await db.plugins.update(pluginId, updatedFields)
}

export async function deletePlugin(pluginId, workspaceId = null, collectionId = null) {
    if(import.meta.env.MODE === 'desktop-electron' && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.deletePlugin(workspace, collectionId, pluginId)
        }
    }

    await db.plugins.where({ _id: pluginId }).delete()
}

export async function deletePluginsByWorkspace(workspaceId) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.deletePluginsByWorkspace(workspace)
        }
    }

    await db.plugins.where({ workspaceId }).delete()
}

export async function deletePluginsByCollectionIds(workspaceId, collectionIds) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.deletePluginsByCollectionIds(workspace, collectionIds)
        }
    }

    await db.plugins.where('collectionId').anyOf(collectionIds).delete()
}

// used for import
export async function createPlugins(plugin, workspaceId = null) {
    if(import.meta.env.MODE === 'desktop-electron' && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.createPlugins(workspace, plugin)
        }
    }

    await db.plugins.bulkPut(plugin)
}
