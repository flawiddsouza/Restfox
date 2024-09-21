import express from 'express'
import { createServer } from 'http'
import { createServer as createHttpsServer } from 'https'
import { Server as SocketIOv3Server } from 'socket.io-v3'
import { Server as SocketIOv4Server } from 'socket.io-v4'
import { WebSocketServer } from 'ws'
import { readFileSync, writeFileSync } from 'fs'
import jwt from 'jsonwebtoken'
import * as Diff from 'diff'
import multer from 'multer'

const upload = multer()

const app = express()

app.use(express.raw({ type: 'application/octet-stream', limit : '10mb' }))
app.use(express.json())

app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
    next()
})

app.post('/upload-multipart', upload.any(), (req, res) => {
    res.send({
        receivedFiles: req.files.map(file => {
            return {
                fieldname: file.fieldname,
                originalname: file.originalname,
                mimetype: file.mimetype,
                size: file.size,
            }
        })
    })
})

app.get('/', (_req, res) => {
    res.send('Restfox Test Endpoint')
})

app.post('/binary', (req, res) => {
    console.log(req.body)
    writeFileSync('src.zip', req.body)
    res.send('Success')
})

app.get('/image-with-content-disposition', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="image.jpg"')
    res.setHeader('Content-Type', 'image/jpeg')
    res.send(readFileSync('files/photo.jpg'))
})

app.get('/image-with-content-disposition-2', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename=annacerrato_vbb_ritratti-02056.jpg; filename*=UTF-8''annacerrato_vbb_ritratti-02056.jpg`)
    res.setHeader('Content-Type', 'image/jpeg')
    res.send(readFileSync('files/photo.jpg'))
})

const jwtSecret = 'secret_key'

app.post('/auth-token', (req, res) => {
    if(req.body.username === 'test' && req.body.password === 'pass') {
        const accessToken = jwt.sign({ user_id: 1 }, jwtSecret)
        return res.send({ accessToken })
    }

    const authHeader = req.headers['authorization']
    if(authHeader) {
        const encoded = authHeader.split(' ')[1]
        if(encoded) {
            const decoded = Buffer.from(encoded, 'base64').toString('utf-8')
            const [username, password] = decoded.split(':')
            if(username === 'test' && password === 'pass') {
                const accessToken = jwt.sign({ user_id: 1 }, jwtSecret)
                return res.send({ accessToken })
            }
        }
    }

    res.sendStatus(401)
})

function verifyAccessToken(req, res, next) {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    if(token == null) {
        return res.sendStatus(401)
    }

    jwt.verify(token, jwtSecret, (err, user) => {
        if (err) {
            return res.sendStatus(401)
        }
        req.user = user
        next()
    })
}

app.get('/protected', verifyAccessToken, (req, res) => {
    res.send('Protected Page')
})

app.get('/user-agent', (req, res) => {
    res.send(req.headers['user-agent'])
})

app.get('/cookie', (req, res) => {
    res.send(req.headers['cookie'])
})

// http://localhost:5605/query-params-test?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIAYE2V3DV5A12345%2F20240325%2Fap-south-1%2Fs3%2Faws4_request&X-Amz-Date=20240325T064424Z&X-Amz-Expires=900&X-Amz-Security-Token=FwoGZXIvYXdzEID%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaDKXdeWCdVYhzCVfZGyLIAbht8OXhYxpM7tw1YfxFLNCM7BNW6vikhVKdOZ7PvimKLmVtuuw812DrdiBSDWUH50OQF6gh1vJZrzGWedDR4uRMlehK8k16dJaxG0PRAZvXcfMPZ2ewNZfJRId05SxLjWEV1k9GewWGA3huwkoOnxtvY9lnMg5cNKvCFiRq83tv83fcRr908dKe96gUqej93Ky1EVmuvr1ZfltmYF2hCBOgdZ0LXnWCdw4wRXpTbw3dl0kzPS0XO9wuxGspw%2F%2F2cCYAo2VzTqtCKMi6hLAGMi03bfMF68F6cS3uZHq5zDv7X19yp1C4kvKMyxl7AaF2I1DYjNYFvnotwDesDbY%3D&X-Amz-Signature=30bff23d306ff517abfe2ad3b34883164c6e296ed1462de3575a5864cc077514&X-Amz-SignedHeaders=host%3Bx-amz-acl&x-amz-acl=public-read
app.get('/query-params-test', (req, res) => {
    const expected = `?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIAYE2V3DV5A12345%2F20240325%2Fap-south-1%2Fs3%2Faws4_request&X-Amz-Date=20240325T064424Z&X-Amz-Expires=900&X-Amz-Security-Token=FwoGZXIvYXdzEID%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaDKXdeWCdVYhzCVfZGyLIAbht8OXhYxpM7tw1YfxFLNCM7BNW6vikhVKdOZ7PvimKLmVtuuw812DrdiBSDWUH50OQF6gh1vJZrzGWedDR4uRMlehK8k16dJaxG0PRAZvXcfMPZ2ewNZfJRId05SxLjWEV1k9GewWGA3huwkoOnxtvY9lnMg5cNKvCFiRq83tv83fcRr908dKe96gUqej93Ky1EVmuvr1ZfltmYF2hCBOgdZ0LXnWCdw4wRXpTbw3dl0kzPS0XO9wuxGspw%2F%2F2cCYAo2VzTqtCKMi6hLAGMi03bfMF68F6cS3uZHq5zDv7X19yp1C4kvKMyxl7AaF2I1DYjNYFvnotwDesDbY%3D&X-Amz-Signature=30bff23d306ff517abfe2ad3b34883164c6e296ed1462de3575a5864cc077514&X-Amz-SignedHeaders=host%3Bx-amz-acl&x-amz-acl=public-read`
    const received = new URL(`http://localhost:5605/${req.originalUrl}`).search

    res.status(received === expected ? 200 : 400)

    res.send({
        match: received === expected,
        diff: Diff.diffChars(expected, received),
        expected,
        received,
    })
})

const args = process.argv.slice(2)
const ENABLE_SSL = args.includes('--ssl')

const server = ENABLE_SSL ? createHttpsServer({
    key: readFileSync('files/localhost.key'),
    cert: readFileSync('files/localhost.crt'),
}, app) : createServer(app)

const ioV3 = new SocketIOv3Server(server, {
    path: '/socket.io-v3',
    cors: {
        origin: '*',
    }
})

ioV3.on('connection', (socket) => {
    console.log('Socket.IO v3 client connected')

    socket.onAny((event, ...args) => {
        socket.emit(event, ...args)
    })

    socket.on('disconnect', () => {
        console.log('Socket.IO v3 client disconnected')
    })
})

const ioV4 = new SocketIOv4Server(server, {
    path: '/socket.io-v4',
    cors: {
        origin: '*',
    }
})

ioV4.on('connection', (socket) => {
    console.log('Socket.IO v4 client connected')

    socket.onAny((event, ...args) => {
        socket.emit(event, ...args)
    })

    socket.on('disconnect', () => {
        console.log('Socket.IO v4 client disconnected')
    })
})

const webSocketServer = new WebSocketServer({ server, path: '/websocket' })

webSocketServer.on('connection', (ws) => {
    console.log('WebSocket client connected')

    ws.on('message', (message) => {
        console.log(`Received message: ${message}`)
        ws.send(message.toString())
    })

    ws.on('close', () => {
        console.log('WebSocket client disconnected')
    })
})

server.listen(5605, '0.0.0.0', () => console.log(`
${ENABLE_SSL ? 'HTTPS' : 'HTTP'} at ${ENABLE_SSL ? 'https' : 'http'}://localhost:5605
Socket.IO v3 at ${ENABLE_SSL ? 'https' : 'http'}://localhost:5605/socket.io-v3
Socket.IO v4 at ${ENABLE_SSL ? 'https' : 'http'}://localhost:5605/socket.io-v4
WebSocket at ws://localhost:5605/websocket
`))
