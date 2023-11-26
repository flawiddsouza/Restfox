const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld (
    'electronIPC', {
        sendRequest(data) {
            return ipcRenderer.invoke('sendRequest', data)
        },
        cancelRequest(requestId) {
            return ipcRenderer.invoke('cancelRequest', requestId)
        },
    }
)
