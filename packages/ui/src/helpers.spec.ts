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
    deepClone,
    INHERITED_AUTHENTICATION_TYPE
} from './helpers'
import type { CollectionItem, HandleRequestState } from './global'

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

    test('an Insomnia request with auth type none imports as No Auth', () => {
        const insomniaExport = { resources: [{ _id: 'r', _type: 'request', parentId: null, name: 'Request', method: 'GET', url: 'https://example.test/', body: {}, authentication: { type: 'none' } }] }
        const collection = convertInsomniaExportToRestfoxCollection(insomniaExport, 'w')
        expect(collection[0].authentication).toEqual({ type: 'none' })
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
