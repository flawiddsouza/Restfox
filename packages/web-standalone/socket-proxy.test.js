import https from 'https'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import test from 'node:test'
import assert from 'node:assert/strict'
import app, { handleSocketProxyUpgrade } from './app.js'
import { startForwardProxy } from './test-forward-proxy.js'

// reads one short masked client frame and returns its text
function readClientTextFrame(buffer) {
    const length = buffer[1] & 0x7f
    const mask = buffer.subarray(2, 6)
    const payload = buffer.subarray(6, 6 + length).map((byte, i) => byte ^ mask[i % 4])
    return Buffer.from(payload).toString()
}

function serverTextFrame(text) {
    const payload = Buffer.from(text)
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
}

const filesDir = path.join(import.meta.dirname, '..', 'test-api', 'files')

// a self-signed HTTPS server that answers like a Socket.IO polling endpoint and echoes WebSocket text messages
function startSelfSignedServer(tlsOptions = {
    key: fs.readFileSync(path.join(filesDir, 'localhost.key')),
    cert: fs.readFileSync(path.join(filesDir, 'localhost.crt')),
}) {
    const server = https.createServer(tlsOptions)
    const received = []
    trackSockets(server)

    server.on('request', (req, res) => {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', () => {
            received.push({ method: req.method, url: req.url, headers: req.headers, body })
            res.setHeader('set-cookie', 'io=target-session')
            res.setHeader('x-target', 'yes')
            res.end(req.method === 'POST' ? `echo:${body}` : '0{"sid":"abc"}')
        })
    })

    server.on('upgrade', (req, socket) => {
        received.push({ method: req.method, url: req.url, headers: req.headers })
        const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
        socket.on('data', chunk => socket.write(serverTextFrame(`echo:${readClientTextFrame(chunk)}`)))
    })

    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ server, origin: `https://localhost:${server.address().port}`, received }))
    })
}

// server.close waits for open connections, and an upgraded socket is never idle, so the tests end them
function closeServer(server) {
    server.closeAllConnections()
    for(const socket of server.openSockets) {
        socket.destroy()
    }
    server.close()
}

function trackSockets(server) {
    server.openSockets = new Set()
    server.on('connection', socket => {
        server.openSockets.add(socket)
        socket.on('close', () => server.openSockets.delete(socket))
    })
    return server
}

function listenApp() {
    return new Promise(resolve => {
        const server = trackSockets(app.listen(0, '127.0.0.1', () => resolve(server)))
        server.on('upgrade', handleSocketProxyUpgrade)
    })
}

function socketProxyPath(disableSSLVerification, targetOrigin, targetPath) {
    return `/proxy-socket/${disableSSLVerification}/${encodeURIComponent(targetOrigin)}${targetPath}`
}

function openWebSocket(url, message) {
    return new Promise(resolve => {
        const socket = new WebSocket(url)
        socket.addEventListener('open', () => socket.send(message))
        socket.addEventListener('message', event => {
            resolve(`message ${event.data}`)
            socket.close()
        })
        socket.addEventListener('error', () => resolve('error'))
    })
}

test('a wss url to a self-signed server connects through the proxy when SSL verification is disabled', async() => {
    const target = await startSelfSignedServer()
    const proxy = await listenApp()

    try {
        const targetOrigin = target.origin.replace('https:', 'wss:')
        const result = await openWebSocket(`ws://127.0.0.1:${proxy.address().port}${socketProxyPath(true, targetOrigin, '/websocket?token=1')}`, 'hello')

        assert.equal(result, 'message echo:hello')
        assert.equal(target.received[0].url, '/websocket?token=1')
        assert.equal(target.received[0].headers.host, new URL(target.origin).host)
    } finally {
        closeServer(proxy)
        closeServer(target.server)
    }
})

test('the proxy still rejects a self-signed certificate when SSL verification is not disabled', async() => {
    const target = await startSelfSignedServer()
    const proxy = await listenApp()

    try {
        const targetOrigin = target.origin.replace('https:', 'wss:')
        const result = await openWebSocket(`ws://127.0.0.1:${proxy.address().port}${socketProxyPath(false, targetOrigin, '/websocket')}`, 'hello')

        assert.equal(result, 'error')
        assert.equal(target.received.length, 0)
    } finally {
        closeServer(proxy)
        closeServer(target.server)
    }
})

test('Socket.IO polling requests are forwarded with the target answer and without this origin\'s cookies', async() => {
    const target = await startSelfSignedServer()
    const proxy = await listenApp()

    try {
        const base = `http://127.0.0.1:${proxy.address().port}${socketProxyPath(true, target.origin, '/socket.io/?EIO=4&transport=polling')}`

        const handshake = await fetch(base, { headers: { cookie: 'restfox=local' } })
        assert.equal(handshake.status, 200)
        assert.equal(await handshake.text(), '0{"sid":"abc"}')
        assert.equal(handshake.headers.get('x-target'), 'yes')
        assert.equal(handshake.headers.get('set-cookie'), null)

        const post = await fetch(`${base}&sid=abc`, { method: 'POST', body: '40' })
        assert.equal(await post.text(), 'echo:40')

        assert.equal(target.received[0].url, '/socket.io/?EIO=4&transport=polling')
        assert.equal(target.received[0].headers.cookie, undefined)
        assert.equal(target.received[1].body, '40')
    } finally {
        closeServer(proxy)
        closeServer(target.server)
    }
})

test('a browser going away in the middle of a proxied answer does not take the server down', async() => {
    const filesDir = path.join(import.meta.dirname, '..', 'test-api', 'files')
    const target = trackSockets(https.createServer({
        key: fs.readFileSync(path.join(filesDir, 'localhost.key')),
        cert: fs.readFileSync(path.join(filesDir, 'localhost.crt')),
    }, (req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.write('first chunk')
        const timer = setInterval(() => res.write('more'), 50)
        res.on('close', () => clearInterval(timer))
    }))
    await new Promise(resolve => target.listen(0, '127.0.0.1', resolve))
    const proxy = await listenApp()

    try {
        const abortController = new AbortController()
        const response = await fetch(`http://127.0.0.1:${proxy.address().port}${socketProxyPath(true, `https://localhost:${target.address().port}`, '/slow')}`, { signal: abortController.signal })
        await response.body.getReader().read()
        abortController.abort()
        await new Promise(resolve => setTimeout(resolve, 300))

        const stillUp = await fetch(`http://127.0.0.1:${proxy.address().port}/proxy-socket/true/not-a-url/`)
        assert.equal(stillUp.status, 400)
    } finally {
        closeServer(proxy)
        closeServer(target)
    }
})

test('a socket proxy url without a valid target origin is refused', async() => {
    const proxy = await listenApp()

    try {
        const response = await fetch(`http://127.0.0.1:${proxy.address().port}/proxy-socket/true/not-a-url/socket.io/`)
        assert.equal(response.status, 400)
    } finally {
        closeServer(proxy)
    }
})

// signed by test-ca.crt, a CA in no trust store, like a site behind a company's TLS inspection proxy
function startCASignedServer() {
    return startSelfSignedServer({
        key: fs.readFileSync(path.join(filesDir, 'test-ca-localhost.key')),
        cert: fs.readFileSync(path.join(filesDir, 'test-ca-localhost.crt')),
    })
}

async function registerCACertificates(proxy) {
    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/proxy-ca-certificates`, {
        method: 'POST',
        body: fs.readFileSync(path.join(filesDir, 'test-ca.crt'), 'utf8'),
    })

    return (await response.json()).id
}

test('a wss url to a server signed by registered CA certificates connects through the proxy with SSL verification on', async() => {
    const target = await startCASignedServer()
    const proxy = await listenApp()

    try {
        const targetOrigin = target.origin.replace('https:', 'wss:')
        const id = await registerCACertificates(proxy)

        const trusted = await openWebSocket(`ws://127.0.0.1:${proxy.address().port}${socketProxyPath(`ca-${id}`, targetOrigin, '/websocket')}`, 'hello')
        assert.equal(trusted, 'message echo:hello')

        const untrusted = await openWebSocket(`ws://127.0.0.1:${proxy.address().port}${socketProxyPath(false, targetOrigin, '/websocket')}`, 'hello')
        assert.equal(untrusted, 'error')
    } finally {
        closeServer(proxy)
        closeServer(target.server)
    }
})

test('Socket.IO polling to a server signed by registered CA certificates goes through the proxy', async() => {
    const target = await startCASignedServer()
    const proxy = await listenApp()

    try {
        const id = await registerCACertificates(proxy)
        const response = await fetch(`http://127.0.0.1:${proxy.address().port}${socketProxyPath(`ca-${id}`, target.origin, '/socket.io/?EIO=4&transport=polling')}`)

        assert.equal(response.status, 200)
        assert.equal(await response.text(), '0{"sid":"abc"}')
    } finally {
        closeServer(proxy)
        closeServer(target.server)
    }
})

test('a socket naming CA certificates the server does not have is refused with the reason', async() => {
    const target = await startCASignedServer()
    const proxy = await listenApp()

    try {
        const response = await fetch(`http://127.0.0.1:${proxy.address().port}${socketProxyPath('ca-forgotten', target.origin, '/socket.io/?EIO=4&transport=polling')}`)
        assert.equal(response.status, 502)
        assert.match(await response.text(), /no longer registered/)

        const result = await openWebSocket(`ws://127.0.0.1:${proxy.address().port}${socketProxyPath('ca-forgotten', target.origin.replace('https:', 'wss:'), '/websocket')}`, 'hello')
        assert.equal(result, 'error')
        assert.equal(target.received.length, 0)
    } finally {
        closeServer(proxy)
        closeServer(target.server)
    }
})

// how the UI names the settings of a socket to a host other than loopback
function socketProxyPathWithOptions(options, targetOrigin, targetPath) {
    return `/proxy-socket/${encodeURIComponent(JSON.stringify(options))}/${encodeURIComponent(targetOrigin)}${targetPath}`
}

function registerProxySettings(proxy, proxySettings) {
    return fetch(`http://127.0.0.1:${proxy.address().port}/proxy-settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(proxySettings),
    })
}

async function registerProxySettingsId(proxy, proxySettings) {
    return (await (await registerProxySettings(proxy, proxySettings)).json()).id
}

test('Settings > Proxy > Custom carries a relayed wss WebSocket through a CONNECT tunnel with the proxy\'s credentials', async() => {
    const forwardProxy = await startForwardProxy()
    const target = await startSelfSignedServer()
    const proxy = await listenApp()
    const port = target.server.address().port

    try {
        const proxySettingsId = await registerProxySettingsId(proxy, { mode: 'custom', url: forwardProxy.url, username: 'user', password: 'p@ss' })
        const secure = socketProxyPathWithOptions({ disableSSLVerification: true, caCertificatesId: null, proxySettingsId }, `wss://api.proxy-test.test:${port}`, '/websocket')
        // the relay URL, which a reverse proxy in front of the server may log, holds no password
        assert.doesNotMatch(decodeURIComponent(secure), /p@ss/)
        assert.equal(await openWebSocket(`ws://127.0.0.1:${proxy.address().port}${secure}`, 'hello'), 'message echo:hello')
        assert.equal(forwardProxy.received[0].requestLine, `CONNECT api.proxy-test.test:${port} HTTP/1.1`)
        assert.deepEqual(forwardProxy.received[0].headers.find(([name]) => name === 'proxy-authorization'), ['proxy-authorization', `Basic ${Buffer.from('user:p@ss').toString('base64')}`])
        assert.equal(target.received.at(-1).url, '/websocket')
        assert.equal(target.received.at(-1).headers.cookie, undefined)

        // SSL verification still applies inside the tunnel
        const verified = socketProxyPathWithOptions({ disableSSLVerification: false, caCertificatesId: null, proxySettingsId }, `wss://api.proxy-test.test:${port}`, '/websocket')
        assert.equal(await openWebSocket(`ws://127.0.0.1:${proxy.address().port}${verified}`, 'hello'), 'error')
    } finally {
        closeServer(proxy)
        closeServer(target.server)
        forwardProxy.close()
    }
})

test('Settings > Proxy > Custom carries relayed Socket.IO polling, and Off connects directly', async() => {
    const forwardProxy = await startForwardProxy()
    const proxy = await listenApp()

    try {
        const customId = await registerProxySettingsId(proxy, { mode: 'custom', url: forwardProxy.url })
        const proxied = await fetch(`http://127.0.0.1:${proxy.address().port}${socketProxyPathWithOptions({ disableSSLVerification: false, caCertificatesId: null, proxySettingsId: customId }, 'http://api.proxy-test.test', '/socket.io/?EIO=4&transport=polling')}`)
        assert.equal(await proxied.text(), 'proxied GET http://api.proxy-test.test/socket.io/?EIO=4&transport=polling HTTP/1.1')

        // the host resolves only at the proxy, so going direct fails to find it
        const offId = await registerProxySettingsId(proxy, { mode: 'off' })
        const direct = await fetch(`http://127.0.0.1:${proxy.address().port}${socketProxyPathWithOptions({ disableSSLVerification: false, caCertificatesId: null, proxySettingsId: offId }, 'http://api.proxy-test.test', '/socket.io/?EIO=4&transport=polling')}`)
        assert.equal(direct.status, 502)
        assert.match(await direct.text(), /ENOTFOUND api\.proxy-test\.test/)
        assert.equal(forwardProxy.received.length, 1)
    } finally {
        closeServer(proxy)
        forwardProxy.close()
    }
})

test('a proxy setting keeps its random id when registered again, and one that cannot be read is refused', async() => {
    const proxy = await listenApp()

    try {
        const proxySettings = { mode: 'custom', url: 'http://proxy.test:3128', username: 'user', password: 'secret' }
        const id = await registerProxySettingsId(proxy, proxySettings)
        assert.match(id, /^[0-9a-f-]{36}$/)
        assert.equal(await registerProxySettingsId(proxy, proxySettings), id)
        assert.notEqual(await registerProxySettingsId(proxy, { ...proxySettings, password: 'other' }), id)

        for(const body of ['not json', '"custom"', '[]', 'null']) {
            const refused = await fetch(`http://127.0.0.1:${proxy.address().port}/proxy-settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
            assert.equal(refused.status, 400, body)
        }
    } finally {
        closeServer(proxy)
    }
})

test('a socket naming a proxy setting the server does not have is refused with the reason', async() => {
    const proxy = await listenApp()

    try {
        const path = socketProxyPathWithOptions({ disableSSLVerification: false, caCertificatesId: null, proxySettingsId: 'forgotten-after-a-restart' }, 'http://api.proxy-test.test', '/socket.io/?EIO=4&transport=polling')
        const response = await fetch(`http://127.0.0.1:${proxy.address().port}${path}`)
        assert.equal(response.status, 502)
        assert.equal(await response.text(), 'The proxy setting is no longer registered with the server, connect again')
        assert.equal(await openWebSocket(`ws://127.0.0.1:${proxy.address().port}${path.replace('http%3A', 'ws%3A')}`, 'hello'), 'error')
    } finally {
        closeServer(proxy)
    }
})

test('a socket relay url whose settings cannot be read is refused', async() => {
    const proxy = await listenApp()

    try {
        const response = await fetch(`http://127.0.0.1:${proxy.address().port}/proxy-socket/%7Bnot-json/${encodeURIComponent('http://api.proxy-test.test')}/socket.io/`)
        assert.equal(response.status, 400)
    } finally {
        closeServer(proxy)
    }
})
