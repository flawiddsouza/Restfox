const { contextBridge, ipcRenderer } = require('electron')

const ipcFunctions = [
    'sendRequest',
    'cancelRequest',
    'getWorkspaceAtLocation',
    'updateWorkspace',
    'ensureEmptyFolderOrEmptyWorkspace',
    'getCollectionForWorkspace',
    'getCollectionById',
    'createCollection',
    'createCollections',
    'updateCollection',
    'deleteCollectionsByWorkspaceId',
    'deleteCollectionsByIds',
    'getResponsesByCollectionId',
    'createResponse',
    'updateResponse',
    'deleteResponse',
    'deleteResponsesByIds',
    'deleteResponsesByCollectionIds',
    'deleteResponsesByCollectionId',
    'getWorkspacePlugins',
    'createPlugin',
    'updatePlugin',
    'deletePlugin',
    'deletePluginsByWorkspace',
    'deletePluginsByCollectionIds',
    'createPlugins',
    'openFolderSelectionDialog',
    'openFolder',
]

const electronIPC = ipcFunctions.reduce((acc, funcName) => {
    acc[funcName] = (...args) => ipcRenderer.invoke(funcName, ...args)
    return acc
}, {})

electronIPC.workspaceChanged = (callback) => {
    ipcRenderer.on('workspaceChanged', (_, ...args) => callback(...args))
}

contextBridge.exposeInMainWorld('electronIPC', electronIPC)
