import express from 'express'
import querystring from 'node:querystring'
import crypto from 'node:crypto'

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const REDIRECT_URI = 'http://localhost:3000/callback'
const USERNAME = 'test-user'
const PASSWORD = 'test-password'

const tokens = {}
const authorizationCodes = {}

const generateToken = () => crypto.randomBytes(20).toString('hex')

// PKCE helper
const verifyCodeChallenge = (code_verifier, code_challenge, method) => {
    if (method === 'plain') {
        return code_verifier === code_challenge
    }
    if (method === 'S256') {
        const hash = crypto.createHash('sha256').update(code_verifier).digest()
        const base64url = hash
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '')
        return base64url === code_challenge
    }
    return false
}

const app = express()
app.use(express.urlencoded({ extended: true }))

app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
    next()
})

// Authorization endpoint with PKCE support
app.get('/authorize', (req, res) => {
    const { response_type, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method } = req.query

    if (client_id !== CLIENT_ID) {
        return res.status(400).send('Invalid client_id')
    }

    if (response_type !== 'code') {
        return res.status(400).send('Unsupported response_type')
    }

    const code = generateToken()

    // Store code + PKCE metadata
    authorizationCodes[code] = {
        client_id,
        redirect_uri,
        code_challenge,
        code_challenge_method,
    }

    const redirectURL = `${redirect_uri}?${querystring.stringify({
        code,
        state,
    })}`

    res.redirect(redirectURL)
})

// Token endpoint with PKCE verification
app.post('/token', (req, res) => {
    const { grant_type, code, redirect_uri, client_id, client_secret, username, password, refresh_token, code_verifier } = req.body

    if (grant_type === 'authorization_code') {
        const authCodeData = authorizationCodes[code]

        if (!authCodeData) {
            return res.status(400).json({ error: 'invalid_grant' })
        }

        if (authCodeData.client_id !== client_id || authCodeData.redirect_uri !== redirect_uri) {
            return res.status(400).json({ error: 'invalid_grant' })
        }

        // If PKCE was used, verify the code_verifier
        if (authCodeData.code_challenge) {
            if (!code_verifier) {
                return res.status(400).json({ error: 'invalid_request', error_description: 'Missing code_verifier' })
            }
            if (!verifyCodeChallenge(code_verifier, authCodeData.code_challenge, authCodeData.code_challenge_method)) {
                return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' })
            }
        } else {
            // Fallback to client_secret validation (standard OAuth2)
            if (client_secret !== CLIENT_SECRET) {
                return res.status(400).json({ error: 'invalid_client' })
            }
        }

        const access_token = generateToken()
        const new_refresh_token = generateToken()
        tokens[access_token] = { refresh_token: new_refresh_token }

        // Consume the code
        delete authorizationCodes[code]

        return res.json({
            access_token,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: new_refresh_token,
        })
    }

    // Keep existing grant flows for password, client_credentials, refresh_token
    else if (grant_type === 'client_credentials') {
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
        const new_refresh_token = generateToken()
        tokens[access_token] = { refresh_token: new_refresh_token }

        res.json({
            access_token,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: new_refresh_token,
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

// Protected resource
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
    console.log(`OAuth2+PKCE test server listening on http://localhost:${port}`)
})
