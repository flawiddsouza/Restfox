import express from 'express'
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

app.listen(5605, () => console.log('Running at http://localhost:5605'))
