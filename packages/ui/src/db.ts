import Dexie from 'dexie'
import 'dexie-export-import'
import {
    CollectionItem,
    FileObject,
    FileWorkspace,
    Plugin,
    RequestFinalResponse,
    Workspace,
} from './global'

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

const db = new RestfoxDatabase()

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

export async function importDB(file: File) {
    await db.delete()
    await db.open()
    await db.import(file)
    document.location.reload()
}

// Workspaces

export async function getAllWorkspaces() {
    return db.workspaces.toCollection().reverse().sortBy('updatedAt')
}

export async function putWorkspace(workspace: Workspace) {
    await db.workspaces.put(workspace)
}

export async function updateWorkspace(workspaceId: string, updatedFields: Partial<Workspace>, skipUpdateForFileWorkspace = false) {
    if(import.meta.env.MODE === 'desktop-electron' && !skipUpdateForFileWorkspace) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            // this will used for updating workspace name, environments & currentEnvironment
            await window.electronIPC.updateWorkspace(workspace, updatedFields)
            // we don't want to update these fields into indexedDB if file workspace
            delete updatedFields.currentEnvironment
            delete updatedFields.environment
            delete updatedFields.environments
        }
    }

    if(Object.keys(updatedFields).length === 0) {
        return
    }

    await db.workspaces.update(workspaceId, updatedFields)
}

export async function deleteWorkspace(workspaceId: string) {
    await db.workspaces.delete(workspaceId)
}

// Collections

export async function getAllCollectionIdsForGivenWorkspace(workspaceId: string) {
    return db.collections.where({ workspaceId }).primaryKeys()
}

export async function getCollectionForWorkspace(workspaceId: string, type = null): Promise<{ error: string | null, collection: CollectionItem[], workspace: FileWorkspace | null, idMap: Map<string, string> | null }> {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            const result = await window.electronIPC.getCollectionForWorkspace(workspace, type)

            if (type === null) {
                for(const collectionItem of result.collection) {
                    deserializeRequestFiles(collectionItem)
                }
            }

            return result
        }
    }

    const where: any = {
        workspaceId
    }

    if(type) {
        where._type = type
    }

    return {
        error: null,
        // @ts-expect-error toArray does work on where, not sure why typescript is complaining
        collection: await db.collections.where(where).toArray(),
        workspace: null,
        idMap: null,
    }
}

export async function getCollectionById(workspaceId: string, collectionId: string): Promise<CollectionItem> {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.getCollectionById(workspace, collectionId)
        }
    }

    return db.collections.where({ ':id': collectionId }).first()
}

interface CreateCollectionResult {
    error: string | null,
    oldCollectionId: string | null,
    newCollectionId: string | null
}

export async function createCollection(workspaceId: string, collection: CollectionItem): Promise<CreateCollectionResult> {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.createCollection(workspace, collection)
        }
    }

    await db.collections.put(collection)

    return {
        error: null,
        oldCollectionId: null,
        newCollectionId: null,
    }
}

export async function createCollections(workspaceId: string, collections: CollectionItem[]): Promise<{
    error: string | null,
    results: CreateCollectionResult[]
}> {
    console.log('createCollections', collections)

    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.createCollections(workspace, collections)
        }
    }

    await db.collections.bulkPut(collections)

    return {
        error: null,
        results: []
    }
}

async function transformFileToFileObject(file: File): Promise<FileObject> {
    return {
        name: file.name,
        type: file.type,
        buffer: await file.arrayBuffer()
    }
}

function transformFileObjectToFile(file: FileObject): File {
    return new File([file.buffer], file.name, { type: file.type })
}

async function serializeRequestFiles(collection: Partial<CollectionItem>) {
    if(collection.body && collection.body.fileName && collection.body.fileName instanceof File) {
        collection.body.fileName = await transformFileToFileObject(collection.body.fileName)
    }

    if(collection.body && collection.body.params) {
        for(const param of collection.body.params) {
            if(param.files) {
                param.files = await Promise.all(param.files.map(async file => await transformFileToFileObject(file as File)))
            }
        }
    }
}

function deserializeRequestFiles(collection: Partial<CollectionItem>) {
    if(collection.body && collection.body.fileName && 'buffer' in collection.body.fileName && collection.body.fileName.buffer instanceof Uint8Array) {
        collection.body.fileName = transformFileObjectToFile(collection.body.fileName)
    }

    if(collection.body && collection.body.params) {
        for(const param of collection.body.params) {
            if(param.files) {
                param.files = param.files.map(file => transformFileObjectToFile(file as FileObject))
            }
        }
    }
}

async function serializeRequestResponseFiles(response: RequestFinalResponse) {
    if(response.request.body instanceof File) {
        response.request.body = await transformFileToFileObject(response.request.body)
    }

    if(response.request.original.body) {
        if(response.request.original.body.fileName && response.request.original.body.fileName instanceof File) {
            response.request.original.body.fileName = await transformFileToFileObject(response.request.original.body.fileName)
        }

        if(response.request.original.body.params) {
            for(const param of response.request.original.body.params) {
                if(param.files) {
                    param.files = await Promise.all(param.files.map(file => transformFileToFileObject(file as File)))
                }
            }
        }
    }
}

function deserializeRequestResponseFiles(response: RequestFinalResponse) {
    if(response.request.body && response.request.body.buffer instanceof Uint8Array) {
        response.request.body = transformFileObjectToFile(response.request.body)
    }

    if(response.request.original.body) {
        if(response.request.original.body.fileName && response.request.original.body.fileName instanceof Uint8Array) {
            response.request.original.body.fileName = transformFileObjectToFile(response.request.original.body.fileName)
        }

        if(response.request.original.body.params) {
            for(const param of response.request.original.body.params) {
                if(param.files) {
                    param.files = param.files.map(file => transformFileObjectToFile(file as FileObject))
                }
            }
        }
    }
}

export async function updateCollection(workspaceId: string, collectionId: string, updatedFields: Partial<CollectionItem>): Promise<{ error: string | null }> {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            await serializeRequestFiles(updatedFields)
            return window.electronIPC.updateCollection(workspace, collectionId, updatedFields)
        }
    }

    await db.collections.update(collectionId, updatedFields)

    return {
        error: null,
    }
}

export async function modifyCollections(workspaceId: string) {
    await db.collections.toCollection().modify({ workspaceId })
}

export async function deleteCollectionsByWorkspaceId(workspaceId: string) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.deleteCollectionsByWorkspaceId(workspace)
        }
    }

    await db.collections.where({ workspaceId }).delete()
}

export async function deleteCollectionsByIds(workspaceId: string, collectionIds: string[]): Promise<{ error: string | null }> {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.deleteCollectionsByIds(workspace, collectionIds)
        }
    }

    await db.collections.where(':id').anyOf(collectionIds).delete()

    return {
        error: null,
    }
}

// Responses

export async function getResponsesByCollectionId(workspaceId: string, collectionId: string) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            const responses = await window.electronIPC.getResponsesByCollectionId(workspace, collectionId)
            for(const response of responses) {
                deserializeRequestResponseFiles(response)
            }
            return responses
        }
    }

    return db.responses.where({ collectionId }).reverse().sortBy('createdAt')
}

export async function createResponse(workspaceId: string, response: RequestFinalResponse) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            await serializeRequestResponseFiles(response)
            return window.electronIPC.createResponse(workspace, response)
        }
    }

    await db.responses.put(response)
}

export async function updateResponse(workspaceId: string, collectionId: string, responseId: string, updatedFields: Partial<RequestFinalResponse>) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.updateResponse(workspace, collectionId, responseId, updatedFields)
        }
    }

    await db.responses.update(responseId, updatedFields)
}

export async function deleteResponse(workspaceId: string, collectionId: string, responseId: string) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.deleteResponse(workspace, collectionId, responseId)
        }
    }

    await db.responses.where({ _id: responseId }).delete()
}

export async function deleteResponsesByIds(workspaceId: string, collectionId: string, responseIds: string[]) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.deleteResponsesByIds(workspace, collectionId, responseIds)
        }
    }

    await db.responses.where(':id').anyOf(responseIds).delete()
}

export async function deleteResponsesByCollectionIds(workspaceId: string, collectionIds: string[]) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return window.electronIPC.deleteResponsesByCollectionIds(workspace, collectionIds)
        }
    }

    await db.responses.where('collectionId').anyOf(collectionIds).delete()
}

export async function deleteResponsesByCollectionId(workspaceId: string, collectionId: string) {
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

export async function createPlugin(plugin: Plugin, workspaceId: string | null = null) {
    if(import.meta.env.MODE === 'desktop-electron' && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.createPlugin(workspace, plugin)
        }
    }

    await db.plugins.put(plugin)
}

export async function updatePlugin(pluginId: string, updatedFields: Partial<Plugin>, workspaceId: string | null = null, collectionId: string | null = null) {
    if(import.meta.env.MODE === 'desktop-electron' && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.updatePlugin(workspace, collectionId, pluginId, updatedFields)
        }
    }

    await db.plugins.update(pluginId, updatedFields)
}

export async function deletePlugin(pluginId: string, workspaceId: string | null = null, collectionId: string | null = null) {
    if(import.meta.env.MODE === 'desktop-electron' && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.deletePlugin(workspace, collectionId, pluginId)
        }
    }

    await db.plugins.where({ _id: pluginId }).delete()
}

export async function deletePluginsByWorkspace(workspaceId: string) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.deletePluginsByWorkspace(workspace)
        }
    }

    await db.plugins.where({ workspaceId }).delete()
}

export async function deletePluginsByCollectionIds(workspaceId: string, collectionIds: string[]) {
    if(import.meta.env.MODE === 'desktop-electron') {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.deletePluginsByCollectionIds(workspace, collectionIds)
        }
    }

    await db.plugins.where('collectionId').anyOf(collectionIds).delete()
}

// used for import
export async function createPlugins(plugins: Plugin[], workspaceId: string | null = null) {
    if(import.meta.env.MODE === 'desktop-electron' && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return window.electronIPC.createPlugins(workspace, plugins)
        }
    }

    await db.plugins.bulkPut(plugins)
}
