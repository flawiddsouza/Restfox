import { test, expect, afterEach } from 'vitest'
import https from 'node:https'
import tls from 'node:tls'
import { X509Certificate } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { handleSendRequest, setCustomCACertificates } from './request.js'
import { trustSystemCACertificates, parseCACertificates, getCACertificatesWithCustom, isCertificateTrustedByCustomCA } from './ca-certificates.js'

const filesDir = path.join(__dirname, '..', '..', 'test-api', 'files')
const readFixture = name => fs.readFileSync(path.join(filesDir, name), 'utf8')

// signed by test-ca.crt, a CA in no trust store, like a site behind a company's TLS inspection proxy, which sends its
// root along
const caCertificate = readFixture('test-ca.crt')
const caSignedCertificate = readFixture('test-ca-localhost.crt')
const selfSignedCertificate = readFixture('localhost.crt')

const servers = []

afterEach(() => {
    setCustomCACertificates([])

    for(const server of servers.splice(0)) {
        server.closeAllConnections()
        server.close()
    }
})

function startServer(key, cert) {
    const server = https.createServer({ key, cert }, (_req, res) => res.end('ok'))
    servers.push(server)
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve(`https://localhost:${server.address().port}/`))
    })
}

function send(url) {
    return handleSendRequest({
        requestId: 'spec',
        url,
        method: 'GET',
        headers: {},
        body: null,
        bodyHint: null,
        disableSSLVerification: false,
    })
}

test('trusts a server signed by the custom CA certificates, and stops once they are removed', async() => {
    const url = await startServer(readFixture('test-ca-localhost.key'), caSignedCertificate + caCertificate)

    const before = await send(url)
    expect(before.event).toBe('responseError')
    expect(before.eventData).toMatch(/self.signed certificate in certificate chain/)

    setCustomCACertificates(parseCACertificates(caCertificate))
    const trusted = await send(url)
    expect(trusted.event).toBe('response')
    expect(trusted.eventData.status).toBe(200)

    setCustomCACertificates([])
    const removed = await send(url)
    expect(removed.event).toBe('responseError')
})

test('getCACertificatesWithCustom keeps the default certificates next to the custom ones', () => {
    expect(getCACertificatesWithCustom([caCertificate])).toEqual([...tls.getCACertificates('default'), caCertificate])
})

// Node formats a certificate differently once it is set, so they are compared by fingerprint
const fingerprints = certificates => new Set(certificates.map(certificate => new X509Certificate(certificate).fingerprint256))

test('trustSystemCACertificates adds the operating system\'s certificates to the default ones', () => {
    const expected = fingerprints([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])

    trustSystemCACertificates()

    expect(fingerprints(tls.getCACertificates('default'))).toEqual(expected)
})

test('parseCACertificates reads every certificate of a PEM bundle and refuses a file without one', () => {
    expect(parseCACertificates(`subject=CN=Restfox Test CA\n${caCertificate}\n${selfSignedCertificate}`)).toHaveLength(2)
    expect(() => parseCACertificates('not a certificate')).toThrow('The file has no PEM certificate')
    expect(() => parseCACertificates('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----')).toThrow('The file has a certificate that cannot be read')
})

// Electron's Certificate, whose issuerCert is the next certificate the server sent
function electronCertificate(...chain) {
    return chain.reduceRight((issuerCert, data) => ({ data, issuerCert }), undefined)
}

test('isCertificateTrustedByCustomCA accepts a chain up to a custom CA for the host it names, and nothing else', () => {
    const customCACertificates = parseCACertificates(caCertificate)

    expect(isCertificateTrustedByCustomCA(electronCertificate(caSignedCertificate), 'localhost', customCACertificates)).toBe(true)
    expect(isCertificateTrustedByCustomCA(electronCertificate(caSignedCertificate, caCertificate), 'localhost', customCACertificates)).toBe(true)
    expect(isCertificateTrustedByCustomCA(electronCertificate(caSignedCertificate), '127.0.0.1', customCACertificates)).toBe(true)

    expect(isCertificateTrustedByCustomCA(electronCertificate(caSignedCertificate), 'example.com', customCACertificates)).toBe(false)
    expect(isCertificateTrustedByCustomCA(electronCertificate(caSignedCertificate), 'localhost', [])).toBe(false)
    expect(isCertificateTrustedByCustomCA(electronCertificate(caSignedCertificate), 'localhost', parseCACertificates(selfSignedCertificate))).toBe(false)
    // a server certificate is not a CA, so it cannot vouch for another certificate
    expect(isCertificateTrustedByCustomCA(electronCertificate(selfSignedCertificate), 'localhost', parseCACertificates(caSignedCertificate))).toBe(false)
})

test('isCertificateTrustedByCustomCA accepts a self-signed server certificate added as itself', () => {
    expect(isCertificateTrustedByCustomCA(electronCertificate(selfSignedCertificate), 'localhost', parseCACertificates(selfSignedCertificate))).toBe(true)
})

test('isCertificateTrustedByCustomCA refuses a certificate whose stated purpose is not serving websites', () => {
    const clientAuthOnlyCertificate = readFixture('test-client-auth-only.crt')
    expect(isCertificateTrustedByCustomCA(electronCertificate(clientAuthOnlyCertificate), 'localhost', parseCACertificates(clientAuthOnlyCertificate))).toBe(false)
})
