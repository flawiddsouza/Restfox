const { execSync } = require('child_process')
const https = require('https')

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY
const GITHUB_REF = process.env.GITHUB_REF

const generateReleaseNotes = () => {
    const output = execSync('node scripts/generate-changelog.js', { encoding: 'utf8' })
    return output
}

const getVersionFromTag = () => {
    return GITHUB_REF.replace('refs/tags/', '')
}

const makeRequest = (options, payload = null) => {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = ''

            res.on('data', (chunk) => {
                data += chunk
            })

            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    data: JSON.parse(data),
                })
            })
        })

        req.on('error', (error) => {
            reject(error)
        })

        if (payload) {
            req.write(payload)
        }

        req.end()
    })
}

const updateReleaseNotes = async (version, releaseNotes) => {
    const getRequestOptions = {
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_REPOSITORY}/releases`,
        method: 'GET',
        headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Node.js',
        },
    }

    const response = await makeRequest(getRequestOptions)

    const releaseData = response.data.find((release) => release.tag_name === version)

    if (!releaseData) {
        console.error(`Release not found for tag ${version}`)
        process.exit(1)
    }

    const releaseId = releaseData.id
    const releaseNotesJson = JSON.stringify({
        body: releaseNotes,
        tag_name: version,
        prerelease: false,
    })

    const patchOptions = {
        ...getRequestOptions,
        path: `/repos/${GITHUB_REPOSITORY}/releases/${releaseId}`,
        method: 'PATCH',
        headers: {
            ...getRequestOptions.headers,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(releaseNotesJson),
        },
    }

    const patchResponse = await makeRequest(patchOptions, releaseNotesJson)

    if (patchResponse.statusCode !== 200) {
        console.error('Failed to update release notes')
        console.log(patchResponse.data)
        process.exit(1)
    } else {
        console.log('Release notes updated successfully')
        process.exit()
    }
}

const main = async () => {
    const releaseNotes = generateReleaseNotes()
    const version = getVersionFromTag()

    await updateReleaseNotes(version, releaseNotes)
}

main()
