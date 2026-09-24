import { test, expect, afterEach } from 'vitest'
import net from 'node:net'
import http from 'node:http'
import tls from 'node:tls'
import fs from 'node:fs'
import path from 'node:path'
import { startProxyRelay } from './proxy-relay.js'
import { startForwardProxy, startSocks5Proxy, closeTestProxies } from './test-proxies.js'

const filesDir = path.join(__dirname, '..', '..', 'test-api', 'files')
const readFixture = name => fs.readFileSync(path.join(filesDir, name), 'utf8')
// an https:// proxy's certificate for localhost, signed by test-ca.crt, a CA in no trust store, like a company's
const httpsProxyTls = { key: readFixture('test-ca-localhost.key'), cert: readFixture('test-ca-localhost.crt') + readFixture('test-ca.crt') }
const trustingTestCA = { rejectUnauthorized: true, ca: [...tls.rootCertificates, readFixture('test-ca.crt')] }

const closables = []

afterEach(() => {
    closeTestProxies()
    for(const closable of closables.splice(0)) {
        closable.close()
    }
})

function startEchoServer() {
    const server = net.createServer(socket => {
        socket.on('error', () => {})
        socket.on('data', chunk => socket.write(`echo:${chunk}`))
    })
    closables.push(server)
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

async function startRelay(proxyUrl, tlsOptions = { rejectUnauthorized: true }) {
    const relay = await startProxyRelay(async() => proxyUrl, () => tlsOptions)
    closables.push(relay)
    return relay
}

// what Chromium does for HTTPS and WebSocket: CONNECT to the relay, then talk to the target through it
function exchangeThroughRelay(relay, authority, message) {
    return new Promise(resolve => {
        const connectRequest = http.request({ host: '127.0.0.1', port: relay.port, method: 'CONNECT', path: authority })
        connectRequest.once('connect', (response, socket) => {
            if(response.statusCode !== 200) {
                socket.destroy()
                resolve(`status ${response.statusCode}`)
                return
            }
            socket.once('data', chunk => {
                resolve(chunk.toString())
                socket.destroy()
            })
            socket.write(message)
        })
        connectRequest.once('error', e => resolve(`error ${e.message}`))
        connectRequest.end()
    })
}

// what Chromium fetch does for plain HTTP: the full URL to the relay
function getThroughRelay(relay, url) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: relay.port, path: url, headers: { host: new URL(url).host, 'proxy-connection': 'keep-alive' } }, response => {
            let body = ''
            response.on('data', chunk => body += chunk)
            response.on('end', () => resolve({ status: response.statusCode, body }))
        }).on('error', reject)
    })
}

test('a tunnel goes through an HTTP proxy with the login from the setting', async() => {
    const echoPort = await startEchoServer()
    const proxy = await startForwardProxy()
    const relay = await startRelay(proxy.url.replace('http://', 'http://user:p%40ss@'))

    expect(await exchangeThroughRelay(relay, `api.relay-spec.test:${echoPort}`, 'hello')).toBe('echo:hello')
    expect(proxy.received[0].requestLine).toBe(`CONNECT api.relay-spec.test:${echoPort} HTTP/1.1`)
    expect(proxy.received[0].headers).toContainEqual(['proxy-authorization', `Basic ${Buffer.from('user:p@ss').toString('base64')}`])
})

test('a tunnel goes through an https:// proxy signed by a CA only Settings > CA Certificates trusts, and not without it', async() => {
    const echoPort = await startEchoServer()
    const proxy = await startForwardProxy(httpsProxyTls)

    const trusting = await startRelay(proxy.url, trustingTestCA)
    expect(await exchangeThroughRelay(trusting, `api.relay-spec.test:${echoPort}`, 'hello')).toBe('echo:hello')

    const notTrusting = await startRelay(proxy.url)
    expect(await exchangeThroughRelay(notTrusting, `api.relay-spec.test:${echoPort}`, 'hello')).toBe('status 502')
})

test('a tunnel goes through a SOCKS5 proxy with the login as typed, which Chromium cannot send', async() => {
    const echoPort = await startEchoServer()
    const socks = await startSocks5Proxy()
    const relay = await startRelay(socks.url.replace('socks5://', `socks5://${encodeURIComponent('dom user')}:${encodeURIComponent('p@ss€')}@`))

    expect(await exchangeThroughRelay(relay, `api.relay-spec.test:${echoPort}`, 'hello')).toBe('echo:hello')
    expect(socks.logins).toEqual([{ username: 'dom user', password: 'p@ss€' }])
})

test('plain HTTP from Chromium fetch goes to an HTTP proxy as a full URL with the login, and through SOCKS5 to the server', async() => {
    const proxy = await startForwardProxy()
    const viaHttpProxy = await startRelay(proxy.url.replace('http://', 'http://user:secret@'))

    expect(await getThroughRelay(viaHttpProxy, 'http://api.relay-spec.test/path?x=1')).toEqual({ status: 200, body: 'proxied GET http://api.relay-spec.test/path?x=1 HTTP/1.1' })
    expect(proxy.received[0].headers).toContainEqual(['proxy-authorization', `Basic ${Buffer.from('user:secret').toString('base64')}`])
    expect(proxy.received[0].headers.find(([name]) => name === 'proxy-connection')).toBe(undefined)

    const target = http.createServer((req, res) => res.end(`server got ${req.url}`))
    closables.push(target)
    await new Promise(resolve => target.listen(0, '127.0.0.1', resolve))
    const socks = await startSocks5Proxy()
    const viaSocks = await startRelay(socks.url.replace('socks5://', 'socks5://user:secret@'))

    expect(await getThroughRelay(viaSocks, `http://api.relay-spec.test:${target.address().port}/path?x=1`)).toEqual({ status: 200, body: 'server got /path?x=1' })
})

test('an IP address reaches the proxy as one, an IPv6 address in brackets for an HTTP proxy', async() => {
    const echoPort = await startEchoServer()
    const proxy = await startForwardProxy()
    const viaHttpProxy = await startRelay(proxy.url)

    expect(await exchangeThroughRelay(viaHttpProxy, `[2001:db8::1]:${echoPort}`, 'hello')).toBe('echo:hello')
    expect(proxy.received[0].requestLine).toBe(`CONNECT [2001:db8::1]:${echoPort} HTTP/1.1`)

    const socks = await startSocks5Proxy()
    const viaSocks = await startRelay(socks.url.replace('socks5://', 'socks5://user:secret@'))

    for(const host of ['10.1.2.3', '[2001:db8::1]', 'api.relay-spec.test']) {
        expect(await exchangeThroughRelay(viaSocks, `${host}:${echoPort}`, 'hello')).toBe('echo:hello')
    }
    expect(socks.addresses).toEqual([
        [1, 10, 1, 2, 3],
        [4, 0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        [3, 'api.relay-spec.test'.length, ...Buffer.from('api.relay-spec.test')],
    ])
})

test('a bypassed host connects directly', async() => {
    const echoPort = await startEchoServer()
    const relay = await startRelay(null)

    expect(await exchangeThroughRelay(relay, `127.0.0.1:${echoPort}`, 'hello')).toBe('echo:hello')
})

test('a proxy refusing the login is passed on to Chromium as 407', async() => {
    const refusing = net.createServer(socket => {
        socket.on('error', () => {})
        socket.once('data', () => socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="proxy"\r\ncontent-length: 0\r\n\r\n'))
    })
    closables.push(refusing)
    await new Promise(resolve => refusing.listen(0, '127.0.0.1', resolve))
    const relay = await startRelay(`http://user:wrong@127.0.0.1:${refusing.address().port}`)

    expect(await exchangeThroughRelay(relay, 'api.relay-spec.test:443', 'hello')).toBe('status 407')
})
