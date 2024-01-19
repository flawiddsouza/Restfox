import express from 'express'
import { createServer } from 'http'
import { Server as SocketIOv3Server } from 'socket.io-v3'
import { Server as SocketIOv4Server } from 'socket.io-v4'
import { WebSocketServer } from 'ws'
import { readFileSync, writeFileSync } from 'fs'
import jwt from 'jsonwebtoken'

const app = express()

app.use(express.raw({ type: 'application/octet-stream', limit : '10mb' }))
app.use(express.json())

app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
    next()
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

const server = createServer(app)

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

server.listen(5605, () => console.log(`
HTTP at http://localhost:5605
Socket.IO v3 at http://localhost:5605/socket.io-v3
Socket.IO v4 at http://localhost:5605/socket.io-v4
WebSocket at ws://localhost:5605/websocket
`))
