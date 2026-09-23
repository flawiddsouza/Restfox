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
    getMissingOAuthTokenFieldsMessage
} from './helpers'
import type { CollectionItem, HandleRequestState } from './global'
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
