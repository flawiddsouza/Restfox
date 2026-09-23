import express from 'express'
import querystring from 'node:querystring'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const REDIRECT_URI = 'http://localhost:3000/callback'
const USERNAME = 'test-user'
const PASSWORD = 'test-password'

const tokens = {}
const authorizationCodes = {}

const generateToken = () => crypto.randomBytes(20).toString('hex')

// where the token endpoint requires the client credentials: 'header', 'body' or 'any', read per request so a test can switch it
const requiredClientAuthentication = () => process.env.CLIENT_AUTHENTICATION || 'any'

// RFC 6749 section 2.3.1, the client sends its credentials either as a Basic Authorization header, id and secret each
// urlencoded before the base64, or as client_id and client_secret in the form body
const getClientCredentials = (req) => {
    const authorization = req.headers['authorization']

    if (authorization && authorization.startsWith('Basic ')) {
        const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString()
        const separator = decoded.indexOf(':')
        try {
            return {
                client_id: decodeURIComponent(decoded.slice(0, separator)),
                client_secret: decodeURIComponent(decoded.slice(separator + 1)),
                sent_in: 'header',
            }
        } catch {
            // a percent sequence that does not decode is not a valid client, not a server error
            return { client_id: undefined, client_secret: undefined, sent_in: 'header' }
        }
    }

    if (req.body.client_id !== undefined || req.body.client_secret !== undefined) {
        return { client_id: req.body.client_id, client_secret: req.body.client_secret, sent_in: 'body' }
    }

    return { client_id: undefined, client_secret: undefined, sent_in: undefined }
}

const rejectClient = (res, sent_in, error_description) => {
    // section 5.2, a client that authenticated through the header gets 401 with the challenge, everything else 400
    if (sent_in === 'header') {
        res.setHeader('WWW-Authenticate', 'Basic realm="token"')
        return res.status(401).json({ error: 'invalid_client', error_description })
    }
    return res.status(400).json({ error: 'invalid_client', error_description })
}

// returns the credentials when the client may proceed, otherwise sends the error and returns null
const authenticateClient = (req, res, { requireSecret = true } = {}) => {
    const credentials = getClientCredentials(req)
    const required = requiredClientAuthentication()

    if (required !== 'any' && credentials.sent_in !== required) {
        rejectClient(res, credentials.sent_in, `client credentials must be sent in the ${required}`)
        return null
    }

    if (credentials.client_id !== CLIENT_ID || (requireSecret && credentials.client_secret !== CLIENT_SECRET)) {
        rejectClient(res, credentials.sent_in)
        return null
    }

    return credentials
}

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
// Token endpoint with PKCE verification. Every token response also says where the client credentials arrived,
// client_authentication is 'header' or 'body', so a client can check which mode it used
app.post('/token', (req, res) => {
    const { grant_type, code, redirect_uri, username, password, refresh_token, code_verifier } = req.body

    if (grant_type === 'authorization_code') {
        const authCodeData = authorizationCodes[code]

        if (!authCodeData) {
            return res.status(400).json({ error: 'invalid_grant' })
        }

        // a PKCE client is public and proves itself with the code verifier instead of a secret
        const client = authenticateClient(req, res, { requireSecret: !authCodeData.code_challenge })

        if (!client) {
            return
        }

        if (authCodeData.client_id !== client.client_id || authCodeData.redirect_uri !== redirect_uri) {
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
            client_authentication: client.sent_in,
        })
    }

    // Keep existing grant flows for password, client_credentials, refresh_token
    else if (grant_type === 'client_credentials') {
        const client = authenticateClient(req, res)

        if (!client) {
            return
        }

        const access_token = generateToken()
        tokens[access_token] = {}

        res.json({
            access_token,
            token_type: 'Bearer',
            expires_in: 3600,
            client_authentication: client.sent_in,
        })
    } else if (grant_type === 'password') {
        const client = authenticateClient(req, res)

        if (!client) {
            return
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
            client_authentication: client.sent_in,
        })
    } else if (grant_type === 'refresh_token') {
        const client = authenticateClient(req, res)

        if (!client) {
            return
        }

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
            client_authentication: client.sent_in,
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

export default app

// listen only when started directly, the test imports the app and picks its own port
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = 8444
    app.listen(port, () => {
        console.log(`OAuth2+PKCE test server listening on http://localhost:${port}, client credentials accepted in: ${requiredClientAuthentication()}`)
    })
}
