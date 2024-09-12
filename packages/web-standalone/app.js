import express from 'express'
import { fetch, Agent } from 'undici'
import multer from 'multer'

const app = express()

const port = process.env.PORT || 4004

app.use(express.static('public'))

const upload = multer()

app.use((req, res, next) => {
    if (req.is('multipart/*')) {
        upload.any()(req, res, next)
    } else {
        express.raw({ type: '*/*' })(req, res, next)
    }
})

const agents = new Map()

function getAgentForRequest(urlParsed, disableSSLVerification) {
    const key = `${urlParsed.hostname}:${urlParsed.port}:${disableSSLVerification}`

    if(!agents.has(key)) {
        const agent = new Agent({
            connect: {
                rejectUnauthorized: disableSSLVerification ? false : true,
            },
            allowH2: true,
        })

        agents.set(key, agent)
    }

    return agents.get(key)
}

app.post('/proxy', async(req, res) => {
    const disableSSLVerification = req.headers['x-proxy-flag-disable-ssl-verification'] === 'true'
    const url = req.headers['x-proxy-req-url']
    const method = req.headers['x-proxy-req-method']
    const headers = {}
    let body

    const agent = getAgentForRequest(new URL(url), disableSSLVerification)

    if (req.is('multipart/*')) {
        const files = req.files

        body = new FormData()

        Object.keys(files).forEach(field => {
            const file = files[field]
            const blob = new Blob([file.buffer], { type: file.mimetype })
            body.append(file.fieldname, blob, file.originalname)
        })
    } else {
        body = req.body
    }

    Object.keys(req.headers).forEach(header => {
        if(header.startsWith('x-proxy-req-header-')) {
            headers[header.replace('x-proxy-req-header-', '')] = req.headers[header]
        }
    })

    try {
        const startTime = new Date()

        const response = await fetch(url, {
            dispatcher: agent,
            method,
            headers,
            body: method !== 'GET' ? body : undefined
        })

        const endTime = new Date()

        const status = response.status
        const statusText = response.statusText
        const responseHeaders = [...response.headers.entries()]

        const responseBlob = await response.blob()
        const mimeType = responseBlob.type
        const buffer = await responseBlob.arrayBuffer()

        const timeTaken = endTime - startTime

        const responseToSend = {
            status,
            statusText,
            headers: responseHeaders,
            mimeType,
            buffer: Array.from(new Uint8Array(buffer)),
            timeTaken
        }

        res.send({
            event: 'response',
            eventData: responseToSend
        })
    } catch(e) {
        res.send({
            event: 'responseError',
            eventData: e.message
        })
    }
})

app.listen(port, () => {
    console.log(`Restfox running on port http://localhost:${port}`)
})
