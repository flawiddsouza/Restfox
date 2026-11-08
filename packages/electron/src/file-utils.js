const fileUtilsShared = require('../shared/file-utils.js')
const { hashText } = require('../shared/helpers.js')
const { readdirIgnoreError, pathExists, encodeFilename, decodeFilename, transformFileObjectToSaveableFileObject, transformSavedFileObjectToFileObject } = fileUtilsShared
const fs = require('fs').promises
const fse = require('fs-extra')
const pathLib = require('path')

// What Restfox itself last left at each path it wrote: { kind: 'file', hash }, { kind: 'dir' } or { kind: 'absent' },
// with the reason. The workspace watcher takes a change as Restfox's own only when the path still holds exactly that,
// so writes the watcher reports as one change, or an outside change made right after, are told apart by content
const ownWrites = new Map()

function recordOwnWrite(path, state, reason) {
    ownWrites.set(path, { ...state, reason })
}

// after a write that failed partway, what the path holds is unknown, so a change there counts as made outside Restfox
function forgetOwnWrite(path) {
    ownWrites.delete(path)
}

async function writeRecorded(path, write, reason) {
    try {
        const text = await write()
        recordOwnWrite(path, { kind: 'file', hash: hashText(text) }, reason)
        return text
    } catch (e) {
        forgetOwnWrite(path)
        throw e
    }
}

function writeFileJson(path, data, reason) {
    return writeRecorded(path, () => fileUtilsShared.writeFileJson(path, data), reason)
}

function writeFileJsonInPlace(path, data, reason) {
    return writeRecorded(path, () => fileUtilsShared.writeFileJsonInPlace(path, data), reason)
}

// with wx, a file that already exists is left untouched, so what Restfox last left there still stands
async function writeNewOnly(path, write, reason) {
    try {
        const text = await write()
        recordOwnWrite(path, { kind: 'file', hash: hashText(text) }, reason)
        return text
    } catch (e) {
        if (e.code !== 'EEXIST') {
            forgetOwnWrite(path)
        }
        throw e
    }
}

function writeFileJsonNewOnly(path, data, reason) {
    return writeNewOnly(path, () => fileUtilsShared.writeFileJsonNewOnly(path, data), reason)
}

function writeEmptyFileNewOnly(path, reason) {
    return writeNewOnly(path, () => fileUtilsShared.writeEmptyFileNewOnly(path), reason)
}

async function deleteFileOrFolder(path, reason) {
    const isDirectory = (await fs.stat(path)).isDirectory()
    try {
        if (isDirectory) {
            await fs.rmdir(path)
        } else {
            await fs.unlink(path)
        }
        recordOwnWrite(path, { kind: 'absent' }, reason)
    } catch (e) {
        forgetOwnWrite(path)
        throw e
    }
}

async function mkdir(path, reason) {
    try {
        await fileUtilsShared.mkdir(path)
    } catch (e) {
        if (e.code !== 'EEXIST') {
            forgetOwnWrite(path)
        }
        throw e
    }
    recordOwnWrite(path, { kind: 'dir' }, reason)
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

// the paths in a folder, relative to it, with whether each is a folder
async function listTree(dir, relativeDir = '') {
    const entries = []
    for (const entry of await fs.readdir(pathLib.join(dir, relativeDir), { withFileTypes: true })) {
        const relativePath = pathLib.join(relativeDir, entry.name)
        entries.push({ relativePath, isDirectory: entry.isDirectory() })
        if (entry.isDirectory()) {
            entries.push(...await listTree(dir, relativePath))
        }
    }
    return entries
}

// the move itself is done, so a moved file that cannot be read back is only forgotten
async function recordMovedFile(path, reason) {
    try {
        recordOwnWrite(path, { kind: 'file', hash: hashText(await fs.readFile(path, 'utf8')) }, reason)
    } catch {
        forgetOwnWrite(path)
    }
}

async function renameFileOrFolder(oldPath, newPath, reason, workspaceWatcher = null) {
    console.log('Renaming', oldPath, 'to', newPath)

    const isDirectory = (await fs.stat(oldPath)).isDirectory()
    const entries = isDirectory ? await listTree(oldPath) : []

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
        for (const path of [oldPath, newPath, ...entries.flatMap(entry => [pathLib.join(oldPath, entry.relativePath), pathLib.join(newPath, entry.relativePath)])]) {
            forgetOwnWrite(path)
        }
        throw e
    }

    recordOwnWrite(oldPath, { kind: 'absent' }, reason)
    if (isDirectory) {
        recordOwnWrite(newPath, { kind: 'dir' }, reason)
        for (const entry of entries) {
            recordOwnWrite(pathLib.join(oldPath, entry.relativePath), { kind: 'absent' }, reason)
            if (entry.isDirectory) {
                recordOwnWrite(pathLib.join(newPath, entry.relativePath), { kind: 'dir' }, reason)
            } else {
                await recordMovedFile(pathLib.join(newPath, entry.relativePath), reason)
            }
        }
    } else {
        await recordMovedFile(newPath, reason)
    }
}

module.exports = {
    readdirIgnoreError,
    pathExists,
    encodeFilename,
    decodeFilename,
    writeFileJson,
    writeFileJsonInPlace,
    writeFileJsonNewOnly,
    writeEmptyFileNewOnly,
    deleteFileOrFolder,
    mkdir,
    renameFileOrFolder,
    transformFileObjectToSaveableFileObject,
    transformSavedFileObjectToFileObject,
    ownWrites,
}
