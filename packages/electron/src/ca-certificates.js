const { X509Certificate } = require('crypto')
const { isIP } = require('net')
const { trustSystemCACertificates, parseCACertificates, getCACertificatesWithCustom } = require('../shared/ca-certificates.js')

const SERVER_AUTHENTICATION_USAGE = '1.3.6.1.5.5.7.3.1'
const ANY_EXTENDED_KEY_USAGE = '2.5.29.37.0'

// a certificate that names its purposes must name serving websites or any purpose
function allowsServerAuthentication(x509) {
    return x509.keyUsage === undefined || x509.keyUsage.includes(SERVER_AUTHENTICATION_USAGE) || x509.keyUsage.includes(ANY_EXTENDED_KEY_USAGE)
}

// parsed once per list, the list is replaced whenever the setting changes
const parsedCustomCACertificates = new WeakMap()

function getParsedCustomCACertificates(customCACertificates) {
    if(!parsedCustomCACertificates.has(customCACertificates)) {
        parsedCustomCACertificates.set(customCACertificates, customCACertificates.map(customCACertificate => new X509Certificate(customCACertificate)))
    }

    return parsedCustomCACertificates.get(customCACertificates)
}

// whether a certificate Chromium rejected chains up to one of the custom CA certificates and is valid for the host.
// certificate is Electron's Certificate, whose issuerCert is the next certificate the server sent. Chromium cannot be given
// extra CAs, so this is a check of its own for what Chromium fetch and sockets reach: signatures up to the custom CA, the
// host name, the dates and the stated purpose. Unlike a TLS library, it does not apply the names or chain length a CA
// limits itself to, which Node does not expose, and matters only when the custom CA issues such a chain
function isCertificateTrustedByCustomCA(certificate, hostname, customCACertificates) {
    try {
        const chain = []
        for(let item = certificate; item && chain.length < 10; item = item.issuerCert) {
            chain.push(new X509Certificate(item.data))
        }

        const host = hostname.replace(/^\[|\]$/g, '')
        if((isIP(host) ? chain[0].checkIP(host) : chain[0].checkHost(host)) === undefined) {
            return false
        }

        const now = Date.now()
        const isValidNow = x509 => now >= Date.parse(x509.validFrom) && now <= Date.parse(x509.validTo)
        const customCAs = getParsedCustomCACertificates(customCACertificates).filter(customCA => isValidNow(customCA) && allowsServerAuthentication(customCA))

        for(let i = 0; i < chain.length; i++) {
            if(!isValidNow(chain[i]) || !allowsServerAuthentication(chain[i])) {
                return false
            }

            // a custom certificate that is not a CA is trusted only as itself, as a self-signed server certificate
            if(customCAs.some(customCA => (customCA.ca || customCA.fingerprint256 === chain[i].fingerprint256) && chain[i].checkIssued(customCA) && chain[i].verify(customCA.publicKey))) {
                return true
            }

            const issuer = chain[i + 1]
            if(!issuer || !issuer.ca || !chain[i].checkIssued(issuer) || !chain[i].verify(issuer.publicKey)) {
                return false
            }
        }
    } catch {
        return false
    }

    return false
}

module.exports = {
    trustSystemCACertificates,
    parseCACertificates,
    getCACertificatesWithCustom,
    isCertificateTrustedByCustomCA,
}
