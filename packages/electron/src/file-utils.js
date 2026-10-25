const fileUtilsShared = require('../shared/file-utils.js')
const { readdirIgnoreError, pathExists, encodeFilename, decodeFilename, transformFileObjectToSaveableFileObject, transformSavedFileObjectToFileObject } = fileUtilsShared
const fs = require('fs').promises
const fse = require('fs-extra')
const pathLib = require('path')

async function writeFileJson(path, data, fsLog, fsLogReason) {
    const id = Date.now()
    const event = await pathExists(path) ? 'change' : 'add'
    fsLog.push({ id, event: event, path, reason: fsLogReason })
    try {
        await fileUtilsShared.writeFileJson(path, data)
    } catch (e) {
        fsLog.slice(fsLog.findIndex(e => e.id === id), 1)
        throw e
    }
}

async function writeFileJsonNewOnly(path, data, fsLog, fsLogReason) {
    const id = Date.now()
    fsLog.push({ id, event: 'add', path, reason: fsLogReason })
    try {
        await fileUtilsShared.writeFileJsonNewOnly(path, data)
    } catch (e) {
        fsLog.slice(fsLog.findIndex(e => e.id === id), 1)
        throw e
    }
}

async function writeEmptyFileNewOnly(path, fsLog, fsLogReason) {
    const id = Date.now()
    fsLog.push({ id, event: 'add', path, reason: fsLogReason })
    try {
        await fileUtilsShared.writeEmptyFileNewOnly(path)
    } catch (e) {
        fsLog.slice(fsLog.findIndex(e => e.id === id), 1)
        throw e
    }
}

async function deleteFileOrFolder(path, fsLog, fsLogReason) {
    const id = Date.now()
    const isDirectory = (await fs.stat(path)).isDirectory()
    const event = isDirectory ? 'unlinkDir' : 'unlink'
    fsLog.push({ id, event, path, reason: fsLogReason })
    try {
        if (isDirectory) {
            await fs.rmdir(path)
        } else {
            await fs.unlink(path)
        }
    } catch (e) {
        fsLog.slice(fsLog.findIndex(e => e.id === id), 1)
        throw e
    }
}

async function mkdir(path, fsLog, fsLogReason)
{
    const id = Date.now()
    fsLog.push({ id, event: 'addDir', path, reason: fsLogReason })
    try {
        await fileUtilsShared.mkdir(path)
    } catch (e) {
        fsLog.slice(fsLog.findIndex(e => e.id === id), 1)
        throw e
    }
}

async function hasSubFolders(dir) {
    const files = await fs.readdir(dir)
    for (const file of files) {
        const stats = await fs.stat(pathLib.join(dir, file))
        if (stats.isDirectory()) {
            return true
        }
    }
    return false
}

async function renameFileOrFolder(oldPath, newPath, fsLog, fsLogReason, workspaceWatcher = null) {
    console.log('Renaming', oldPath, 'to', newPath)

    const id = Date.now()
    const isDirectory = (await fs.stat(oldPath)).isDirectory()

    if (isDirectory) {
        await renameAndLogRecursively(oldPath, newPath, fsLog, fsLogReason, id)
    } else {
        logEvent(fsLog, id, 'unlink', oldPath, fsLogReason)
        logEvent(fsLog, id, 'add', newPath, fsLogReason)
    }

    try {
        if (process.platform === 'win32' && isDirectory && await hasSubFolders(oldPath)) {
            console.log('Copying and deleting directory due to Windows rename issue')
            if (workspaceWatcher) {
                const oldPathGlob = pathLib.join(oldPath, '**', '*')
                console.log(    `Unwatching ${oldPathGlob}`)
                workspaceWatcher.unwatch(oldPathGlob)
            }
            await fse.copy(oldPath, newPath)
            await fs.rm(oldPath, { recursive: true })
        } else {
            await fs.rename(oldPath, newPath)
        }
    } catch (e) {
        fsLog.slice(fsLog.findIndex(e => e.id === id), 1)
        throw e
    }
}

async function renameAndLogRecursively(oldPath, newPath, fsLog, fsLogReason, id, isSubFolder = false) {
    if (!isSubFolder) { // Only log the root folder being renamed on the first call
        logEvent(fsLog, id, 'unlinkDir', oldPath, fsLogReason)
        logEvent(fsLog, id, 'addDir', newPath, fsLogReason)
    }

    let entries = await fs.readdir(oldPath, { withFileTypes: true })
    for (let entry of entries) {
        const oldEntryPath = pathLib.join(oldPath, entry.name)
        const newEntryPath = pathLib.join(newPath, entry.name)

        if (entry.isDirectory()) {
            // Log and rename subdirectories recursively
            logEvent(fsLog, id, 'unlinkDir', oldEntryPath, fsLogReason)
            logEvent(fsLog, id, 'addDir', newEntryPath, fsLogReason)
            await renameAndLogRecursively(oldEntryPath, newEntryPath, fsLog, fsLogReason, id, true)
        } else {
            // Log rename events for files
            logEvent(fsLog, id, 'unlink', oldEntryPath, fsLogReason)
            logEvent(fsLog, id, 'add', newEntryPath, fsLogReason)
        }
    }
}

function logEvent(fsLog, id, event, path, reason) {
    fsLog.push({ id, event, path, reason })
}

module.exports = {
    readdirIgnoreError,
    pathExists,
    encodeFilename,
    decodeFilename,
    writeFileJson,
    writeFileJsonNewOnly,
    writeEmptyFileNewOnly,
    deleteFileOrFolder,
    mkdir,
    renameFileOrFolder,
    transformFileObjectToSaveableFileObject,
    transformSavedFileObjectToFileObject,
}
