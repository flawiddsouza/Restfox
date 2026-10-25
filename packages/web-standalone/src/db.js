import { logMethodCall } from '../../electron/shared/helpers.js'
import dotenv from 'dotenv'
import * as dbHelpers from './db-helpers.js'
import * as fileUtils from './file-utils.js'
import { createDatabase } from '../../electron/shared/db.js'

const database = createDatabase(fileUtils, dbHelpers, dotenv)
const { getIdMap } = database

async function getCollectionForWorkspace(workspace, type) {
    logMethodCall('getCollectionForWorkspace', { workspace, type })

    try {
        let idMapBeforeClear = null
        getIdMap(workspace.location)

        if (type === null) {
            idMapBeforeClear = await database.clearCollectionIdMap(workspace)
        }

        const result = await database.readCollectionForWorkspace(workspace, type, idMapBeforeClear)
        return { ...result, idMap: result.idMap ? [...result.idMap.entries()] : null }
    } catch (error) {
        return { error: { message: error.message }, collection: [], workspace: null, idMap: null }
    }
}

async function deleteCollectionsByIds(workspace, collectionIds) {
    logMethodCall('deleteCollectionsByIds', { workspace, collectionIds })
    const idMap = getIdMap(workspace.location)
    try {
        return await database.deleteCollectionsByIds(workspace, collectionIds, idMap)
    } catch (err) {
        console.error('deleteCollectionsByIds', err)
        return { error: `Error deleting collections: ${err.message}` }
    }
}

export const { getWorkspaceAtLocation, updateWorkspace, ensureEmptyFolderOrEmptyWorkspace, getCollectionById, createCollection, createCollections, updateCollection, deleteCollectionsByWorkspaceId, getResponsesByCollectionId, createResponse, updateResponse, deleteResponse, deleteResponsesByIds, deleteResponsesByCollectionIds, deleteResponsesByCollectionId, getWorkspacePlugins, createPlugin, updatePlugin, deletePlugin, deletePluginsByWorkspace, deletePluginsByCollectionIds, createPlugins } = database

export { getCollectionForWorkspace, deleteCollectionsByIds }
