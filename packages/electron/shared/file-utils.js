import fs from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'

export async function readdirIgnoreError(path) {
    try {
        return await fs.readdir(path)
    } catch (e) {
        return []
    }
}

export async function pathExists(pathToCheck) {
    return fs.access(pathToCheck).then(() => true).catch(() => false)
}

export function encodeFilename(name) {
    let encodedName = ''
    const forbiddenChars = {
        '<': '&lt;',
        '>': '&gt;',
        ':': '&#58;',
        '"': '&quot;',
        '/': '&#47;',
        '\\': '&#92;',
        '|': '&#124;',
        '?': '&#63;',
        '*': '&#42;',
    }

    // Encode forbidden characters and control characters
    for (let index = 0; index < name.length; index++) {
        const char = name[index]
        const charCode = name.charCodeAt(index)
        if (forbiddenChars[char]) {
            encodedName += forbiddenChars[char]
        } else if (charCode < 32) {
            encodedName += `&#${charCode};`
        } else {
            encodedName += char
        }
    }

    // Remove trailing space or period for Windows compatibility
    encodedName = encodedName.replace(/[ .]+$/, match => match.split('').map(c => `&#${c.charCodeAt(0)};`).join(''))

    return encodedName
}

export function decodeFilename(name) {
    const decodeMap = {
        '&lt;': '<',
        '&gt;': '>',
        '&#58;': ':',
        '&quot;': '"',
        '&#47;': '/',
        '&#92;': '\\',
        '&#124;': '|',
        '&#63;': '?',
        '&#42;': '*',
    }

    // Include ASCII control codes (0-31) in the decode map
    for (let i = 0; i < 32; i++) {
        decodeMap[`&#${i};`] = String.fromCharCode(i)
    }

    const regex = new RegExp(Object.keys(decodeMap).join('|'), 'g')
    return name.replace(regex, matched => decodeMap[matched])
}

// each write returns the text it wrote, from which callers take the file's new version
export async function writeFileJson(filePath, data) {
    const text = JSON.stringify(data, null, 4)
    await writeFileReplacing(filePath, text)
    return text
}

// The text goes into a file beside the target first, which then takes the target's place, so a write that fails
// partway, such as on a full disk, leaves the file as it was rather than cut short, which a later load could not read.
// The name starts with a dot, which the workspace watcher and loader skip. The file keeps its permissions, and a link
// keeps pointing where it did, as the file it points to is the one replaced. Written in place, as before: a link to a
// file that is not there; a file this process may not write, such as a read-only one, which a move would replace where
// the write is refused; a file another user or group owns, which the move would give to this one, as on a workspace
// several users share; a file with other hard links, which would stop sharing its text; a folder this process may not
// create files in; and a file the move cannot replace, such as one another program holds open on Windows. Access lists
// and extended attributes on a file are not kept
async function writeFileReplacing(filePath, text) {
    let stats = null
    try {
        stats = await fs.lstat(filePath)
        if (stats.isSymbolicLink()) {
            const targetPath = await fs.realpath(filePath)
            stats = await fs.lstat(targetPath)
            filePath = targetPath
        }
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err
        }
    }
    const ownedByAnother = stats !== null && typeof process.getuid === 'function' && typeof process.getgid === 'function' && (stats.uid !== process.getuid() || stats.gid !== process.getgid())
    if (stats && (stats.isSymbolicLink() || ownedByAnother || stats.nlink > 1 || !await fs.access(filePath, fs.constants.W_OK).then(() => true, () => false))) {
        await fs.writeFile(filePath, text)
        return
    }
    // not named after the file, as a long name plus anything added to it could pass the limit on a file name
    const tempPath = path.join(path.dirname(filePath), `.${randomBytes(6).toString('hex')}.tmp`)
    try {
        await fs.writeFile(tempPath, text)
    } catch (err) {
        await fs.rm(tempPath, { force: true }).catch(() => {})
        if (err.code === 'EACCES' || err.code === 'EPERM') {
            await fs.writeFile(filePath, text)
            return
        }
        throw err
    }
    if (stats) {
        try {
            // the mode given on creation passes through the umask, which can drop bits such as group write
            await fs.chmod(tempPath, stats.mode & 0o7777)
        } catch {
            // a file system that cannot set it, such as some network mounts
            await fs.rm(tempPath, { force: true }).catch(() => {})
            await fs.writeFile(filePath, text)
            return
        }
    }
    try {
        await fs.rename(tempPath, filePath)
    } catch {
        await fs.rm(tempPath, { force: true }).catch(() => {})
        await fs.writeFile(filePath, text)
    }
}

// In place, for a change so small and so repeated that a file beside each target costs more than it protects: a new
// sort order, which a create or a drag writes to every sibling
export async function writeFileJsonInPlace(filePath, data) {
    const text = JSON.stringify(data, null, 4)
    await fs.writeFile(filePath, text)
    return text
}

export async function writeFileJsonNewOnly(filePath, data) {
    const text = JSON.stringify(data, null, 4)
    await fs.writeFile(filePath, text, { flag: 'wx' })
    return text
}

export async function writeEmptyFileNewOnly(filePath) {
    await fs.writeFile(filePath, '', { flag: 'wx' })
    return ''
}

export async function mkdir(dirPath) {
    await fs.mkdir(dirPath)
}

export function transformFileObjectToSaveableFileObject(file) {
    if(file.bufferOmitted) {
        return { name: file.name, type: file.type, buffer: '', bufferOmitted: true }
    }
    return { name: file.name, type: file.type, buffer: Buffer.from(file.buffer).toString('base64') }
}

export function transformSavedFileObjectToFileObject(file, deserializeBuffer = buffer => buffer) {
    if(file.bufferOmitted) {
        return { name: file.name, type: file.type, buffer: deserializeBuffer(Buffer.alloc(0)), bufferOmitted: true }
    }
    return { name: file.name, type: file.type, buffer: deserializeBuffer(Buffer.from(file.buffer, 'base64')) }
}
