const { readFileSync, writeFileSync } = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const pathToElectron = path.join(__dirname, '../packages/electron')
const pathToElectronPackageJSON = path.join(pathToElectron, 'package.json')
const pathToElectronPackageLockJSON = path.join(pathToElectron, 'package-lock.json')
const pathToChromeAppManifest = path.join(__dirname, '../packages/browser-extension/v3-app/src/manifest.json')

const packageJSON = JSON.parse(readFileSync(pathToElectronPackageJSON))
const chromeAppManifest = JSON.parse(readFileSync(pathToChromeAppManifest))

const [ major, minor, patch ] = packageJSON.version.split('.').map(item => Number(item))

packageJSON.version = `${major}.${minor}.${patch+1}`
chromeAppManifest.version = `${major}.${minor}.${patch+1}`

writeFileSync(pathToElectronPackageJSON, JSON.stringify(packageJSON, null, 4) + '\n')
writeFileSync(pathToChromeAppManifest, JSON.stringify(chromeAppManifest, null, 4) + '\n')

execSync('npm i', {
    cwd: pathToElectron
})

execSync(`git add ${pathToElectronPackageJSON} ${pathToElectronPackageLockJSON} ${pathToChromeAppManifest}`)
execSync(`git commit -m "chore: bump version"`)
execSync(`git tag v${packageJSON.version} --force`)
