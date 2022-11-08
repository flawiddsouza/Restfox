import express from 'express'
import fetch from 'node-fetch'

const app = express()

const port = process.env.PORT || 4004

app.use(express.static('public'))

app.post('/proxy', async(req, res) => {
    const url = req.headers['x-proxy-req-url']
    const method = req.headers['x-proxy-req-method']
    const headers = {}
    const body = req.body

    Object.keys(req.headers).forEach(header => {
        if(header.startsWith('x-proxy-req-header-')) {
            headers[header.replace('x-proxy-req-header-', '')] = req.headers[header]
        }
    })

    try {
        const startTime = new Date()

        const response = await fetch(url, {
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
