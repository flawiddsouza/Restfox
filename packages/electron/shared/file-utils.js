import fs from 'fs/promises'

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

export async function writeFileJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 4))
}

export async function writeFileJsonNewOnly(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 4), { flag: 'wx' })
}

export async function writeEmptyFileNewOnly(filePath) {
    await fs.writeFile(filePath, '', { flag: 'wx' })
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
