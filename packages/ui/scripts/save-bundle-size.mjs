import { execSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import path from 'path'
import { getFileSize, humanFileSize, __dirname } from './helpers.mjs'

const uiBundlePath = path.join(__dirname, '../dist')

rmSync(uiBundlePath, { recursive: true, force: true })

execSync('npm run build', {
    cwd: path.join(uiBundlePath, '..')
})

const fileList = {}
let totalSize = 0

for(const filename of readdirSync(uiBundlePath)) {
    let filenameKey = filename
    if(filename.startsWith('workbox-')) {
        filenameKey = 'workbox.xxxxxxxx.js'
    }
    const fullFilePath = path.join(uiBundlePath, filename)
    fileList[filenameKey] = getFileSize(fullFilePath)
    totalSize += fileList[filenameKey]
}

fileList['totalSize'] = totalSize
fileList['totalSizeHuman'] = humanFileSize(totalSize)

const bundleSizeFilePath = path.join(__dirname, '..', 'bundle-size.json')

const savedBundleSize = existsSync(bundleSizeFilePath) ? JSON.parse(readFileSync(bundleSizeFilePath)) : null

if(savedBundleSize) {
    fileList['totalSizeDiff'] = fileList['totalSize'] - savedBundleSize['totalSize']
    fileList['totalSizeDiffHuman'] = humanFileSize(Math.abs(fileList['totalSizeDiff']))
    if(fileList['totalSizeDiff'] < 0) {
        fileList['totalSizeDiffHuman'] = `-${fileList['totalSizeDiffHuman']}`
    }
}

writeFileSync(bundleSizeFilePath, JSON.stringify(fileList, null, 4) + '\n')
