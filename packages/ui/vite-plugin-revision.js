import { execSync } from 'child_process'

function execShellCommandSync(cmd) {
    return execSync(cmd, { encoding: 'utf8' }).trim()
}

export const ViteRevisionPlugin = (mode) => ({
    name: 'vite-revision',
    config() {
        const latestTag = mode === 'development' ? 'development' : execShellCommandSync('git describe --tags --abbrev=0')
        const latestCommitHash = mode === 'development' ? 'development' : execShellCommandSync('git rev-parse HEAD')

        process.env.VITE_GIT_TAG = latestTag
        process.env.VITE_GIT_COMMIT_HASH = latestCommitHash.substring(0, 7)
    }
})
