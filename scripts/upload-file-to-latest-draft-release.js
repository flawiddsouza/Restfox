const https = require('https')
const fs = require('fs')
const path = require('path')

const accessToken = process.env.GITHUB_TOKEN
const repository = process.env.GITHUB_REPOSITORY
const [owner, repo] = repository.split('/')
const tag = 'draft'
const filePath = process.argv[2]

if (!filePath) {
    console.error('Please provide the file path as a command line argument!')
    process.exit(1)
}

const makeRequest = async (options, payload = null) => {
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

const getAllReleasesOptions = {
    hostname: 'api.github.com',
    path: `/repos/${owner}/${repo}/releases`,
    method: 'GET',
    headers: {
        Authorization: `token ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Node.js',
    },
}

const main = async () => {
    try {
        const response = await makeRequest(getAllReleasesOptions)
        const releases = response.data
        const draftReleases = releases.filter((release) => {
            return release.draft === true
        })

        if (draftReleases.length === 0) {
            throw new Error('No draft releases found!')
        }

        const release = draftReleases[0]
        const releaseId = release.id

        const fileContent = fs.readFileSync(filePath)
        const fileName = path.basename(filePath)

        const uploadOptions = {
            hostname: 'uploads.github.com',
            path: `/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${fileName}`,
            method: 'POST',
            headers: {
                'User-Agent': 'Node.js',
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/octet-stream',
                'Content-Length': fileContent.length,
            },
        }

        const uploadResponse = await makeRequest(uploadOptions, fileContent)
        console.log(`Uploaded ${filePath} to ${repo} ${tag}!`)
        console.log(uploadResponse)
    } catch (error) {
        console.error(`Error updating release: ${error.message}`)
    }
}

main()
