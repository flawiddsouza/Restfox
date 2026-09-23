const { dialog, session, shell } = require('electron')
const fileUtils = require('./file-utils')
const fs = require('fs').promises
const path = require('path')
const { platform } = require('os')
const requests = require('./request')
const { parseCACertificates, isCertificateTrustedByCustomCA } = require('./ca-certificates')

const LOG_ONLY_METHOD_NAME = true
const LOG_ONLY_METHOD_NAME_EXCEPT = []

function logMethodCall(methodName, args) {
    if (LOG_ONLY_METHOD_NAME && !LOG_ONLY_METHOD_NAME_EXCEPT.includes(methodName)) {
        console.log(methodName)
        return
    }
    console.log(methodName, args)
}

async function openFolderSelectionDialog() {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
    })

    if (result.canceled) {
        return null
    }

    return result.filePaths[0]
}

async function openFolder(path) {
    await shell.openPath(path)
}

async function readFile(filePath, workspaceLocation = null) {
    logMethodCall('readFile', { filePath, workspaceLocation })

    let filePathResolved = ''
    let filePathExists = false

    if (workspaceLocation !== null) {
        filePathResolved = path.resolve(path.join(workspaceLocation, filePath))
        filePathExists = await fileUtils.pathExists(filePathResolved)
    }

    if (!filePathExists) {
        filePathResolved = path.resolve(filePath)
        filePathExists = await fileUtils.pathExists(filePathResolved)
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
        console.error(error)
        return {
            error: error.message + ' ' + filePathResolved,
            content: null,
        }
    }
}

// requests go through undici in this process and read the setting per request, but WebSocket and Socket.IO
// connections are made by the renderer, whose certificates Chromium checks, so the renderer sends the setting here
let sslVerificationDisabled = false

async function setDisableSSLVerification(value) {
    const disableSSLVerification = value === true

    // the renderer sends the setting on every load, closing connections for an unchanged value would also drop the
    // dev server's live reload socket, which reloads the page and sends it again
    if(disableSSLVerification === sslVerificationDisabled) {
        return
    }

    sslVerificationDisabled = disableSSLVerification
    // an open connection keeps the certificate decision it was made with
    await session.defaultSession.closeAllConnections()
}

let customCACertificatesText = null

// Settings > CA Certificates, the text of a PEM file or null. Requests through undici and, via handleCertificateError,
// Chromium's connections trust these certificates in addition to the default ones
async function setCACertificates(text) {
    const value = text ? String(text) : null

    if(value === customCACertificatesText) {
        return { error: null }
    }

    let certificates = []

    if(value !== null) {
        try {
            certificates = parseCACertificates(value)
        } catch(e) {
            return { error: e.message }
        }
    }

    customCACertificatesText = value
    requests.setCustomCACertificates(certificates)
    await session.defaultSession.closeAllConnections()

    return { error: null }
}

// Chromium asks here about each certificate it rejected, so the answer follows the settings at the time. Not
// setCertificateVerifyProc, the network service caches its result and a certificate stays accepted after unticking.
// Chromium already trusts the operating system's certificates, a custom one is checked here
function handleCertificateError(event, _webContents, url, error, certificate, callback) {
    if(sslVerificationDisabled || (error === 'net::ERR_CERT_AUTHORITY_INVALID' && isCertificateTrustedByCustomCA(certificate, new URL(url).hostname, requests.getCustomCACertificates()))) {
        event.preventDefault()
        callback(true)
    }
}

function removePrefixFromString(str, prefix) {
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

module.exports = {
    openFolderSelectionDialog,
    openFolder,
    readFile,
    setDisableSSLVerification,
    setCACertificates,
    handleCertificateError,
    removePrefixFromString,
}
