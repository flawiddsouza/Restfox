const { readFileSync, writeFileSync } = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const pathToElectron = path.join(__dirname, '../packages/electron')
const pathToElectronPackageJSON = path.join(pathToElectron, 'package.json')
const pathToElectronPackageLockJSON = path.join(pathToElectron, 'package-lock.json')
// const pathToChromeAppManifest = path.join(__dirname, '../packages/browser-extension/v3-app/src/manifest.json')
const pathToChromeAppManifest = ''
const pathToREADME = path.join(__dirname, '../README.md')

const packageJSON = JSON.parse(readFileSync(pathToElectronPackageJSON))
// const chromeAppManifest = JSON.parse(readFileSync(pathToChromeAppManifest))
const README = readFileSync(pathToREADME).toString()

const args = process.argv.slice(2)

if (args.length === 0) {
    console.log('Please specify one of these: --major | --minor | --patch | --undo')
    process.exit(1)
}

if (args.includes('--undo')) {
    // check if last commit is "chore: bump version"
    const lastCommit = execSync('git log -1 --pretty=%B').toString().trim()
    if (lastCommit !== 'chore: bump version') {
        console.log('Last commit is not "chore: bump version" so nothing to undo')
        process.exit(1)
    }
    execSync(`git tag -d v${packageJSON.version}`)
    execSync(`git stash`)
    execSync(`git reset --hard HEAD~1`)
    execSync(`git stash pop`)
    process.exit(0)
}

let [major, minor, patch] = packageJSON.version.split('.').map(item => Number(item))

if (args.includes('--major')) {
    major++
    minor = 0
    patch = 0
} else if (args.includes('--minor')) {
    minor++
    patch = 0
} else if (args.includes('--patch')) {
    patch++
} else {
    console.log('Please specify one of these: --major | --minor | --patch | --undo')
    process.exit(1)
}

packageJSON.version = `${major}.${minor}.${patch}`
// chromeAppManifest.version = `${major}.${minor}.${patch+1}`

writeFileSync(pathToElectronPackageJSON, JSON.stringify(packageJSON, null, 4) + '\n')
// writeFileSync(pathToChromeAppManifest, JSON.stringify(chromeAppManifest, null, 4) + '\n')
writeFileSync(pathToREADME, README.replace(/\d+\.\d+\.\d+/g, packageJSON.version))

execSync('npm i', {
    cwd: pathToElectron
})

execSync(`git add ${pathToElectronPackageJSON} ${pathToElectronPackageLockJSON} ${pathToChromeAppManifest} ${pathToREADME}`)
execSync(`git commit -m "chore: bump version"`)
execSync(`git tag v${packageJSON.version} --force`)
