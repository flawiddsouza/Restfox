import tls from 'tls'
import { X509Certificate } from 'crypto'

const PEM_CERTIFICATE_REGEX = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g

// Node trusts only the certificates it was built with, while browsers also trust those installed in the operating system,
// such as the root a company's TLS inspection proxy signs sites with
export function trustSystemCACertificates() {
    try {
        tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])])
    } catch(e) {
        console.error('Could not add the operating system\'s CA certificates:', e.message)
    }
}

// the certificates in a PEM file, throws when it holds none that parse
export function parseCACertificates(text) {
    const certificates = String(text ?? '').match(PEM_CERTIFICATE_REGEX) ?? []

    if(certificates.length === 0) {
        throw new Error('The file has no PEM certificate (-----BEGIN CERTIFICATE-----)')
    }

    for(const certificate of certificates) {
        try {
            new X509Certificate(certificate)
        } catch(e) {
            throw new Error('The file has a certificate that cannot be read', { cause: e })
        }
    }

    return certificates
}

// the custom certificates are trusted in addition to the default ones, never instead of them
export function getCACertificatesWithCustom(customCACertificates) {
    return [...tls.getCACertificates('default'), ...customCACertificates]
}
