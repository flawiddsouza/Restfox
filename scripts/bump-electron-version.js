const { readFileSync, writeFileSync } = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const pathToPackageJSON = path.join(__dirname, '../packages/electron/package.json')

const packageJSON = JSON.parse(readFileSync(pathToPackageJSON))

const [ major, minor, patch ] = packageJSON.version.split('.').map(item => Number(item))

packageJSON.version = `${major}.${minor}.${patch+1}`

writeFileSync(pathToPackageJSON, JSON.stringify(packageJSON, null, 4) + '\n')

execSync(`git add ${pathToPackageJSON}`)
execSync(`git commit -m "chore(electron): bump version"`)
execSync(`git tag v${packageJSON.version}`)
