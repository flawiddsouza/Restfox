import { BlockList, isIP } from 'net'

// Settings > Proxy: the proxy a request goes through, as a URL undici's ProxyAgent takes, or null to connect directly.
// A missing setting is System, the operating system's proxy, like browsers and other API clients

// browsers never send these through a proxy, Chromium in Electron included, requests do the same
function isLoopback(hostname) {
    return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127(\.\d{1,3}){3}$/.test(hostname)
}

// a bypass entry's host and port: "[::1]:8080" and a bare IPv6 address or range have colons of their own
function parseBypassEntry(entry) {
    const bracketed = entry.match(/^\[(.+)\](?::(\d+))?$/)

    if(bracketed) {
        return { host: bracketed[1], port: bracketed[2] }
    }

    const portSeparator = entry.lastIndexOf(':')

    if(portSeparator === -1 || isIP(entry.split('/')[0]) === 6) {
        return { host: entry, port: undefined }
    }

    return { host: entry.slice(0, portSeparator), port: entry.slice(portSeparator + 1) }
}

// an IP address, or a range such as 10.0.0.0/8, covering the request's address
function isAddressInEntry(hostname, entryHost) {
    const [address, prefixLength] = entryHost.split('/')
    const addressType = isIP(address)

    if(addressType === 0 || isIP(hostname) !== addressType) {
        return false
    }

    const family = addressType === 4 ? 'ipv4' : 'ipv6'
    const addresses = new BlockList()

    try {
        if(prefixLength === undefined) {
            addresses.addAddress(address, family)
        } else {
            addresses.addSubnet(address, Number(prefixLength), family)
        }
    } catch {
        return false
    }

    return addresses.check(hostname, family)
}

// a list like NO_PROXY, split by commas or spaces: "*" for every host, a host, which also covers its subdomains, the
// same with a leading "." or "*.", an IP address or range such as 10.0.0.0/8, or any of them with ":port"
export function isBypassed(url, bypassList) {
    const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')

    for(const entry of String(bypassList ?? '').toLowerCase().split(/[\s,]+/)) {
        if(entry === '') {
            continue
        }

        if(entry === '*') {
            return true
        }

        const { host, port: entryPort } = parseBypassEntry(entry)

        if(entryPort !== undefined && entryPort !== port) {
            continue
        }

        if(isIP(host.split('/')[0]) !== 0) {
            if(isAddressInEntry(hostname, host)) {
                return true
            }
            continue
        }

        const entryHost = host.replace(/^\*?\./, '')

        if(hostname === entryHost || hostname.endsWith(`.${entryHost}`)) {
            return true
        }
    }

    return false
}

// Electron's session.resolveProxy answers like a PAC script, "PROXY host:port; DIRECT", the first entry is used
export function parseResolvedProxy(resolved) {
    const [type, address] = String(resolved ?? '').split(';')[0].trim().split(/\s+/)

    switch(type?.toUpperCase()) {
        case 'PROXY':
            return `http://${address}`
        case 'HTTPS':
            return `https://${address}`
        case 'SOCKS5':
            return `socks5://${address}`
        case 'SOCKS':
        case 'SOCKS4':
            throw new Error(`The system proxy ${address} is a SOCKS4 proxy, only HTTP, HTTPS and SOCKS5 proxies are supported`)
        default:
            return null
    }
}

// HTTP_PROXY, HTTPS_PROXY and NO_PROXY, the lowercase names first as curl reads them
function getEnvironmentProxy(url, env) {
    const proxy = url.protocol === 'https:' ? (env.https_proxy ?? env.HTTPS_PROXY) : (env.http_proxy ?? env.HTTP_PROXY)

    if(!proxy || isBypassed(url, env.no_proxy ?? env.NO_PROXY)) {
        return null
    }

    return proxy.includes('://') ? proxy : `http://${proxy}`
}

function getCustomProxy(url, proxySettings) {
    const address = String(proxySettings.url ?? '').trim()

    if(address === '' || isBypassed(url, proxySettings.bypass)) {
        return null
    }

    const proxyUrl = new URL(address.includes('://') ? address : `http://${address}`)

    if(proxySettings.username) {
        proxyUrl.username = encodeURIComponent(proxySettings.username)
        proxyUrl.password = encodeURIComponent(proxySettings.password ?? '')
    }

    return proxyUrl.href
}

// resolveSystemProxy is Electron's session.resolveProxy, which reads the operating system's settings and PAC script.
// Without it, as in web-standalone, and when the system has no proxy, the environment variables apply
export async function getProxyForRequest(url, proxySettings, resolveSystemProxy = null, env = process.env) {
    if(isLoopback(url.hostname)) {
        return null
    }

    if(proxySettings?.mode === 'off') {
        return null
    }

    if(proxySettings?.mode === 'custom') {
        return getCustomProxy(url, proxySettings)
    }

    const systemProxy = resolveSystemProxy ? parseResolvedProxy(await resolveSystemProxy(url.href)) : null

    return systemProxy ?? getEnvironmentProxy(url, env)
}

// undici refuses a request's own Proxy-Authorization and takes it only as the ProxyAgent's token
export function takeProxyAuthorization(headers) {
    const name = Object.keys(headers ?? {}).find(headerName => headerName.toLowerCase() === 'proxy-authorization')

    if(name === undefined) {
        return { headers, token: null }
    }

    const { [name]: token, ...otherHeaders } = headers

    return { headers: otherHeaders, token }
}

// undici's ProxyAgent options for a proxy. TLS to the proxy only for an https:// one, its SOCKS5 agent reads any proxyTls
// as a SOCKS proxy behind TLS. A SOCKS5 login decoded, that agent takes the URL's percent-encoded one as it is
export function getProxyAgentOptions(proxyUrl, tls, token = null) {
    const { protocol, username, password } = new URL(proxyUrl)

    return {
        uri: proxyUrl,
        ...(protocol === 'https:' ? { proxyTls: tls } : {}),
        ...(protocol.startsWith('socks') && username ? { username: decodeURIComponent(username), password: decodeURIComponent(password) } : {}),
        ...(token !== null ? { token } : {}),
    }
}

// plain HTTP carries the proxy's credentials in the request itself, they stay out of the timeline and the response
// history unless the request set the header itself
export function removeProxyCredentials(headersSent, requestHeaders) {
    if(!headersSent || Object.keys(requestHeaders ?? {}).some(name => name.toLowerCase() === 'proxy-authorization')) {
        return headersSent
    }

    return headersSent.filter(([name]) => name.toLowerCase() !== 'proxy-authorization')
}
