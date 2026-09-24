import https from 'https'
import fs from 'fs'
import path from 'path'
import test from 'node:test'
import assert from 'node:assert/strict'
import app from './app.js'
import { startForwardProxy } from './test-forward-proxy.js'

const filesDir = path.join(import.meta.dirname, '..', 'test-api', 'files')

function listen(server) {
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function listenApp() {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server))
    })
}

function closeServer(server) {
    server.closeAllConnections?.()
    server.close()
}

async function sendThroughServer(server, url, proxySettings, disableSSLVerification = false, requestHeaders = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/proxy`, {
        method: 'POST',
        headers: {
            'x-proxy-req-url': url,
            'x-proxy-req-method': 'GET',
            'x-proxy-flag-disable-ssl-verification': String(disableSSLVerification),
            'x-proxy-flag-header-names': JSON.stringify(Object.keys(requestHeaders)),
            ...Object.fromEntries(Object.entries(requestHeaders).map(([name, value]) => [`x-proxy-req-header-${name}`, value])),
            ...(proxySettings !== undefined ? { 'x-proxy-flag-proxy': encodeURIComponent(JSON.stringify(proxySettings)) } : {}),
        },
    })

    return response.json()
}

test('Settings > Proxy > Custom sends plain HTTP to the proxy as a full URL, its credentials kept out of the timeline', async() => {
    const proxy = await startForwardProxy()
    const server = await listenApp()

    try {
        const result = await sendThroughServer(server, 'http://api.proxy-test.test/path', { mode: 'custom', url: proxy.url, username: 'user', password: 'p@ss€' })

        assert.equal(result.event, 'response')
        assert.equal(Buffer.from(result.eventData.buffer).toString(), 'proxied GET http://api.proxy-test.test/path HTTP/1.1')
        assert.deepEqual(proxy.received[0].headers.find(([name]) => name === 'proxy-authorization'), ['proxy-authorization', `Basic ${Buffer.from('user:p@ss€').toString('base64')}`])
        assert.equal(result.eventData.requestHeadersSent.find(([name]) => name === 'proxy-authorization'), undefined)
    } finally {
        closeServer(server)
        proxy.close()
    }
})

test('Settings > Proxy > Custom tunnels HTTPS through CONNECT', async() => {
    const proxy = await startForwardProxy()
    const target = await listen(https.createServer({
        key: fs.readFileSync(path.join(filesDir, 'localhost.key')),
        cert: fs.readFileSync(path.join(filesDir, 'localhost.crt')),
    }, (_req, res) => res.end('secure')))
    const server = await listenApp()

    try {
        const result = await sendThroughServer(server, `https://api.proxy-test.test:${target.address().port}/`, { mode: 'custom', url: proxy.url }, true)

        assert.equal(result.event, 'response')
        assert.equal(Buffer.from(result.eventData.buffer).toString(), 'secure')
        assert.equal(proxy.received[0].requestLine, `CONNECT api.proxy-test.test:${target.address().port} HTTP/1.1`)
    } finally {
        closeServer(server)
        closeServer(target)
        proxy.close()
    }
})

test('Settings > Proxy > System, also from an older UI that sends no setting, uses this server\'s HTTP_PROXY, and Off ignores it', async() => {
    const proxy = await startForwardProxy()
    const server = await listenApp()
    // the lowercase name wins, so one set on this machine is put aside
    const savedEnv = { http_proxy: process.env.http_proxy, HTTP_PROXY: process.env.HTTP_PROXY, no_proxy: process.env.no_proxy, NO_PROXY: process.env.NO_PROXY }
    for(const name of Object.keys(savedEnv)) {
        delete process.env[name]
    }
    process.env.HTTP_PROXY = proxy.url

    try {
        for(const proxySettings of [undefined, { mode: 'system' }]) {
            const result = await sendThroughServer(server, 'http://api.proxy-test.test/system', proxySettings)
            assert.equal(Buffer.from(result.eventData.buffer).toString(), 'proxied GET http://api.proxy-test.test/system HTTP/1.1')
        }

        // the host resolves only at the proxy, so going direct fails to find it
        const off = await sendThroughServer(server, 'http://api.proxy-test.test/off', { mode: 'off' })
        assert.equal(off.event, 'responseError')
        assert.match(off.eventData, /ENOTFOUND api\.proxy-test\.test/)
        assert.equal(proxy.received.length, 2)
    } finally {
        for(const [name, value] of Object.entries(savedEnv)) {
            if(value === undefined) {
                delete process.env[name]
            } else {
                process.env[name] = value
            }
        }
        closeServer(server)
        proxy.close()
    }
})

test('a Proxy-Authorization the request sets itself goes to the proxy when one applies, and stays in the timeline', async() => {
    const proxy = await startForwardProxy()
    const server = await listenApp()

    try {
        const result = await sendThroughServer(server, 'http://api.proxy-test.test/own', { mode: 'custom', url: proxy.url }, false, { 'Proxy-Authorization': 'Bearer own-token' })

        assert.equal(result.event, 'response')
        assert.deepEqual(proxy.received[0].headers.find(([name]) => name === 'proxy-authorization'), ['proxy-authorization', 'Bearer own-token'])
        assert.deepEqual(result.eventData.requestHeadersSent.find(([name]) => name === 'proxy-authorization'), ['proxy-authorization', 'Bearer own-token'])
    } finally {
        closeServer(server)
        proxy.close()
    }
})
