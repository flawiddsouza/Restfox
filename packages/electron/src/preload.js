const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld (
    'electronIPC', {
        sendRequest(data) {
            return ipcRenderer.invoke('sendRequest', data)
        },
        cancelRequest(requestId) {
            return ipcRenderer.invoke('cancelRequest', requestId)
        },
        getCollectionForWorkspace(...args) {
            return ipcRenderer.invoke('getCollectionForWorkspace', ...args)
        },
        getCollectionById(...args) {
            return ipcRenderer.invoke('getCollectionById', ...args)
        },
        createCollection(...args) {
            return ipcRenderer.invoke('createCollection', ...args)
        },
        createCollections(...args) {
            return ipcRenderer.invoke('createCollections', ...args)
        },
        updateCollection(...args) {
            return ipcRenderer.invoke('updateCollection', ...args)
        },
        deleteCollectionsByWorkspaceId(...args) {
            return ipcRenderer.invoke('deleteCollectionsByWorkspaceId', ...args)
        },
        deleteCollectionsByIds(...args) {
            return ipcRenderer.invoke('deleteCollectionsByIds', ...args)
        },
        getResponsesByCollectionId(...args) {
            return ipcRenderer.invoke('getResponsesByCollectionId', ...args)
        },
        createResponse(...args) {
            return ipcRenderer.invoke('createResponse', ...args)
        },
        updateResponse(...args) {
            return ipcRenderer.invoke('updateResponse', ...args)
        },
        deleteResponse(...args) {
            return ipcRenderer.invoke('deleteResponse', ...args)
        },
        deleteResponsesByIds(...args) {
            return ipcRenderer.invoke('deleteResponsesByIds', ...args)
        },
        deleteResponsesByCollectionIds(...args) {
            return ipcRenderer.invoke('deleteResponsesByCollectionIds', ...args)
        },
        deleteResponsesByCollectionId(...args) {
            return ipcRenderer.invoke('deleteResponsesByCollectionId', ...args)
        },
        openFolderSelectionDialog(...args) {
            return ipcRenderer.invoke('openFolderSelectionDialog', ...args)
        },
    }
)
