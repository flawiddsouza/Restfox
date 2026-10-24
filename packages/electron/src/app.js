const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron')
const { resolve } = require('path')
const fs = require('fs')
const net = require('net')
const contextMenu = require('electron-context-menu')
const log = require('electron-log/main')
const open = import('open')
const requests = require('./request')
const db = require('./db')
const helpers = require('./helpers')
const TaskQueue = require('./task-queue')
const updateElectronApp = require('update-electron-app')
const windowStateKeeper = require('./utils/window-state')
const { trustSystemCACertificates, getCACertificatesWithCustom } = require('./ca-certificates')
const { getInstallKind } = require('./install-kind')

Object.assign(console, log.functions)

if(require('electron-squirrel-startup')) return app.quit()

trustSystemCACertificates()

// add a right-click context menu to the app, includes options to copy, paste, select all etc.
contextMenu()

// fix blacked out select dropdowns + freezes, mostly when running the snap on ubuntu
// no downsides to doing this, it renders the app just fine
// 18-Mar-24 17:59 PM: I was wrong - the colors rendered with software acceleration are
// not the same as the ones rendered with hardware acceleration on
// so we'll only disable hardware acceleration on linux if running as a snap
if (process.platform === 'linux' && process.env.SNAP) {
    app.disableHardwareAcceleration()
}

function createWindow() {
    const autoHideMenuBar = true

    const workAreaSize = screen.getPrimaryDisplay().workAreaSize
    // console.log("workAreaSize: width: " + workAreaSize.width + ", height: " + workAreaSize.height)
    const winStateOptions = {
        defaultWidth: parseInt(workAreaSize.width * 0.75),
        defaultHeight: parseInt(workAreaSize.height * 0.75),
        defaultMaximize: true,
    }
    const winState = windowStateKeeper(winStateOptions)

    const win = new BrowserWindow({
        x: winState.x,
        y: winState.y,
        width: winState.width,
        height: winState.height,
        show: false,
        autoHideMenuBar,
        webPreferences: {
            preload: resolve(__dirname, './preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        icon: resolve(__dirname, '../ui/favicon.png'),
    })
    win.on('show', () => { win.focus() })
    // win.maximize()
    // Please do not set useContentSize to true at creating BrowserWindow instance because it changes how to calculate window size.
    // https://github.com/mawie81/electron-window-state?tab=readme-ov-file#usage
    winState.manage(win)
    win.show()

    if (!app.isPackaged) {
        win.webContents.openDevTools()
        win.loadURL('http://localhost:5173')
    } else {
        win.loadURL(`file://${resolve(__dirname, '../ui/index.html')}`)
    }

    // open links with target="_blank" in an external browser instead of in the app
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url === 'about:blank') {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    autoHideMenuBar,
                },
            }
        }
        open.then(openModule => openModule.default(url))
        return { action: 'deny' }
    })

    app.on('second-instance', () => {
        console.log('Second instance was opened, showing the existing window and focusing it')
        if (win.isMinimized()) {
            win.restore()
        }
        win.focus()
        win.show()
    })

    globalThis.electronApplicationWindow = win
}

app.whenReady().then(async() => {
    const isSingleInstance = app.requestSingleInstanceLock()

    if (!isSingleInstance) {
        dialog.showMessageBoxSync({
            type: 'info',
            message: 'Another instance of the app is already running',
            buttons: ['OK'],
        })
        app.quit()
        return
    }

    if(!app.isPackaged) {
        console.log('installing vue devtools as app is in development mode')
        const { default: installExtension, VUEJS_DEVTOOLS } = require('electron-devtools-installer')
        await installExtension(VUEJS_DEVTOOLS)
    }

    // the sends and gRPC calls still running for each window, as the functions that cancel them. A reload or close
    // leaves nothing to stop them, and a response that stays open, such as an event stream, would run on here, so they
    // are cancelled then
    const runningCancels = new Map()

    function trackRunning(sender, cancel) {
        let cancels = runningCancels.get(sender)
        if(!cancels) {
            cancels = new Set()
            runningCancels.set(sender, cancels)
            const cancelAll = () => {
                const cancelsNow = [...cancels]
                cancels.clear()
                cancelsNow.forEach(cancelOne => cancelOne())
            }
            sender.on('did-navigate', cancelAll)
            sender.once('destroyed', () => {
                cancelAll()
                runningCancels.delete(sender)
            })
        }
        cancels.add(cancel)
        return () => cancels.delete(cancel)
    }

    // the response reaches the renderer as pushed requestEvent messages, the invoke reply carries nothing
    ipcMain.handle('sendRequest', async(event, data) => {
        const untrackSend = trackRunning(event.sender, () => requests.cancelRequest(data.requestId))
        try {
            await requests.handleSendRequest(data, message => {
                if(!event.sender.isDestroyed()) {
                    event.sender.send('requestEvent', data.requestId, message)
                }
            })
        } finally {
            untrackSend()
        }
    })
    ipcMain.handle('cancelRequest', (_, ...args) => requests.cancelRequest(...args))

    // a gRPC call's connection follows Settings > Disable SSL Verification, CA Certificates and Proxy, picked per
    // connection as for requests. openTunnel gives a socket through the proxy, or null to connect directly, and stops
    // opening it once its signal, when given, aborts
    function getGrpcConnection(disableSSLVerification) {
        const customCACertificates = requests.getCustomCACertificates()
        // for an https:// proxy
        const tlsOptions = {
            rejectUnauthorized: !disableSSLVerification,
            ...(customCACertificates.length > 0 ? { ca: getCACertificatesWithCustom(customCACertificates) } : {}),
        }

        return {
            rejectUnauthorized: !disableSSLVerification,
            caCertificates: customCACertificates,
            openTunnel: async(host, port, signal) => {
                const authority = net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`
                const proxyUrl = await requests.getProxyForGrpcServer(authority)
                return proxyUrl !== null ? require('./proxy-tunnel').openTunnel(new URL(proxyUrl), host, port, tlsOptions, signal) : null
            },
        }
    }

    // loaded on the first gRPC use, so starting the app does not load protobufjs
    const getGrpcEngine = () => require('./grpc')

    // the running methods loads by the renderer's load id, so grpcCancelSchemaLoad can stop one
    const grpcSchemaLoads = new Map()

    // answers { schema } or { error, code }, since a rejected invoke reaches the renderer without the error's code
    ipcMain.handle('grpcLoadSchema', async(event, spec) => {
        const abortController = new AbortController()
        const untrackLoad = trackRunning(event.sender, () => abortController.abort())
        const loadId = spec.loadId
        if(loadId !== undefined) {
            grpcSchemaLoads.set(loadId, abortController)
        }
        try {
            const schema = await getGrpcEngine().loadSchema({
                target: spec.target,
                connection: getGrpcConnection(spec.disableSSLVerification === true),
                metadata: spec.metadata ?? [],
                protoFiles: spec.protoFiles ?? null,
                timeoutMs: spec.timeoutMs ?? 0,
                signal: abortController.signal,
            })
            return { schema }
        } catch(e) {
            // with the gRPC status of a load that ended with one, such as UNAVAILABLE for a server that could not be
            // reached
            return { error: e.message, code: e.code ?? null, ...(e.messageWithoutValues === undefined ? {} : { errorWithoutValues: e.messageWithoutValues }), ...(e.grpcCode === undefined ? {} : { grpcStatus: { code: e.grpcCode, name: getGrpcEngine().getStatusName(e.grpcCode) } }) }
        } finally {
            untrackLoad()
            if(grpcSchemaLoads.get(loadId) === abortController) {
                grpcSchemaLoads.delete(loadId)
            }
        }
    })

    // the load closes its connection and answers with an error
    ipcMain.handle('grpcCancelSchemaLoad', (_, loadId) => grpcSchemaLoads.get(loadId)?.abort())

    // answers { text } or { error }, see convertInsomniaMessage
    ipcMain.handle('grpcConvertInsomniaMessage', (_, spec) => {
        try {
            return { text: getGrpcEngine().convertInsomniaMessage(spec) }
        } catch(e) {
            return { error: e.message }
        }
    })

    // the running gRPC calls by the renderer's call id
    const grpcCalls = new Map()

    // the call's events reach the renderer as pushed grpcEvent messages, the invoke reply carries nothing. A status or
    // error event ends the call, anything the engine emits after it is dropped
    ipcMain.handle('grpcStartCall', (event, spec) => {
        const { callId } = spec
        const sender = event.sender
        const startTime = Date.now()
        let ended = false

        if(grpcCalls.has(callId)) {
            throw new Error(`A gRPC call with the id ${callId} is already running`)
        }

        const untrackCall = trackRunning(sender, () => grpcCalls.get(callId)?.cancel())

        const emit = grpcEvent => {
            if(ended) {
                return
            }
            if(grpcEvent.type === 'status' || grpcEvent.type === 'error') {
                ended = true
                grpcCalls.delete(callId)
                untrackCall()
            }
            if(!sender.isDestroyed()) {
                sender.send('grpcEvent', callId, grpcEvent)
            }
        }

        try {
            const call = getGrpcEngine().startCall({
                target: spec.target,
                connection: getGrpcConnection(spec.disableSSLVerification === true),
                metadata: spec.metadata ?? [],
                protoFiles: spec.protoFiles ?? null,
                service: spec.service,
                method: spec.method,
                deadlineMs: spec.deadlineMs ?? 0,
                messages: spec.messages ?? [],
            }, emit)

            grpcCalls.set(callId, call)
        } catch(e) {
            emit({ type: 'error', message: e.message, time: Date.now() - startTime })
        }
    })

    ipcMain.handle('grpcSendMessage', (_, callId, json) => grpcCalls.get(callId)?.send(json))

    ipcMain.handle('grpcEndCall', (_, callId) => grpcCalls.get(callId)?.end())

    ipcMain.handle('grpcCancelCall', (_, callId) => grpcCalls.get(callId)?.cancel())

    const operationQueue = new TaskQueue()

    ipcMain.handle('getWorkspaceAtLocation', (_, ...args) => {
        return operationQueue.enqueue(() => db.getWorkspaceAtLocation(...args))
    })

    ipcMain.handle('updateWorkspace', (_, ...args) => {
        return operationQueue.enqueue(() => db.updateWorkspace(...args))
    })

    ipcMain.handle('ensureEmptyFolderOrEmptyWorkspace', (_, ...args) => {
        return operationQueue.enqueue(() => db.ensureEmptyFolderOrEmptyWorkspace(...args))
    })

    ipcMain.handle('getCollectionForWorkspace', (_, ...args) => {
        return operationQueue.enqueue(() => db.getCollectionForWorkspace(...args))
    })

    ipcMain.handle('getCollectionById', (_, ...args) => {
        return operationQueue.enqueue(() => db.getCollectionById(...args))
    })

    ipcMain.handle('createCollection', (_, ...args) => {
        return operationQueue.enqueue(() => db.createCollection(...args))
    })

    ipcMain.handle('createCollections', (_, ...args) => {
        return operationQueue.enqueue(() => db.createCollections(...args))
    })

    ipcMain.handle('updateCollection', (_, ...args) => {
        return operationQueue.enqueue(() => db.updateCollection(...args))
    })

    ipcMain.handle('deleteCollectionsByWorkspaceId', (_, ...args) => {
        return operationQueue.enqueue(() => db.deleteCollectionsByWorkspaceId(...args))
    })

    ipcMain.handle('deleteCollectionsByIds', (_, ...args) => {
        return operationQueue.enqueue(() => db.deleteCollectionsByIds(...args))
    })

    ipcMain.handle('getResponsesByCollectionId', (_, ...args) => {
        return operationQueue.enqueue(() => db.getResponsesByCollectionId(...args))
    })

    ipcMain.handle('createResponse', (_, ...args) => {
        return operationQueue.enqueue(() => db.createResponse(...args))
    })

    ipcMain.handle('updateResponse', (_, ...args) => {
        return operationQueue.enqueue(() => db.updateResponse(...args))
    })

    ipcMain.handle('deleteResponse', (_, ...args) => {
        return operationQueue.enqueue(() => db.deleteResponse(...args))
    })

    ipcMain.handle('deleteResponsesByIds', (_, ...args) => {
        return operationQueue.enqueue(() => db.deleteResponsesByIds(...args))
    })

    ipcMain.handle('deleteResponsesByCollectionIds', (_, ...args) => {
        return operationQueue.enqueue(() => db.deleteResponsesByCollectionIds(...args))
    })

    ipcMain.handle('deleteResponsesByCollectionId', (_, ...args) => {
        return operationQueue.enqueue(() => db.deleteResponsesByCollectionId(...args))
    })

    ipcMain.handle('getWorkspacePlugins', (_, ...args) => {
        return operationQueue.enqueue(() => db.getWorkspacePlugins(...args))
    })

    ipcMain.handle('createPlugin', (_, ...args) => {
        return operationQueue.enqueue(() => db.createPlugin(...args))
    })

    ipcMain.handle('updatePlugin', (_, ...args) => {
        return operationQueue.enqueue(() => db.updatePlugin(...args))
    })

    ipcMain.handle('deletePlugin', (_, ...args) => {
        return operationQueue.enqueue(() => db.deletePlugin(...args))
    })

    ipcMain.handle('deletePluginsByWorkspace', (_, ...args) => {
        return operationQueue.enqueue(() => db.deletePluginsByWorkspace(...args))
    })

    ipcMain.handle('deletePluginsByCollectionIds', (_, ...args) => {
        return operationQueue.enqueue(() => db.deletePluginsByCollectionIds(...args))
    })

    ipcMain.handle('createPlugins', (_, ...args) => {
        return operationQueue.enqueue(() => db.createPlugins(...args))
    })

    ipcMain.handle('openFolderSelectionDialog', () => helpers.openFolderSelectionDialog())

    ipcMain.handle('openFolder', (_, ...args) => helpers.openFolder(...args))

    ipcMain.handle('readFile', (_, ...args) => helpers.readFile(...args))

    ipcMain.handle('setDisableSSLVerification', (_, ...args) => helpers.setDisableSSLVerification(...args))

    ipcMain.handle('setCACertificates', (_, ...args) => helpers.setCACertificates(...args))

    ipcMain.handle('setProxy', (_, ...args) => helpers.setProxy(...args))

    app.on('certificate-error', helpers.handleCertificateError)

    ipcMain.handle('updateElectronApp', () => {
        console.log('ipcMain: updateElectronApp')
        updateElectronApp()
    })

    ipcMain.handle('getInstallInfo', () => ({
        appName: app.getName(),
        installKind: getInstallKind({
            isPackaged: app.isPackaged,
            platform: process.platform,
            env: process.env,
            execPath: process.execPath,
            fileExists: fs.existsSync,
        }),
    }))

    createWindow()

    app.on('activate', () => {
        if(BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('window-all-closed', () => {
    if(process.platform !== 'darwin') {
        app.quit()
    }
})

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error)
})
