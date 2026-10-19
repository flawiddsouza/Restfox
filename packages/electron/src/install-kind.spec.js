import { test, expect } from 'vitest'
import { getInstallKind } from './install-kind.js'

// Answers only for the files listed, as Windows paths
function fileExistsFor(...files) {
    const existing = new Set(files)
    return file => existing.has(file)
}

const packaged = { isPackaged: true, env: {}, fileExists: fileExistsFor() }

test('an unpackaged run is dev', () => {
    expect(getInstallKind({ ...packaged, isPackaged: false, platform: 'win32', execPath: 'C:\\repo\\packages\\electron\\node_modules\\electron\\dist\\electron.exe' })).toBe('dev')
})

test('macOS is mac', () => {
    expect(getInstallKind({ ...packaged, platform: 'darwin', execPath: '/Applications/Restfox.app/Contents/MacOS/Restfox' })).toBe('mac')
})

test('Linux with SNAP set is snap', () => {
    expect(getInstallKind({ ...packaged, platform: 'linux', env: { SNAP: '/snap/restfox/62' }, execPath: '/snap/restfox/62/restfox' })).toBe('snap')
})

test('Linux with FLATPAK_ID set is flatpak', () => {
    expect(getInstallKind({ ...packaged, platform: 'linux', env: { FLATPAK_ID: 'dev.restfox.Restfox' }, execPath: '/app/lib/restfox/restfox' })).toBe('flatpak')
})

test('Linux under /usr is linux-package', () => {
    expect(getInstallKind({ ...packaged, platform: 'linux', execPath: '/usr/lib/restfox/restfox' })).toBe('linux-package')
})

test('Linux anywhere else is other', () => {
    expect(getInstallKind({ ...packaged, platform: 'linux', execPath: '/home/user/Restfox-linux-x64/restfox' })).toBe('other')
})

test('Windows with install.json next to the app is scoop', () => {
    const execPath = 'C:\\Users\\user\\scoop\\apps\\restfox\\0.41.0\\Restfox.exe'
    const fileExists = fileExistsFor('C:\\Users\\user\\scoop\\apps\\restfox\\0.41.0\\install.json')
    expect(getInstallKind({ ...packaged, platform: 'win32', execPath, fileExists })).toBe('scoop')
})

test('Windows with Update.exe one folder up is windows-installer', () => {
    const execPath = 'C:\\Users\\user\\AppData\\Local\\Restfox\\app-0.41.0\\Restfox.exe'
    const fileExists = fileExistsFor('C:\\Users\\user\\AppData\\Local\\Restfox\\Update.exe')
    expect(getInstallKind({ ...packaged, platform: 'win32', execPath, fileExists })).toBe('windows-installer')
})

test('Windows with neither file is windows-zip', () => {
    expect(getInstallKind({ ...packaged, platform: 'win32', execPath: 'C:\\Users\\user\\Downloads\\Restfox-win32-x64-0.41.0\\Restfox.exe' })).toBe('windows-zip')
})
