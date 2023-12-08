import { execSync } from 'child_process'

function execShellCommandSync(cmd) {
    return execSync(cmd, { encoding: 'utf8' }).trim()
}

export const ViteRevisionPlugin = () => ({
    name: 'vite-revision',
    config() {
        const latestTag = execShellCommandSync('git describe --tags --abbrev=0')
        const latestCommitHash = execShellCommandSync('git rev-parse HEAD')

        process.env.VITE_GIT_TAG = latestTag
        process.env.VITE_GIT_COMMIT_HASH = latestCommitHash.substring(0, 7)
    }
})
