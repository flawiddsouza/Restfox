import fs from 'fs/promises'
import path from 'path'
import { platform } from 'os'
import { createHash } from 'crypto'
import { pathExists } from './file-utils.js'

export function hashText(text) {
    return createHash('sha256').update(text).digest('hex')
}

// The version of a request, socket or gRPC item's file: a save is refused when the file no longer holds what the screen
// came from. Its sort order is left out, as only merges and creates write it, so a sidebar change made in another
// window does not refuse that window's next save of the item. A text that is not JSON is taken whole
export function itemFileVersion(text) {
    let data
    try {
        data = JSON.parse(text)
    } catch {
        return hashText(text)
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return hashText(text)
    }
    const rest = { ...data }
    delete rest.sortOrder
    return hashText(JSON.stringify(rest))
}

const LOG_ONLY_METHOD_NAME = true
const LOG_ONLY_METHOD_NAME_EXCEPT = []

export function logMethodCall(methodName, args) {
    if (LOG_ONLY_METHOD_NAME && !LOG_ONLY_METHOD_NAME_EXCEPT.includes(methodName)) {
        console.log(methodName)
        return
    }
    console.log(methodName, args)
}

export async function readFile(filePath, workspaceLocation = null, onError = () => {}) {
    let filePathResolved = ''
    let filePathExists = false

    if (workspaceLocation !== null) {
        filePathResolved = path.resolve(path.join(workspaceLocation, filePath))
        filePathExists = await pathExists(filePathResolved)
    }

    if (!filePathExists) {
        filePathResolved = path.resolve(filePath)
        filePathExists = await pathExists(filePathResolved)
    }

    if (!filePathExists) {
        return {
            error: `Cannot find file: ${filePathResolved}`,
            content: null,
        }
    }

    try {
        const content = await fs.readFile(filePathResolved, 'utf8')

        return {
            error: null,
            content,
        }
    } catch (error) {
        onError(error)
        return {
            error: error.message + ' ' + filePathResolved,
            content: null,
        }
    }
}

export function removePrefixFromString(str, prefix) {
    if (str.startsWith(prefix)) {
        let returnStr = str.slice(prefix.length)

        // normalize path separators, so that they are always posix, just for ids
        // makes response tags work cross platform
        if (platform() === 'win32') {
            returnStr = returnStr.replaceAll(path.win32.sep, path.posix.sep)
        }

        return returnStr
    }

    return str
}
