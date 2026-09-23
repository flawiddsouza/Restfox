import Dexie from 'dexie'
import '@flawiddsouza/dexie-export-import'
import {
    CollectionItem,
    FileObject,
    FileWorkspace,
    Plugin,
    RequestFinalResponse,
    Workspace,
} from './global'

async function callWebStandaloneAPI(method: string, args: Record<string, unknown>) {
    const res = await fetch(`/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args, (_, value) => {
            if(value instanceof ArrayBuffer) {
                return Array.from(new Uint8Array(value))
            }
            if(value instanceof Uint8Array) {
                return Array.from(value)
            }
            return value
        }),
    })
    const data = await res.json()
    if (data.error) {
        throw new Error(data.error)
    }
    return data.result
}

const webStandaloneIPC = {
    getWorkspaceAtLocation:             (location: string, getEnvironments = false) => callWebStandaloneAPI('getWorkspaceAtLocation', { location, getEnvironments }),
    updateWorkspace:                    (workspace: any, updatedFields: any) => callWebStandaloneAPI('updateWorkspace', { workspace, updatedFields }),
    ensureEmptyFolderOrEmptyWorkspace:  (location: string) => callWebStandaloneAPI('ensureEmptyFolderOrEmptyWorkspace', { location }),
    getCollectionForWorkspace:          (workspace: any, type: any) => callWebStandaloneAPI('getCollectionForWorkspace', { workspace, type }),
    getCollectionById:                  (workspace: any, collectionId: string) => callWebStandaloneAPI('getCollectionById', { workspace, collectionId }),
    createCollection:                   (workspace: any, collection: any) => callWebStandaloneAPI('createCollection', { workspace, collection }),
    createCollections:                  (workspace: any, collections: any[]) => callWebStandaloneAPI('createCollections', { workspace, collections }),
    updateCollection:                   (workspace: any, collectionId: string, updatedFields: any) => callWebStandaloneAPI('updateCollection', { workspace, collectionId, updatedFields }),
    deleteCollectionsByWorkspaceId:     (workspace: any) => callWebStandaloneAPI('deleteCollectionsByWorkspaceId', { workspace }),
    deleteCollectionsByIds:             (workspace: any, collectionIds: string[]) => callWebStandaloneAPI('deleteCollectionsByIds', { workspace, collectionIds }),
    getResponsesByCollectionId:         (workspace: any, collectionId: string) => callWebStandaloneAPI('getResponsesByCollectionId', { workspace, collectionId }),
    createResponse:                     (workspace: any, response: any) => callWebStandaloneAPI('createResponse', { workspace, response }),
    updateResponse:                     (workspace: any, collectionId: string, responseId: string, updatedFields: any) => callWebStandaloneAPI('updateResponse', { workspace, collectionId, responseId, updatedFields }),
    deleteResponse:                     (workspace: any, collectionId: string, responseId: string) => callWebStandaloneAPI('deleteResponse', { workspace, collectionId, responseId }),
    deleteResponsesByIds:               (workspace: any, collectionId: string, responseIds: string[]) => callWebStandaloneAPI('deleteResponsesByIds', { workspace, collectionId, responseIds }),
    deleteResponsesByCollectionIds:     (workspace: any, collectionIds: string[]) => callWebStandaloneAPI('deleteResponsesByCollectionIds', { workspace, collectionIds }),
    deleteResponsesByCollectionId:      (workspace: any, collectionId: string) => callWebStandaloneAPI('deleteResponsesByCollectionId', { workspace, collectionId }),
    getWorkspacePlugins:                (workspace: any) => callWebStandaloneAPI('getWorkspacePlugins', { workspace }),
    createPlugin:                       (workspace: any, plugin: any) => callWebStandaloneAPI('createPlugin', { workspace, plugin }),
    updatePlugin:                       (workspace: any, collectionId: string | null, pluginId: string, updatedFields: any) => callWebStandaloneAPI('updatePlugin', { workspace, collectionId, pluginId, updatedFields }),
    deletePlugin:                       (workspace: any, collectionId: string | null, pluginId: string) => callWebStandaloneAPI('deletePlugin', { workspace, collectionId, pluginId }),
    deletePluginsByWorkspace:           (workspace: any) => callWebStandaloneAPI('deletePluginsByWorkspace', { workspace }),
    deletePluginsByCollectionIds:       (workspace: any, collectionIds: string[]) => callWebStandaloneAPI('deletePluginsByCollectionIds', { workspace, collectionIds }),
    createPlugins:                      (workspace: any, plugins: any[]) => callWebStandaloneAPI('createPlugins', { workspace, plugins }),
    readFile:                           (filePath: string, workspaceLocation?: string) => callWebStandaloneAPI('readFile', { filePath, workspaceLocation }),
}

function resolveFileIPC() {
    if (import.meta.env.MODE === 'desktop-electron') {
        return window.electronIPC
    }
    if (import.meta.env.MODE === 'web-standalone') {
        return webStandaloneIPC
    }
    return null
}

export const fileIPC = resolveFileIPC()

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

// settings that hold a file, such as Settings > CA Certificates, too large for localStorage. A database of its own, a new
// table in the Restfox database would raise its version and older releases could not open it
export interface SettingsFile {
    fileName: string
    content: string
}

class RestfoxSettingsFilesDatabase extends Dexie {
    files!: Dexie.Table<SettingsFile & { _id: string }>

    constructor() {
        super('Restfox-SettingsFiles')

        this.version(1).stores({
            files: '_id',
        })
    }
}

const settingsFilesDB = new RestfoxSettingsFilesDatabase()

export async function getSettingsFile(id: string): Promise<SettingsFile | null> {
    const file = await settingsFilesDB.files.get(id)
    return file ? { fileName: file.fileName, content: file.content } : null
}

export async function putSettingsFile(id: string, file: SettingsFile) {
    await settingsFilesDB.files.put({ _id: id, ...file })
}

export async function deleteSettingsFile(id: string) {
    await settingsFilesDB.files.delete(id)
}

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
    if(fileIPC && !skipUpdateForFileWorkspace) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            // this will used for updating workspace name, environments & currentEnvironment
            try {
                await fileIPC.updateWorkspace(workspace, updatedFields)
            } catch (e) {
                // This will error out if updatedFields.location was incorrect in the previous update
                // so the user will not be able to fix the location if we don't catch this error
                console.warn('Error updating file workspace', e)
            }
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
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            const result = await fileIPC.getCollectionForWorkspace(workspace, type)

            // web-standalone: idMap is serialized as array of entries over HTTP (JSON doesn't support Map)
            if (Array.isArray(result.idMap)) {
                result.idMap = new Map(result.idMap)
            }

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
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return fileIPC.getCollectionById(workspace, collectionId)
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
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return fileIPC.createCollection(workspace, collection)
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

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            const collectionsClone = structuredClone(collections)
            await Promise.all(collectionsClone.map(collection => serializeRequestFiles(collection)))
            console.log('createCollections: serialized', collectionsClone)
            return fileIPC.createCollections(workspace, collectionsClone)
        }
    }

    await db.collections.bulkPut(collections)

    return {
        error: null,
        results: []
    }
}

async function transformFileToFileObject(file: File): Promise<FileObject> {
    try {
        return { name: file.name, type: file.type, buffer: await file.arrayBuffer() }
    } catch {
        return { name: file.name, type: file.type, buffer: new ArrayBuffer(0), bufferOmitted: true }
    }
}

function transformFileObjectToFile(file: FileObject): File | null {
    // Return null so the caller clears the reference — better to show "No File Selected"
    // than silently send 0 bytes.
    if(file.bufferOmitted) {
        return null
    }
    const buffer = Array.isArray(file.buffer) ? new Uint8Array(file.buffer as number[]) : file.buffer
    return new File([buffer], file.name, { type: file.type })
}

async function serializeRequestFiles(collection: Partial<CollectionItem>) {
    if(collection.body && collection.body.fileName && collection.body.fileName instanceof File) {
        collection.body.fileName = await transformFileToFileObject(collection.body.fileName)
    }

    if(collection.body && collection.body.params) {
        for(const param of collection.body.params) {
            if(param.files) {
                // filter out non-file objects
                param.files = (param.files as any[]).filter(file => file instanceof File)
                param.files = await Promise.all(param.files.map(async file => await transformFileToFileObject(file as File)))
            }
        }
    }
}

function deserializeRequestFiles(collection: Partial<CollectionItem>) {
    if(collection.body && collection.body.fileName && 'buffer' in collection.body.fileName && (collection.body.fileName.buffer instanceof Uint8Array || Array.isArray(collection.body.fileName.buffer))) {
        collection.body.fileName = transformFileObjectToFile(collection.body.fileName) ?? undefined
    }

    if(collection.body && collection.body.params) {
        for(const param of collection.body.params) {
            if(param.files) {
                param.files = param.files.map(file => transformFileObjectToFile(file as FileObject)).filter(Boolean) as File[]
            }
        }
    }
}

async function serializeRequestResponseFiles(response: RequestFinalResponse) {
    if(response.request && response.request.body instanceof File) {
        response.request.body = await transformFileToFileObject(response.request.body)
    }

    if(response.request && response.request.original.body) {
        if(response.request.original.body.fileName && response.request.original.body.fileName instanceof File) {
            response.request.original.body.fileName = await transformFileToFileObject(response.request.original.body.fileName)
        }

        if(response.request.original.body.params) {
            for(const param of response.request.original.body.params) {
                if(param.files) {
                    // filter out non-file objects
                    param.files = (param.files as any[]).filter(file => file instanceof File)
                    param.files = await Promise.all(param.files.map(file => transformFileToFileObject(file as File)))
                }
            }
        }
    }
}

function deserializeRequestResponseFiles(response: RequestFinalResponse) {
    if(Array.isArray(response.buffer)) {
        response.buffer = new Uint8Array(response.buffer as unknown as number[]).buffer
    }

    if(response.request.body && (response.request.body.buffer instanceof Uint8Array || Array.isArray(response.request.body.buffer))) {
        response.request.body = transformFileObjectToFile(response.request.body) ?? undefined
    }

    if(response.request.original.body) {
        if(response.request.original.body.fileName && 'buffer' in response.request.original.body.fileName && (response.request.original.body.fileName.buffer instanceof Uint8Array || Array.isArray(response.request.original.body.fileName.buffer))) {
            response.request.original.body.fileName = transformFileObjectToFile(response.request.original.body.fileName) ?? undefined
        }

        if(response.request.original.body.params) {
            for(const param of response.request.original.body.params) {
                if(param.files) {
                    param.files = param.files.map(file => transformFileObjectToFile(file as FileObject)).filter(Boolean) as File[]
                }
            }
        }
    }
}

export async function updateCollection(workspaceId: string, collectionId: string, updatedFields: Partial<CollectionItem>): Promise<{ error: string | null }> {
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            await serializeRequestFiles(updatedFields)
            return fileIPC.updateCollection(workspace, collectionId, updatedFields)
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
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return fileIPC.deleteCollectionsByWorkspaceId(workspace)
        }
    }

    await db.collections.where({ workspaceId }).delete()
}

export async function deleteCollectionsByIds(workspaceId: string, collectionIds: string[]): Promise<{ error: string | null }> {
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return fileIPC.deleteCollectionsByIds(workspace, collectionIds)
        }
    }

    await db.collections.where(':id').anyOf(collectionIds).delete()

    return {
        error: null,
    }
}

// Responses

export async function getResponsesByCollectionId(workspaceId: string, collectionId: string): Promise<RequestFinalResponse[]> {
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            const responses = await fileIPC.getResponsesByCollectionId(workspace, collectionId)
            for(const response of responses) {
                deserializeRequestResponseFiles(response)
            }
            return responses
        }
    }

    return db.responses.where({ collectionId }).reverse().sortBy('createdAt')
}

export async function createResponse(workspaceId: string, response: RequestFinalResponse) {
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            await serializeRequestResponseFiles(response)
            return fileIPC.createResponse(workspace, response)
        }
    }

    await db.responses.put(response)
}

export async function updateResponse(workspaceId: string, collectionId: string, responseId: string, updatedFields: Partial<RequestFinalResponse>) {
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return fileIPC.updateResponse(workspace, collectionId, responseId, updatedFields)
        }
    }

    await db.responses.update(responseId, updatedFields)
}

export async function deleteResponse(workspaceId: string, collectionId: string, responseId: string) {
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return fileIPC.deleteResponse(workspace, collectionId, responseId)
        }
    }

    await db.responses.where({ _id: responseId }).delete()
}

export async function deleteResponsesByIds(workspaceId: string, collectionId: string, responseIds: string[]) {
    console.log('deleteResponsesByIds', {
        collectionId,
        responseIds,
    })

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return fileIPC.deleteResponsesByIds(workspace, collectionId, responseIds)
        }
    }

    await db.responses.where(':id').anyOf(responseIds).delete()
}

export async function deleteResponsesByCollectionIds(workspaceId: string, collectionIds: string[]) {
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return fileIPC.deleteResponsesByCollectionIds(workspace, collectionIds)
        }
    }

    await db.responses.where('collectionId').anyOf(collectionIds).delete()
}

export async function deleteResponsesByCollectionId(workspaceId: string, collectionId: string) {
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace._type === 'file') {
            return fileIPC.deleteResponsesByCollectionId(workspace, collectionId)
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
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return fileIPC.getWorkspacePlugins(workspace)
        }
    }

    const workspacePlugins = await db.plugins.where({ workspaceId }).toArray()

    const collectionIds = await getAllCollectionIdsForGivenWorkspace(workspaceId)
    const collectionItemPlugins = await db.plugins.where('collectionId').anyOf(collectionIds).toArray()

    return [
        ...workspacePlugins.filter(plugin => plugin.collectionId === null),
        ...collectionItemPlugins
    ]
}

export async function createPlugin(plugin: Plugin, workspaceId: string | null = null) {
    console.log('createPlugin', {
        plugin,
        workspaceId,
    })

    if(fileIPC && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return fileIPC.createPlugin(workspace, plugin)
        }
    }

    await db.plugins.put(plugin)
}

export async function updatePlugin(pluginId: string, updatedFields: Partial<Plugin>, workspaceId: string | null = null, collectionId: string | null = null) {
    console.log('updatePlugin', {
        pluginId,
        updatedFields,
        workspaceId,
        collectionId,
    })

    if(fileIPC && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return fileIPC.updatePlugin(workspace, collectionId, pluginId, updatedFields)
        }
    }

    await db.plugins.update(pluginId, updatedFields)
}

export async function deletePlugin(pluginId: string, workspaceId: string | null = null, collectionId: string | null = null) {
    console.log('deletePlugin', {
        pluginId,
        workspaceId,
        collectionId,
    })

    if(fileIPC && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return fileIPC.deletePlugin(workspace, collectionId, pluginId)
        }
    }

    await db.plugins.where({ _id: pluginId }).delete()
}

export async function deletePluginsByWorkspace(workspaceId: string) {
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return fileIPC.deletePluginsByWorkspace(workspace)
        }
    }

    await db.plugins.where({ workspaceId }).delete()
}

export async function deletePluginsByCollectionIds(workspaceId: string, collectionIds: string[]) {
    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return fileIPC.deletePluginsByCollectionIds(workspace, collectionIds)
        }
    }

    await db.plugins.where('collectionId').anyOf(collectionIds).delete()
}

// used for import
export async function createPlugins(plugins: Plugin[], workspaceId: string | null = null) {
    console.log('createPlugins', {
        plugins,
        workspaceId,
    })

    if(fileIPC && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace._type === 'file') {
            return fileIPC.createPlugins(workspace, plugins)
        }
    }

    await db.plugins.bulkPut(plugins)
}
