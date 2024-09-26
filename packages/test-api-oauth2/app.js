import express from 'express'
import querystring from 'node:querystring'
import crypto from 'node:crypto'

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const REDIRECT_URI = 'http://localhost:3000/callback'
const AUTHORIZATION_CODE = 'test-authorization-code'
const USERNAME = 'test-user'
const PASSWORD = 'test-password'

const tokens = {}

const generateToken = () => crypto.randomBytes(20).toString('hex')

const app = express()

app.use(express.urlencoded({ extended: true }))

app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
    next()
})

app.get('/authorize', (req, res) => {
    const { response_type, client_id, redirect_uri, scope, state } = req.query

    if (client_id !== CLIENT_ID) {
        return res.status(400).send('Invalid client_id')
    }

    const redirectURL = `${redirect_uri}?${querystring.stringify({
        code: AUTHORIZATION_CODE,
        state,
    })}`

    res.redirect(redirectURL)
})

app.post('/token', (req, res) => {
    const { grant_type, code, redirect_uri, client_id, client_secret, username, password, refresh_token } = req.body

    if (grant_type === 'authorization_code') {
        if (
            code !== AUTHORIZATION_CODE ||
            redirect_uri !== REDIRECT_URI ||
            client_id !== CLIENT_ID ||
            client_secret !== CLIENT_SECRET
        ) {
            return res.status(400).json({ error: 'invalid_grant' })
        }

        const access_token = generateToken()
        const refresh_token = generateToken()
        tokens[access_token] = { refresh_token }

        res.json({
            access_token,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token,
        })
    } else if (grant_type === 'client_credentials') {
        if (
            client_id !== CLIENT_ID ||
            client_secret !== CLIENT_SECRET
        ) {
            return res.status(400).json({ error: 'invalid_client' })
        }

        const access_token = generateToken()
        tokens[access_token] = {}

        res.json({
            access_token,
            token_type: 'Bearer',
            expires_in: 3600,
        })
    } else if (grant_type === 'password') {
        if (
            client_id !== CLIENT_ID ||
            client_secret !== CLIENT_SECRET
        ) {
            return res.status(400).json({ error: 'invalid_client' })
        }

        if (
            username !== USERNAME ||
            password !== PASSWORD
        ) {
            return res.status(400).json({ error: 'invalid_user_creds' })
        }

        const access_token = generateToken()
        const refresh_token = generateToken()
        tokens[access_token] = { refresh_token }

        res.json({
            access_token,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token,
        })
    } else if (grant_type === 'refresh_token') {
        const tokenEntry = Object.entries(tokens).find(
            ([_, value]) => value.refresh_token === refresh_token
        )

        if (!tokenEntry) {
            return res.status(400).json({ error: 'invalid_grant' })
        }

        const [oldAccessToken] = tokenEntry
        const newAccessToken = generateToken()
        tokens[newAccessToken] = tokens[oldAccessToken]
        delete tokens[oldAccessToken]

        res.json({
            access_token: newAccessToken,
            token_type: 'Bearer',
            expires_in: 3600,
        })
    } else {
        res.status(400).json({ error: 'unsupported_grant_type' })
    }
})

app.get('/resource', (req, res) => {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    if (!tokens[token]) {
        return res.status(401).json({ error: 'invalid_token' })
    }

    res.json({
        data: 'Protected resource data',
    })
})

const port = 8444
app.listen(port, () => {
    console.log(`OAuth2 test server listening on http://localhost:${port}`)
})
