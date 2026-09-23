import https from 'https'
import tls from 'tls'
import { X509Certificate } from 'crypto'
import fs from 'fs'
import path from 'path'
import test from 'node:test'
import assert from 'node:assert/strict'
import app from './app.js'

const filesDir = path.join(import.meta.dirname, '..', 'test-api', 'files')
const readFixture = name => fs.readFileSync(path.join(filesDir, name), 'utf8')

// signed by test-ca.crt, a CA in no trust store, like a site behind a company's TLS inspection proxy, which sends its
// root along
const caCertificate = readFixture('test-ca.crt')

function startCASignedServer() {
    const server = https.createServer({
        key: readFixture('test-ca-localhost.key'),
        cert: readFixture('test-ca-localhost.crt') + caCertificate,
    }, (_req, res) => res.end('ok'))

    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ server, url: `https://localhost:${server.address().port}/` }))
    })
}

function listenApp() {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server))
    })
}

function closeServer(server) {
    server.closeAllConnections()
    server.close()
}

function registerCACertificates(proxy, certificates) {
    return fetch(`http://127.0.0.1:${proxy.address().port}/proxy-ca-certificates`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: certificates,
    })
}

async function sendThroughProxy(proxy, url, caCertificatesId = null) {
    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/proxy`, {
        method: 'POST',
        headers: {
            'x-proxy-req-url': url,
            'x-proxy-req-method': 'GET',
            'x-proxy-flag-disable-ssl-verification': 'false',
            ...(caCertificatesId ? { 'x-proxy-flag-ca-certificates-id': caCertificatesId } : {}),
        },
    })

    return response.json()
}

test('a server signed by registered CA certificates is trusted for the requests that name them', async() => {
    const target = await startCASignedServer()
    const proxy = await listenApp()

    try {
        const before = await sendThroughProxy(proxy, target.url)
        assert.equal(before.event, 'responseError')
        assert.equal(before.eventData, 'fetch failed: self-signed certificate in certificate chain')

        const registration = await registerCACertificates(proxy, caCertificate)
        assert.equal(registration.status, 200)
        const { id } = await registration.json()

        const trusted = await sendThroughProxy(proxy, target.url, id)
        assert.equal(trusted.event, 'response')
        assert.equal(trusted.eventData.status, 200)

        // the certificates belong to the requests that name them, not to the server
        const other = await sendThroughProxy(proxy, target.url)
        assert.equal(other.event, 'responseError')
    } finally {
        closeServer(proxy)
        closeServer(target.server)
    }
})

test('a request naming CA certificates the server does not have asks the UI to register them again', async() => {
    const proxy = await listenApp()

    try {
        const result = await sendThroughProxy(proxy, 'https://localhost:1/', 'forgotten-after-a-restart')
        assert.deepEqual(result, { event: 'caCertificatesNotFound' })
    } finally {
        closeServer(proxy)
    }
})

test('registering a file without a readable certificate is refused with the reason', async() => {
    const proxy = await listenApp()

    try {
        const noCertificate = await registerCACertificates(proxy, 'not a certificate')
        assert.equal(noCertificate.status, 400)
        assert.match((await noCertificate.json()).error, /The file has no PEM certificate/)

        const unreadable = await registerCACertificates(proxy, '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----')
        assert.equal(unreadable.status, 400)
        assert.match((await unreadable.json()).error, /The file has a certificate that cannot be read/)
    } finally {
        closeServer(proxy)
    }
})

test('the server trusts the operating system\'s certificates', () => {
    // Node formats a certificate differently once it is set, so they are compared by fingerprint
    const fingerprints = certificates => new Set(certificates.map(certificate => new X509Certificate(certificate).fingerprint256))
    const trusted = fingerprints(tls.getCACertificates('default'))

    for(const fingerprint of fingerprints(tls.getCACertificates('system'))) {
        assert.ok(trusted.has(fingerprint))
    }
})
