const { isIP } = require('net')
const { isBypassed, parseResolvedProxy, getProxyForRequest, getProxyForGrpc, takeProxyAuthorization, getProxyAgentOptions, removeProxyCredentials, parseBypassEntry } = require('../shared/proxy.js')

// the same setting for Chromium's own connections, WebSocket, Socket.IO and Chromium fetch, through session.setProxy.
// Custom goes to the loopback relay on relayPort, which passes connections to the proxy (proxy-relay.js). Chromium
// matches a bypass entry exactly, so each also gets its subdomains as the list above means
function getChromiumProxyConfig(proxySettings, relayPort = null) {
    if(proxySettings?.mode === 'off') {
        return { mode: 'direct' }
    }

    if(proxySettings?.mode === 'custom') {
        const address = String(proxySettings.url ?? '').trim()

        if(address === '') {
            return { mode: 'direct' }
        }

        const proxyBypassRules = String(proxySettings.bypass ?? '').split(/[\s,]+/).filter(entry => entry !== '').flatMap(entry => {
            if(entry === '*') {
                return ['*']
            }

            const { host, port } = parseBypassEntry(entry)
            const [address, prefixLength] = host.split('/')

            // an address or range has no subdomains, Chromium wants an IPv6 address in brackets and a range without
            if(isIP(address) !== 0) {
                const rule = isIP(address) === 6 && prefixLength === undefined ? `[${address}]` : host
                return [port !== undefined ? `${rule}:${port}` : rule]
            }

            const name = entry.replace(/^\*?\./, '')
            return [name, `*.${name}`]
        })

        return { mode: 'fixed_servers', proxyRules: `http://127.0.0.1:${relayPort}`, proxyBypassRules: proxyBypassRules.join(',') }
    }

    return { mode: 'system' }
}

module.exports = {
    isBypassed,
    parseResolvedProxy,
    getProxyForRequest,
    getProxyForGrpc,
    getChromiumProxyConfig,
    takeProxyAuthorization,
    getProxyAgentOptions,
    removeProxyCredentials,
}
