const path = require('path')

// How this copy of the app was installed, for the page view analytics reports
function getInstallKind({ isPackaged, platform, env, execPath, fileExists }) {
    if(!isPackaged) {
        return 'dev'
    }

    if(platform === 'darwin') {
        return 'mac'
    }

    if(platform === 'linux') {
        if(env.SNAP) {
            return 'snap'
        }
        if(env.FLATPAK_ID) {
            return 'flatpak'
        }
        // deb and rpm packages install under /usr/lib
        if(execPath.startsWith('/usr/')) {
            return 'linux-package'
        }
        return 'other'
    }

    if(platform === 'win32') {
        const appFolder = path.win32.dirname(execPath)
        // Scoop writes its own install.json next to each app it installs
        if(fileExists(path.win32.join(appFolder, 'install.json'))) {
            return 'scoop'
        }
        // The installer keeps its updater one folder above each app version
        if(fileExists(path.win32.join(appFolder, '..', 'Update.exe'))) {
            return 'windows-installer'
        }
        return 'windows-zip'
    }

    return 'other'
}

module.exports = {
    getInstallKind,
}
