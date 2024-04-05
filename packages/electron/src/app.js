const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const { resolve } = require('path')
const contextMenu = require('electron-context-menu')
const log = require('electron-log/main')
const requests = require('./request')
const db = require('./db')
const helpers = require('./helpers')
const TaskQueue = require('./task-queue')
require('update-electron-app')()

Object.assign(console, log.functions)

if(require('electron-squirrel-startup')) return app.quit()

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

    const win = new BrowserWindow({
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
    win.maximize()
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
        shell.openExternal(url)
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

    ipcMain.handle('sendRequest', (_, ...args) => requests.handleSendRequest(...args))
    ipcMain.handle('cancelRequest', (_, ...args) => requests.cancelRequest(...args))

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

    createWindow()
})

app.on('window-all-closed', () => {
    if(process.platform !== 'darwin') {
        app.quit()
    }
})
