const fs = require('fs').promises

async function readdirIgnoreError(path) {
    try {
        return await fs.readdir(path)
    } catch (e) {
        return []
    }
}

async function pathExists(pathToCheck) {
    return fs.access(pathToCheck).then(() => true).catch(() => false)
}

function encodeFilename(name) {
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

function decodeFilename(name) {
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

module.exports = {
    readdirIgnoreError,
    pathExists,
    encodeFilename,
    decodeFilename,
}
