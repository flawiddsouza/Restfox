const { app, BrowserWindow } = require('electron')
const { resolve } = require('path')

function createWindow() {
    const win = new BrowserWindow({ show: false })
    win.on('show', () => { win.focus() })
    win.maximize()
    win.show()
    win.loadFile(resolve(__dirname, '../../ui/dist/index.html'))
}

app.whenReady().then(() => {
    createWindow()
})

app.on('window-all-closed', () => {
    if(process.platform !== 'darwin') {
        app.quit()
    }
})
