const { logMethodCall } = require('../shared/helpers.js')
const chokidar = require('chokidar')
const dotenv = require('dotenv')
const dbHelpers = require('./db-helpers')
const fileUtils = require('./file-utils')
const { createDatabase } = require('../shared/db.js')

/** @type{chokidar.FSWatcher} */
let workspaceWatcher = null
const database = createDatabase(fileUtils, dbHelpers, dotenv, () => workspaceWatcher)
const { getIdMap, fsLog } = database

async function getCollectionForWorkspace(workspace, type) {
    logMethodCall('getCollectionForWorkspace', {
        workspace,
        type,
    })

    getIdMap(workspace.location)

    try {
        let idMapBeforeClear = null

        if (type === null) {
            if (workspaceWatcher) {
                await workspaceWatcher.close()
                workspaceWatcher = null
            }

            idMapBeforeClear = await database.clearCollectionIdMap(workspace)

            workspaceWatcher = chokidar.watch(workspace.location, {
                ignored: (path) => /(^|[\/\\])\../.test(path) && !/\.env$/.test(path), // ignore dotfiles except .env
                ignoreInitial: true, // (default: false) if set to false then add/addDir events are also emitted for matching paths while instantiating the watching as chokidar discovers these file paths (before the ready event)
                awaitWriteFinish: {
                    stabilityThreshold: 80,
                    pollInterval: 10
                }, // was getting an add & change event even thought there was only one fs.writeFile wx call - this seems to fix it
            }).on('all', (event, path) => {
                console.log(event, path)
                let controlledChange = false
                let controlledChangeReason = null
                const checkIfFsLogExists = fsLog.findIndex((log) => log.path === path && log.event === event)
                if (checkIfFsLogExists !== -1) {
                    controlledChangeReason = fsLog[checkIfFsLogExists].reason ?? null
                    fsLog.splice(checkIfFsLogExists, 1)
                    controlledChange = true
                }
                globalThis.electronApplicationWindow.webContents.send('workspaceChanged', event, path, controlledChange, controlledChangeReason)
            })
        }

        const result = await database.readCollectionForWorkspace(workspace, type, idMapBeforeClear)
        return result
    } catch (error) {
        return {
            error,
            collection: [],
            workspace: null,
            idMap: null,
        }
    }
}

async function deleteCollectionsByIds(workspace, collectionIds) {
    logMethodCall('deleteCollectionsByIds', {
        workspace,
        collectionIds,
    })

    const idMap = getIdMap(workspace.location)

    try {
        return await database.deleteCollectionsByIds(workspace, collectionIds, idMap)
    } catch (err) {
        console.error(arguments.callee.name, err)
        return {
            error: `Error deleting collections: ${err.message}`,
        }
    }
}

module.exports = {
    getWorkspaceAtLocation: database.getWorkspaceAtLocation,
    updateWorkspace: database.updateWorkspace,
    ensureEmptyFolderOrEmptyWorkspace: database.ensureEmptyFolderOrEmptyWorkspace,
    getCollectionForWorkspace,
    getCollectionById: database.getCollectionById,
    createCollection: database.createCollection,
    createCollections: database.createCollections,
    updateCollection: database.updateCollection,
    deleteCollectionsByWorkspaceId: database.deleteCollectionsByWorkspaceId,
    deleteCollectionsByIds,
    getResponsesByCollectionId: database.getResponsesByCollectionId,
    createResponse: database.createResponse,
    updateResponse: database.updateResponse,
    deleteResponse: database.deleteResponse,
    deleteResponsesByIds: database.deleteResponsesByIds,
    deleteResponsesByCollectionIds: database.deleteResponsesByCollectionIds,
    deleteResponsesByCollectionId: database.deleteResponsesByCollectionId,
    getWorkspacePlugins: database.getWorkspacePlugins,
    createPlugin: database.createPlugin,
    updatePlugin: database.updatePlugin,
    deletePlugin: database.deletePlugin,
    deletePluginsByWorkspace: database.deletePluginsByWorkspace,
    deletePluginsByCollectionIds: database.deletePluginsByCollectionIds,
    createPlugins: database.createPlugins,
}
