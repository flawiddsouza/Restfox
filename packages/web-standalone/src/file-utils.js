import * as fileUtilsShared from '../../electron/shared/file-utils.js'
import { transformSavedFileObjectToFileObject as transformSavedFileObjectToFileObjectShared } from '../../electron/shared/file-utils.js'
export { readdirIgnoreError, pathExists, encodeFilename, decodeFilename, transformFileObjectToSaveableFileObject } from '../../electron/shared/file-utils.js'
import fs from 'fs/promises'

export async function writeFileJson(filePath, data, _fsLog, _reason) {
    await fileUtilsShared.writeFileJson(filePath, data)
}

export async function writeFileJsonNewOnly(filePath, data, _fsLog, _reason) {
    await fileUtilsShared.writeFileJsonNewOnly(filePath, data)
}

export async function writeEmptyFileNewOnly(filePath, _fsLog, _reason) {
    await fileUtilsShared.writeEmptyFileNewOnly(filePath)
}

export async function deleteFileOrFolder(filePath, _fsLog, _reason) {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) {
        // Use recursive removal to handle non-empty directories (e.g. folder groups with child requests)
        await fs.rm(filePath, { recursive: true, force: true })
    } else {
        await fs.unlink(filePath)
    }
}

export async function mkdir(dirPath, _fsLog, _reason) {
    await fileUtilsShared.mkdir(dirPath)
}

export async function renameFileOrFolder(oldPath, newPath, _fsLog, _reason) {
    try {
        await fs.rename(oldPath, newPath)
    } catch {
        // fallback for cross-device moves (shouldn't happen in Docker but just in case)
        await fs.cp(oldPath, newPath, { recursive: true })
        await fs.rm(oldPath, { recursive: true })
    }
}

export function transformSavedFileObjectToFileObject(file) {
    return transformSavedFileObjectToFileObjectShared(file, buffer => Array.from(buffer))
}
