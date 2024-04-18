import { readdirSync, statSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
export const __dirname = path.dirname(__filename)

export function humanFileSize(size) {
    var i = size == 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return (size / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

export function getDirSize(directory) {
    const files = readdirSync(directory)
    return files.reduce((prev, filename) => {
        const fullFilePath = path.join(directory, filename)
        const stats = statSync(fullFilePath)
        const size = stats.isDirectory() ? getDirSize(fullFilePath) : stats.size
        return prev + size
    }, 0)
}

export function getFileSize(fullFilePath) {
    const stats = statSync(fullFilePath)
    return stats.isDirectory() ? getDirSize(fullFilePath) : stats.size
}
