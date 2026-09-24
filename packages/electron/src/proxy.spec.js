import { test, expect } from 'vitest'
import { isBypassed, parseResolvedProxy, getProxyForRequest, getChromiumProxyConfig, takeProxyAuthorization, getProxyAgentOptions } from './proxy.js'

test('a bypass entry covers the host and its subdomains, with or without a leading dot or star', () => {
    for(const entry of ['example.com', '.example.com', '*.example.com']) {
        expect(isBypassed(new URL('http://example.com/'), entry)).toBe(true)
        expect(isBypassed(new URL('http://api.example.com/'), entry)).toBe(true)
        expect(isBypassed(new URL('http://notexample.com/'), entry)).toBe(false)
    }
})

test('a bypass entry with a port covers only that port, the scheme default when the URL has none', () => {
    expect(isBypassed(new URL('http://example.com:8080/'), 'example.com:8080')).toBe(true)
    expect(isBypassed(new URL('http://example.com/'), 'example.com:8080')).toBe(false)
    expect(isBypassed(new URL('https://example.com/'), 'example.com:443')).toBe(true)
})

test('a bypass list is split by commas or spaces and "*" covers every host', () => {
    expect(isBypassed(new URL('http://b.test/'), 'a.test, b.test')).toBe(true)
    expect(isBypassed(new URL('http://b.test/'), 'a.test b.test')).toBe(true)
    expect(isBypassed(new URL('http://anything.test/'), '*')).toBe(true)
    expect(isBypassed(new URL('http://b.test/'), '')).toBe(false)
    expect(isBypassed(new URL('http://b.test/'), undefined)).toBe(false)
})

test('the first entry of a PAC style answer from Electron is used', () => {
    expect(parseResolvedProxy('DIRECT')).toBe(null)
    expect(parseResolvedProxy('PROXY 10.0.0.1:3128;DIRECT')).toBe('http://10.0.0.1:3128')
    expect(parseResolvedProxy('HTTPS proxy.test:443')).toBe('https://proxy.test:443')
    expect(parseResolvedProxy('SOCKS5 proxy.test:1080')).toBe('socks5://proxy.test:1080')
    expect(() => parseResolvedProxy('SOCKS proxy.test:1080')).toThrow('SOCKS4')
})

test('System, also when the setting was never saved, takes the operating system proxy first and then the environment', async() => {
    const url = new URL('http://api.test/')
    const env = { HTTP_PROXY: 'http://env-proxy.test:8080' }

    for(const proxySettings of [null, undefined, {}, { mode: 'system' }]) {
        expect(await getProxyForRequest(url, proxySettings, async() => 'PROXY os-proxy.test:3128', env)).toBe('http://os-proxy.test:3128')
        expect(await getProxyForRequest(url, proxySettings, async() => 'DIRECT', env)).toBe('http://env-proxy.test:8080')
        expect(await getProxyForRequest(url, proxySettings, null, env)).toBe('http://env-proxy.test:8080')
        expect(await getProxyForRequest(url, proxySettings, null, {})).toBe(null)
    }
})

test('the environment proxy follows the scheme and NO_PROXY, lowercase names first', async() => {
    const env = { http_proxy: 'lower.test:1', HTTP_PROXY: 'http://upper.test:1', HTTPS_PROXY: 'http://secure.test:2', NO_PROXY: 'internal.test' }

    expect(await getProxyForRequest(new URL('http://api.test/'), null, null, env)).toBe('http://lower.test:1')
    expect(await getProxyForRequest(new URL('https://api.test/'), null, null, env)).toBe('http://secure.test:2')
    expect(await getProxyForRequest(new URL('https://a.internal.test/'), null, null, env)).toBe(null)
})

test('Off connects directly whatever the system or environment say', async() => {
    expect(await getProxyForRequest(new URL('http://api.test/'), { mode: 'off' }, async() => 'PROXY os-proxy.test:3128', { HTTP_PROXY: 'http://env-proxy.test:8080' })).toBe(null)
})

test('Custom adds the credentials, encoded, and follows its bypass list', async() => {
    const proxySettings = { mode: 'custom', url: 'proxy.test:3128', username: 'dom\\user', password: 'p@ss:word', bypass: 'internal.test' }
    const proxyUrl = await getProxyForRequest(new URL('https://api.test/'), proxySettings, async() => 'PROXY os-proxy.test:3128', {})

    expect(proxyUrl).toBe('http://dom%5Cuser:p%40ss%3Aword@proxy.test:3128/')
    expect(decodeURIComponent(new URL(proxyUrl).username)).toBe('dom\\user')
    expect(decodeURIComponent(new URL(proxyUrl).password)).toBe('p@ss:word')
    expect(await getProxyForRequest(new URL('https://internal.test/'), proxySettings, null, {})).toBe(null)
    expect(await getProxyForRequest(new URL('https://api.test/'), { mode: 'custom', url: '' }, null, {})).toBe(null)
})

test('loopback hosts connect directly in every mode, as Chromium does', async() => {
    const custom = { mode: 'custom', url: 'http://proxy.test:3128' }
    const env = { HTTP_PROXY: 'http://env-proxy.test:8080' }

    for(const url of ['http://localhost:5605/', 'http://api.localhost/', 'http://127.0.0.1/', 'http://[::1]:8080/']) {
        expect(await getProxyForRequest(new URL(url), custom, null, env)).toBe(null)
        expect(await getProxyForRequest(new URL(url), null, null, env)).toBe(null)
    }
})

test('Chromium gets the same choice, the custom proxy without credentials and each bypass entry with its subdomains', () => {
    expect(getChromiumProxyConfig(null)).toEqual({ mode: 'system' })
    expect(getChromiumProxyConfig({ mode: 'system' })).toEqual({ mode: 'system' })
    expect(getChromiumProxyConfig({ mode: 'off' })).toEqual({ mode: 'direct' })
    expect(getChromiumProxyConfig({ mode: 'custom', url: ' ' })).toEqual({ mode: 'direct' })
    expect(getChromiumProxyConfig({ mode: 'custom', url: 'proxy.test:3128', username: 'user', password: 'secret', bypass: '.corp.test, api.test:8080 *' })).toEqual({
        mode: 'fixed_servers',
        proxyRules: 'http://proxy.test:3128',
        proxyBypassRules: 'corp.test,*.corp.test,api.test:8080,*.api.test:8080,*',
    })
})

test('a bypass entry can be an IP address or range, IPv6 included, as NO_PROXY often holds', () => {
    expect(isBypassed(new URL('http://10.1.2.3/'), '10.0.0.0/8')).toBe(true)
    expect(isBypassed(new URL('http://11.1.2.3/'), '10.0.0.0/8')).toBe(false)
    expect(isBypassed(new URL('http://10.1.2.3:8080/'), '10.1.2.3:8080')).toBe(true)
    expect(isBypassed(new URL('http://10.1.2.3/'), '10.1.2.3:8080')).toBe(false)
    expect(isBypassed(new URL('http://[2001:db8::1]/'), '2001:db8::1')).toBe(true)
    expect(isBypassed(new URL('http://[2001:db8::5]/'), '2001:db8::/32')).toBe(true)
    expect(isBypassed(new URL('http://[2001:db9::5]/'), '2001:db8::/32')).toBe(false)
    expect(isBypassed(new URL('http://[2001:db8::5]:8080/'), '[2001:db8::5]:8080')).toBe(true)
    // a host name is not an address, and a broken range covers nothing
    expect(isBypassed(new URL('http://10.example.com/'), '10.0.0.0/8')).toBe(false)
    expect(isBypassed(new URL('http://10.1.2.3/'), '10.0.0.0/99')).toBe(false)
})

test('Chromium gets addresses and ranges without a subdomain rule, an IPv6 address in brackets', () => {
    expect(getChromiumProxyConfig({ mode: 'custom', url: 'proxy.test:1', bypass: '10.0.0.0/8, 2001:db8::1, 2001:db8::/32, [::5]:8080, 10.1.2.3:8080' }).proxyBypassRules)
        .toBe('10.0.0.0/8,[2001:db8::1],2001:db8::/32,[::5]:8080,10.1.2.3:8080')
})

test('undici gets TLS to the proxy only for an https:// one, a SOCKS5 login decoded, and the request\'s own Proxy-Authorization as the token', () => {
    const tls = { rejectUnauthorized: false }

    expect(getProxyAgentOptions('http://proxy.test:3128/', tls)).toEqual({ uri: 'http://proxy.test:3128/' })
    expect(getProxyAgentOptions('https://proxy.test/', tls)).toEqual({ uri: 'https://proxy.test/', proxyTls: tls })
    expect(getProxyAgentOptions('socks5://dom%20user%40x:p%40ss@proxy.test:1080', tls))
        .toEqual({ uri: 'socks5://dom%20user%40x:p%40ss@proxy.test:1080', username: 'dom user@x', password: 'p@ss' })
    expect(getProxyAgentOptions('http://proxy.test:3128/', tls, 'Bearer own')).toEqual({ uri: 'http://proxy.test:3128/', token: 'Bearer own' })

    expect(takeProxyAuthorization({ Accept: '*/*', 'Proxy-Authorization': 'Bearer own' })).toEqual({ headers: { Accept: '*/*' }, token: 'Bearer own' })
    expect(takeProxyAuthorization({ Accept: '*/*' })).toEqual({ headers: { Accept: '*/*' }, token: null })
})
