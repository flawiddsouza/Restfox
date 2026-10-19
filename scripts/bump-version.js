const { readFileSync, writeFileSync } = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const pathToElectron = path.join(__dirname, '../packages/electron')
const pathToElectronPackageJSON = path.join(pathToElectron, 'package.json')
const pathToElectronPackageLockJSON = path.join(pathToElectron, 'package-lock.json')
const pathToChromeAppManifest = path.join(__dirname, '../packages/browser-extension/v3-app/src/manifest.json')
const pathToREADME = path.join(__dirname, '../README.md')

const packageJSON = JSON.parse(readFileSync(pathToElectronPackageJSON))
const chromeAppManifest = JSON.parse(readFileSync(pathToChromeAppManifest))
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

// Chrome compares versions number by number from the left, a missing number counting as 0
function isNewerVersion(version, than) {
    const versionParts = version.split('.').map(Number)
    const thanParts = than.split('.').map(Number)
    for(let i = 0; i < Math.max(versionParts.length, thanParts.length); i++) {
        const difference = (versionParts[i] ?? 0) - (thanParts[i] ?? 0)
        if(difference !== 0) {
            return difference > 0
        }
    }
    return false
}

// An extension update must be newer than what users have, so the extension keeps counting from where the Chrome Web
// Store has it until the Restfox version overtakes that count, and takes the Restfox version from then on.
// version_name is what people see, so it always shows the Restfox version.
if(isNewerVersion(packageJSON.version, chromeAppManifest.version)) {
    chromeAppManifest.version = packageJSON.version
} else {
    const [chromeAppManifestMajor, chromeAppManifestMinor, chromeAppManifestPatch] = chromeAppManifest.version.split('.').map(Number)
    chromeAppManifest.version = `${chromeAppManifestMajor}.${chromeAppManifestMinor}.${chromeAppManifestPatch + 1}`
}
chromeAppManifest.version_name = packageJSON.version

writeFileSync(pathToElectronPackageJSON, JSON.stringify(packageJSON, null, 4) + '\n')
writeFileSync(pathToChromeAppManifest, JSON.stringify(chromeAppManifest, null, 4) + '\n')
writeFileSync(pathToREADME, README.replace(/\d+\.\d+\.\d+/g, packageJSON.version))

execSync('npm i', {
    cwd: pathToElectron
})

execSync(`git add ${pathToElectronPackageJSON} ${pathToElectronPackageLockJSON} ${pathToChromeAppManifest} ${pathToREADME}`)
execSync(`git commit -m "chore: bump version"`)
execSync(`git tag v${packageJSON.version} --force`)
