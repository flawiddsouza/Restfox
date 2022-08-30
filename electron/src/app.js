const { app, BrowserWindow } = require('electron')
const { resolve } = require('path')
require('update-electron-app')()

if(require('electron-squirrel-startup')) return app.quit()

function createWindow() {
    const win = new BrowserWindow({ show: false })
    win.on('show', () => { win.focus() })
    win.maximize()
    win.show()
    win.loadURL(`file://${resolve(__dirname, '../ui/index.html')}`)
}

app.whenReady().then(() => {
    createWindow()
})

app.on('window-all-closed', () => {
    if(process.platform !== 'darwin') {
        app.quit()
    }
})
