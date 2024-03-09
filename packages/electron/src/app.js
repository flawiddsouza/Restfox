const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { resolve } = require('path')
const { File } = require('node:buffer')
const { Agent } = require('undici')
const { Socket } = require('net')
const dnsPromises = require('dns').promises
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
        },
        icon: resolve(__dirname, '../ui/favicon.png'),
    })
    win.on('show', () => { win.focus() })
    win.maximize()
    win.show()
    win.loadURL(`file://${resolve(__dirname, '../ui/index.html')}`)

    // open links with target="_blank" in an external browser instead of in the app
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)
        return { action: 'deny' }
    })
}

let abortController = {}

async function checkReachability(host, port) {
    return new Promise((resolve) => {
        const socket = new Socket()

        socket.once('connect', () => {
            socket.end()
            resolve(true)
        })

        socket.once('error', () => {
            resolve(false)
        })

        socket.connect(port, host)
    })
}

async function handleSendRequest(_event, data) {
    try {
        const { requestId, url, method, headers, bodyHint, disableSSLVerification } = data
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

        const urlParsed = new URL(url)

        const response = await fetch(url, {
            method,
            headers,
            body: method !== 'GET' ? body : undefined,
            signal: abortController.signal,
            dispatcher: new Agent({
                connect: {
                    rejectUnauthorized: disableSSLVerification ? false : true,
                    lookup: async(hostname, _opts, callback) => {
                        try {
                            console.log('lookup', hostname)
                            const addresses = await dnsPromises.lookup(hostname, { all: true })

                            let address = null

                            if (addresses.length > 1) {
                                console.log('addresses found', addresses)

                                while(addresses.length > 0) {
                                    address = addresses.shift()
                                    let isReachable = true
                                    const urlPort = urlParsed.port !== '' ? urlParsed.port : (urlParsed.protocol === 'https:' ? 443 : 80)
                                    if (hostname === 'localhost') {
                                        isReachable = await checkReachability(address.address, urlPort)
                                        console.log(`address ${address.address} is ${isReachable ? 'reachable' : 'not reachable'} on port ${urlPort}`)
                                    } else {
                                        console.log(`reachability test skipped for non-localhost address ${address.address} and picked as the address to use for the request`)
                                    }
                                    if(isReachable) {
                                        break
                                    }
                                }
                            } else {
                                address = addresses[0]
                            }

                            if(!address) {
                                throw new Error('No reachable address found')
                            }

                            callback(null, address.address, address.family)
                        } catch(err) {
                            callback(err)
                        }
                    }
                },
            }),
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
        console.error('request failed', e)
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
