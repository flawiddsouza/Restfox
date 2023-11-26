const { app, BrowserWindow, ipcMain } = require('electron')
const { resolve } = require('path')
const { File } = require('node:buffer')
require('update-electron-app')()

if(require('electron-squirrel-startup')) return app.quit()

function createWindow() {
    const win = new BrowserWindow({
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: resolve(__dirname, './preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        }
    })
    win.on('show', () => { win.focus() })
    win.maximize()
    win.show()
    win.loadURL(`file://${resolve(__dirname, '../ui/index.html')}`)
}

let abortController = {}

async function handleSendRequest(_event, data) {
    try {
        const { requestId, url, method, headers, bodyHint } = data
        let { body } = data

        abortController[requestId] = new AbortController()

        if(bodyHint === 'FormData') {
            const formData = new FormData()
            for(const item of body) {
                const value = typeof item[1] !== 'object' ? item[1] : new File([new Uint8Array(item[1].buffer)], item[1].name, { type: item[1].type })
                formData.append(item[0], value)
            }
            body = formData
        }

        if(bodyHint === 'File') {
            body = new File([new Uint8Array(body.buffer)], body.name, { type: body.type })
        }

        const startTime = new Date()

        const response = await fetch(url, {
            method,
            headers,
            body: method !== 'GET' ? body : undefined,
            signal: abortController.signal
        })

        const endTime = new Date()

        const status = response.status
        const statusText = response.statusText
        const responseHeaders = [...response.headers.entries()]

        const responseBlob = await response.blob()
        const mimeType = responseBlob.type
        const buffer = await responseBlob.arrayBuffer()

        const timeTaken = endTime - startTime

        const responseToSend = {
            status,
            statusText,
            headers: responseHeaders,
            mimeType,
            buffer: Array.from(new Uint8Array(buffer)),
            timeTaken
        }
        return {
            event: 'response',
            eventData: responseToSend
        }
    } catch(e) {
        return {
            event: 'responseError',
            eventData: e.message
        }
    } finally {
        delete abortController[data.requestId]
    }
}

function cancelRequest(_event, requestId) {
    if(abortController[requestId]) {
        abortController[requestId].abort()
        delete abortController[requestId]
    }
}

app.whenReady().then(() => {
    ipcMain.handle('sendRequest', handleSendRequest)
    ipcMain.handle('cancelRequest', cancelRequest)
    createWindow()
})

app.on('window-all-closed', () => {
    if(process.platform !== 'darwin') {
        app.quit()
    }
})
