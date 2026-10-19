// @vitest-environment edge-runtime

import { assert, test, describe, expect, vi, afterEach, beforeEach } from 'vitest'
import {
    substituteEnvironmentVariables,
    parseContentDispositionHeaderAndGetFileName,
    convertPostmanAuthToRestfoxAuth,
    scriptConversion,
    toTree,
    getSpaces,
    getSavedRequestTimeout,
    getSavedProxySettings,
    getProxySettingsInUse,
    getProxyUrlError,
    fetchWrapper,
    handleRequest,
    createRequestData,
    setObjectPathValue,
    prepareCollectionForExport,
    convertRestfoxExportToRestfoxCollection,
    convertInsomniaExportToRestfoxCollection,
    convertInsomniaFileToRestfoxCollection,
    deepClone,
    INHERITED_AUTHENTICATION_TYPE,
    createOAuthTokenRequest,
    describeOAuthTokenError,
    getMissingOAuthTokenFieldsMessage,
    getSocketConnectionUrl,
    fetchGraphQLSchema,
    caCertificatesFileToPEM,
    substituteEnvironmentVariablesForSend,
    SendResolver,
    describeMaskedPromptOmitted,
} from './helpers'
import { forgetPromptValues } from './utils/prompt-tag'
import type { CollectionItem, HandleRequestState, RequestAuthentication, RequestFinalResponse } from './global'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

type FetchInitWithSignal = {
    signal: AbortSignal
}

type WindowWithExtensionHook = Window & {
    __EXTENSION_HOOK__?: string
}

beforeEach(() => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
            store[key] = value
        }),
        removeItem: vi.fn((key: string) => {
            delete store[key]
        }),
        clear: vi.fn(() => {
            Object.keys(store).forEach(key => {
                delete store[key]
            })
        }),
    })
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    delete (window as WindowWithExtensionHook).__EXTENSION_HOOK__
    localStorage.clear()
})

describe(`Function: ${substituteEnvironmentVariables.name}`, () => {

    // build environment vars
    const env: any = {}

    env.i = 1
    env.nothing = null
    env.num = 1234
    env.str = 'This is string'

    env.arrNum = [ 1, 2, 3 ]
    env.arrStr = [ 'a', 'bb', 'cc' ]
    env.arrObj = [
        { keyStr: 'string' },
        { keyNum: 1 },
        { keyObj: { nestedObj: 'nest object value', nestedArr: [ 1, 2, 3 ] } }
    ]

    env.arr2dMix = [ env.arrNum, env.arrStr, env.arrObj ]

    env.strCamelCase      = 'This is camelCase'
    env.str_snake_case    = 'This is snake-case'
    env['str-kebab-case'] = 'This is kebab-case'
    env['key with space'] = 'This key has space'

    const extremelyMessyKey = 'extremelyMESSY-K_E_Y ~!@#$%^&*()_+12 34567980{{} :>}notReplaced::{{  num }}::notReplaced"?<, . shouldReplaceThisInFuture::{{  num   }}::replaced /;\'[ ]'
    env[ extremelyMessyKey ] = 'Very messy key :)'

    test('Positive Case', async() => {
        const input = `{
            "i": {{i}},
            "_i": {{ i }},

            "nothing": {{nothing}},
            "nothing": {{ nothing }},

            "num": {{num}},
            "_num": {{ num }},

            "str": "{{str}}",
            "_str": "{{ str }}",

            "arrNum": {{arrNum}},
            "_arrNum": {{ arrNum }},
            "arrNum[0]": "{{arrNum[0]}}",
            "_arrNum[0]": "{{ arrNum[0] }}",

            "arrStr": {{arrStr}},
            "arrStr_": {{arrStr}},
            "arrStr[0]": "{{arrStr[0]}}",

            "arrObj[0]": "{{arrObj[0]}}",
            "arrObj[1]": "{{arrObj[1]}}",
            "arrObj[2]": "{{arrObj[2]}}",
            "arrObj[2].keyObj": "{{arrObj[2].keyObj}}",

            "arr2dMix": {{arr2dMix}},
            "arr2dMix_": {{arr2dMix}},

            "arr2dMix[2][2].keyObj.nestedArr": {{arr2dMix[2][2].keyObj.nestedArr}},
            "arr2dMix[2][2].keyObj.nestedArr[0]": {{arr2dMix[2][2].keyObj.nestedArr[0]}},

            "strCamelCase":   "{{strCamelCase}}",
            "str_snake_case": "{{str_snake_case}}",
            "str-kebab-case": "{{str-kebab-case}}",
            "key with space": "{{key with space}}",

            "messyKey": "{{${extremelyMessyKey}}}",
        }`
        const expectedOutput = `{
            "i": ${env.i},
            "_i": ${env.i},

            "nothing": ${env.nothing},
            "nothing": ${env.nothing},

            "num": ${env.num},
            "_num": ${env.num},

            "str": "${env.str}",
            "_str": "${env.str}",

            "arrNum": ${JSON.stringify(env.arrNum)},
            "_arrNum": ${JSON.stringify(env.arrNum)},
            "arrNum[0]": "${env.arrNum[0]}",
            "_arrNum[0]": "${env.arrNum[0]}",

            "arrStr": ${JSON.stringify(env.arrStr)},
            "arrStr_": ${JSON.stringify(env.arrStr)},
            "arrStr[0]": "${env.arrStr[0]}",

            "arrObj[0]": "${JSON.stringify(env.arrObj[0])}",
            "arrObj[1]": "${JSON.stringify(env.arrObj[1])}",
            "arrObj[2]": "${JSON.stringify(env.arrObj[2])}",
            "arrObj[2].keyObj": "${JSON.stringify(env.arrObj[2].keyObj)}",

            "arr2dMix": ${JSON.stringify(env.arr2dMix)},
            "arr2dMix_": ${JSON.stringify(env.arr2dMix)},

            "arr2dMix[2][2].keyObj.nestedArr": ${JSON.stringify(env.arr2dMix[2][2].keyObj.nestedArr)},
            "arr2dMix[2][2].keyObj.nestedArr[0]": ${env.arr2dMix[2][2].keyObj.nestedArr[0]},

            "strCamelCase":   "${env.strCamelCase}",
            "str_snake_case": "${env.str_snake_case}",
            "str-kebab-case": "${env['str-kebab-case']}",
            "key with space": "${env['key with space']}",

            "messyKey": "${env[extremelyMessyKey]}",
        }`
        assert.equal(await substituteEnvironmentVariables(env, input), expectedOutput)

    })

    test('Negative Case', async() => {
        const input = `{
            "": "",
            "{": "}",
            "{{": "}}",
            "}}": "{{",
            "{": "}}",
            "{{": "}",
            "{ { ": " } }",

            "num": num,
            "num": {num,
            "num": num},
            "num": {num},
            "num": {{num},
            "num": {num}},

            "num": { {num}},
            "num": {{num} },
            "num": { {num} },
            "num": { {num } },
            "num": { { num} },
            "num": { { num } },

            "num": {{ num}},
            "num": {{num }},

            "num": {{  num}},
            "num": {{num  }},
            "num": {{  num }},
            "num": {{ num  }},
            "num": {{  num  }},

            "num": {{
                num}},
            "num": {{num
            }},
            "num": {{
                num
            }},
            "num": {
                {num}
            },

            "num": {
                {num
            }},
            "num": {{
                num}
            }},


            "str": {{ s t r }},
            "str": {{}},
            "str": {,
            "str": {{,
            "str": {{},
            "str": {}},
            "str": {{}},
            "str": { { } },
            "str": {  } },

            "-_-": "-_-",
            "{{}}": "-._.-",
            "{{}}": "_.",
            "{{}}": "{{_.}}",

            "{{}}": "{{_. arrNum}}",
            "{{}}": "{{_ .arrNum}}",

            "{{}}": "{{ _.arrNum  }}",
            "{{}}": "{{_.arrNum }}",
            "{{}}": "{{  _.arrNum  }}",
            "{{}}": "{{  _.arrNum.  }}",

            "{{}}": "{{arrNum.}}",
            "{{str": "}}",
            "{{str": }},
            "arrNum": "{{arrNum[999]}}",
        }`

        const extraForRegExSpecific = `{
            "num": {{ num    }}, "num": {{num  }}, "num": {{  num }},
                                                            "num": {{  num }},
            "num": {{ num  }},
            "num": {{
                num
            }},
            "num": {{num
            }},
            "num": {{
                num}},
            "str": {{ s t r }},
        }`

        assert.equal(await substituteEnvironmentVariables(env, input), input)
        assert.equal(await substituteEnvironmentVariables(env, extraForRegExSpecific), extraForRegExSpecific)

    })

    test('Insomnia support', async() => {
        const input = `{
            "num": {{_.num}},
            "_num": {{ _.num }},

            "str": "{{_.str}}",
            "_str": "{{ _.str }}",

            "arr2dMix": {{_.arr2dMix}},
            "arr2dMix_": {{ _.arr2dMix }},

            "arr2dMix[2][2].keyObj.nestedArr": {{ _.arr2dMix[2][2].keyObj.nestedArr }},
            "arr2dMix[2][2].keyObj.nestedArr[0]": {{_.arr2dMix[2][2].keyObj.nestedArr[0]}},

            "strCamelCase":   "{{_.strCamelCase}}",
            "str_snake_case": "{{_.str_snake_case}}",
            "str-kebab-case": "{{_.str-kebab-case}}",
            "key with space": "{{ _.key with space }}",

            "messyKey": "{{${extremelyMessyKey}}}",
        }`
        const expectedOutput = `{
            "num": ${env.num},
            "_num": ${env.num},

            "str": "${env.str}",
            "_str": "${env.str}",

            "arr2dMix": ${JSON.stringify(env.arr2dMix)},
            "arr2dMix_": ${JSON.stringify(env.arr2dMix)},

            "arr2dMix[2][2].keyObj.nestedArr": ${JSON.stringify(env.arr2dMix[2][2].keyObj.nestedArr)},
            "arr2dMix[2][2].keyObj.nestedArr[0]": ${env.arr2dMix[2][2].keyObj.nestedArr[0]},

            "strCamelCase":   "${env.strCamelCase}",
            "str_snake_case": "${env.str_snake_case}",
            "str-kebab-case": "${env['str-kebab-case']}",
            "key with space": "${env['key with space']}",

            "messyKey": "${env[extremelyMessyKey]}",
        }`
        assert.equal(await substituteEnvironmentVariables(env, input), expectedOutput)
    })

    test('Insomnia support will not be used if "_" is present as a key in "environment"', async() => {
        env._ = { someKey: '"_" will be used treated as the key, if its present in the env' }

        const input = `{
            "_.someKey": {{_.someKey}},
            "_.someKey": {{ _.someKey }},

            "num": {{_.num}},
            "_.someKey": {{ _.someKey}},
            "_.someKey": {{_.someKey }},
            "_.someKey": {{  _.someKey }},
            "_.someKey": {{ _.someKey  }},
            "_.someKey": {{  _.someKey  }},
        }`
        const expectedOutput = `{
            "_.someKey": ${env._.someKey},
            "_.someKey": ${env._.someKey},

            "num": {{_.num}},
            "_.someKey": {{ _.someKey}},
            "_.someKey": {{_.someKey }},
            "_.someKey": {{  _.someKey }},
            "_.someKey": {{ _.someKey  }},
            "_.someKey": {{  _.someKey  }},
        }`
        assert.equal(await substituteEnvironmentVariables(env, input), expectedOutput)
    })
})

describe(`Function: ${parseContentDispositionHeaderAndGetFileName.name}`, () => {
    test('Type 1', () => {
        const input = `inline; filename="file.txt"`
        const expectedOutput = 'file.txt'
        assert.equal(parseContentDispositionHeaderAndGetFileName(input, 'fallbackFileName'), expectedOutput)
    })

    test('Type 2', () => {
        const input = `attachment; filename="image.jpg"`
        const expectedOutput = 'image.jpg'
        assert.equal(parseContentDispositionHeaderAndGetFileName(input, 'fallbackFileName'), expectedOutput)
    })

    test('Type 3', () => {
        const input = `attachment; filename=annacerrato_vbb_ritratti-02056.jpg; filename*=UTF-8''annacerrato_vbb_ritratti-02056.jpg`
        const expectedOutput = 'annacerrato_vbb_ritratti-02056.jpg'
        assert.equal(parseContentDispositionHeaderAndGetFileName(input, 'fallbackFileName'), expectedOutput)
    })
})

describe('Function: getSavedRequestTimeout', () => {
    test('returns saved positive timeout as an integer', () => {
        localStorage.setItem('Restfox-RequestTimeout', '1500.9')

        expect(getSavedRequestTimeout()).toBe(1500)
    })

    test('returns 0 for missing or invalid timeout values', () => {
        expect(getSavedRequestTimeout()).toBe(0)

        localStorage.setItem('Restfox-RequestTimeout', '-1')
        expect(getSavedRequestTimeout()).toBe(0)

        localStorage.setItem('Restfox-RequestTimeout', 'abc')
        expect(getSavedRequestTimeout()).toBe(0)
    })
})

describe('Function: getSavedProxySettings', () => {
    test('never saved, or unreadable, is null, which the transports take as System', () => {
        expect(getSavedProxySettings()).toBe(null)

        for(const saved of ['not json', 'null', '"custom"', '5']) {
            localStorage.setItem('Restfox-Proxy', saved)
            expect(getSavedProxySettings()).toBe(null)
        }
    })

    test('fields a saved value lacks take their defaults', () => {
        localStorage.setItem('Restfox-Proxy', '{}')
        expect(getSavedProxySettings()).toEqual({ mode: 'system', url: '', username: '', password: '', bypass: '' })

        localStorage.setItem('Restfox-Proxy', JSON.stringify({ mode: 'custom', url: 'http://proxy.test:3128' }))
        expect(getSavedProxySettings()).toEqual({ mode: 'custom', url: 'http://proxy.test:3128', username: '', password: '', bypass: '' })
    })
})

describe('Function: getProxySettingsInUse', () => {
    test('sends the Custom fields only while Custom is chosen, a password kept for switching back stays behind', () => {
        const custom = { mode: 'custom' as const, url: 'http://proxy.test:3128', username: 'user', password: 'secret', bypass: 'internal.test' }

        expect(getProxySettingsInUse(custom)).toEqual(custom)
        expect(getProxySettingsInUse({ ...custom, mode: 'system' })).toEqual({ mode: 'system' })
        expect(getProxySettingsInUse({ ...custom, mode: 'off' })).toEqual({ mode: 'off' })
    })
})

describe('Function: getProxyUrlError', () => {
    test('accepts HTTP, HTTPS and SOCKS5 proxies, a missing scheme meaning HTTP, and a single name such as a hosts entry', () => {
        for(const url of ['proxy.test:3128', 'http://proxy.test:3128', 'https://proxy.test', 'socks5://127.0.0.1:1080', 'SOCKS5://proxy.test:1080', 'proxy']) {
            expect(getProxyUrlError(url)).toBe(null)
        }
    })

    test('a login in the URL goes in Username and Password instead', () => {
        expect(getProxyUrlError('http://user:pass@proxy.test:8080')).toBe('Enter the login in Username and Password, not in the URL')
        expect(getProxyUrlError('user@proxy.test:8080')).toBe('Enter the login in Username and Password, not in the URL')
        expect(getProxyUrlError('socks5://user:pass@proxy.test:1080')).toBe('Enter the login in Username and Password, not in the URL')
    })

    test('an empty URL asks for one', () => {
        expect(getProxyUrlError('')).toBe('Enter a proxy URL to use Custom')
        expect(getProxyUrlError('  ')).toBe('Enter a proxy URL to use Custom')
    })

    test('refuses what the transports cannot connect through', () => {
        for(const url of ['http://', 'socks4://proxy.test:1080', 'ftp://proxy.test', 'http://proxy test']) {
            expect(getProxyUrlError(url)).toMatch('Enter a proxy like')
        }
    })
})

describe(`Function: ${fetchWrapper.name}`, () => {
    test('throws TimeoutError when requestTimeout elapses before response', async() => {
        vi.useFakeTimers()
        vi.stubGlobal('fetch', (_url: string, init: FetchInitWithSignal) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        }))

        const abortController = new AbortController()
        const promise = fetchWrapper(
            new URL('https://example.com'),
            'GET',
            {},
            null,
            abortController.signal,
            {
                electronSwitchToChromiumFetch: false,
                disableSSLVerification: false,
                requestTimeout: 10,
            }
        )
        const expectation = expect(promise).rejects.toMatchObject({ name: 'TimeoutError' })

        await vi.advanceTimersByTimeAsync(10)

        await expectation
    })

    test('propagates AbortError when user cancels before timeout', async() => {
        vi.useFakeTimers()
        vi.stubGlobal('fetch', (_url: string, init: FetchInitWithSignal) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        }))

        const abortController = new AbortController()
        const promise = fetchWrapper(
            new URL('https://example.com'),
            'GET',
            {},
            null,
            abortController.signal,
            {
                electronSwitchToChromiumFetch: false,
                disableSSLVerification: false,
                requestTimeout: 1000,
            }
        )
        const expectation = expect(promise).rejects.toMatchObject({ name: 'AbortError' })

        abortController.abort()

        await expectation
    })

    test('does not send extension request when file serialization finishes after timeout', async() => {
        vi.useFakeTimers()
        ;(window as WindowWithExtensionHook).__EXTENSION_HOOK__ = 'Restfox CORS Helper Enabled'

        let resolveArrayBuffer: (value: ArrayBuffer) => void = () => {
            throw new Error('arrayBuffer resolver was not set')
        }
        const body = new File(['body'], 'body.txt')
        vi.spyOn(body, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>(resolve => {
            resolveArrayBuffer = resolve
        }))
        const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)

        const abortController = new AbortController()
        fetchWrapper(
            new URL('https://example.com'),
            'POST',
            {},
            body,
            abortController.signal,
            {
                electronSwitchToChromiumFetch: false,
                disableSSLVerification: false,
                requestTimeout: 10,
            }
        ).catch(() => undefined)

        await vi.advanceTimersByTimeAsync(10)
        resolveArrayBuffer(new ArrayBuffer(0))
        await Promise.resolve()
        await Promise.resolve()

        expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
            event: 'sendRequest'
        }))
    })
})

describe(`Function: ${handleRequest.name}`, () => {
    test('returns timeout error when requestTimeout elapses', async() => {
        vi.useFakeTimers()
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        vi.stubGlobal('fetch', (_url: string, init: FetchInitWithSignal) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        }))

        const abortController = new AbortController()
        const promise = handleRequest(
            {
                _id: 'request-id',
                _type: 'request',
                name: 'Request',
                parentId: null,
                workspaceId: 'workspace-id',
                url: 'https://example.com',
                method: 'GET',
            } as CollectionItem,
            {},
            {},
            undefined,
            async() => undefined,
            [],
            null,
            abortController.signal,
            {
                electronSwitchToChromiumFetch: false,
                disableSSLVerification: false,
                requestTimeout: 10,
            }
        )

        await vi.advanceTimersByTimeAsync(10)

        await expect(promise).resolves.toMatchObject({ error: 'Error: Request Timed Out' })
    })

    const sendRequest = (signal: AbortSignal) => handleRequest(
        {
            _id: 'request-id',
            _type: 'request',
            name: 'Request',
            parentId: null,
            workspaceId: 'workspace-id',
            url: 'https://example.com',
            method: 'GET',
        } as CollectionItem,
        {},
        {},
        undefined,
        async() => undefined,
        [],
        null,
        signal,
        {
            electronSwitchToChromiumFetch: false,
            disableSSLVerification: false,
            requestTimeout: 0,
        }
    )

    test('a cancel the user asked for is reported in the panel, not logged as an error', async() => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        vi.stubGlobal('fetch', (_url: string, init: FetchInitWithSignal) => new Promise((_resolve, reject) => {
            if(init.signal.aborted) {
                reject(init.signal.reason)
            }
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        }))

        const abortController = new AbortController()
        const promise = sendRequest(abortController.signal)
        abortController.abort()

        await expect(promise).resolves.toMatchObject({ error: 'Error: Request Cancelled' })
        expect(consoleError).not.toHaveBeenCalled()
    })

    test('a request that fails is still logged as an error', async() => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))

        await expect(sendRequest(new AbortController().signal)).resolves.toMatchObject({ error: 'Error: Request failed' })
        expect(consoleError).toHaveBeenCalled()
    })
})

describe('convertPostmanAuthToRestfoxAuth', () => {
    test('should return Inherit when auth is not present', () => {
        const request = {}
        const result = convertPostmanAuthToRestfoxAuth(request)
        expect(result).toEqual({ type: INHERITED_AUTHENTICATION_TYPE })
    })

    test('should return No Auth when auth is noauth', () => {
        const request = { auth: { type: 'noauth' } }
        const result = convertPostmanAuthToRestfoxAuth(request)
        expect(result).toEqual({ type: 'none' })
    })

    test('should handle bearer authentication', () => {
        const request = {
            auth: {
                type: 'bearer',
                bearer: [
                    { key: 'token', value: 'test-token' }
                ]
            }
        }
        const result = convertPostmanAuthToRestfoxAuth(request)
        expect(result).toEqual({
            type: 'bearer',
            token: 'test-token'
        })
    })

    test('should handle basic authentication in Postman v2.0 format', () => {
        const request = {
            auth: {
                type: 'basic',
                basic: {
                    username: 'user_v2',
                    password: 'pass_v2'
                }
            }
        }
        const result = convertPostmanAuthToRestfoxAuth(request)
        expect(result).toEqual({
            type: 'basic',
            username: 'user_v2',
            password: 'pass_v2'
        })
    })

    test('should handle basic authentication in Postman v2.1 format', () => {
        const request = {
            auth: {
                type: 'basic',
                basic: [
                    { key: 'username', value: 'user_v2.1' },
                    { key: 'password', value: 'pass_v2.1' }
                ]
            }
        }
        const result = convertPostmanAuthToRestfoxAuth(request)
        expect(result).toEqual({
            type: 'basic',
            username: 'user_v2.1',
            password: 'pass_v2.1'
        })
    })

    test('should map Postman grant type names to the ones Restfox sends', () => {
        const oauth2 = (grantType: string) => ({ auth: { type: 'oauth2', oauth2: [{ key: 'grant_type', value: grantType }] } })
        expect(convertPostmanAuthToRestfoxAuth(oauth2('password_credentials')).grantType).toBe('password')
        expect(convertPostmanAuthToRestfoxAuth(oauth2('client_credentials')).grantType).toBe('client_credentials')
        expect(convertPostmanAuthToRestfoxAuth(oauth2('authorization_code')).grantType).toBe('authorization_code')
        // Restfox has no implicit grant, the value is kept so the Grant Type selector shows what was imported
        expect(convertPostmanAuthToRestfoxAuth(oauth2('implicit')).grantType).toBe('implicit')
        expect(convertPostmanAuthToRestfoxAuth(oauth2('constructor')).grantType).toBe('constructor')
    })

    test('should import a Postman authorization code grant with PKCE and its authorization fields', () => {
        const request = {
            auth: {
                type: 'oauth2',
                oauth2: [
                    { key: 'grant_type', value: 'authorization_code_with_pkce' },
                    { key: 'authUrl', value: 'https://auth.url/authorize' },
                    { key: 'redirect_uri', value: 'https://app.url/callback' },
                    { key: 'state', value: 'state_789' },
                    { key: 'code_verifier', value: 'verifier_abc' },
                    { key: 'clientId', value: 'client_123' },
                    { key: 'accessTokenUrl', value: 'https://token.url' },
                ]
            }
        }
        expect(convertPostmanAuthToRestfoxAuth(request)).toMatchObject({
            type: 'oauth2',
            grantType: 'authorization_code',
            usePKCE: true,
            authorizationUrl: 'https://auth.url/authorize',
            redirectUri: 'https://app.url/callback',
            state: 'state_789',
            codeVerifier: 'verifier_abc',
            clientId: 'client_123',
            accessTokenUrl: 'https://token.url',
        })
    })

    test('should read OAuth 2.0 from a Postman v2.0 collection, which stores it as an object', () => {
        const request = { auth: { type: 'oauth2', oauth2: { grant_type: 'password_credentials', accessTokenUrl: 'https://token.url', clientId: 'client_123', username: 'oauth_user' } } }
        expect(convertPostmanAuthToRestfoxAuth(request)).toMatchObject({ type: 'oauth2', grantType: 'password', accessTokenUrl: 'https://token.url', clientId: 'client_123', username: 'oauth_user' })
    })

    test('should read the setting names older Postman versions wrote', () => {
        // the OAuth 2.0 example from Postman's own collection transformer, examples/v2.0.0/helpers.json
        const request = { auth: { type: 'oauth2', oauth2: { accessToken: 'secretToken', addTokenTo: 'header', callBackUrl: 'https://foo.com/cb', authUrl: 'https://foo.com/au', accessTokenUrl: 'https://foo.com/at', clientId: 'uniqueClientIdentifier', clientSecret: 'secretClientValue', clientAuth: 'body', grantType: 'password_credentials', scope: 'all', username: 'postman', password: 'randomSecretString', tokenType: 'bearer', redirectUri: 'https://foo.com/rd', refreshToken: 'refreshToken' } } }
        expect(convertPostmanAuthToRestfoxAuth(request)).toMatchObject({
            type: 'oauth2',
            grantType: 'password',
            redirectUri: 'https://foo.com/cb',
            authorizationUrl: 'https://foo.com/au',
            accessTokenUrl: 'https://foo.com/at',
            clientId: 'uniqueClientIdentifier',
            clientSecret: 'secretClientValue',
            clientAuthentication: 'body',
            scope: 'all',
            username: 'postman',
            password: 'randomSecretString',
            token: 'secretToken',
            refreshToken: 'refreshToken',
        })
    })

    test('should keep the token prefix Postman adds before the token', () => {
        const request = { auth: { type: 'oauth2', oauth2: [{ key: 'grant_type', value: 'client_credentials' }, { key: 'headerPrefix', value: 'Token' }] } }
        expect(convertPostmanAuthToRestfoxAuth(request).prefix).toBe('Token')
    })

    test('should keep where Postman sends the client credentials', () => {
        const oauth2 = (clientAuthentication: string) => ({ auth: { type: 'oauth2', oauth2: [{ key: 'grant_type', value: 'client_credentials' }, { key: 'client_authentication', value: clientAuthentication }] } })
        expect(convertPostmanAuthToRestfoxAuth(oauth2('header')).clientAuthentication).toBe('header')
        expect(convertPostmanAuthToRestfoxAuth(oauth2('body')).clientAuthentication).toBe('body')
        expect(convertPostmanAuthToRestfoxAuth({ auth: { type: 'oauth2', oauth2: [] } })).not.toHaveProperty('clientAuthentication')
    })

    test('should handle OAuth2 authentication', () => {
        const request = {
            auth: {
                type: 'oauth2',
                oauth2: [
                    { key: 'grant_type', value: 'password' },
                    { key: 'username', value: 'oauth_user' },
                    { key: 'password', value: 'oauth_pass' },
                    { key: 'clientId', value: 'client_123' },
                    { key: 'clientSecret', value: 'secret_456' },
                    { key: 'accessTokenUrl', value: 'https://token.url' },
                    { key: 'scope', value: 'read write' }
                ]
            }
        }
        const result = convertPostmanAuthToRestfoxAuth(request)
        expect(result).toEqual({
            type: 'oauth2',
            grantType: 'password',
            username: 'oauth_user',
            password: 'oauth_pass',
            clientId: 'client_123',
            clientSecret: 'secret_456',
            accessTokenUrl: 'https://token.url',
            scope: 'read write'
        })
    })

    test('should handle missing fields gracefully', () => {
        const request = {
            auth: {
                type: 'basic',
                basic: []
            }
        }
        const result = convertPostmanAuthToRestfoxAuth(request)
        expect(result).toEqual({
            type: 'basic',
            username: '',
            password: ''
        })
    })
})

describe('scriptConversion', () => {
    test('should convert Postman script to Restfox script with basic mappings', () => {
        const postmanScript = `
      pm.environment.set("key", "value");
      pm.environment.get("key");
      pm.response.json();
      pm.response.code;
      pm.test("Test", function () {});
      pm.response.text();
    `

        const expectedRestfoxScript = `
      rf.setEnvVar("key", "value");
      rf.getEnvVar("key");
      rf.response.getBodyJSON();
      rf.response.getStatusCode();
      test("Test", function () {});
      rf.response.getBodyText();
    `

        const result = scriptConversion(postmanScript, 'postmanToRestfox')
        expect(result).toBe(expectedRestfoxScript)
    })

    test('should convert Restfox script to Postman script with basic mappings', () => {
        const restfoxScript = `
      rf.setEnvVar("key", "value");
      rf.getEnvVar("key");
      rf.response.getBodyJSON();
    `

        const expectedPostmanScript = `
      pm.environment.set("key", "value");
      pm.environment.get("key");
      pm.response.json();
    `

        const result = scriptConversion(restfoxScript, 'restfoxToPostman')
        expect(result).toBe(expectedPostmanScript)
    })

    test('should convert Restfox script to Insomnia script with basic mappings', () => {
        const restfoxScript = `
      rf.setEnvVar("key", "value");
      rf.getEnvVar("key");
      rf.response.getBodyJSON();
    `

        const expectedInsomniaScript = `
      insomnia.setEnvironmentVariable("key", "value");
      insomnia.getEnvironmentVariable("key");
      insomnia.response.json();
    `

        const result = scriptConversion(restfoxScript, 'restfoxToInsomnia')
        expect(result).toBe(expectedInsomniaScript)
    })

    test('should convert Postman status code assertions to Restfox', () => {
        const postmanScript = `
      pm.response.to.have.status(200);
      pm.response.to.have.status(404);
    `

        const expectedRestfoxScript = `
      rf.response.getStatusCode() === 200;
      rf.response.getStatusCode() === 404;
    `

        const result = scriptConversion(postmanScript, 'postmanToRestfox')
        expect(result).toBe(expectedRestfoxScript)
    })

    test('should throw error for unsupported script types', () => {
        const unsupportedScript = 'some random script'
        expect(() => scriptConversion(unsupportedScript, 'unsupportedType' as any)).toThrowError('Unsupported script type: unsupportedType')
    })
})

describe('toTree', () => {
    test('should return an empty array when input is empty', () => {
        const input: any = []
        const result = toTree(input)
        expect(result).toEqual([])
    })

    test('should handle a flat list with no parent-child relationships', () => {
        const input: any = [
            { _id: '1', _type: 'request', parentId: null },
            { _id: '2', _type: 'request', parentId: null }
        ]
        const result = toTree(input)
        expect(result).toEqual(input) // No hierarchy, so the result is the same as input
    })

    test('should build a tree structure when there are parent-child relationships', () => {
        const input: any = [
            { _id: '1', _type: 'request_group', parentId: null },
            { _id: '2', _type: 'request', parentId: '1' }
        ]
        const expected = [
            {
                _id: '1',
                _type: 'request_group',
                parentId: null,
                children: [{ _id: '2', _type: 'request', parentId: '1' }]
            }
        ]
        const result = toTree(input)
        expect(result).toEqual(expected)
    })

    test('should build nested trees with multiple levels', () => {
        const input: any = [
            { _id: '1', _type: 'request_group', parentId: null },
            { _id: '2', _type: 'request_group', parentId: '1' },
            { _id: '3', _type: 'request', parentId: '2' }
        ]
        const expected = [
            {
                _id: '1',
                _type: 'request_group',
                parentId: null,
                children: [
                    {
                        _id: '2',
                        _type: 'request_group',
                        parentId: '1',
                        children: [{ _id: '3', _type: 'request', parentId: '2' }]
                    }
                ]
            }
        ]
        const result = toTree(input)
        expect(result).toEqual(expected)
    })

    test('should handle multiple root elements', () => {
        const input: any = [
            { _id: '1', _type: 'request_group', parentId: null },
            { _id: '2', _type: 'request_group', parentId: null },
            { _id: '3', _type: 'request', parentId: '1' }
        ]
        const expected = [
            {
                _id: '1',
                _type: 'request_group',
                parentId: null,
                children: [{ _id: '3', _type: 'request', parentId: '1' }]
            },
            {
                _id: '2',
                _type: 'request_group',
                parentId: null,
                children: []
            }
        ]
        const result = toTree(input)
        expect(result).toEqual(expected)
    })
})

describe('getSpaces', () => {
    test('should return 4 spaces when passed number 4', () => {
        expect(getSpaces(4)).toBe('    ') // 4 spaces
    })

    test('should return 4 spaces when passed string "4"', () => {
        expect(getSpaces('4')).toBe('    ') // 4 spaces
    })

    test('should return empty string when passed string "abc"', () => {
        expect(getSpaces('abc')).toBe('') // invalid input
    })

    test('should return empty string when passed a negative number', () => {
        expect(getSpaces(-3)).toBe('') // negative number returns empty string
    })

    test('should return empty string when passed 0', () => {
        expect(getSpaces(0)).toBe('') // 0 returns empty string
    })

    test('should return empty string when passed an empty string', () => {
        expect(getSpaces('')).toBe('') // empty string returns empty string
    })

    test('should return 10 spaces when passed string "10"', () => {
        expect(getSpaces('10')).toBe('          ') // 10 spaces
    })
})

describe(`Function: ${createRequestData.name}`, () => {
    const prepare = (url: string, parameters: CollectionItem['parameters'], environment: Record<string, string> = {}) => {
        const request = { _id: 'r', _type: 'request', workspaceId: 'w', parentId: null, name: 'Request', method: 'GET', url, parameters } as CollectionItem
        const state: HandleRequestState = { currentPlugin: null, testResults: [] }
        return createRequestData(state, request, environment, {}, undefined, null, [], null)
    }

    test('sends the url as typed when the request has no Query table', async() => {
        const result = await prepare('https://example.test/path?foo=bar', undefined)
        expect(result.url.href).toBe('https://example.test/path?foo=bar')
    })

    test('keeps the query string of a url that an environment variable resolves to', async() => {
        const result = await prepare('{{UPLOAD_URL}}', [], { UPLOAD_URL: 'https://example.test/upload?token=abc&part=1' })
        expect(result.url.href).toBe('https://example.test/upload?token=abc&part=1')
    })

    test('appends enabled Query table rows after the query string the variable resolved to', async() => {
        const result = await prepare('{{UPLOAD_URL}}?extra=1', [{ name: 'extra', value: '1' }, { name: 'off', value: '2', disabled: true }], { UPLOAD_URL: 'https://example.test/upload?token=abc' })
        expect(result.url.href).toBe('https://example.test/upload?token=abc&extra=1')
    })

    test('does not duplicate query parameters typed in the url and mirrored in the Query table', async() => {
        const result = await prepare('https://example.test/path?foo=bar', [{ name: 'foo', value: 'bar' }])
        expect(result.url.href).toBe('https://example.test/path?foo=bar')
    })

    test('leaves the encoding of a signed url from a variable untouched when appending Query table rows', async() => {
        const result = await prepare('{{SIGNED_URL}}?part=1', [{ name: 'part', value: '1' }], { SIGNED_URL: 'https://example.test/f?sig=a%2Fb%3D&name=x+y' })
        expect(result.url.href).toBe('https://example.test/f?sig=a%2Fb%3D&name=x+y&part=1')
    })

    test('sends a %20 typed in the query as %20, and a typed + still as a literal plus', async() => {
        const result = await prepare('https://example.test/path?b=two%20words&d=a+b&c=x%2By', [
            { name: 'b', value: 'two%20words' },
            { name: 'd', value: 'a+b' },
            { name: 'c', value: 'x%2By' },
        ])
        expect(result.url.href).toBe('https://example.test/path?b=two%20words&d=a%2Bb&c=x%2By')
    })

    test('encodes a space and non-ASCII typed in the Query table', async() => {
        const result = await prepare('https://example.test/path?q=hello world&s=é', [
            { name: 'q', value: 'hello world' },
            { name: 's', value: 'é' },
        ])
        expect(result.url.href).toBe('https://example.test/path?q=hello%20world&s=%C3%A9')
    })

    test('sends a % that starts no escape as %25 instead of failing the send', async() => {
        const result = await prepare('https://example.test/path?p=100%', [{ name: 'p', value: '100%' }])
        expect(result.url.href).toBe('https://example.test/path?p=100%25')
    })

    test('reads a parameter name as typed in the url, like its value', async() => {
        const result = await prepare('https://example.test/path?a%20b=x', [{ name: 'a%20b', value: 'x' }])
        expect(result.url.href).toBe('https://example.test/path?a%20b=x')
    })
})

describe(`Function: ${setObjectPathValue.name}`, () => {
    test('creates the missing levels of a dot path', () => {
        const object: any = { keep: 1 }
        setObjectPathValue(object, 'auth.token', 'abc')
        expect(object).toEqual({ keep: 1, auth: { token: 'abc' } })
    })

    test('creates an array when the next key is an index and keeps siblings', () => {
        const object: any = { list: [{ id: 1 }] }
        setObjectPathValue(object, 'list[1].id', 2)
        setObjectPathValue(object, 'fresh[0]', 'x')
        expect(object).toEqual({ list: [{ id: 1 }, { id: 2 }], fresh: ['x'] })
    })

    test('keeps a dot inside a quoted bracket key', () => {
        const object: any = {}
        setObjectPathValue(object, 'headers["content.type"]', 'json')
        expect(object).toEqual({ headers: { 'content.type': 'json' } })
    })

    test('refuses paths that would pollute Object.prototype', () => {
        vi.spyOn(console, 'warn').mockReturnValue(undefined)
        setObjectPathValue({}, '__proto__.polluted', 'yes')
        setObjectPathValue({}, 'constructor.prototype.polluted', 'yes')
        expect(({} as any).polluted).toBeUndefined()
        expect(console.warn).toHaveBeenCalledTimes(2)
    })
})

describe('Authentication inheritance', () => {
    const folderAuthentication = { type: 'bearer', token: 'folder-token' }
    const prepare = (authentication: CollectionItem['authentication'], { parentAuthentication }: { parentAuthentication: CollectionItem['authentication'] } = { parentAuthentication: folderAuthentication }) => {
        const request = { _id: 'r', _type: 'request', workspaceId: 'w', parentId: 'f', name: 'Request', method: 'GET', url: 'https://example.test/', authentication } as CollectionItem
        const state: HandleRequestState = { currentPlugin: null, testResults: [] }
        return createRequestData(state, request, {}, {}, parentAuthentication, null, [], null)
    }

    test('a request set to No Auth under a bearer folder sends no Authorization header', async() => {
        const result = await prepare({ type: 'none' })
        expect(result.headers).not.toHaveProperty('Authorization')
    })

    test('a request set to Inherit sends the folder token', async() => {
        const result = await prepare({ type: INHERITED_AUTHENTICATION_TYPE })
        expect(result.headers.Authorization).toBe('Bearer folder-token')
    })

    test('Inherit is stored as the value older versions wrote for an item without an auth of its own', () => {
        expect(INHERITED_AUTHENTICATION_TYPE).toBe('No Auth')
    })

    test('a request without an authentication object, or with an empty one, inherits', async() => {
        expect((await prepare(undefined)).headers.Authorization).toBe('Bearer folder-token')
        expect((await prepare({})).headers.Authorization).toBe('Bearer folder-token')
    })

    test('a request whose own auth is unticked sends nothing instead of the folder token', async() => {
        const result = await prepare({ type: 'bearer', token: 'own-token', disabled: true })
        expect(result.headers).not.toHaveProperty('Authorization')
    })

    test('a request with an auth of its own sends that instead of the folder token', async() => {
        const result = await prepare({ type: 'bearer', token: 'own-token' })
        expect(result.headers.Authorization).toBe('Bearer own-token')
    })

    test('a request set to Inherit with no folder auth sends no Authorization header', async() => {
        const result = await prepare({ type: INHERITED_AUTHENTICATION_TYPE }, { parentAuthentication: undefined })
        expect(result.headers).not.toHaveProperty('Authorization')
    })

    test('an Insomnia request without an auth of its own imports as Inherit', () => {
        const insomniaExport = { resources: [{ _id: 'r', _type: 'request', parentId: null, name: 'Request', method: 'GET', url: 'https://example.test/', body: {}, authentication: {} }] }
        const collection = convertInsomniaExportToRestfoxCollection(insomniaExport, 'w')
        expect(collection[0].authentication).toEqual({ type: INHERITED_AUTHENTICATION_TYPE })
    })

    test('an Insomnia OAuth 2.0 request keeps where it sent the client credentials, the Basic header unless credentialsInBody is set', () => {
        const resource = (authentication: object) => ({ resources: [{ _id: 'r', _type: 'request', parentId: null, name: 'Request', method: 'GET', url: 'https://example.test/', body: {}, authentication }] })
        expect(convertInsomniaExportToRestfoxCollection(resource({ type: 'oauth2', grantType: 'client_credentials' }), 'w')[0].authentication?.clientAuthentication).toBe('header')
        expect(convertInsomniaExportToRestfoxCollection(resource({ type: 'oauth2', grantType: 'client_credentials', credentialsInBody: true }), 'w')[0].authentication?.clientAuthentication).toBe('body')
    })

    test('an Insomnia request with auth type none imports as No Auth', () => {
        const insomniaExport = { resources: [{ _id: 'r', _type: 'request', parentId: null, name: 'Request', method: 'GET', url: 'https://example.test/', body: {}, authentication: { type: 'none' } }] }
        const collection = convertInsomniaExportToRestfoxCollection(insomniaExport, 'w')
        expect(collection[0].authentication).toEqual({ type: 'none' })
    })
})

describe('Header name casing', () => {
    const request = (fields: Partial<CollectionItem>) => ({ _id: 'r', _type: 'request', workspaceId: 'w', parentId: 'f', name: 'Request', method: 'GET', url: 'https://example.test/', ...fields }) as CollectionItem
    const prepare = (fields: Partial<CollectionItem>, { environment = {}, parentHeaders = {}, parentAuthentication }: { environment?: Record<string, unknown>, parentHeaders?: Record<string, string[]>, parentAuthentication?: CollectionItem['authentication'] } = {}) => {
        const state: HandleRequestState = { currentPlugin: null, testResults: [] }
        return createRequestData(state, request(fields), environment, parentHeaders, parentAuthentication, null, [], null)
    }

    test('a header name is sent as typed', async() => {
        const result = await prepare({ headers: [{ name: 'Environment', value: 'ADMIN' }] })
        expect(result.headers).toEqual({ Environment: 'ADMIN' })
    })

    test('a header name from a variable keeps the case the variable resolves to', async() => {
        const result = await prepare({ headers: [{ name: '{{HEADER}}', value: 'v' }] }, { environment: { HEADER: 'X-Api-Key' } })
        expect(result.headers).toEqual({ 'X-Api-Key': 'v' })
    })

    test('names still match without regard to case: the same header twice is joined, the request spelling wins over a global one', async() => {
        const result = await prepare({ headers: [{ name: 'X-Tag', value: 'a' }, { name: 'x-tag', value: 'b' }, { name: 'X-Env', value: 'request' }] }, { environment: { GLOBAL_HEADERS: { 'x-env': 'global' } } })
        expect(result.headers).toEqual({ 'x-tag': 'a, b', 'X-Env': 'global, request' })
    })

    test('a folder header is skipped when the request has the same header in another case, and keeps its own spelling otherwise', async() => {
        const result = await prepare({ headers: [{ name: 'X-Tenant', value: 'request' }] }, { parentHeaders: { 'x-tenant': ['folder'], 'X-Folder-Only': ['f'] } })
        expect(result.headers).toEqual({ 'X-Tenant': 'request', 'X-Folder-Only': 'f' })
    })

    test('a folder header name from a variable resolves like a request header name', async() => {
        const result = await prepare({}, { environment: { HEADER: 'X-Api-Key' }, parentHeaders: { '{{HEADER}}': ['v'] } })
        expect(result.headers).toEqual({ 'X-Api-Key': 'v' })
    })

    test('a typed Authorization header and the Auth tab are still sent together as one value, as the transports joined them before', async() => {
        const result = await prepare({ headers: [{ name: 'Authorization', value: 'Custom abc' }], authentication: { type: 'bearer', token: 't' } })
        expect(result.headers).toEqual({ Authorization: 'Custom abc, Bearer t' })
    })

    test('a Content-Type header in any case is left out for a multipart body', async() => {
        const result = await prepare({ method: 'POST', body: { mimeType: 'multipart/form-data', params: [{ name: 'a', value: '1' }] }, headers: [{ name: 'Content-Type', value: 'multipart/form-data' }] })
        expect(result.headers).toEqual({})
    })

    describe('when sent', () => {
        const send = async(fields: Partial<CollectionItem>) => {
            let sentHeaders: Record<string, string> = {}
            vi.stubGlobal('fetch', async(_url: string, init: { headers: Record<string, string> }) => {
                sentHeaders = init.headers
                return new Response('ok')
            })
            const response = await handleRequest(request(fields), {}, {}, undefined, async() => undefined, [], null, new AbortController().signal, { electronSwitchToChromiumFetch: false, disableSSLVerification: false, requestTimeout: 0 })
            return { sentHeaders, response }
        }

        test('a typed User-Agent in any case replaces the default one', async() => {
            const { sentHeaders } = await send({ headers: [{ name: 'User-Agent', value: 'custom' }] })
            expect(sentHeaders).toEqual({ 'User-Agent': 'custom' })
        })

        test('the headers a browser does not send are left out of the saved request in any case', async() => {
            const { response } = await send({ headers: [{ name: 'Cookie', value: 'a=1' }, { name: 'X-Kept', value: 'k' }] })
            expect(Object.keys((response as RequestFinalResponse).request.headers)).toEqual(['X-Kept', 'user-agent'])
        })
    })
})

describe(`Function: ${fetchGraphQLSchema.name}`, () => {
    const request = (fields: Partial<CollectionItem>) => ({ _id: 'r', _type: 'request', workspaceId: 'w', parentId: 'f', name: 'Request', method: 'POST', url: 'https://example.test/graphql', body: { mimeType: 'application/graphql', text: '{"query":"{ hello }"}' }, ...fields }) as CollectionItem
    const types = [{ name: 'Query', kind: 'OBJECT', description: null, fields: [{ name: 'hello', type: { name: 'String', kind: 'SCALAR' } }] }]
    const flags = { electronSwitchToChromiumFetch: false, disableSSLVerification: false, requestTimeout: 0 }

    const fetchSchema = async(fields: Partial<CollectionItem>, { environment = {}, parentHeaders = {}, parentAuthentication, response = new Response(JSON.stringify({ data: { __schema: { types } } })) }: { environment?: Record<string, any>, parentHeaders?: Record<string, string[]>, parentAuthentication?: CollectionItem['authentication'], response?: Response } = {}) => {
        const sent: { url?: string, method?: string, headers?: Record<string, string>, body?: string } = {}
        vi.stubGlobal('fetch', async(url: URL, init: { method: string, headers: Record<string, string>, body: string }) => {
            Object.assign(sent, { url: url.toString(), method: init.method, headers: init.headers, body: init.body })
            return response
        })
        const result = fetchGraphQLSchema(request(fields), environment, parentHeaders, parentAuthentication, new AbortController().signal, flags)
        return { sent, result }
    }

    test('sends the request\'s query parameters, headers, global headers and auth', async() => {
        const { sent, result } = await fetchSchema({ parameters: [{ name: 'tenant', value: '{{TENANT}}' }], headers: [{ name: 'X-Api-Key', value: 'key' }], authentication: { type: 'bearer', token: '{{TOKEN}}' } }, { environment: { TENANT: 'acme', TOKEN: 't', GLOBAL_HEADERS: { 'X-Global': 'g' } } })
        expect(await result).toEqual(types)
        expect(sent.url).toBe('https://example.test/graphql?tenant=acme')
        expect(sent.method).toBe('POST')
        expect(sent.headers).toMatchObject({ 'X-Global': 'g', 'X-Api-Key': 'key', Authorization: 'Bearer t', 'Content-Type': 'application/json' })
        expect(JSON.parse(sent.body!).query).toContain('__schema')
    })

    test('sends the folder\'s headers and auth when the request inherits them', async() => {
        const { sent, result } = await fetchSchema({ authentication: { type: INHERITED_AUTHENTICATION_TYPE } }, { parentHeaders: { 'X-Folder': ['f'] }, parentAuthentication: { type: 'basic', username: 'u', password: 'p' } })
        await result
        expect(sent.headers).toMatchObject({ 'X-Folder': 'f', Authorization: 'Basic dTpw' })
    })

    test('keeps a typed Content-Type', async() => {
        const { sent, result } = await fetchSchema({ headers: [{ name: 'content-type', value: 'application/json; charset=utf-8' }] })
        await result
        expect(Object.entries(sent.headers!).filter(([name]) => name.toLowerCase() === 'content-type')).toEqual([['content-type', 'application/json; charset=utf-8']])
    })

    test('fails with the server\'s GraphQL errors', async() => {
        const { result } = await fetchSchema({}, { response: new Response(JSON.stringify({ errors: [{ message: 'Not authorised' }] }), { status: 401 }) })
        await expect(result).rejects.toThrow('Not authorised')
    })

    test('fails with the status when the response is not GraphQL', async() => {
        const { result } = await fetchSchema({}, { response: new Response('Forbidden', { status: 403, statusText: 'Forbidden' }) })
        await expect(result).rejects.toThrow('403 Forbidden')
    })

    test('fails with the bare status when the transport gives no status text', async() => {
        const { result } = await fetchSchema({}, { response: new Response('', { status: 401 }) })
        await expect(result).rejects.toThrow(/^401$/)
    })

    test('fails when a successful response has no schema', async() => {
        const { result } = await fetchSchema({}, { response: new Response(JSON.stringify({ data: {} })) })
        await expect(result).rejects.toThrow('The response has no schema')
    })
})

describe(`Function: ${createOAuthTokenRequest.name}`, () => {
    test('sends the client credentials in the body when the config predates the choice', () => {
        const { headers, body } = createOAuthTokenRequest('id', 'secret', undefined, { grant_type: 'client_credentials' })
        expect(headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })
        expect(body).toBe('grant_type=client_credentials&client_id=id&client_secret=secret')
    })

    test('sends the client credentials in the body when chosen', () => {
        const { headers, body } = createOAuthTokenRequest('id', 'secret', 'body', { grant_type: 'refresh_token', refresh_token: 'r' })
        expect(headers).not.toHaveProperty('Authorization')
        expect(body).toBe('grant_type=refresh_token&refresh_token=r&client_id=id&client_secret=secret')
    })

    test('sends the client credentials as a Basic Authorization header when chosen and keeps them out of the body', () => {
        const { headers, body } = createOAuthTokenRequest('id', 'secret', 'header', { grant_type: 'client_credentials', scope: 'read' })
        expect(headers.Authorization).toBe('Basic ' + btoa('id:secret'))
        expect(body).toBe('grant_type=client_credentials&scope=read')
    })

    test('urlencodes the id and secret before the base64, as RFC 6749 section 2.3.1 requires', () => {
        const { headers } = createOAuthTokenRequest('my client', 'p@ss:word/ü', 'header', {})
        expect(headers.Authorization).toBe('Basic ' + btoa('my%20client:p%40ss%3Aword%2F%C3%BC'))
    })
})

describe(`Function: ${describeOAuthTokenError.name}`, () => {
    const url = 'https://auth.example.test/token'
    const response = (status: number, body: string, statusText = '') => ({ status, statusText, buffer: new TextEncoder().encode(body).buffer })

    test('an invalid_client answer names the error and the settings to change', () => {
        const message = describeOAuthTokenError(response(401, '{"error":"invalid_client","error_description":"bad secret"}', 'Unauthorized'), url)
        expect(message).toBe('The token endpoint answered HTTP 401 Unauthorized: invalid_client, bad secret. It refused the client credentials. Check the Client ID and Client Secret, or switch Client Authentication between Basic Auth Header and Request Body.')
    })

    test('another OAuth error is shown as the server wrote it', () => {
        expect(describeOAuthTokenError(response(400, '{"error":"invalid_grant"}'), url)).toBe('The token endpoint answered HTTP 400: invalid_grant.')
    })

    test('an HTML error page is shown as its text, with a hint for the status', () => {
        const page = '<!doctype html><title>403</title><style>body { color: red }</style>403 Forbidden'
        expect(describeOAuthTokenError(response(403, page), url)).toBe('The token endpoint answered HTTP 403: 403 403 Forbidden. It refused the request. Check the Client ID and Client Secret, or switch Client Authentication between Basic Auth Header and Request Body.')
        expect(describeOAuthTokenError(response(404, 'Cannot POST /nope', 'Not Found'), url)).toBe('The token endpoint answered HTTP 404 Not Found: Cannot POST /nope. Check the Access Token URL.')
    })

    test('a JSON answer without the OAuth error field is shown as its text', () => {
        expect(describeOAuthTokenError(response(401, '{"message":"Unauthorized"}'), url)).toBe('The token endpoint answered HTTP 401: {"message":"Unauthorized"}. It refused the request. Check the Client ID and Client Secret, or switch Client Authentication between Basic Auth Header and Request Body.')
    })

    test('a 200 without a token says what is missing', () => {
        expect(describeOAuthTokenError(response(200, '{"token_type":"Bearer"}'), url)).toBe('The token endpoint answered HTTP 200 without an access_token: {"token_type":"Bearer"}.')
        expect(describeOAuthTokenError(response(200, '<html>login</html>'), url)).toBe('The token endpoint answered HTTP 200 with something other than JSON: login.')
    })

    test('a timeout and an unreachable server name the url and what to check', () => {
        const timeout = Object.assign(new Error('Request timed out after 5000 ms'), { name: 'TimeoutError' })
        expect(describeOAuthTokenError(timeout, url)).toBe(`The token request to ${url} timed out. Check that the server is running, or raise Request Timeout in Settings.`)
        expect(describeOAuthTokenError(new TypeError('Failed to fetch'), url)).toBe(`Could not reach the token endpoint at ${url}: Failed to fetch. Check the Access Token URL and that the server is running. In the browser the server must also allow cross-origin requests, otherwise use the Restfox CORS Helper extension or the desktop app.`)
        expect(describeOAuthTokenError(new Error('connect ECONNREFUSED 127.0.0.1:1'), url)).toBe(`Could not reach the token endpoint at ${url}: connect ECONNREFUSED 127.0.0.1:1. Check the Access Token URL and that the server is running.`)
    })

    test('a long answer is cut to its start', () => {
        const message = describeOAuthTokenError(response(500, 'x'.repeat(300)), url)
        expect(message).toBe(`The token endpoint answered HTTP 500: ${'x'.repeat(120)}....`)
    })
})

describe(`Function: ${getSocketConnectionUrl.name}`, () => {
    const standaloneOnHttp = { protocol: 'http:', host: 'localhost:4004' }

    test('web-standalone with SSL verification disabled connects a wss url through the server', () => {
        expect(getSocketConnectionUrl('wss://localhost:5605/websocket?token=1', { isWebStandalone: true, disableSSLVerification: true }, standaloneOnHttp))
            .toBe('ws://localhost:4004/proxy-socket/true/wss%3A%2F%2Flocalhost%3A5605/websocket?token=1')
    })

    test('a Socket.IO https url keeps the path the client polls and upgrades on', () => {
        expect(getSocketConnectionUrl('https://localhost:5605/socket.io-v4?room=a', { isWebStandalone: true, disableSSLVerification: true }, standaloneOnHttp))
            .toBe('http://localhost:4004/proxy-socket/true/https%3A%2F%2Flocalhost%3A5605/socket.io-v4?room=a')
    })

    test('web-standalone with CA certificates connects a secure url through the server, which trusts them', () => {
        expect(getSocketConnectionUrl('wss://localhost:5605/websocket', { isWebStandalone: true, disableSSLVerification: false, caCertificatesId: 'abc' }, standaloneOnHttp))
            .toBe('ws://localhost:4004/proxy-socket/ca-abc/wss%3A%2F%2Flocalhost%3A5605/websocket')
        // with SSL verification disabled there is nothing to check a certificate against
        expect(getSocketConnectionUrl('wss://localhost:5605/websocket', { isWebStandalone: true, disableSSLVerification: true, caCertificatesId: 'abc' }, standaloneOnHttp))
            .toBe('ws://localhost:4004/proxy-socket/true/wss%3A%2F%2Flocalhost%3A5605/websocket')
        expect(getSocketConnectionUrl('ws://localhost:5605/websocket', { isWebStandalone: true, disableSSLVerification: false, caCertificatesId: 'abc' }, standaloneOnHttp))
            .toBe('ws://localhost:5605/websocket')
    })

    test('loopback, and every socket in other builds, connects directly as before', () => {
        const url = 'wss://localhost:5605/websocket'
        expect(getSocketConnectionUrl(url, { isWebStandalone: true, disableSSLVerification: false }, standaloneOnHttp)).toBe(url)
        expect(getSocketConnectionUrl(url, { isWebStandalone: true, disableSSLVerification: false, caCertificatesId: null }, standaloneOnHttp)).toBe(url)
        expect(getSocketConnectionUrl(url, { isWebStandalone: false, disableSSLVerification: false, caCertificatesId: 'abc' }, standaloneOnHttp)).toBe(url)
        expect(getSocketConnectionUrl(url, { isWebStandalone: false, disableSSLVerification: true }, standaloneOnHttp)).toBe(url)
        expect(getSocketConnectionUrl('ws://localhost:5605/websocket', { isWebStandalone: true, disableSSLVerification: true }, standaloneOnHttp)).toBe('ws://localhost:5605/websocket')
        expect(getSocketConnectionUrl('not a url', { isWebStandalone: true, disableSSLVerification: true }, standaloneOnHttp)).toBe('not a url')
        for(const loopback of ['ws://127.0.0.1:5605/websocket', 'ws://[::1]:5605/websocket', 'ws://api.localhost/websocket', 'http://localhost:5605/socket.io/']) {
            expect(getSocketConnectionUrl(loopback, { isWebStandalone: true, disableSSLVerification: false, proxySettingsId: 'p1' }, standaloneOnHttp)).toBe(loopback)
        }
    })

    test('web-standalone connects every socket to another host through the server, with its settings and Settings > Proxy', () => {
        const options = (value: object) => encodeURIComponent(JSON.stringify(value))

        expect(getSocketConnectionUrl('ws://example.com/ws?x=1', { isWebStandalone: true, disableSSLVerification: false }, standaloneOnHttp))
            .toBe(`ws://localhost:4004/proxy-socket/${options({ disableSSLVerification: false, caCertificatesId: null, proxySettingsId: null })}/ws%3A%2F%2Fexample.com/ws?x=1`)
        expect(getSocketConnectionUrl('http://example.com:3000/socket.io/', { isWebStandalone: true, disableSSLVerification: false, proxySettingsId: 'p1' }, standaloneOnHttp))
            .toBe(`http://localhost:4004/proxy-socket/${options({ disableSSLVerification: false, caCertificatesId: null, proxySettingsId: 'p1' })}/http%3A%2F%2Fexample.com%3A3000/socket.io/`)
        expect(getSocketConnectionUrl('wss://example.com/ws', { isWebStandalone: true, disableSSLVerification: false, caCertificatesId: 'abc' }, { protocol: 'https:', host: 'restfox.example.com' }))
            .toBe(`wss://restfox.example.com/proxy-socket/${options({ disableSSLVerification: false, caCertificatesId: 'abc', proxySettingsId: null })}/wss%3A%2F%2Fexample.com/ws`)
        // an https page reaches a ws:// target through its own wss://
        expect(getSocketConnectionUrl('ws://example.com/ws', { isWebStandalone: true, disableSSLVerification: false }, { protocol: 'https:', host: 'restfox.example.com' }))
            .toMatch(/^wss:\/\/restfox\.example\.com\/proxy-socket\//)
        // with SSL verification disabled there is nothing to check a certificate against
        expect(getSocketConnectionUrl('wss://example.com/ws', { isWebStandalone: true, disableSSLVerification: true, caCertificatesId: 'abc' }, standaloneOnHttp))
            .toBe(`ws://localhost:4004/proxy-socket/${options({ disableSSLVerification: true, caCertificatesId: null, proxySettingsId: null })}/wss%3A%2F%2Fexample.com/ws`)
    })
})

describe(`Function: ${caCertificatesFileToPEM.name}`, () => {
    const pemFile = path.join(__dirname, '..', '..', 'test-api', 'files', 'test-ca.crt')

    test('keeps a PEM file as it is', async() => {
        const pem = await readFile(pemFile, 'utf8')
        expect(await caCertificatesFileToPEM(new File([pem], 'test-ca.crt'))).toBe(pem)
    })

    test('turns a binary DER certificate, as Windows exports one, into PEM', async() => {
        const pem = await readFile(pemFile, 'utf8')
        const der = Buffer.from(pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, ''), 'base64')

        expect(await caCertificatesFileToPEM(new File([der], 'test-ca.cer'))).toBe(pem)
    })
})

describe(`Function: ${getMissingOAuthTokenFieldsMessage.name}`, () => {
    test('a config with nothing filled in names the grant type and the token url', () => {
        expect(getMissingOAuthTokenFieldsMessage('get', { grantType: undefined, accessTokenUrl: '' })).toBe('Grant Type and Access Token URL are required to get a token.')
    })

    test('a variable that resolved to nothing counts as missing', () => {
        expect(getMissingOAuthTokenFieldsMessage('get', { grantType: 'client_credentials', accessTokenUrl: 'undefined' })).toBe('Access Token URL is required to get a token.')
    })

    test('each grant type names its own required fields', () => {
        expect(getMissingOAuthTokenFieldsMessage('get', { grantType: 'password', accessTokenUrl: 'https://a.test/token', username: ' ' })).toBe('Username is required to get a token.')
        expect(getMissingOAuthTokenFieldsMessage('get', { grantType: 'authorization_code', accessTokenUrl: '', authorizationCode: '', redirectUri: '' })).toBe('Access Token URL, Authorization Code and Redirect URI are required to get a token.')
    })

    test('an empty client id or secret does not stop the request, the server decides on those', () => {
        expect(getMissingOAuthTokenFieldsMessage('get', { grantType: 'client_credentials', accessTokenUrl: 'https://a.test/token' })).toBeNull()
        expect(getMissingOAuthTokenFieldsMessage('get', { grantType: 'password', accessTokenUrl: 'https://a.test/token', username: 'user' })).toBeNull()
    })

    test('a refresh needs only the token url', () => {
        expect(getMissingOAuthTokenFieldsMessage('refresh', { accessTokenUrl: '' })).toBe('Access Token URL is required to refresh the token.')
        expect(getMissingOAuthTokenFieldsMessage('refresh', { accessTokenUrl: 'https://a.test/token' })).toBeNull()
    })
})

describe('Insomnia import', () => {
    const file = (text: string) => ({ name: 'export.yaml', text: async() => text })
    const request = (extra: object) => ({ _id: 'req_1', _type: 'request', parentId: 'fld_1', name: 'Request', method: 'GET', url: 'https://example.test/', body: {}, ...extra })

    test('a v5 YAML export, the format Insomnia 11 and later write, imports with its nested folders', async() => {
        const text = await readFile(path.join(process.cwd(), 'test-data', 'insomnia-import', 'variable_inheritance.yaml'), 'utf-8')
        const [workspaceFolder] = await convertInsomniaFileToRestfoxCollection(file(text), 'w')
        expect(workspaceFolder).toMatchObject({ _type: 'request_group', name: 'Variable Inheritance' })
        const grandparent = workspaceFolder.children![0]
        expect(grandparent).toMatchObject({ _type: 'request_group', name: 'grandparent', environment: { 'test-value': 'grandparent' } })
        const parent = grandparent.children![0]
        expect(parent).toMatchObject({ _type: 'request_group', name: 'parent' })
        expect(parent.children![0]).toMatchObject({
            _type: 'request',
            name: 'Child Request',
            method: 'GET',
            url: 'https://insomnia-airlines-api.onrender.com/test/extra-data',
            headers: [{ name: 'User-Agent', value: 'insomnia/12.5.1-alpha.0' }, { name: 'x-test-value', value: '{{ _[\'test-value\'] }}' }],
            authentication: { type: 'basic', username: '{{ _[\'test-value\'] }}', password: '' },
        })
    })

    test('a v5 folder keeps its headers, auth and description, and a request without auth of its own inherits', async() => {
        const text = [
            'type: collection.insomnia.rest/5.0',
            'name: Api',
            'meta:',
            '  id: wrk_1',
            'collection:',
            '  - name: Secured',
            '    meta:',
            '      id: fld_1',
            '      description: needs a token',
            '    headers:',
            '      - name: X-Tenant',
            '        value: acme',
            '    authentication:',
            '      type: bearer',
            '      token: folder-token',
            '    children:',
            '      - url: https://example.test/items',
            '        name: Items',
            '        meta:',
            '          id: req_1',
            '        method: GET',
        ].join('\n')
        const [workspaceFolder] = await convertInsomniaFileToRestfoxCollection(file(text), 'w')
        const folder = workspaceFolder.children![0]
        expect(folder).toMatchObject({ name: 'Secured', description: 'needs a token', headers: [{ name: 'X-Tenant', value: 'acme' }], authentication: { type: 'bearer', token: 'folder-token' } })
        expect(folder.children![0]).toMatchObject({ name: 'Items', authentication: { type: INHERITED_AUTHENTICATION_TYPE }, body: { mimeType: 'No Body' } })
    })

    test('a v4 folder keeps its headers, auth and description', async() => {
        const folder = { _id: 'fld_1', _type: 'request_group', parentId: null, name: 'Secured', description: 'needs a token', headers: [{ name: 'X-Tenant', value: 'acme' }], authentication: { type: 'bearer', token: 'folder-token' } }
        const [restfoxFolder] = await convertInsomniaFileToRestfoxCollection({ resources: [folder, request({})] }, 'w')
        expect(restfoxFolder).toMatchObject({ name: 'Secured', description: 'needs a token', headers: [{ name: 'X-Tenant', value: 'acme' }], authentication: { type: 'bearer', token: 'folder-token' } })
    })

    test('request types the importer does not handle are skipped instead of failing the whole import', async() => {
        const resources = [
            { _id: 'fld_1', _type: 'request_group', parentId: null, name: 'Folder' },
            request({}),
            { _id: 'ws_1', _type: 'websocket_request', parentId: 'fld_1', name: 'Socket', url: 'wss://example.test/' },
            { _id: 'grpc_1', _type: 'grpc_request', parentId: 'fld_1', name: 'gRPC', url: 'example.test:443' },
        ]
        const [restfoxFolder] = await convertInsomniaFileToRestfoxCollection({ resources }, 'w')
        expect(restfoxFolder.children!.map(item => item.name)).toEqual(['Request'])
    })

    test('an OAuth 2.0 request keeps the fields Insomnia names differently', async() => {
        const authentication = { type: 'oauth2', grantType: 'authorization_code', redirectUrl: 'https://app.test/callback', code: 'code_1', usePkce: true, tokenPrefix: 'Token', accessToken: 'token_1', refreshToken: 'refresh_1', authorizationUrl: 'https://auth.test/authorize' }
        const [folder] = await convertInsomniaFileToRestfoxCollection({ resources: [{ _id: 'fld_1', _type: 'request_group', parentId: null, name: 'Folder' }, request({ authentication })] }, 'w')
        expect(folder.children![0].authentication).toMatchObject({ type: 'oauth2', grantType: 'authorization_code', redirectUri: 'https://app.test/callback', authorizationCode: 'code_1', usePKCE: true, prefix: 'Token', token: 'token_1', refreshToken: 'refresh_1', authorizationUrl: 'https://auth.test/authorize' })
    })

    test('a file that is not an Insomnia export says so', async() => {
        await expect(convertInsomniaFileToRestfoxCollection(file('info:\n  name: something else\n'), 'w')).rejects.toThrow('Not an Insomnia export')
    })
})

describe('Restfox export and import', () => {
    const folder: CollectionItem = { _id: 'f', _type: 'request_group', parentId: null, workspaceId: 'w', name: 'Folder', headers: [{ name: 'X-Test', value: 'yes' }], authentication: { type: 'bearer', token: 'synthetic' }, description: 'folder docs', sortOrder: 0 }
    const request: CollectionItem = { _id: 'r', _type: 'request', parentId: 'f', workspaceId: 'w', name: 'Request', method: 'GET', url: 'https://example.test/:id', pathParameters: [{ name: 'id', value: '1' }], description: 'request docs', sortOrder: 0 }
    const requestScript = { _id: 'p1', name: 'request script', type: 'script' as const, code: { pre_request: 'a', post_request: 'b' }, workspaceId: 'w', collectionId: 'r', enabled: true, createdAt: 1, updatedAt: 1 }
    const workspaceScript = { _id: 'p2', name: 'workspace script', type: 'script' as const, code: { pre_request: 'c', post_request: 'd' }, workspaceId: 'w', collectionId: null, enabled: true, createdAt: 1, updatedAt: 1 }
    const importInto = (collection: any[], plugins?: any[]) => convertRestfoxExportToRestfoxCollection({ exportedFrom: 'Restfox-1.0.0', collection, plugins }, 'w2')

    test('a folder keeps its headers, authentication and description', () => {
        const { newCollectionTree } = importInto([folder])
        expect(newCollectionTree[0]).toMatchObject({ headers: folder.headers, authentication: folder.authentication, description: 'folder docs' })
    })

    test('a request keeps its path parameters and description', () => {
        const { newCollectionTree } = importInto([{ ...request, parentId: null }])
        expect(newCollectionTree[0]).toMatchObject({ pathParameters: request.pathParameters, description: 'request docs' })
    })

    test('imported scripts belong to the workspace they are imported into', () => {
        const { newPlugins } = importInto([{ ...request, parentId: null, plugins: [requestScript] }], [workspaceScript])
        expect(newPlugins).toEqual([
            { ...workspaceScript, workspaceId: 'w2', collectionId: null },
            { ...requestScript, workspaceId: 'w2' },
        ])
    })

    test('scripts follow their item when ids are regenerated for a file workspace export', () => {
        const storePlugins = [deepClone(requestScript), deepClone(workspaceScript)]
        const collection = prepareCollectionForExport([folder, request], storePlugins, true)
        const exportedRequest = collection.find(item => item._type === 'request')!

        expect(exportedRequest._id).not.toBe('r')
        expect(exportedRequest.parentId).toBe(collection[0]._id)
        expect(exportedRequest.plugins).toEqual([{ ...requestScript, collectionId: exportedRequest._id }])
        expect(collection[0].plugins).toEqual([])
        expect(storePlugins[0].collectionId).toBe('r')
    })

    test('ids stay as they are when not asked to regenerate them', () => {
        const collection = prepareCollectionForExport([folder, request], [requestScript], false)
        expect(collection.map(item => item._id)).toEqual(['f', 'r'])
        expect(collection[1].plugins).toEqual([requestScript])
    })

    test('a file workspace export round trips with fields and scripts intact', () => {
        const exported = prepareCollectionForExport([folder, request], [requestScript, workspaceScript], true)
        const { newCollectionTree, newPlugins } = importInto(exported, [workspaceScript])
        const importedRequest = newCollectionTree[0].children![0]

        expect(newCollectionTree[0]).toMatchObject({ headers: folder.headers, authentication: folder.authentication, description: 'folder docs' })
        expect(importedRequest).toMatchObject({ pathParameters: request.pathParameters, description: 'request docs' })
        expect(newPlugins.map(plugin => [plugin.name, plugin.collectionId, plugin.workspaceId])).toEqual([
            ['workspace script', null, 'w2'],
            ['request script', importedRequest._id, 'w2'],
        ])
    })
})

describe('Prompt tag', () => {
    const request = (fields: Partial<CollectionItem>) => ({ _id: 'r', _type: 'request', workspaceId: 'w', parentId: null, name: 'Request', method: 'GET', url: 'https://example.test/', ...fields }) as CollectionItem
    const prepare = (fields: Partial<CollectionItem>) => {
        const state: HandleRequestState = { currentPlugin: null, testResults: [] }
        return createRequestData(state, request(fields), {}, {}, undefined, null, [], null)
    }
    const send = async(fields: Partial<CollectionItem>, environment: Record<string, unknown> = {}, plugins: unknown[] = []) => {
        const sent: { url?: string, headers?: Record<string, string> } = {}
        vi.stubGlobal('fetch', async(url: string, init: { headers: Record<string, string> }) => {
            sent.url = url
            sent.headers = init.headers
            return new Response('ok')
        })
        const response = await handleRequest(request(fields), environment, {}, undefined, async() => undefined, plugins as any, null, new AbortController().signal, { electronSwitchToChromiumFetch: false, disableSSLVerification: false, requestTimeout: 0 }) as RequestFinalResponse
        return { sent, response }
    }

    let answers: (string | null)[]
    const createPrompt = vi.fn<(...args: unknown[]) => Promise<string | null | undefined>>(async() => answers.length > 0 ? answers.shift() : null)

    beforeEach(() => {
        answers = []
        createPrompt.mockClear()
        ;(window as any).createPrompt = createPrompt
    })

    test('asks on send and sends what was typed', async() => {
        answers = ['42']
        const result = await prepare({ url: `https://example.test/users/{% prompt(title='User id') %}` })
        expect(result.url.href).toBe('https://example.test/users/42')
        expect(createPrompt).toHaveBeenCalledTimes(1)
        expect(createPrompt.mock.calls[0][0]).toBe('User id')
    })

    test('the same prompt in two places asks once per send, and again on the next send', async() => {
        const tag = `{% prompt(title='Tenant') %}`
        answers = ['a', 'b']
        const first = await prepare({ url: `https://example.test/${tag}`, headers: [{ name: 'X-Tenant', value: tag }] })
        expect([first.url.pathname, first.headers['X-Tenant']]).toEqual(['/a', 'a'])
        const second = await prepare({ url: `https://example.test/${tag}`, headers: [{ name: 'X-Tenant', value: tag }] })
        expect([second.url.pathname, second.headers['X-Tenant']]).toEqual(['/b', 'b'])
        expect(createPrompt).toHaveBeenCalledTimes(2)
    })

    test('Ask once keeps the value for later sends, shared by the same prompt in another request, such as through one environment variable', async() => {
        const environment = { PASSWORD: `{% prompt(title='Password once', ask='once') %}` }
        answers = ['secret']
        await createRequestData({ currentPlugin: null, testResults: [] }, request({ headers: [{ name: 'X-Password', value: '{{PASSWORD}}' }] }), environment, {}, undefined, null, [], null)
        const other = await createRequestData({ currentPlugin: null, testResults: [] }, request({ _id: 'other', url: 'https://example.test/{{PASSWORD}}' }), environment, {}, undefined, null, [], null)
        expect(other.url.pathname).toBe('/secret')
        expect(createPrompt).toHaveBeenCalledTimes(1)
    })

    test('Ask once and pre-filled keep a value per workspace: the same prompt in another workspace asks again and previews its default', async() => {
        const once = `{% prompt(title='Workspace password', defaultValue='d', ask='once') %}`
        const prefill = `{% prompt(title='Workspace user', ask='prefill') %}`
        answers = ['prod-pass', 'prod-user', 'staging-pass', 'staging-user']
        await prepare({ headers: [{ name: 'X-Password', value: once }, { name: 'X-User', value: prefill }] })
        const staging = await prepare({ workspaceId: 'staging', headers: [{ name: 'X-Password', value: once }, { name: 'X-User', value: prefill }] })
        expect([staging.headers['X-Password'], staging.headers['X-User']]).toEqual(['staging-pass', 'staging-user'])
        expect(createPrompt.mock.calls.map(call => [call[0], call[1]])).toEqual([['Workspace password', 'd'], ['Workspace user', ''], ['Workspace password', 'd'], ['Workspace user', '']])
        expect(await substituteEnvironmentVariables({}, once, { workspaceId: 'w' })).toBe('prod-pass')
        expect(await substituteEnvironmentVariables({}, once, { workspaceId: 'other' })).toBe('d')
    })

    test('Ask once does not share with a prompt that has another title', async() => {
        answers = ['a-pass', 'b-pass']
        const first = await prepare({ headers: [{ name: 'X-Password', value: `{% prompt(title='Customer A password', ask='once') %}` }] })
        const second = await prepare({ headers: [{ name: 'X-Password', value: `{% prompt(title='Customer B password', ask='once') %}` }] })
        expect([first.headers['X-Password'], second.headers['X-Password']]).toEqual(['a-pass', 'b-pass'])
        expect(createPrompt).toHaveBeenCalledTimes(2)
    })

    test('cancelling the box stops the send, naming the prompt as the box did', async() => {
        const { response } = await send({ url: `https://example.test/{% prompt(title='Password') %}` })
        expect((response as any).error).toBe('Error: Prompt "Password" was cancelled')
        const untitled = await send({ url: `https://example.test/{% prompt() %}` })
        expect((untitled.response as any).error).toBe('Error: Prompt "Enter value" was cancelled')
    })

    test('previews never open the box: they show the default, or ****** for a masked prompt', async() => {
        const preview = (tag: string) => substituteEnvironmentVariables({}, tag, { tagTrigger: false, noError: true })
        expect(await preview(`{% prompt(title='Id', defaultValue='7') %}`)).toBe('7')
        expect(await preview(`{% prompt(title='Password', defaultValue='x', mask=1) %}`)).toBe('******')
        expect(createPrompt).not.toHaveBeenCalled()
    })

    test('only a send asks, a text resolved outside one shows the preview value even when tags are run', async() => {
        expect(await substituteEnvironmentVariables({}, `{% prompt(title='Id', defaultValue='7') %}`)).toBe('7')
        expect(await substituteEnvironmentVariables({}, `{% prompt(title='Password', defaultValue='x', mask=1) %}`)).toBe('******')
        expect(createPrompt).not.toHaveBeenCalled()
    })

    test('Ask every send, pre-filled, fills the box with what was typed last time for that prompt only, a masked prompt hides what is typed', async() => {
        const tag = `{% prompt(title='Last', label='Your value', ask='prefill', mask=1) %}`
        answers = ['x', 'y', 'z']
        await prepare({ url: `https://example.test/${tag}` })
        await prepare({ url: `https://example.test/${tag}` })
        await prepare({ url: `https://example.test/{% prompt(title='Last', label='Another value', ask='prefill', mask=1) %}` })
        expect(createPrompt.mock.calls[0]).toEqual(['Last', '', [], { label: 'Your value', mask: true }])
        expect(createPrompt.mock.calls[1]).toEqual(['Last', 'x', [], { label: 'Your value', mask: true }])
        expect(createPrompt.mock.calls[2]).toEqual(['Last', '', [], { label: 'Another value', mask: true }])
    })

    test('a masked prompt in one header leaves only that header out of history, the url, the other headers and the body are saved', async() => {
        answers = ['s3cret']
        const tag = `{% prompt(title='Token', mask=1) %}`
        const { sent, response } = await send({ method: 'POST', url: 'https://example.test/items?q=1', headers: [{ name: 'Authorization', value: `Bearer ${tag}` }, { name: 'X-Trace', value: 't1' }], body: { mimeType: 'application/json', text: '{"a":1}' } })
        expect(sent.headers?.Authorization).toBe('Bearer s3cret')
        expect(JSON.stringify(response)).not.toContain('s3cret')
        expect(response.url).toBe('https://example.test/items')
        expect(response.request.query).toBe('?q=1')
        expect(response.request.headers['X-Trace']).toBe('t1')
        expect(response.request.headers.Authorization).toBeUndefined()
        expect(response.request.body).toBe('{"a":1}')
        expect(response.request.maskedPromptOmitted).toEqual({ reason: 'masked-field', url: false, headerNames: ['Authorization'], body: false })
        expect(response.request.original.headers?.[0].value).toBe(`Bearer ${tag}`)
    })

    test('a masked prompt in the body leaves only the body out of history', async() => {
        answers = ['b0dy-secret']
        const { response } = await send({ method: 'POST', headers: [{ name: 'X-Trace', value: 't1' }], body: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'client_secret', value: `{% prompt(title='Secret', mask=1) %}` }] } })
        expect(JSON.stringify(response)).not.toContain('b0dy-secret')
        expect(response.request.headers['X-Trace']).toBe('t1')
        expect(response.request.body).toBeNull()
        expect(response.request.maskedPromptOmitted).toEqual({ reason: 'masked-field', url: false, headerNames: [], body: true })
    })

    test('a masked prompt in the url, a path or a query parameter saves the url with its masked values as ******, which every version can parse', async() => {
        answers = ['p4th', 'qu3ry']
        const { sent, response } = await send({ url: 'https://example.test/users/:id?key=k', pathParameters: [{ name: 'id', value: `{% prompt(title='Id', mask=1) %}` }], parameters: [{ name: 'key', value: `{% prompt(title='Key', mask=1) %}` }], headers: [{ name: 'X-Trace', value: 't1' }] })
        expect(String(sent.url)).toBe('https://example.test/users/p4th?key=qu3ry')
        expect(JSON.stringify(response)).not.toMatch(/p4th|qu3ry/)
        expect([response.url, response.request.query]).toEqual(['https://example.test/users/******', '?key=******'])
        expect(new URL(response.url + response.request.query).pathname).toBe('/users/******')
        expect(response.request.headers['X-Trace']).toBe('t1')
        expect(response.request.maskedPromptOmitted).toEqual({ reason: 'masked-field', url: 'masked', headerNames: [], body: false })
        expect(createPrompt).toHaveBeenCalledTimes(2)
    })

    test('a masked prompt in the port, which a url cannot hold as ******, saves the url as written', async() => {
        answers = ['8443']
        const { sent, response } = await send({ url: `https://example.test:{% prompt(title='Port', mask=1) %}/a?q=1` })
        expect(String(sent.url)).toBe('https://example.test:8443/a?q=1')
        expect(JSON.stringify(response)).not.toContain('8443')
        expect([response.url, response.request.query]).toEqual([`https://example.test:{% prompt(title='Port', mask=1) %}/a?q=1`, ''])
        expect(response.request.maskedPromptOmitted).toEqual({ reason: 'masked-field', url: 'written', headerNames: [], body: false })
    })

    test('a masked prompt in the Auth tab or reached through a variable leaves out the header it went into', async() => {
        answers = ['v4r', 'pa55']
        const { response } = await send({ authentication: { type: 'basic', username: 'user', password: `{% prompt(title='Password', mask=1) %}` }, headers: [{ name: 'X-Api-Key', value: '{{API_KEY}}' }, { name: 'X-Trace', value: 't1' }] }, { API_KEY: `{% prompt(title='Api key', mask=1) %}` })
        expect(JSON.stringify(response)).not.toMatch(/v4r|dXNlcjpwYTU1/)
        expect(response.request.headers['X-Trace']).toBe('t1')
        expect(response.request.maskedPromptOmitted).toEqual({ reason: 'masked-field', url: false, headerNames: ['X-Api-Key', 'Authorization'], body: false })
    })

    test('a masked prompt in a header\'s name leaves the header out and names it with the value as ******', async() => {
        answers = ['n4me']
        const { sent, response } = await send({ headers: [{ name: `X-{% prompt(title='Name', mask=1) %}`, value: 'v' }, { name: 'X-Trace', value: 't1' }] })
        expect(sent.headers?.['X-n4me']).toBe('v')
        expect(JSON.stringify(response)).not.toContain('n4me')
        expect(response.request.maskedPromptOmitted).toEqual({ reason: 'masked-field', url: false, headerNames: ['X-******'], body: false })
        expect(response.request.headers['X-Trace']).toBe('t1')
    })

    test('GLOBAL_HEADERS ask their prompts, and send a variable or another tag in them as written, as before', async() => {
        answers = ['p']
        const { sent } = await send({}, { TOKEN: 't', GLOBAL_HEADERS: { 'X-Var': '{{TOKEN}}', 'X-Tag': '{% uuid() %}', 'X-Prompt': `{% prompt(title='Global') %}` } })
        expect([sent.headers?.['X-Var'], sent.headers?.['X-Tag'], sent.headers?.['X-Prompt']]).toEqual(['{{TOKEN}}', '{% uuid() %}', 'p'])
    })

    test('a url left out goes from the sent headers too: HTTP/2 :path and :authority, and host', async() => {
        const response = { url: 'https://example.test/a', request: { method: 'GET', query: '?k=S3CRET', headers: {}, headersSent: [[':method', 'GET'], [':path', '/a?k=S3CRET'], [':authority', 'example.test'], [':scheme', 'https'], ['host', 'example.test'], ['x-trace', 't1']], body: null, original: {} } } as unknown as RequestFinalResponse
        answers = ['S3CRET']
        const urlSend = new SendResolver('w')
        await urlSend.resolve({}, `{% prompt(title='Query', mask=1) %}`, 'url')
        const saved = urlSend.omitMaskedPromptParts(response, request({ url: 'https://example.test/a?k={{K}}' }))
        expect(saved.request.headersSent).toEqual([[':method', 'GET'], [':scheme', 'https'], ['x-trace', 't1']])
    })

    test('a masked prompt a script reads is left out of test results too, in a pre-request or a post-request script', async() => {
        const tag = `{% prompt(title='Test token', ask='once', mask=1) %}`
        answers = ['t3st-secret']
        await prepare({ headers: [{ name: 'X-Warm', value: tag }] })
        const script = (code: { pre_request: string, post_request: string }) => ({ _id: 'p', type: 'script', name: 'script', code, workspaceId: null, collectionId: 'r', enabled: true, createdAt: 0, updatedAt: 0 })
        const test = `test('token ' + rf.getEnvVar('TOKEN'), () => expect(rf.getEnvVar('TOKEN')).to.equal('x'))`
        const pre = await send({ headers: [{ name: 'X-Trace', value: 't1' }] }, { TOKEN: tag }, [script({ pre_request: test, post_request: '' })])
        expect(pre.response.testResults.map(result => result.passed)).toEqual([false])
        expect(JSON.stringify(pre.response)).not.toContain('t3st-secret')
        const post = await send({ headers: [{ name: 'X-Trace', value: 't1' }] }, { TOKEN: tag }, [script({ pre_request: '', post_request: test })])
        expect(post.response.request.maskedPromptOmitted).toEqual({ reason: 'script-read' })
        expect(JSON.stringify(post.response)).not.toContain('t3st-secret')
    })

    test('a disabled or nameless header does not ask, with a pre-request script too', async() => {
        const plugin = { _id: 'p', type: 'script', name: 'script', code: { pre_request: `rf.request.getMethod()`, post_request: '' }, workspaceId: null, collectionId: 'r', enabled: true, createdAt: 0, updatedAt: 0 }
        const { response } = await send({ headers: [{ name: 'X-Off', value: `{% prompt(title='Disabled') %}`, disabled: true }, { name: '', value: `{% prompt(title='Nameless') %}` }] }, {}, [plugin])
        expect(response.status).toBe(200)
        expect(createPrompt).not.toHaveBeenCalled()
    })

    test('cancelling a header prompt stops the send at once, with a pre-request script too: no later prompt asks and the script does not run', async() => {
        const plugin = { _id: 'p', type: 'script', name: 'script', code: { pre_request: `rf.setEnvVar('ran', 'yes')`, post_request: '' }, workspaceId: null, collectionId: 'r', enabled: true, createdAt: 0, updatedAt: 0 }
        const setEnvironmentVariable = vi.fn(async() => undefined)
        answers = [null]
        const response = await handleRequest(request({ url: `https://example.test/{% prompt(title='Url') %}`, headers: [{ name: 'X-Header', value: `{% prompt(title='Header') %}` }] }), {}, {}, undefined, setEnvironmentVariable, [plugin] as any, null, new AbortController().signal, { electronSwitchToChromiumFetch: false, disableSSLVerification: false, requestTimeout: 0 }) as any
        expect(response.error).toBe('Error: Prompt "Header" was cancelled')
        expect(createPrompt.mock.calls.map(call => call[0])).toEqual(['Header'])
        expect(setEnvironmentVariable).not.toHaveBeenCalled()
    })

    test('Ask once asks once for two sends at the same time, and both send the value', async() => {
        const tag = `{% prompt(title='Concurrent once', ask='once') %}`
        answers = ['a', 'b']
        const [first, second] = await Promise.all([prepare({ headers: [{ name: 'X-Value', value: tag }] }), prepare({ headers: [{ name: 'X-Value', value: tag }] })])
        expect([first.headers['X-Value'], second.headers['X-Value']]).toEqual(['a', 'a'])
        expect(createPrompt).toHaveBeenCalledTimes(1)
    })

    test('GLOBAL_HEADERS send text that only looks like a tag as written', async() => {
        const { sent } = await send({}, { GLOBAL_HEADERS: { 'X-G': '{% my-tag() %}' } })
        expect(sent.headers?.['X-G']).toBe('{% my-tag() %}')
    })

    test('Mask Text written by hand as \'1\' or true masks too', async() => {
        answers = ['qu0ted', 'b00lean']
        const quoted = await send({ headers: [{ name: 'X-A', value: `{% prompt(title='Q', mask='1') %}` }] })
        const bare = await send({ headers: [{ name: 'X-B', value: `{% prompt(title='B', mask=true) %}` }] })
        expect([quoted.sent.headers?.['X-A'], bare.sent.headers?.['X-B']]).toEqual(['qu0ted', 'b00lean'])
        expect(JSON.stringify([quoted.response, bare.response])).not.toMatch(/qu0ted|b00lean/)
    })

    test('two prompts in one field ask in reading order', async() => {
        answers = ['1', '2']
        const result = await prepare({ url: `https://example.test/{% prompt(title='First') %}/{% prompt(title='Second') %}` })
        expect(createPrompt.mock.calls.map(call => call[0])).toEqual(['First', 'Second'])
        expect(result.url.pathname).toBe('/1/2')
    })

    test('Forget Remembered Values makes a prompt asked once ask again', async() => {
        const tag = `{% prompt(title='Password forgotten', ask='once') %}`
        answers = ['first', 'second']
        forgetPromptValues() // values other tests kept
        await prepare({ headers: [{ name: 'X-Password', value: tag }] })
        expect(forgetPromptValues()).toBe(1)
        expect(forgetPromptValues()).toBe(0)
        const second = await prepare({ headers: [{ name: 'X-Password', value: tag }] })
        expect(second.headers['X-Password']).toBe('second')
        expect(createPrompt).toHaveBeenCalledTimes(2)
    })

    test('a socket url or message resolves as a send of its own, and what is shown hides only the masked values', async() => {
        answers = ['4321', 'ada']
        const text = `{ "pin": "{% prompt(title='PIN', mask=1) %}", "user": "{% prompt(title='User') %}", "host": "{{ HOST }}" }`
        expect(await substituteEnvironmentVariablesForSend({ HOST: 'h1' }, text, 'w')).toEqual({
            textResolved: '{ "pin": "4321", "user": "ada", "host": "h1" }',
            textResolvedMasked: '{ "pin": "******", "user": "ada", "host": "h1" }',
        })
        // shown without asking again
        expect(createPrompt).toHaveBeenCalledTimes(2)
    })

    test('a pre-request script that reads a remembered masked prompt through rf.getEnvVar keeps the whole send out of history, it may have put it anywhere', async() => {
        const tag = `{% prompt(title='Kept token', ask='once', mask=1) %}`
        answers = ['sek-ret']
        await prepare({ headers: [{ name: 'X-Warm', value: tag }] })
        const plugin = { _id: 'p', type: 'script', name: 'script', code: { pre_request: `rf.request.setHeader('X-Token', rf.getEnvVar('TOKEN'))`, post_request: '' }, workspaceId: null, collectionId: 'r', enabled: true, createdAt: 0, updatedAt: 0 }
        const { response } = await send({ method: 'POST', headers: [{ name: 'X-Trace', value: 't1' }], body: { mimeType: 'text/plain', text: 'b' } }, { TOKEN: tag }, [plugin])
        expect(response.status).toBe(200)
        expect(JSON.stringify(response)).not.toContain('sek-ret')
        expect(response.request.maskedPromptOmitted).toEqual({ reason: 'script-read' })
        expect([response.url, response.request.query, response.request.headers, response.request.body]).toEqual(['https://example.test/', '', {}, null])
    })

    test('a pre-request script reading a masked header through rf.request.getHeader keeps the whole send out of history, one that does not read it leaves out only that header', async() => {
        const tag = `{% prompt(title='Header token', ask='once', mask=1) %}`
        answers = ['h3ader']
        // remembered first, a script reads a header only once it is resolved
        await prepare({ headers: [{ name: 'X-Warm', value: tag }] })
        const headers = [{ name: 'X-Token', value: tag }, { name: 'X-Trace', value: 't1' }]
        const script = (code: string) => ({ _id: 'p', type: 'script', name: 'script', code: { pre_request: code, post_request: '' }, workspaceId: null, collectionId: 'r', enabled: true, createdAt: 0, updatedAt: 0 })
        const reading = await send({ headers }, {}, [script(`rf.request.setHeader('X-Copy', rf.request.getHeader('X-Token'))`)])
        expect(reading.sent.headers?.['X-Copy']).toBe('h3ader')
        expect(JSON.stringify(reading.response)).not.toContain('h3ader')
        expect(reading.response.request.maskedPromptOmitted).toEqual({ reason: 'script-read' })
        const notReading = await send({ headers }, {}, [script(`rf.request.setHeader('X-Other', 'o')`)])
        expect(notReading.response.request.maskedPromptOmitted).toEqual({ reason: 'masked-field', url: false, headerNames: ['X-Token'], body: false })
        expect(notReading.response.request.headers['X-Trace']).toBe('t1')
    })

    test('a header left out goes from the sent headers too, matched without regard to case', async() => {
        const response = { url: 'https://example.test/a', request: { method: 'GET', query: '?q=1', headers: { authorization: 'Bearer x', 'X-Trace': 't1' }, headersSent: [['host', 'example.test'], ['authorization', 'Bearer x'], ['x-trace', 't1']], body: 'b', original: {} } } as unknown as RequestFinalResponse
        const tag = `{% prompt(title='Omitted', ask='once', mask=1) %}`
        answers = ['x']
        const headerSend = new SendResolver('w')
        await headerSend.resolve({}, tag, { header: 'Authorization' })
        const saved = headerSend.omitMaskedPromptParts(response, request({ url: '{{BASE}}/a?q=1' }))
        expect(saved.request.headers).toEqual({ 'X-Trace': 't1' })
        expect(saved.request.headersSent).toEqual([['host', 'example.test'], ['x-trace', 't1']])
        expect([saved.url, saved.request.query, saved.request.body]).toEqual(['https://example.test/a', '?q=1', 'b'])
        const allSend = new SendResolver('w')
        await allSend.resolve({}, tag, 'url')
        await allSend.resolve({}, tag, 'body')
        const all = allSend.omitMaskedPromptParts(response, request({ url: '{{BASE}}/a?q=1' }))
        expect([all.url, all.request.query, all.request.body]).toEqual(['{{BASE}}/a?q=1', '', null])
        const unsavedSend = new SendResolver('w')
        await unsavedSend.resolve({}, tag, 'unsaved')
        expect(unsavedSend.omitMaskedPromptParts(response, request({}))).toBe(response)
    })

    test('the note names each part left out and why', () => {
        expect(describeMaskedPromptOmitted({ reason: 'masked-field', url: false, headerNames: ['Authorization'], body: false })).toBe('Left out because a masked prompt was used there: the Authorization header')
        expect(describeMaskedPromptOmitted({ reason: 'masked-field', url: false, headerNames: ['Authorization'], body: true })).toBe('Left out because a masked prompt was used there: the Authorization header and the body')
        expect(describeMaskedPromptOmitted({ reason: 'masked-field', url: 'written', headerNames: ['X-Key', 'Authorization'], body: true })).toBe('Left out because a masked prompt was used there: the URL (shown as written), the X-Key header, the Authorization header and the body')
        expect(describeMaskedPromptOmitted({ reason: 'masked-field', url: 'masked', headerNames: [], body: false })).toBe('Left out because a masked prompt was used there: the masked values in the URL (shown as ******)')
        expect(describeMaskedPromptOmitted({ reason: 'script-read' })).toBe('Left out because a script read a masked prompt: the URL (shown as written), the headers, the body and the test names and errors')
    })

    test('a request that used only unmasked prompts saves the resolved request as before', async() => {
        answers = ['v']
        const { response } = await send({ headers: [{ name: 'X-Value', value: `{% prompt(title='Value') %}` }] })
        expect(response.request.headers['X-Value']).toBe('v')
        expect(response.request.maskedPromptOmitted).toBeUndefined()
    })

    // Each text a send can read, one at a time, gets a masked prompt and is sent twice with two typed values. Where the
    // server got the value, the saved copies must be the same, so no form of the value, encoded or not, is saved
    describe('in any text of a send', () => {
        // script runs a pre-request script that reads nothing, so the texts are also prepared for a script
        type Fixture = { request: CollectionItem, parentHeaders: Record<string, string[]>, parentAuthentication?: RequestAuthentication, environment: Record<string, any>, script?: boolean }

        // one body and one auth kind of each, from the request, its folders and the environment, with disabled items, a
        // query typed into the url and a folder header the request's own replaces
        const fixtures: Fixture[] = [
            {
                request: request({ method: 'POST', url: 'https://example.test/users/:id', parameters: [{ name: 'q', value: '1' }], pathParameters: [{ name: 'id', value: '7' }], headers: [{ name: 'X-Header', value: 'h' }, { name: 'X-Var', value: '{{VAR}}' }], body: { mimeType: 'application/json', text: '{"a":"b"}' }, authentication: { type: 'basic', username: 'u', password: 'p' } }),
                parentHeaders: { 'X-Folder': ['f'], 'X-Header': ['replaced'] },
                environment: { VAR: 'v', GLOBAL_HEADERS: { 'X-Global': 'g' } },
            },
            {
                request: request({ method: 'POST', url: 'https://example.test/?k=v', body: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'f', value: '1' }] }, authentication: { type: 'bearer', prefix: 'Bearer', token: 't' } }),
                parentHeaders: {},
                environment: {},
            },
            {
                request: request({ method: 'POST', body: { mimeType: 'multipart/form-data', params: [{ type: 'text', name: 'm', value: '1' }] } }),
                parentHeaders: {},
                parentAuthentication: { type: 'basic', username: 'fu', password: 'fp' },
                environment: {},
            },
            {
                request: request({ method: 'POST', parameters: [{ name: 'on', value: '1' }, { name: 'off', value: '0', disabled: true }], headers: [{ name: 'X-On', value: 'on' }, { name: 'X-Off', value: 'off', disabled: true }], body: { mimeType: 'text/plain', text: 'plain' }, authentication: { type: 'oauth2', prefix: 'Bearer', token: 'o' } }),
                parentHeaders: {},
                environment: {},
                script: true,
            },
        ]

        // maps whose keys are header names
        const headerNameMaps = ['parentHeaders', 'environment.GLOBAL_HEADERS']

        // every text in the fixture by its path, a header name map's key as "<map>.<key>:name"
        function textPaths(value: any, path: string[] = []): string[][] {
            if (typeof value === 'string') {
                return [path]
            }
            if (value === null || typeof value !== 'object') {
                return []
            }
            return Object.entries(value).flatMap(([key, child]) => [
                ...(headerNameMaps.includes(path.join('.')) ? [[...path, `${key}:name`]] : []),
                ...textPaths(child, [...path, key]),
            ])
        }

        function withTag(fixture: Fixture, path: string[], tag: string): Fixture {
            const copy = JSON.parse(JSON.stringify(fixture))
            const parent = path.slice(0, -1).reduce((object, key) => object[key], copy)
            const last = path[path.length - 1]
            if (last.endsWith(':name')) {
                const name = last.slice(0, -':name'.length)
                const entries = Object.entries(parent)
                Object.keys(parent).forEach(key => delete parent[key])
                entries.forEach(([key, child]) => parent[key === name ? name + tag : key] = child)
            } else {
                parent[last] += tag
            }
            return copy
        }

        const script = { _id: 'p', type: 'script', name: 'script', code: { pre_request: 'rf.request.getMethod()', post_request: '' }, workspaceId: null, collectionId: 'r', enabled: true, createdAt: 0, updatedAt: 0 }

        async function sendWithAnswer(fixture: Fixture, answer: string) {
            let sent = ''
            vi.stubGlobal('fetch', async(url: string, init: { headers: Record<string, string>, body: unknown }) => {
                const body = init.body instanceof FormData ? [...init.body.entries()] : String(init.body)
                sent = JSON.stringify([url, init.headers, body])
                return new Response('ok')
            })
            answers = [answer]
            createPrompt.mockClear()
            const response = await handleRequest(fixture.request, fixture.environment, fixture.parentHeaders, fixture.parentAuthentication, async() => undefined, (fixture.script ? [script] : []) as any, null, new AbortController().signal, { electronSwitchToChromiumFetch: false, disableSSLVerification: false, requestTimeout: 0 }) as RequestFinalResponse
            // what differs on every send
            const saved = { ...response, _id: '', createdAt: 0, timeTaken: 0, headTimeTaken: 0, bodyTimeTaken: 0 }
            return { sent, saved: JSON.stringify(saved), asked: createPrompt.mock.calls.length }
        }

        test('reaches the server and is never saved', async() => {
            const tag = `{% prompt(title='Any text', mask=1) %}`
            const notSent: string[] = []
            const notSentButAsked: string[] = []
            const saved: string[] = []

            for (const [index, fixture] of fixtures.entries()) {
                for (const path of textPaths(fixture)) {
                    const fixtureWithTag = withTag(fixture, path, tag)
                    const first = await sendWithAnswer(fixtureWithTag, 'Aaaa1111')
                    const second = await sendWithAnswer(fixtureWithTag, 'Bbbb2222')
                    const name = `${index}:${path.join('.')}`
                    if (first.sent === second.sent) {
                        notSent.push(name)
                        if (first.asked > 0) {
                            notSentButAsked.push(name)
                        }
                        continue
                    }
                    if (second.saved !== first.saved) {
                        saved.push(name)
                    }
                }
            }

            expect(saved).toEqual([])

            // so the check covers every text a send reads: these are the only ones the server never got. A path
            // parameter's name is sent only where the url uses it
            const notSentFields = ['_id', '_type', 'workspaceId', 'name', 'method', 'body.mimeType']
            expect(notSent.sort()).toEqual([
                ...notSentFields.map(field => `0:request.${field}`), '0:request.pathParameters.0.name', '0:request.authentication.type', '0:parentHeaders.X-Header.0',
                ...notSentFields.map(field => `1:request.${field}`), '1:request.authentication.type',
                ...notSentFields.map(field => `2:request.${field}`), '2:request.body.params.0.type', '2:parentAuthentication.type',
                ...notSentFields.map(field => `3:request.${field}`), '3:request.authentication.type', '3:request.parameters.1.name', '3:request.parameters.1.value', '3:request.headers.1.name', '3:request.headers.1.value',
            ].sort())

            // a text that is not sent never asks, apart from a path parameter's name, which the url is searched for
            expect(notSentButAsked).toEqual(['0:request.pathParameters.0.name'])
        })
    })
})
