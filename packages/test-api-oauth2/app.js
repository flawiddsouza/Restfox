import express from 'express'
import querystring from 'node:querystring'

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const REDIRECT_URI = 'http://localhost:3000/callback'
const AUTHORIZATION_CODE = 'test-authorization-code'
const ACCESS_TOKEN = 'test-access-token'
const USERNAME = 'test-user'
const PASSWORD = 'test-password'

const app = express()
app.use(express.urlencoded({ extended: true }))

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
    const { grant_type, code, redirect_uri, client_id, client_secret, username, password } = req.body

    if (grant_type === 'authorization_code') {
        if (
            code !== AUTHORIZATION_CODE ||
            redirect_uri !== REDIRECT_URI ||
            client_id !== CLIENT_ID ||
            client_secret !== CLIENT_SECRET
        ) {
            return res.status(400).json({ error: 'invalid_grant' })
        }

        res.json({
            access_token: ACCESS_TOKEN,
            token_type: 'Bearer',
            expires_in: 3600,
        })
    } else if (grant_type === 'client_credentials') {
        if (
            client_id !== CLIENT_ID ||
            client_secret !== CLIENT_SECRET
        ) {
            return res.status(400).json({ error: 'invalid_client' })
        }

        res.json({
            access_token: ACCESS_TOKEN,
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

        res.json({
            access_token: ACCESS_TOKEN,
            token_type: 'Bearer',
            expires_in: 3600,
        })
    } else {
        res.status(400).json({ error: 'unsupported_grant_type' })
    }
})

app.get('/resource', (req, res) => {
    const authHeader = req.headers['authorization']
    if (authHeader !== `Bearer ${ACCESS_TOKEN}`) {
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
