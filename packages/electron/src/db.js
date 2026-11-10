const { logMethodCall, hashText } = require('../shared/helpers.js')
const chokidar = require('chokidar')
const fs = require('fs').promises
const path = require('path')
const dotenv = require('dotenv')
const dbHelpers = require('./db-helpers')
const fileUtils = require('./file-utils')
const TaskQueue = require('./task-queue')
const { createDatabase } = require('../shared/db.js')

/** @type{chokidar.FSWatcher} */
let workspaceWatcher = null
// the folder the watcher is on, null when none
let workspaceWatcherLocation = null
// settles once the watcher has read the folder, before which it reports no change
let workspaceWatcherReady = Promise.resolve()
// the reads of the workspace shown so far, so a change reported before one of them is left to it
let watchedReads = 0
// the watcher stopped watching a path that may come back, which only a new watcher undoes: one it was told to stop
// watching, as a folder renamed by a copy is, so a folder given that name again is watched, or the workspace's folder,
// deleted, so the folder made again is
let workspaceWatcherMissesPaths = false
const database = createDatabase(fileUtils, dbHelpers, dotenv, () => workspaceWatcher && {
    unwatch: paths => {
        workspaceWatcherMissesPaths = true
        workspaceWatcher.unwatch(paths)
    },
})
const { getIdMap } = database

// every file workspace call runs here one at a time, and so does the watcher's check of a change, which then never
// reads a file while Restfox is still writing it
const operationQueue = new TaskQueue()

// Restfox's own write when the path still holds what Restfox last left there, so a change another program made, also
// right after or between Restfox's writes, reloads the workspace
async function isOwnChange(event, path) {
    const ownWrite = fileUtils.ownWrites.get(path)
    if (!ownWrite) {
        return null
    }
    const kindForEvent = { add: 'file', change: 'file', addDir: 'dir', unlink: 'absent', unlinkDir: 'absent' }[event]
    return ownWrite.kind === kindForEvent && await holdsOwnWrite(path, ownWrite) ? ownWrite : null
}

async function holdsOwnWrite(path, ownWrite) {
    try {
        if (ownWrite.kind === 'file') {
            return ownWrite.hash === hashText(await fs.readFile(path, 'utf8'))
        }
        if (ownWrite.kind === 'dir') {
            return (await fs.stat(path)).isDirectory()
        }
        return !await fileUtils.pathExists(path)
    } catch {
        // gone or unreadable since: not what Restfox left
        return false
    }
}

// A path another program changed while no watcher saw it, such as a branch checked out while another workspace was
// shown, is that program's, so text Restfox wrote there before is not taken for its own once the watcher is back
async function forgetOwnWritesChangedSince(location) {
    for (const [ownPath, ownWrite] of fileUtils.ownWrites) {
        const relative = path.relative(location, ownPath)
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && !await holdsOwnWrite(ownPath, ownWrite)) {
            fileUtils.ownWrites.delete(ownPath)
        }
    }
}

function isWorkspaceFolder(changedPath, location) {
    return path.resolve(changedPath) === path.resolve(location)
}

// watch is for the workspace the window shows: a read for anything else, such as an export, the Edit Tag list or a
// duplicate's copy, leaves the watcher on the open workspace
async function getCollectionForWorkspace(workspace, type, watch = false) {
    logMethodCall('getCollectionForWorkspace', {
        workspace,
        type,
        watch,
    })

    getIdMap(workspace.location)

    try {
        let idMapBeforeClear = null

        if (type === null) {
            // first, as it checks the folder can be read, so a folder gone for a moment, such as on a network share,
            // leaves the watcher where it was
            idMapBeforeClear = await database.clearCollectionIdMap(workspace)

            // the watcher comes from another folder or none, so changes to this one went unseen meanwhile
            const watcherMoves = watch && workspaceWatcherLocation !== workspace.location
            if (watch) {
                // this read covers every change reported before it
                watchedReads++
            }
            // The watcher stays on while the same folder is read again, as a new one would watch every file anew, which
            // holds up the app on a large workspace
            const watcherReplaced = watch && (watcherMoves || workspaceWatcherMissesPaths)
            if (watcherReplaced) {
                if (workspaceWatcher) {
                    await workspaceWatcher.close()
                    workspaceWatcher = null
                    workspaceWatcherLocation = null
                }
            }

            if (watcherReplaced) {
                if (watcherMoves) {
                    await forgetOwnWritesChangedSince(workspace.location)
                }
                workspaceWatcherMissesPaths = false
                const watcher = chokidar.watch(workspace.location, {
                    ignored: (path) => /(^|[\/\\])\../.test(path) && !/\.env$/.test(path), // ignore dotfiles except .env
                    ignoreInitial: true, // (default: false) if set to false then add/addDir events are also emitted for matching paths while instantiating the watching as chokidar discovers these file paths (before the ready event)
                    awaitWriteFinish: {
                        stabilityThreshold: 80,
                        pollInterval: 10
                    }, // was getting an add & change event even thought there was only one fs.writeFile wx call - this seems to fix it
                }).on('all', (event, path) => {
                    console.log(event, path)
                    // chokidar can stop watching the folder once it is deleted, so the next read watches it anew
                    if (event === 'unlinkDir' && workspaceWatcher === watcher && isWorkspaceFolder(path, workspace.location)) {
                        workspaceWatcherMissesPaths = true
                    }
                    const readsBefore = watchedReads
                    operationQueue.enqueue(async() => {
                        const ownWrite = await isOwnChange(event, path)
                        // once another program changed the path, text Restfox wrote there before, such as a branch checked
                        // out again, is that program's too, also for a change the watcher reported just before a reload
                        // replaced it, which the new one does not report
                        if (ownWrite === null) {
                            fileUtils.ownWrites.delete(path)
                        }
                        // a read since, of a reload or another workspace, or the watcher that replaced this one, covers the
                        // page from here
                        if (workspaceWatcher !== watcher || watchedReads !== readsBefore) {
                            return
                        }
                        globalThis.electronApplicationWindow.webContents.send('workspaceChanged', event, path, ownWrite !== null, ownWrite?.reason ?? null)
                    }).catch(error => console.error('workspaceChanged', error))
                })
                workspaceWatcher = watcher
                workspaceWatcherLocation = workspace.location
                workspaceWatcherReady = new Promise(resolve => watcher.once('ready', resolve))
            }
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
    operationQueue,
    whenWorkspaceWatcherReady: () => workspaceWatcherReady,
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
