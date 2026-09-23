import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import app from './app.js'

let server
let tokenUrl

before(async() => {
    server = app.listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    tokenUrl = `http://localhost:${server.address().port}/token`
})

after(() => {
    server.close()
})

beforeEach(() => {
    delete process.env.CLIENT_AUTHENTICATION
})

const basicHeader = (clientId, clientSecret) => 'Basic ' + Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')

const postToken = async(parameters, headers = {}) => {
    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(parameters).toString(),
    })
    return { status: response.status, headers: response.headers, body: await response.json() }
}

test('client credentials in the body are accepted', async() => {
    const { status, body } = await postToken({ grant_type: 'client_credentials', client_id: 'test-client-id', client_secret: 'test-client-secret' })
    assert.equal(status, 200)
    assert.equal(body.client_authentication, 'body')
    assert.ok(body.access_token)
})

test('client credentials in a Basic Authorization header are accepted, id and secret urlencoded before the base64', async() => {
    const { status, body } = await postToken({ grant_type: 'client_credentials' }, { Authorization: basicHeader('test-client-id', 'test-client-secret') })
    assert.equal(status, 200)
    assert.equal(body.client_authentication, 'header')
    assert.ok(body.access_token)
})

test('a wrong secret in the header is refused with 401 and a challenge, in the body with 400', async() => {
    const viaHeader = await postToken({ grant_type: 'client_credentials' }, { Authorization: basicHeader('test-client-id', 'wrong') })
    assert.equal(viaHeader.status, 401)
    assert.equal(viaHeader.headers.get('www-authenticate'), 'Basic realm="token"')
    assert.equal(viaHeader.body.error, 'invalid_client')

    const viaBody = await postToken({ grant_type: 'client_credentials', client_id: 'test-client-id', client_secret: 'wrong' })
    assert.equal(viaBody.status, 400)
    assert.equal(viaBody.body.error, 'invalid_client')
})

test('a Basic header that does not decode is refused as an invalid client', async() => {
    const { status, body } = await postToken({ grant_type: 'client_credentials' }, { Authorization: 'Basic ' + Buffer.from('%E0%A4%A:secret').toString('base64') })
    assert.equal(status, 401)
    assert.equal(body.error, 'invalid_client')
})

test('CLIENT_AUTHENTICATION=header refuses credentials sent in the body', async() => {
    process.env.CLIENT_AUTHENTICATION = 'header'
    const { status, body } = await postToken({ grant_type: 'client_credentials', client_id: 'test-client-id', client_secret: 'test-client-secret' })
    assert.equal(status, 400)
    assert.equal(body.error, 'invalid_client')
    assert.equal(body.error_description, 'client credentials must be sent in the header')
})

test('CLIENT_AUTHENTICATION=body refuses credentials sent in the header', async() => {
    process.env.CLIENT_AUTHENTICATION = 'body'
    const { status, body } = await postToken({ grant_type: 'client_credentials' }, { Authorization: basicHeader('test-client-id', 'test-client-secret') })
    assert.equal(status, 401)
    assert.equal(body.error_description, 'client credentials must be sent in the body')
})

test('password and refresh grants take the client credentials from either place', async() => {
    const password = await postToken({ grant_type: 'password', username: 'test-user', password: 'test-password' }, { Authorization: basicHeader('test-client-id', 'test-client-secret') })
    assert.equal(password.status, 200)
    assert.equal(password.body.client_authentication, 'header')

    const refresh = await postToken({ grant_type: 'refresh_token', refresh_token: password.body.refresh_token, client_id: 'test-client-id', client_secret: 'test-client-secret' })
    assert.equal(refresh.status, 200)
    assert.equal(refresh.body.client_authentication, 'body')
    assert.notEqual(refresh.body.access_token, password.body.access_token)
})
