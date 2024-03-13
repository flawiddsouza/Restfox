const { dialog } = require('electron')

async function openFolderSelectionDialog() {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
    })

    if (result.canceled) {
        return null
    }

    return result.filePaths[0]
}

module.exports = {
    openFolderSelectionDialog,
}
