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
    }
)
