const { execSync } = require('child_process')

// Get the last two tags
const tags = execSync('git tag --sort=committerdate').toString().trim().split('\n').reverse().slice(0, 2)
const fromTag = tags[1]
const toTag = tags[0]

// Get the commit messages between the two tags
const commitMessages = execSync(
    `git log --pretty=format:'%s' ${fromTag}..${toTag}`
).toString()

// Split the commit messages into an array
const commits = commitMessages.trim().split('\n').reverse()

// Initialize empty arrays to store the different types of changes
let newFeatures = []
let fixes = []

// Loop through each commit message and categorize it based on the conventional commits spec
commits.forEach((commit) => {
    if (commit.startsWith('feat') || commit.startsWith('feat(ui)')) {
        newFeatures.push(commit.slice(commit.indexOf(':') + 1).trim())
    } else if (commit.startsWith('fix') || commit.startsWith('fix(ui)')) {
        fixes.push(commit.slice(commit.indexOf(':') + 1).trim())
    }
})

// Print the changelog in the desired format
console.log("### What's New")
if (newFeatures.length > 0) {
    console.log('- ' + newFeatures.join('\n- '))
}
if (fixes.length > 0) {
    console.log('\n### Fixes')
    console.log('- ' + fixes.join('\n- '))
}
console.log(`
### Packages

For **Ubuntu**, snap can be installed using:
\`\`\`
sudo snap install restfox
\`\`\`

For **macOS**, the app can be installed using homebrew:
\`\`\`
brew install restfox
\`\`\`

For **Windows**, the app can be installed using:
\`\`\`
scoop bucket add extras
scoop install restfox
\`\`\`

**NOTE:** Not all the builds have been tested properly, so please create an issue if you encounter any problems.
`)
console.log(`\n**Full Changelog**: https://github.com/flawiddsouza/Restfox/compare/${fromTag}...${toTag}`)
