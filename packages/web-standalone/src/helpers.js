export { readFile, removePrefixFromString } from '../../electron/shared/helpers.js'
import fs from 'fs/promises'
import path from 'path'

export async function browseDirectory(dirPath) {
    let resolvedPath = dirPath ? path.resolve(dirPath) : process.cwd()

    const stat = await fs.stat(resolvedPath)
    if (!stat.isDirectory()) {
        throw new Error('Path is not a directory')
    }

    const entries = await fs.readdir(resolvedPath, { withFileTypes: true })

    const directories = entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => ({
            name: entry.name,
            path: path.join(resolvedPath, entry.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

    const parentPath = path.dirname(resolvedPath)

    return {
        currentPath: resolvedPath,
        parentPath: parentPath !== resolvedPath ? parentPath : null,
        directories,
    }
}
