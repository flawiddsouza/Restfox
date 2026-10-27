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
    saveCACertificates,
    createGrpcRequestData,
    generateGrpcurlCommand,
    convertCollectionsFromRestfoxToPostman,
    convertCollectionsFromRestfoxToInsomnia,
    flattenTree,
    humanFriendlyRunningTime,
    humanFriendlyTime,
} from './helpers'
import { store as requestStore } from './store'
import { getResponsesByCollectionId } from './db'
import { forgetPromptValues } from './utils/prompt-tag'
import { markSendReplaced } from './utils/response-stream'
import type { CollectionItem, HandleRequestState, RequestAuthentication, RequestFinalResponse } from './global'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// edge-runtime has no IndexedDB, Settings > CA Certificates is kept in memory here
vi.mock('@/db', async(importOriginal) => ({
    ...await importOriginal<typeof import('@/db')>(),
    getResponsesByCollectionId: vi.fn(async() => []),
    getSettingsFile: vi.fn(async() => null),
    putSettingsFile: vi.fn(async() => undefined),
    deleteSettingsFile: vi.fn(async() => undefined),
}))

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
        assert.equal(await substituteEnvironmentVariables(env, input, 'display'), expectedOutput)

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

        assert.equal(await substituteEnvironmentVariables(env, input, 'display'), input)
        assert.equal(await substituteEnvironmentVariables(env, extraForRegExSpecific, 'display'), extraForRegExSpecific)

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
        assert.equal(await substituteEnvironmentVariables(env, input, 'display'), expectedOutput)
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
        assert.equal(await substituteEnvironmentVariables(env, input, 'display'), expectedOutput)
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

describe('Streaming responses', () => {
    const encoder = new TextEncoder()
    const sseChunk = encoder.encode('data: {"a":1}\n\n')
    const allByteValues = Uint8Array.from({ length: 256 }, (_, index) => index)
    const binaryBody = Uint8Array.from({ length: 1024 }, (_, index) => index % 256)
    const jsonBody = encoder.encode('{"id":1,"name":"ünïcode ✓"}')
    const requestUrl = new URL('https://example.com')
    const fetchFlags = (requestTimeout = 0) => ({ electronSwitchToChromiumFetch: false, disableSSLVerification: false, requestTimeout })

    // 1, 2, 3, ... bytes, so chunk edges fall everywhere, multibyte characters included
    const unevenChunks = (bytes: Uint8Array) => {
        const chunks: Uint8Array[] = []
        let offset = 0
        for(let size = 1; offset < bytes.byteLength; size++) {
            chunks.push(bytes.slice(offset, offset + size))
            offset += size
        }
        return chunks
    }

    const concat = (parts: Uint8Array[]) => {
        const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
        let offset = 0
        for(const part of parts) {
            bytes.set(part, offset)
            offset += part.byteLength
        }
        return bytes
    }

    const progressBytes = (onResponseProgress: ReturnType<typeof vi.fn>) => concat(onResponseProgress.mock.calls.filter(call => call[0].type === 'data').map(call => call[0].bytes))

    // a body that stays open after its chunks until the request's signal aborts it, as a real fetch errors its body then
    const openBody = (chunks: Uint8Array[], signal: AbortSignal) => new ReadableStream<Uint8Array>({
        start(controller) {
            chunks.forEach(chunk => controller.enqueue(chunk))
            signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
        },
    })

    const closedBody = (chunks: Uint8Array[]) => new ReadableStream<Uint8Array>({
        start(controller) {
            chunks.forEach(chunk => controller.enqueue(chunk))
            controller.close()
        },
    })

    const stubOpenBody = (chunks: Uint8Array[], contentType = 'text/event-stream') => {
        vi.stubGlobal('fetch', async(_url: string, init: FetchInitWithSignal) => new Response(openBody(chunks, init.signal), { headers: { 'content-type': contentType } }))
    }

    describe('page fetch', () => {
        // what the page fetch returned when it read the whole body with blob(), Date frozen by fake timers
        const bufferedResult = async(response: Response) => {
            const blob = await response.blob()
            return {
                status: response.status,
                statusText: response.statusText,
                headers: [...response.headers.entries()],
                mimeType: blob.type,
                buffer: await blob.arrayBuffer(),
                timeTaken: 0,
                headTimeTaken: 0,
                bodyTimeTaken: 0,
            }
        }

        const samples: { name: string, makeResponse: () => Response }[] = [
            { name: 'JSON', makeResponse: () => new Response(closedBody(unevenChunks(jsonBody)), { status: 201, statusText: 'Created', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Trace': 't1' } }) },
            { name: 'binary', makeResponse: () => new Response(closedBody(unevenChunks(binaryBody)), { headers: { 'content-type': 'application/octet-stream' } }) },
            { name: 'binary without a content type', makeResponse: () => new Response(closedBody([allByteValues])) },
            { name: 'empty', makeResponse: () => new Response(null, { status: 204, statusText: 'No Content' }) },
        ]

        for(const sample of samples) {
            test(`a ${sample.name} response gives exactly what the buffered read gave, with or without a progress handler`, async() => {
                vi.useFakeTimers()
                vi.stubGlobal('fetch', async() => sample.makeResponse())
                const expected = await bufferedResult(sample.makeResponse())

                const withoutHandler = await fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags())
                const onResponseProgress = vi.fn()
                const withHandler = await fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(), onResponseProgress)

                for(const response of [withoutHandler, withHandler]) {
                    expect(Object.keys(response).sort()).toEqual(Object.keys(expected).sort())
                    expect(response).toEqual(expected)
                    expect(response.buffer).toBeInstanceOf(ArrayBuffer)
                    expect(new Uint8Array(response.buffer)).toEqual(new Uint8Array(expected.buffer))
                }
                expect(onResponseProgress.mock.calls[0][0]).toMatchObject({ type: 'head', head: { status: expected.status, headers: expected.headers } })
                expect(progressBytes(onResponseProgress)).toEqual(new Uint8Array(expected.buffer))
            })
        }

        test('a timeout after the head keeps the bytes received, marked timedOut, and reports head and data as they arrive', async() => {
            vi.useFakeTimers()
            stubOpenBody([sseChunk])
            const onResponseProgress = vi.fn()

            const promise = fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(50), onResponseProgress)
            await vi.advanceTimersByTimeAsync(10)

            expect(onResponseProgress.mock.calls.map(call => call[0].type)).toEqual(['head', 'data'])
            expect(onResponseProgress.mock.calls[0][0].head.status).toBe(200)
            expect(onResponseProgress.mock.calls[1][0].bytes).toEqual(sseChunk)

            await vi.advanceTimersByTimeAsync(50)
            const response = await promise
            expect(new Uint8Array(response.buffer)).toEqual(sseChunk)
            expect(response.bodyIncomplete).toBe('timedOut')
            expect(response.status).toBe(200)
            expect(response.mimeType).toBe('text/event-stream')
        })

        test('a cancel after the first chunk keeps it, marked cancelled, and logs nothing', async() => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
            stubOpenBody([sseChunk])
            const abortController = new AbortController()
            const onResponseProgress = vi.fn((progress: { type: string }) => {
                if(progress.type === 'data') {
                    abortController.abort()
                }
            })

            const response = await fetchWrapper(requestUrl, 'GET', {}, null, abortController.signal, fetchFlags(), onResponseProgress)

            expect(new Uint8Array(response.buffer)).toEqual(sseChunk)
            expect(response.bodyIncomplete).toBe('cancelled')
            expect(consoleError).not.toHaveBeenCalled()
        })

        test('without a progress handler the timeout still covers the body and rejects as before, and so does a cancel', async() => {
            vi.useFakeTimers()
            stubOpenBody([sseChunk], 'application/json')
            const timedOut = fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(50))
            const timedOutExpectation = expect(timedOut).rejects.toMatchObject({ name: 'TimeoutError' })
            await vi.advanceTimersByTimeAsync(50)
            await timedOutExpectation

            const abortController = new AbortController()
            const cancelled = fetchWrapper(requestUrl, 'GET', {}, null, abortController.signal, fetchFlags(1000))
            const cancelledExpectation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
            await vi.advanceTimersByTimeAsync(10)
            abortController.abort()
            await cancelledExpectation
        })

        test('a body that fails after the head keeps what arrived, marked failed, with one line in Logs, and rejects without a handler', async() => {
            const failingBody = () => new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(sseChunk)
                    setTimeout(() => controller.error(new TypeError('network error')), 0)
                },
            })
            vi.stubGlobal('fetch', async() => new Response(failingBody(), { headers: { 'content-type': 'text/event-stream' } }))
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

            const response = await fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(), vi.fn())

            expect(response.bodyIncomplete).toBe('failed')
            expect(new Uint8Array(response.buffer)).toEqual(sseChunk)
            expect(consoleError).toHaveBeenCalledTimes(1)
            expect(consoleError.mock.calls[0][0]).toMatchObject({ message: 'network error' })

            await expect(fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags())).rejects.toMatchObject({ name: 'TypeError', message: 'network error' })
        })

        test('a failure before the head rejects as before, with a progress handler too', async() => {
            vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
            const onResponseProgress = vi.fn()
            await expect(fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(), onResponseProgress)).rejects.toMatchObject({ message: 'Failed to fetch' })
            expect(onResponseProgress).not.toHaveBeenCalled()
        })
    })

    describe('Electron', () => {
        type Push = (requestId: string, message: unknown) => void

        const stubElectron = () => {
            const listeners: Push[] = []
            const ipc = {
                onRequestEvent: vi.fn((callback: Push) => {
                    listeners.push(callback)
                }),
                sendRequest: vi.fn<(payload: { requestId: string }) => Promise<unknown>>(async() => undefined),
                cancelRequest: vi.fn(),
            }
            ;(window as any).electronIPC = ipc
            const push: Push = (requestId, message) => listeners.forEach(listener => listener(requestId, message))
            return { ipc, push }
        }

        // a mimeType taken from the header as is, not as a blob gives it, would differ
        const head = { status: 200, statusText: 'OK', headers: [['content-type', 'Application/JSON; Charset=UTF-8']], headTimeTaken: 5, requestHeadersSent: [['accept', '*/*']] }
        // as main and the server send it, with no mimeType, which the UI works out from the head
        const end = { timeTaken: 12, bodyTimeTaken: 7 }
        const mimeType = 'application/json;charset=utf-8'

        // what the renderer made of main's old { event: 'response' } reply
        const bufferedResult = (bytes: Uint8Array) => ({
            status: 200,
            statusText: 'OK',
            headers: head.headers,
            mimeType,
            buffer: new Uint8Array(bytes).buffer,
            timeTaken: 12,
            headTimeTaken: 5,
            bodyTimeTaken: 7,
            requestHeadersSent: [['accept', '*/*']],
        })

        const pushResponse = (push: Push, requestId: string, bytes: Uint8Array) => {
            push(requestId, { event: 'head', eventData: head })
            unevenChunks(bytes).forEach(chunk => push(requestId, { event: 'data', eventData: chunk }))
            push(requestId, { event: 'end', eventData: end })
        }

        const nextTask = () => new Promise(resolve => setTimeout(resolve, 0))

        beforeEach(() => {
            vi.stubEnv('MODE', 'desktop-electron')
        })

        afterEach(() => {
            vi.unstubAllEnvs()
            delete (window as any).electronIPC
        })

        const orders: { name: string, send: (push: Push, requestId: string, bytes: Uint8Array) => Promise<void> }[] = [
            { name: 'all pushed before the invoke reply', send: async(push, requestId, bytes) => pushResponse(push, requestId, bytes) },
            { name: 'all pushed after the invoke reply', send: async(push, requestId, bytes) => {
                setTimeout(() => pushResponse(push, requestId, bytes), 0)
            } },
            { name: 'the invoke reply between head and data', send: async(push, requestId, bytes) => {
                push(requestId, { event: 'head', eventData: head })
                setTimeout(() => {
                    unevenChunks(bytes).forEach(chunk => push(requestId, { event: 'data', eventData: chunk }))
                    push(requestId, { event: 'end', eventData: end })
                }, 0)
            } },
        ]

        for(const order of orders) {
            for(const [bodyName, bytes] of [['JSON', jsonBody], ['binary', binaryBody]] as const) {
                test(`a ${bodyName} response with ${order.name} gives exactly what the old reply gave, with or without a progress handler`, async() => {
                    const { ipc, push } = stubElectron()
                    ipc.sendRequest.mockImplementation(async({ requestId }) => {
                        await order.send(push, requestId, bytes)
                        return undefined
                    })

                    const withoutHandler = await fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags())
                    const onResponseProgress = vi.fn()
                    const withHandler = await fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(), onResponseProgress)

                    const expected = bufferedResult(bytes)
                    for(const response of [withoutHandler, withHandler]) {
                        expect(Object.keys(response).sort()).toEqual(Object.keys(expected).sort())
                        expect(response).toEqual(expected)
                        expect(new Uint8Array(response.buffer)).toEqual(bytes)
                    }
                    expect(onResponseProgress.mock.calls[0][0]).toEqual({ type: 'head', head })
                    expect(progressBytes(onResponseProgress)).toEqual(bytes)
                })
            }
        }

        test('the request body is sent as before', async() => {
            const { ipc, push } = stubElectron()
            ipc.sendRequest.mockImplementation(async({ requestId }) => pushResponse(push, requestId, jsonBody))

            await fetchWrapper(requestUrl, 'POST', { 'X-Trace': 't1' }, new File(['ab'], 'a.txt', { type: 'text/plain' }), new AbortController().signal, fetchFlags())

            expect(ipc.sendRequest.mock.calls[0][0]).toEqual({
                requestId: expect.any(String),
                url: 'https://example.com/',
                method: 'POST',
                headers: { 'X-Trace': 't1' },
                body: { name: 'a.txt', type: 'text/plain', buffer: [97, 98] },
                bodyHint: 'File',
                disableSSLVerification: false,
            })
        })

        test('a cancel after the head keeps what arrived and ignores later pushes, without a handler it rejects as before', async() => {
            const { ipc, push } = stubElectron()
            let requestId = ''
            ipc.sendRequest.mockImplementation(async(payload) => {
                requestId = payload.requestId
                push(requestId, { event: 'head', eventData: { ...head, headers: [['content-type', 'text/event-stream']] } })
                push(requestId, { event: 'data', eventData: sseChunk })
            })

            const abortController = new AbortController()
            const onResponseProgress = vi.fn()
            const promise = fetchWrapper(requestUrl, 'GET', {}, null, abortController.signal, fetchFlags(), onResponseProgress)
            await nextTask()
            abortController.abort()
            const response = await promise

            expect(ipc.cancelRequest).toHaveBeenCalledWith(requestId)
            expect(response.bodyIncomplete).toBe('cancelled')
            expect(response.mimeType).toBe('text/event-stream')
            expect(new Uint8Array(response.buffer)).toEqual(sseChunk)

            const callsBefore = onResponseProgress.mock.calls.length
            push(requestId, { event: 'data', eventData: encoder.encode('late') })
            push(requestId, { event: 'end', eventData: end })
            expect(onResponseProgress.mock.calls.length).toBe(callsBefore)

            const abortWithoutHandler = new AbortController()
            const withoutHandler = fetchWrapper(requestUrl, 'GET', {}, null, abortWithoutHandler.signal, fetchFlags())
            await nextTask()
            abortWithoutHandler.abort()
            await expect(withoutHandler).rejects.toMatchObject({ name: 'AbortError' })
        })

        test('a timeout after the head keeps what arrived, marked timedOut, before the head it is a TimeoutError', async() => {
            vi.useFakeTimers()
            const { ipc, push } = stubElectron()
            ipc.sendRequest.mockImplementation(async({ requestId }) => {
                push(requestId, { event: 'head', eventData: head })
                push(requestId, { event: 'data', eventData: jsonBody })
            })
            const promise = fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(50), vi.fn())
            await vi.advanceTimersByTimeAsync(50)
            const response = await promise
            expect(response.bodyIncomplete).toBe('timedOut')
            expect(new Uint8Array(response.buffer)).toEqual(jsonBody)

            ipc.sendRequest.mockImplementation(async() => undefined)
            const beforeHead = fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(50), vi.fn())
            const expectation = expect(beforeHead).rejects.toMatchObject({ name: 'TimeoutError' })
            await vi.advanceTimersByTimeAsync(50)
            await expectation
        })

        test('a body error keeps what arrived, marked failed, with one line in Logs, and rejects without a handler', async() => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
            const { ipc, push } = stubElectron()
            ipc.sendRequest.mockImplementation(async({ requestId }) => {
                push(requestId, { event: 'head', eventData: head })
                push(requestId, { event: 'data', eventData: jsonBody })
                push(requestId, { event: 'bodyError', eventData: { message: 'terminated: other side closed', timeTaken: 30, bodyTimeTaken: 25 } })
            })

            const response = await fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(), vi.fn())
            expect(response).toMatchObject({ bodyIncomplete: 'failed', timeTaken: 30, bodyTimeTaken: 25, headTimeTaken: 5, mimeType })
            expect(new Uint8Array(response.buffer)).toEqual(jsonBody)
            expect(consoleError).toHaveBeenCalledTimes(1)

            await expect(fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags())).rejects.toMatchObject({ message: 'terminated: other side closed' })
        })

        test('a failure before the head, pushed or from the invoke, rejects as before', async() => {
            const { ipc, push } = stubElectron()
            ipc.sendRequest.mockImplementation(async({ requestId }) => push(requestId, { event: 'responseError', eventData: 'TypeError: fetch failed\nError: getaddrinfo ENOTFOUND' }))
            await expect(fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(), vi.fn())).rejects.toMatchObject({ message: 'TypeError: fetch failed\nError: getaddrinfo ENOTFOUND' })

            ipc.sendRequest.mockImplementation(async() => {
                throw new Error('No handler registered for \'sendRequest\'')
            })
            await expect(fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags())).rejects.toMatchObject({ message: 'No handler registered for \'sendRequest\'' })
        })

        // the store keeps a tab's abort controller until its next send, so a handler left on its signal would keep the body
        test('a finished send leaves no handler on the signal, which would keep what arrived in memory', async() => {
            const { ipc, push } = stubElectron()
            ipc.sendRequest.mockImplementation(async({ requestId }) => pushResponse(push, requestId, jsonBody))
            const abortController = new AbortController()

            await fetchWrapper(requestUrl, 'GET', {}, null, abortController.signal, fetchFlags(), vi.fn())
            expect(abortController.signal.onabort).toBeNull()

            ipc.sendRequest.mockImplementation(async({ requestId }) => push(requestId, { event: 'responseError', eventData: 'TypeError: fetch failed' }))
            const failedAbortController = new AbortController()
            await expect(fetchWrapper(requestUrl, 'GET', {}, null, failedAbortController.signal, fetchFlags(), vi.fn())).rejects.toThrow()
            expect(failedAbortController.signal.onabort).toBeNull()

            abortController.abort()
            failedAbortController.abort()
            expect(ipc.cancelRequest).not.toHaveBeenCalled()
        })
    })

    describe('CORS Helper extension', () => {
        // the page's message listeners, which the edge runtime's window cannot dispatch to
        const messageListeners = new Set<(message: { data: unknown }) => void>()

        // what the extension's content script posts to the page
        const reply = (data: unknown) => [...messageListeners].forEach(listener => listener({ data }))

        // the page's own postMessage, standing in for the content script, which reads what the page posts
        const stubExtension = () => {
            const posted: any[] = []
            const postMessage = vi.spyOn(window, 'postMessage').mockImplementation((message: any) => {
                posted.push(message)
            })
            const sent = () => posted.find(message => message.event === 'sendRequest')
            return { posted, postMessage, sent }
        }

        beforeEach(() => {
            messageListeners.clear()
            vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: any) => {
                if(type === 'message') {
                    messageListeners.add(listener)
                }
            })
            vi.spyOn(window, 'removeEventListener').mockImplementation((type: string, listener: any) => {
                if(type === 'message') {
                    messageListeners.delete(listener)
                }
            })
        })

        const head = { status: 200, statusText: 'OK', headers: [['content-type', 'Application/JSON; Charset=UTF-8']], headTimeTaken: 5 }
        const end = { timeTaken: 12, bodyTimeTaken: 7 }

        // what an extension before 1.1.0 replies, the whole response with a mimeType from blob()
        const wholeResponse = (bytes: Uint8Array) => ({
            status: 200,
            statusText: 'OK',
            headers: head.headers,
            mimeType: 'application/json;charset=utf-8',
            buffer: new Uint8Array(bytes).buffer,
            timeTaken: 12,
            headTimeTaken: 5,
            bodyTimeTaken: 7,
        })

        const replyInParts = (eventId: string, bytes: Uint8Array) => {
            reply({ event: 'responseHead', eventId, eventData: head })
            unevenChunks(bytes).forEach(chunk => reply({ event: 'responseData', eventId, eventData: chunk }))
            reply({ event: 'responseEnd', eventId, eventData: end })
        }

        beforeEach(() => {
            (window as WindowWithExtensionHook).__EXTENSION_HOOK__ = 'Restfox CORS Helper Enabled'
        })

        const send = async(onResponseProgress?: ReturnType<typeof vi.fn>, signal = new AbortController().signal, requestTimeout = 0) => {
            const promise = fetchWrapper(requestUrl, 'GET', {}, null, signal, fetchFlags(requestTimeout), onResponseProgress)
            // the message is posted once the body is ready to go
            await vi.waitFor(() => expect(window.postMessage).toHaveBeenCalled())
            return promise
        }

        test('asks for the response in parts and posts the request as before', async() => {
            const { sent } = stubExtension()
            const promise = fetchWrapper(requestUrl, 'POST', { 'X-Trace': 't1' }, new File(['ab'], 'a.txt', { type: 'text/plain' }), new AbortController().signal, fetchFlags())
            await vi.waitFor(() => expect(sent()).toBeDefined())

            expect(sent()).toEqual({
                event: 'sendRequest',
                eventId: expect.any(String),
                stream: true,
                eventData: {
                    url: 'https://example.com/',
                    method: 'POST',
                    headers: { 'X-Trace': 't1' },
                    body: { name: 'a.txt', type: 'text/plain', buffer: [97, 98] },
                    bodyHint: 'File',
                },
            })

            replyInParts(sent().eventId, jsonBody)
            await promise
        })

        for(const [bodyName, bytes] of [['JSON', jsonBody], ['binary', binaryBody]] as const) {
            test(`a ${bodyName} response in parts gives exactly what an extension before 1.1.0 gave whole, with or without a progress handler`, async() => {
                const expected = wholeResponse(bytes)

                for(const onResponseProgress of [undefined, vi.fn()]) {
                    const { sent, postMessage } = stubExtension()
                    const promise = send(onResponseProgress)
                    await vi.waitFor(() => expect(sent()).toBeDefined())
                    replyInParts(sent().eventId, bytes)
                    const response = await promise

                    expect(Object.keys(response).sort()).toEqual(Object.keys(expected).sort())
                    expect(response).toEqual(expected)
                    expect(new Uint8Array(response.buffer)).toEqual(bytes)
                    if(onResponseProgress) {
                        expect(onResponseProgress.mock.calls[0][0]).toEqual({ type: 'head', head })
                        expect(progressBytes(onResponseProgress)).toEqual(bytes)
                    }
                    postMessage.mockRestore()
                }
            })
        }

        test('the whole response from an extension before 1.1.0 is taken as before, and one before 1.0.9 without an eventId too', async() => {
            for(const withEventId of [true, false]) {
                const { sent, postMessage } = stubExtension()
                const onResponseProgress = vi.fn()
                const promise = send(onResponseProgress)
                await vi.waitFor(() => expect(sent()).toBeDefined())
                const expected = wholeResponse(jsonBody)
                reply({ event: 'response', ...(withEventId ? { eventId: sent().eventId } : {}), eventData: expected })

                expect(await promise).toEqual(expected)
                expect(onResponseProgress).not.toHaveBeenCalled()
                postMessage.mockRestore()
            }
        })

        test('the parts of another request are not taken', async() => {
            const { sent } = stubExtension()
            const promise = send(vi.fn())
            await vi.waitFor(() => expect(sent()).toBeDefined())

            replyInParts('another-request', encoder.encode('{"other":true}'))
            replyInParts(sent().eventId, jsonBody)

            expect(new Uint8Array((await promise).buffer)).toEqual(jsonBody)
        })

        test('a cancel after the head keeps what arrived, tells the extension and ignores later parts, without a handler it rejects as before', async() => {
            const { sent, posted } = stubExtension()
            const abortController = new AbortController()
            const onResponseProgress = vi.fn()
            const promise = send(onResponseProgress, abortController.signal)
            await vi.waitFor(() => expect(sent()).toBeDefined())
            const { eventId } = sent()

            reply({ event: 'responseHead', eventId, eventData: { ...head, headers: [['content-type', 'text/event-stream']] } })
            reply({ event: 'responseData', eventId, eventData: sseChunk })
            abortController.abort()
            const response = await promise

            expect(posted).toContainEqual({ event: 'cancelRequest', eventId })
            expect(response.bodyIncomplete).toBe('cancelled')
            expect(response.mimeType).toBe('text/event-stream')
            expect(new Uint8Array(response.buffer)).toEqual(sseChunk)

            const callsBefore = onResponseProgress.mock.calls.length
            reply({ event: 'responseData', eventId, eventData: encoder.encode('late') })
            reply({ event: 'responseEnd', eventId, eventData: end })
            expect(onResponseProgress.mock.calls.length).toBe(callsBefore)

            const abortWithoutHandler = new AbortController()
            const withoutHandler = send(undefined, abortWithoutHandler.signal)
            await vi.waitFor(() => expect(posted.filter(message => message.event === 'sendRequest').length).toBe(2))
            abortWithoutHandler.abort()
            await expect(withoutHandler).rejects.toMatchObject({ name: 'AbortError' })
        })

        test('a timeout after the head keeps what arrived, marked timedOut, before the head it is a TimeoutError', async() => {
            const { sent, posted } = stubExtension()
            const promise = send(vi.fn(), new AbortController().signal, 50)
            await vi.waitFor(() => expect(sent()).toBeDefined())
            reply({ event: 'responseHead', eventId: sent().eventId, eventData: head })
            reply({ event: 'responseData', eventId: sent().eventId, eventData: jsonBody })

            const response = await promise
            expect(response.bodyIncomplete).toBe('timedOut')
            expect(new Uint8Array(response.buffer)).toEqual(jsonBody)

            const beforeHead = send(vi.fn(), new AbortController().signal, 50)
            await expect(beforeHead).rejects.toMatchObject({ name: 'TimeoutError' })
            expect(posted.filter(message => message.event === 'cancelRequest').length).toBe(2)
        })

        test('a body error keeps what arrived, marked failed, with one line in Logs, and rejects without a handler', async() => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

            for(const onResponseProgress of [vi.fn(), undefined]) {
                const { sent, postMessage } = stubExtension()
                const promise = send(onResponseProgress)
                await vi.waitFor(() => expect(sent()).toBeDefined())
                reply({ event: 'responseHead', eventId: sent().eventId, eventData: head })
                reply({ event: 'responseData', eventId: sent().eventId, eventData: jsonBody })
                // the extension stopping before the end sends no timings
                reply({ event: 'responseBodyError', eventId: sent().eventId, eventData: onResponseProgress ? { message: 'network error', timeTaken: 30, bodyTimeTaken: 25 } : { message: 'network error' } })

                if(onResponseProgress) {
                    const response = await promise
                    expect(response).toMatchObject({ bodyIncomplete: 'failed', timeTaken: 30, bodyTimeTaken: 25, headTimeTaken: 5 })
                    expect(new Uint8Array(response.buffer)).toEqual(jsonBody)
                    expect(consoleError).toHaveBeenCalledTimes(1)
                } else {
                    await expect(promise).rejects.toMatchObject({ message: 'network error' })
                }
                postMessage.mockRestore()
            }
        })

        test('a failure before the head rejects with the extension\'s error, as before', async() => {
            const { sent } = stubExtension()
            const promise = send(vi.fn())
            await vi.waitFor(() => expect(sent()).toBeDefined())
            reply({ event: 'responseError', eventId: sent().eventId, eventData: new Error('Failed to fetch') })
            await expect(promise).rejects.toMatchObject({ message: 'Failed to fetch' })
        })

        // the store keeps a tab's abort controller until its next send, so a handler left on its signal would keep the body
        test('a finished send leaves no handler on the signal, which would keep what arrived in memory', async() => {
            const { sent, posted } = stubExtension()
            const abortController = new AbortController()
            const promise = send(vi.fn(), abortController.signal)
            await vi.waitFor(() => expect(sent()).toBeDefined())
            replyInParts(sent().eventId, jsonBody)
            await promise
            expect(abortController.signal.onabort).toBeNull()
            expect(messageListeners.size).toBe(0)

            abortController.abort()
            expect(posted.filter(message => message.event === 'cancelRequest')).toEqual([])
        })
    })

    describe('web-standalone', () => {
        const encodeFrame = (type: number, payload: Uint8Array) => {
            const frame = new Uint8Array(5 + payload.byteLength)
            frame[0] = type
            new DataView(frame.buffer).setUint32(1, payload.byteLength)
            frame.set(payload, 5)
            return frame
        }
        const jsonFrame = (type: number, value: unknown) => encodeFrame(type, encoder.encode(JSON.stringify(value)))

        // a mimeType taken from the header as is, not as a blob gives it, would differ
        const head = { status: 200, statusText: 'OK', headers: [['content-type', 'Application/JSON; Charset=UTF-8']], headTimeTaken: 5, requestHeadersSent: [['accept', '*/*']] }
        // as main and the server send it, with no mimeType, which the UI works out from the head
        const end = { timeTaken: 12, bodyTimeTaken: 7 }
        const mimeType = 'application/json;charset=utf-8'

        const framesReply = (bytes: Uint8Array) => concat([
            jsonFrame(1, head),
            ...unevenChunks(bytes).map(chunk => encodeFrame(2, chunk)),
            jsonFrame(3, end),
        ])

        const framesResponse = (body: ReadableStream<Uint8Array>) => new Response(body, { headers: { 'content-type': 'application/vnd.restfox.proxy-frames', 'cache-control': 'no-cache, no-transform' } })
        const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=utf-8' } })

        // the JSON envelope every server sends without the stream flag, and older servers always
        const envelope = (bytes: Uint8Array) => ({ event: 'response', eventData: { ...head, mimeType, buffer: Array.from(bytes), timeTaken: end.timeTaken, bodyTimeTaken: end.bodyTimeTaken } })
        const bufferedResult = (bytes: Uint8Array) => ({ ...head, mimeType, buffer: new Uint8Array(bytes).buffer, timeTaken: end.timeTaken, bodyTimeTaken: end.bodyTimeTaken })

        let proxyReplies: ((init: FetchInitWithSignal & { headers: Record<string, string> }) => Response)[]
        let proxyRequests: { headers: Record<string, string> }[]
        let caRegistrations: number

        beforeEach(async() => {
            vi.stubEnv('MODE', 'web-standalone')
            await saveCACertificates(null)
            proxyReplies = []
            proxyRequests = []
            caRegistrations = 0
            vi.stubGlobal('fetch', async(input: string, init: FetchInitWithSignal & { headers: Record<string, string> }) => {
                if(input === '/proxy-ca-certificates') {
                    caRegistrations++
                    return jsonResponse({ id: `ca-${caRegistrations}` })
                }
                proxyRequests.push(init)
                return proxyReplies.shift()!(init)
            })
        })

        afterEach(async() => {
            vi.unstubAllEnvs()
            await saveCACertificates(null)
        })

        test('asks for frames, and a frames reply split at every byte offset gives exactly what the JSON reply gave, with or without a handler', async() => {
            for(const bytes of [jsonBody, allByteValues]) {
                proxyReplies.push(() => jsonResponse(envelope(bytes)))
                const expected = await fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags())
                expect(expected).toEqual(bufferedResult(bytes))

                const reply = framesReply(bytes)
                for(let offset = 0; offset <= reply.byteLength; offset++) {
                    const handler = offset % 2 === 0 ? vi.fn() : undefined
                    proxyReplies.push(() => framesResponse(closedBody([reply.subarray(0, offset), reply.subarray(offset)].filter(part => part.byteLength > 0))))
                    const response = await fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(), handler)
                    expect(Object.keys(response).sort()).toEqual(Object.keys(expected).sort())
                    expect(response).toEqual(expected)
                    expect(new Uint8Array(response.buffer)).toEqual(bytes)
                    if(handler) {
                        expect(handler.mock.calls[0][0]).toEqual({ type: 'head', head })
                        expect(progressBytes(handler)).toEqual(bytes)
                    }
                }
            }
            expect(proxyRequests.every(request => request.headers['x-proxy-flag-stream'] === '1')).toBe(true)
        })

        test('certificates the restarted server forgot are registered again, then the frames are read', async() => {
            await saveCACertificates({ fileName: 'ca.pem', certificates: '-----BEGIN CERTIFICATE-----\nwp3\n-----END CERTIFICATE-----\n' })
            proxyReplies.push(() => jsonResponse({ event: 'caCertificatesNotFound' }))
            proxyReplies.push(() => framesResponse(closedBody([framesReply(jsonBody)])))

            const response = await fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(), vi.fn())

            expect(response).toEqual(bufferedResult(jsonBody))
            expect(caRegistrations).toBe(2)
            expect(proxyRequests.map(request => request.headers['x-proxy-flag-ca-certificates-id'])).toEqual(['ca-1', 'ca-2'])
        })

        test('a failure before the head is still the JSON responseError', async() => {
            proxyReplies.push(() => jsonResponse({ event: 'responseError', eventData: 'fetch failed: getaddrinfo ENOTFOUND' }))
            await expect(fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(), vi.fn())).rejects.toMatchObject({ message: 'fetch failed: getaddrinfo ENOTFOUND' })
        })

        test('an error frame from the server\'s timeout keeps what arrived, marked timedOut, and is a TimeoutError without a handler', async() => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
            const reply = () => framesResponse(closedBody([concat([jsonFrame(1, head), encodeFrame(2, sseChunk), jsonFrame(4, { message: 'Request timed out after 100 ms', timedOut: true })])]))

            proxyReplies.push(reply)
            const response = await fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(100), vi.fn())
            expect(response.bodyIncomplete).toBe('timedOut')
            expect(new Uint8Array(response.buffer)).toEqual(sseChunk)
            expect(consoleError).not.toHaveBeenCalled()

            proxyReplies.push(reply)
            await expect(fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(100))).rejects.toMatchObject({ name: 'TimeoutError' })
        })

        test('an error frame from a failed upstream, or a reply that stops without one, is failed with one line in Logs', async() => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

            proxyReplies.push(() => framesResponse(closedBody([concat([jsonFrame(1, head), encodeFrame(2, sseChunk), jsonFrame(4, { message: 'terminated: other side closed', timedOut: false })])])))
            const failed = await fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(), vi.fn())
            expect(failed.bodyIncomplete).toBe('failed')
            expect(new Uint8Array(failed.buffer)).toEqual(sseChunk)
            expect(consoleError).toHaveBeenCalledTimes(1)

            proxyReplies.push(() => framesResponse(closedBody([concat([jsonFrame(1, head), encodeFrame(2, sseChunk)])])))
            const truncated = await fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags(), vi.fn())
            expect(truncated.bodyIncomplete).toBe('failed')
            expect(consoleError).toHaveBeenCalledTimes(2)

            proxyReplies.push(() => framesResponse(closedBody([concat([jsonFrame(1, head), jsonFrame(4, { message: 'terminated: other side closed', timedOut: false })])])))
            await expect(fetchWrapper(requestUrl, 'GET', {}, null, new AbortController().signal, fetchFlags())).rejects.toMatchObject({ message: 'terminated: other side closed' })
        })

        test('a cancel while frames arrive keeps what arrived, marked cancelled', async() => {
            proxyReplies.push(init => framesResponse(openBody([concat([jsonFrame(1, head), encodeFrame(2, sseChunk)])], init.signal)))
            const abortController = new AbortController()
            const onResponseProgress = vi.fn((progress: { type: string }) => {
                if(progress.type === 'data') {
                    abortController.abort()
                }
            })

            const response = await fetchWrapper(requestUrl, 'GET', {}, null, abortController.signal, fetchFlags(), onResponseProgress)

            expect(response.bodyIncomplete).toBe('cancelled')
            expect(new Uint8Array(response.buffer)).toEqual(sseChunk)
        })

        test('a body cut short counts its time from the send, the wait for the upstream head included, as the other transports do', async() => {
            vi.useFakeTimers()
            try {
                // the server answers once the upstream head arrived, 3 s after the send
                const slowHead = { ...head, headTimeTaken: 3000 }
                proxyReplies.push(init => new Promise<Response>(resolve => {
                    setTimeout(() => resolve(framesResponse(openBody([concat([jsonFrame(1, slowHead), encodeFrame(2, sseChunk)])], init.signal))), 3000)
                }) as unknown as Response)
                const abortController = new AbortController()
                const promise = fetchWrapper(requestUrl, 'GET', {}, null, abortController.signal, fetchFlags(), vi.fn())

                await vi.advanceTimersByTimeAsync(8000)
                abortController.abort()
                const response = await promise

                expect(response.bodyIncomplete).toBe('cancelled')
                expect(response.headTimeTaken).toBe(3000)
                expect(response.timeTaken).toBe(8000)
            } finally {
                vi.useRealTimers()
            }
        })
    })

    describe('handleRequest', () => {
        const request = (fields: Partial<CollectionItem> = {}) => ({ _id: 'r', _type: 'request', workspaceId: 'w', parentId: null, name: 'Request', method: 'GET', url: 'https://example.test/', ...fields }) as CollectionItem
        const script = (postRequest: string) => ({ _id: 'p', type: 'script', name: 'script', code: { pre_request: '', post_request: postRequest }, workspaceId: null, collectionId: 'r', enabled: true, createdAt: 0, updatedAt: 0 })
        // getBodyJSON gives undefined for a body that is not JSON, such as half of one
        const testsAndJSON = `test('status', () => expect(rf.response.getStatusCode()).to.equal(200))\nrf.response.getBodyJSON().choices.length`

        // cancels the send once the first chunk arrived, leaving a partial response
        const sendCancelledAfterFirstChunk = (fields: Partial<CollectionItem>, plugins: unknown[]) => {
            stubOpenBody([sseChunk])
            const abortController = new AbortController()
            const onResponseProgress = vi.fn((progress: { type: string }) => {
                if(progress.type === 'data') {
                    abortController.abort()
                }
            })
            return handleRequest(request(fields), {}, {}, undefined, async() => undefined, plugins as any, null, abortController.signal, fetchFlags(), onResponseProgress) as Promise<RequestFinalResponse>
        }

        test('scripts run on a partial body, and one that fails on it is a failed test with one line in Logs, the received bytes kept', async() => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

            const response = await sendCancelledAfterFirstChunk({}, [script(testsAndJSON)])

            expect(response.bodyIncomplete).toBe('cancelled')
            expect(response.status).toBe(200)
            expect(new Uint8Array(response.buffer)).toEqual(sseChunk)
            expect(response.testResults).toHaveLength(2)
            expect(response.testResults[0]).toEqual({ description: 'status', passed: true })
            expect(response.testResults[1]).toMatchObject({ passed: false, description: expect.stringContaining('Error in Plugin "Script: Post Request"') })
            expect(response.testResults[1].error).toContain('TypeError')
            expect(consoleError).toHaveBeenCalledTimes(1)
        })

        test('a stream a newer Send replaced runs no scripts, since it is thrown away and must not set a variable the new send reads', async() => {
            stubOpenBody([sseChunk])
            const abortController = new AbortController()
            const setEnvironmentVariable = vi.fn(async() => undefined)

            const response = await handleRequest(request(), {}, {}, undefined, setEnvironmentVariable, [script(`rf.setEnvVar('lastId', '1')`)] as any, null, abortController.signal, fetchFlags(), (progress: { type: string }) => {
                if(progress.type === 'data') {
                    markSendReplaced(abortController.signal)
                    abortController.abort()
                }
            }) as RequestFinalResponse

            expect(response.bodyIncomplete).toBe('cancelled')
            expect(setEnvironmentVariable).not.toHaveBeenCalled()
        })

        test('a body cut short that is not a stream runs no scripts, as before, so none sets a variable from half of it', async() => {
            stubOpenBody([new TextEncoder().encode('{"tok')], 'application/json')
            const abortController = new AbortController()
            const setEnvironmentVariable = vi.fn(async() => undefined)

            const response = await handleRequest(request(), {}, {}, undefined, setEnvironmentVariable, [script(`rf.setEnvVar('token', rf.response.getBodyText())\ntest('ran', () => expect(1).to.equal(1))`)] as any, null, abortController.signal, fetchFlags(), (progress: { type: string }) => {
                if(progress.type === 'data') {
                    abortController.abort()
                }
            }) as RequestFinalResponse

            expect(response.bodyIncomplete).toBe('cancelled')
            expect(new TextDecoder().decode(response.buffer)).toBe('{"tok')
            expect(setEnvironmentVariable).not.toHaveBeenCalled()
            expect(response.testResults).toEqual([])
        })

        test('a script that fails on a complete body still gives the error, as before', async() => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined)
            vi.stubGlobal('fetch', async() => new Response(closedBody([sseChunk]), { headers: { 'content-type': 'text/event-stream' } }))

            const response = await handleRequest(request(), {}, {}, undefined, async() => undefined, [script(testsAndJSON)] as any, null, new AbortController().signal, fetchFlags(), vi.fn())

            expect(response).toMatchObject({ status: null, statusText: 'Error', error: expect.stringContaining('Error in Plugin "Script: Post Request"') })
        })

        test('a complete stream runs the scripts and is saved without bodyIncomplete', async() => {
            vi.stubGlobal('fetch', async() => new Response(closedBody(unevenChunks(sseChunk)), { headers: { 'content-type': 'text/event-stream' } }))

            const response = await handleRequest(request(), {}, {}, undefined, async() => undefined, [script(`test('body', () => expect(rf.response.getBodyText()).to.equal('data: {"a":1}\\n\\n'))`)] as any, null, new AbortController().signal, fetchFlags(), vi.fn()) as RequestFinalResponse

            expect(response.testResults).toEqual([{ description: 'body', passed: true }])
            expect('bodyIncomplete' in response).toBe(false)
            expect(new Uint8Array(response.buffer)).toEqual(sseChunk)
        })

        // the store keeps the loading overlay for a body that ends at once, while scripts that take long still run
        test('the end of the body is told before the scripts run, for a body cut short too', async() => {
            vi.stubGlobal('fetch', async() => new Response(closedBody([jsonBody]), { headers: { 'content-type': 'application/json' } }))
            const order: string[] = []
            const setEnvironmentVariable = async() => {
                order.push('script')
            }
            const plugins = [script(`rf.setEnvVar('seen', '1')`)] as any

            await handleRequest(request(), {}, {}, undefined, setEnvironmentVariable, plugins, null, new AbortController().signal, fetchFlags(), (progress: { type: string }) => order.push(progress.type))
            expect(order).toEqual(['head', 'data', 'end', 'script'])

            order.length = 0
            stubOpenBody([sseChunk])
            const abortController = new AbortController()
            const partial = await handleRequest(request(), {}, {}, undefined, setEnvironmentVariable, plugins, null, abortController.signal, fetchFlags(), (progress: { type: string }) => {
                order.push(progress.type)
                if(progress.type === 'data') {
                    abortController.abort()
                }
            })
            expect(partial).toMatchObject({ bodyIncomplete: 'cancelled' })
            expect(order).toEqual(['head', 'data', 'end', 'script'])
        })

        test('a partial send still leaves out what a masked prompt went into', async() => {
            (window as any).createPrompt = vi.fn(async() => 's3cret')
            try {
                const response = await sendCancelledAfterFirstChunk({ headers: [{ name: 'Authorization', value: `Bearer {% prompt(title='Token', mask=1) %}` }, { name: 'X-Trace', value: 't1' }] }, [])

                expect(response.bodyIncomplete).toBe('cancelled')
                expect(response.request.headers.Authorization).toBeUndefined()
                expect(response.request.headers['X-Trace']).toBe('t1')
                expect(response.request.maskedPromptOmitted).toEqual({ reason: 'masked-field', url: false, headerNames: ['Authorization'], body: false })
                expect(JSON.stringify(response)).not.toContain('s3cret')
            } finally {
                delete (window as any).createPrompt
            }
        })
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
        return createRequestData(state, request, environment, {}, undefined, null, [], null, new SendResolver((request).workspaceId, 'send'))
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
        return createRequestData(state, request, {}, {}, parentAuthentication, null, [], null, new SendResolver((request).workspaceId, 'send'))
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
        return createRequestData(state, request(fields), environment, parentHeaders, parentAuthentication, null, [], null, new SendResolver((request(fields)).workspaceId, 'send'))
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

    test('an aborted schema fetch asks no further prompt after a request field waits', async() => {
        forgetPromptValues()
        let answerFirst!: (value: string) => void
        let promptOpened!: () => void
        const opened = new Promise<void>(resolve => {
            promptOpened = resolve
        })
        window.createPrompt = vi.fn((title: string) => {
            if(title === 'First header') {
                return new Promise<string>(resolve => {
                    answerFirst = resolve
                    promptOpened()
                })
            }
            return Promise.resolve('later')
        })
        vi.stubGlobal('fetch', vi.fn(async() => new Response(JSON.stringify({ data: { __schema: { types } } }))))
        const controller = new AbortController()
        const result = fetchGraphQLSchema(request({ headers: [
            { name: 'X-First', value: `{% prompt(title='First header') %}` },
            { name: 'X-Later', value: `{% prompt(title='Later header') %}` },
        ] }), {}, {}, undefined, controller.signal, flags).catch(error => error)
        await opened
        controller.abort()
        answerFirst('first')
        const error = await result
        expect(window.createPrompt).toHaveBeenCalledOnce()
        expect(error).toMatchObject({ message: 'The send was stopped' })
        expect(fetch).not.toHaveBeenCalled()
        delete (window as any).createPrompt
        forgetPromptValues()
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
        ]
        const [restfoxFolder] = await convertInsomniaFileToRestfoxCollection({ resources }, 'w')
        expect(restfoxFolder.children!.map(item => item.name)).toEqual(['Request'])
    })

    const fixture = (name: string) => readFile(path.join(process.cwd(), 'test-data', 'insomnia-import', name), 'utf-8')

    test('a v4 gRPC request keeps its method and message, and its proto file with the rest of the folder tree it was added in', async() => {
        const json = JSON.parse(await fixture('grpc-proto-directories.v4.json'))
        const [workspaceFolder] = await convertInsomniaFileToRestfoxCollection(json, 'w')
        const grpcFolder = workspaceFolder.children!.find(item => item.name === 'template-connect-go_grpc')!
        const httpFolder = workspaceFolder.children!.find(item => item.name === 'template-connect-go_http')!

        expect(httpFolder.children!.map(item => item._type)).toEqual(['request', 'request'])

        const greet = grpcFolder.children!.find(item => item.name === 'GreetHandler')!
        expect(greet).toMatchObject({
            _type: 'grpc',
            url: 'localhost:9090',
            grpc: { service: 'greet.v1.GreetService', method: 'Greet' },
            body: { mimeType: 'application/json', text: '{\n    "name": "World"\n}' },
            headers: [],
            authentication: { type: 'none' },
            parentId: grpcFolder._id,
            workspaceId: 'w',
        })
        // paths leave out the top folder, as Insomnia compiles them from inside it, and the request's file comes first
        expect(greet.grpc!.protoFiles!.map(file => file.path)).toEqual(['greet/v1/greet.proto', 'templateconnectgo/v1/store.proto'])
        expect(greet.grpc!.protoFiles![0].text).toMatch(/^syntax = "proto3";\n\npackage greet\.v1;/)

        const store = grpcFolder.children!.find(item => item.name === 'StoreListHandler')!
        expect(store.grpc).toMatchObject({ service: 'templateconnectgo.v1.StoreService', method: 'ListStores' })
        expect(store.grpc!.protoFiles!.map(file => file.path)).toEqual(['templateconnectgo/v1/store.proto', 'greet/v1/greet.proto'])
        expect(store.body!.text).toContain('"search_query": "\u7530"')
    })

    test('a v4 gRPC request keeps its metadata as headers, disabled ones too, and its description', async() => {
        const json = JSON.parse(await fixture('grpc-metadata-and-http.v4.json'))
        const [workspaceFolder] = await convertInsomniaFileToRestfoxCollection(json, 'w')
        const items: CollectionItem[] = flattenTree([workspaceFolder])
        const createBucket = items.find(item => item.name === 'CreateBucket')!

        expect(createBucket).toMatchObject({
            _type: 'grpc',
            url: '{{ _.grpc_url }}',
            grpc: { service: 'apollostorage.grpc.ObjectApi', method: 'CreateBucket' },
            headers: [{ name: 'authorization', value: 'Bearer {{ _.auth_token }}', description: 'Enable when the server has AUTH_ENABLED=true.', disabled: true }],
        })
        expect(createBucket.description).toMatch(/^Create a bucket/)
        // a file added on its own is compiled by its name
        expect(createBucket.grpc!.protoFiles!.map(file => file.path)).toEqual(['object_api.proto'])
        expect(items.filter(item => item._type === 'grpc')).toHaveLength(8)
        expect(items.filter(item => item._type === 'request')).toHaveLength(14)
    })

    test('a v5 gRPC request keeps its method and message, and uses server reflection as v5 leaves its proto file out', async() => {
        const [workspaceFolder] = await convertInsomniaFileToRestfoxCollection(file(await fixture('grpc.v5.yaml')), 'w')
        const items = workspaceFolder.children!

        expect(items.map(item => [item._type, item.name, item.grpc?.service, item.grpc?.method])).toEqual([
            ['grpc', 'CreateShipment', 'shipment.v1.ShipmentService', 'CreateShipment'],
            ['grpc', 'GetShipment', 'shipment.v1.ShipmentService', 'GetShipment'],
            ['grpc', 'AddShipmentStatusEvent - Picked Up', 'shipment.v1.ShipmentService', 'AddShipmentStatusEvent'],
            ['grpc', 'GetShipmentHistory', 'shipment.v1.ShipmentService', 'GetShipmentHistory'],
            ['grpc', 'AddShipmentStatusEvent - In Transit', 'shipment.v1.ShipmentService', 'AddShipmentStatusEvent'],
            ['grpc', 'AddShipmentStatusEvent - Delivered', 'shipment.v1.ShipmentService', 'AddShipmentStatusEvent'],
            ['grpc', 'AddShipmentStatusEvent - Cancelled', 'shipment.v1.ShipmentService', 'AddShipmentStatusEvent'],
        ])
        expect(items[1]).toMatchObject({ name: 'GetShipment', url: 'localhost:8080', body: { mimeType: 'application/json', text: '{\n  "reference_number": "REF-001"\n}' }, headers: [], authentication: { type: 'none' } })
        expect(items.every(item => item.grpc!.protoFiles === undefined)).toBe(true)
    })

    test('a gRPC message goes through the converter the Import dialog gives, with its method and .proto files, and stays as written when that fails or there are no .proto files', async() => {
        const exported = JSON.parse(await fixture('grpc-address-in-environment.v4.json'))
        const convert = vi.fn(async({ method, text }: { method: string, text: string }) => method === 'EliminarTarea' ? Promise.reject(new Error('no such method')) : `converted ${text}`)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        try {
            const items = (flattenTree(await convertInsomniaFileToRestfoxCollection(exported, 'w', convert)) as CollectionItem[]).filter(item => item._type === 'grpc')
            const written = (name: string) => exported.resources.find((resource: any) => resource.name === name).body.text
            const patch = items.find(item => item.name === 'ModificarTarea (PATCH)')!
            expect(patch.body!.text).toBe(`converted ${written('ModificarTarea (PATCH)')}`)
            expect(convert).toHaveBeenCalledWith({ protoFiles: patch.grpc!.protoFiles, service: 'tareas.ServicioTareas', method: 'ModificarTarea', text: written('ModificarTarea (PATCH)') })
            expect(items.find(item => item.name === 'EliminarTarea')!.body!.text).toBe(written('EliminarTarea'))
            expect(warn).toHaveBeenCalledWith('EliminarTarea: its message is kept as Insomnia wrote it, as it could not be read with its .proto files: no such method')
        } finally {
            warn.mockRestore()
        }

        convert.mockClear()
        const withoutProtoFiles = { _id: 'greq_1', _type: 'grpc_request', parentId: '__WORKSPACE_ID__', name: 'Call', url: 'grpc://localhost:50051', protoMethodName: '/demo.v1.Demo/SayHello', metadata: [], body: { text: '{"name": {"value": "x"}}' } }
        const [call] = await convertInsomniaFileToRestfoxCollection({ resources: [withoutProtoFiles] }, 'w', convert)
        expect(call.body!.text).toBe('{"name": {"value": "x"}}')
        expect(convert).not.toHaveBeenCalled()
    })

    test('a gRPC address with no scheme, which Insomnia calls without TLS, gets grpc:// where Restfox would use TLS', async() => {
        const unspecified = (flattenTree(await convertInsomniaFileToRestfoxCollection(JSON.parse(await fixture('grpc-unspecified-address.v4.json')), 'w')) as CollectionItem[])
            .filter(item => item._type === 'grpc')
        expect(unspecified).toHaveLength(6)
        expect(unspecified.every(item => item.url === 'grpc://0.0.0.0:50051')).toBe(true)

        // an address that starts with a variable is left as it is, its value is set in Restfox
        const inEnvironment = (flattenTree(await convertInsomniaFileToRestfoxCollection(JSON.parse(await fixture('grpc-address-in-environment.v4.json')), 'w')) as CollectionItem[])
            .filter(item => item._type === 'grpc')
        expect(inEnvironment).toHaveLength(8)
        expect(inEnvironment.every(item => item.url === '{{ _.grpc_server }}')).toBe(true)
        expect(inEnvironment[0].grpc).toMatchObject({ service: 'tareas.ServicioTareas', method: 'ListarTareas' })

        const grpcRequest = (url: string) => ({ _id: 'greq_1', _type: 'grpc_request', parentId: '__WORKSPACE_ID__', name: 'Call', url, protoMethodName: '', metadata: [], body: { text: '{}' } })
        const urlOf = async(url: string) => (await convertInsomniaFileToRestfoxCollection({ resources: [grpcRequest(url)] }, 'w'))[0].url
        expect(await urlOf('https://api.example.com')).toBe('grpc://api.example.com:443')
        expect(await urlOf('HTTPS://api.example.com:8443')).toBe('grpc://api.example.com:8443')
        expect(await urlOf('api.example.com:{{ _.port }}')).toBe('grpc://api.example.com:{{ _.port }}')
        // with no port Insomnia calls 443, where Restfox would call 80 without TLS
        expect(await urlOf('localhost')).toBe('grpc://localhost:443')
        expect(await urlOf('grpc://myserver/')).toBe('grpc://myserver:443/')
        // a variable in the host may hold the port, so none is added
        expect(await urlOf('grpc://{{ _.host }}')).toBe('grpc://{{ _.host }}')
        // ones Restfox also calls without TLS, or with TLS as Insomnia does, stay as they are
        expect(await urlOf('localhost:{{ _.port }}')).toBe('localhost:{{ _.port }}')
        expect(await urlOf('http://localhost:50051')).toBe('http://localhost:50051')
        expect(await urlOf('grpcs://api.example.com')).toBe('grpcs://api.example.com')
        expect(await urlOf('{{ _.host }}:50051')).toBe('{{ _.host }}:50051')
        expect(await urlOf('unix:/tmp/grpc.sock')).toBe('unix:/tmp/grpc.sock')
    })

    test('a gRPC request with no method or proto file chosen imports with none', async() => {
        const resources = [{ _id: 'greq_1', _type: 'grpc_request', parentId: '__WORKSPACE_ID__', name: 'New gRPC Request', url: '', protoFileId: '', protoMethodName: '', metadata: [], body: { text: '{}' } }]
        const [item] = await convertInsomniaFileToRestfoxCollection({ resources }, 'w')
        expect(item).toMatchObject({ _type: 'grpc', parentId: null, url: '', grpc: {}, body: { mimeType: 'application/json', text: '{}' } })
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

    const grpcItem: CollectionItem = { _id: 'g', _type: 'grpc', parentId: 'f', workspaceId: 'w', name: 'Say Hello', url: 'localhost:50051', grpc: { service: 'demo.v1.Demo', method: 'SayHello', protoFiles: [{ path: 'demo/v1/demo.proto', text: 'syntax = "proto3";' }] }, body: { mimeType: 'application/json', text: '{"name":"a"}' }, headers: [{ name: 'x-key', value: 'k' }], authentication: { type: 'bearer', token: 't' }, description: 'grpc docs', sortOrder: 1 }

    test('a gRPC item is imported whole', () => {
        const { newCollectionTree } = importInto([folder, grpcItem])
        expect(newCollectionTree[0].children![0]).toEqual({ ...grpcItem, workspaceId: 'w2' })
    })

    test('a gRPC item with only the fields an older export could hold imports as it was', () => {
        const { newCollectionTree } = importInto([{ _id: 'g', _type: 'grpc', parentId: null, workspaceId: 'w', name: 'g' }])
        expect(newCollectionTree[0]).toEqual({ _id: 'g', _type: 'grpc', parentId: null, workspaceId: 'w2', name: 'g' })
    })

    test('an item of a type only a newer version knows is imported whole, an HTTP request still as before', () => {
        const newer = { _id: 'n', _type: 'newer-kind', parentId: null, workspaceId: 'w', name: 'From Later', settings: { deep: [1, 2] } } as unknown as CollectionItem
        const { newCollectionTree } = importInto([newer, { ...request, parentId: null, extra: 'dropped' } as unknown as CollectionItem])
        expect(newCollectionTree.find(item => item._id === 'n')).toEqual({ ...newer, workspaceId: 'w2' })
        expect(newCollectionTree.find(item => item._id === 'r')).not.toHaveProperty('extra')
    })

    test('Postman and Insomnia exports leave gRPC items out', async() => {
        const collection = prepareCollectionForExport([folder, { ...request, body: { mimeType: 'application/json', text: '{}' } }, grpcItem], [], false)
        expect(JSON.stringify(await convertCollectionsFromRestfoxToPostman(collection))).not.toContain('Say Hello')
        const insomniaExport = await convertCollectionsFromRestfoxToInsomnia(collection)
        expect(insomniaExport.resources.map((resource: any) => resource._type)).toEqual(['workspace', 'request_group', 'request'])
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

describe('gRPC items', () => {
    const grpcItem = (fields: Partial<CollectionItem> = {}) => ({ _id: 'g', _type: 'grpc', workspaceId: 'w', parentId: null, name: 'Say Hello', url: '{{ host }}:50051', grpc: { service: 'demo.v1.Demo', method: 'SayHello' }, body: { mimeType: 'application/json', text: '{"name": "{{ name }}"}' }, headers: [{ name: 'x-key', value: '{{ key }}' }, { name: 'x-off', value: 'no', disabled: true }], ...fields }) as CollectionItem
    const environment = { host: 'localhost', name: 'Restfox', key: 'k1' }

    test('a send resolves the address, the message and the metadata, with the folders\' headers and auth', async() => {
        const resolved = await createGrpcRequestData(grpcItem(), environment, { 'x-folder': ['f'] }, { type: 'bearer', token: 'folder-token' }, null)
        expect(resolved).toEqual({
            url: 'localhost:50051',
            message: '{"name": "Restfox"}',
            metadata: [['x-key', 'k1'], ['x-folder', 'f'], ['Authorization', 'Bearer folder-token']],
        })
    })

    test('a send with no message sends the empty message', async() => {
        const resolved = await createGrpcRequestData(grpcItem({ body: undefined, headers: undefined }), {}, {}, undefined, null)
        expect(resolved).toEqual({ url: '{{ host }}:50051', message: '{}', metadata: [] })
    })

    const plaintext = { address: 'localhost:50051', tls: false }

    test('Copy as grpcurl names the server, the method, the metadata and the message', () => {
        expect(generateGrpcurlCommand(grpcItem(), { target: plaintext, metadata: [['x-key', 'k1'], ['Authorization', 'Bearer t']], message: '{"name": "it\'s"}', disableSSLVerification: false }))
            .toBe('grpcurl -plaintext -H \'x-key: k1\' -H \'Authorization: Bearer t\' -d \'{"name": "it\'\\\'\'s"}\' localhost:50051 demo.v1.Demo/SayHello')
    })

    test('Copy as grpcurl gives each value of a -bin name its own -H, as the call sends them, and keeps text values joined', () => {
        expect(generateGrpcurlCommand(grpcItem(), { target: plaintext, metadata: [['Trace-Bin', 'YQ==, Yg=='], ['x-list', 'a, b']], message: '', disableSSLVerification: false }))
            .toBe('grpcurl -plaintext -H \'Trace-Bin: YQ==\' -H \'Trace-Bin: Yg==\' -H \'x-list: a, b\' localhost:50051 demo.v1.Demo/SayHello')
    })

    test('Copy as grpcurl uses TLS unless the address is plaintext, and skips verification only when Settings do', () => {
        const tls = { address: 'api.example.com:443', tls: true }
        expect(generateGrpcurlCommand(grpcItem(), { target: tls, metadata: [], message: '', disableSSLVerification: false })).toBe('grpcurl api.example.com:443 demo.v1.Demo/SayHello')
        expect(generateGrpcurlCommand(grpcItem(), { target: tls, metadata: [], message: '', disableSSLVerification: true })).toBe('grpcurl -insecure api.example.com:443 demo.v1.Demo/SayHello')
        expect(generateGrpcurlCommand(grpcItem(), { target: plaintext, metadata: [], message: '', disableSSLVerification: true })).toBe('grpcurl -plaintext localhost:50051 demo.v1.Demo/SayHello')
    })

    test('Copy as grpcurl names the proto files the user keeps beside it, and leaves out metadata gRPC sets itself', () => {
        const item = grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'SayHello', protoFiles: [{ path: 'demo/v1/demo.proto', text: '' }, { path: 'my protos/types.proto', text: '' }] } })
        expect(generateGrpcurlCommand(item, { target: { address: '[::1]:50051', tls: false }, metadata: [['Content-Type', 'application/json'], ['te', 'trailers']], message: '{}', disableSSLVerification: false }))
            .toBe('grpcurl -plaintext -d \'{}\' -import-path . -proto demo/v1/demo.proto -proto \'my protos/types.proto\' \'[::1]:50051\' demo.v1.Demo/SayHello')
    })

    test('Copy as grpcurl names each proto file by the path its imports use, from the folder they are found in', () => {
        const demo = 'syntax = "proto3";\npackage demo.v1;\nimport "demo/v1/types.proto";\nimport "google/protobuf/empty.proto";\n'
        const call = (protoFiles: { path: string, text: string }[]) => generateGrpcurlCommand(
            grpcItem({ grpc: { service: 'demo.v1.Demo', method: 'SayHello', protoFiles } }),
            { target: plaintext, metadata: [], message: '', disableSSLVerification: false },
        )

        // a folder picked above the folder the imports start from
        expect(call([{ path: 'protos/demo/v1/demo.proto', text: demo }, { path: 'protos/demo/v1/types.proto', text: '' }]))
            .toBe('grpcurl -plaintext -import-path protos -proto demo/v1/demo.proto -proto demo/v1/types.proto localhost:50051 demo.v1.Demo/SayHello')
        // files picked on their own, without the folders their imports name
        expect(call([{ path: 'demo.proto', text: demo }, { path: 'types.proto', text: '' }]))
            .toBe('grpcurl -plaintext -import-path . -proto demo.proto -proto demo/v1/types.proto localhost:50051 demo.v1.Demo/SayHello')
        // a folder picked at the folder the imports start from
        expect(call([{ path: 'demo/v1/demo.proto', text: demo }, { path: 'demo/v1/types.proto', text: '' }]))
            .toBe('grpcurl -plaintext -import-path . -proto demo/v1/demo.proto -proto demo/v1/types.proto localhost:50051 demo.v1.Demo/SayHello')
    })

    test('Copy as grpcurl leaves out the metadata a call leaves out', () => {
        const metadata: [string, string][] = [['grpc-timeout', '5S'], ['Keep-Alive', 'timeout=5'], [' :authority', 'x'], ['Transfer-Encoding', 'chunked'], ['x-kept', '1']]
        expect(generateGrpcurlCommand(grpcItem(), { target: plaintext, metadata, message: '', disableSSLVerification: false })).toBe('grpcurl -plaintext -H \'x-kept: 1\' localhost:50051 demo.v1.Demo/SayHello')
    })

    test('Copy as grpcurl gives a User-Agent row as -user-agent, as grpcurl drops a User-Agent -H, the last row as the call does', () => {
        const metadata: [string, string][] = [['User-Agent', 'first/1'], ['x-kept', '1'], [' user-agent ', 'my app/2']]
        expect(generateGrpcurlCommand(grpcItem(), { target: plaintext, metadata, message: '', disableSSLVerification: false }))
            .toBe('grpcurl -plaintext -H \'x-kept: 1\' -user-agent \'my app/2\' localhost:50051 demo.v1.Demo/SayHello')
    })

    test('Copy as grpcurl needs a method', () => {
        expect(() => generateGrpcurlCommand(grpcItem({ grpc: {} }), { target: plaintext, metadata: [], message: '', disableSSLVerification: false })).toThrow('Choose a method first')
    })
})

describe('Prompt tag', () => {
    const request = (fields: Partial<CollectionItem>) => ({ _id: 'r', _type: 'request', workspaceId: 'w', parentId: null, name: 'Request', method: 'GET', url: 'https://example.test/', ...fields }) as CollectionItem
    const prepare = (fields: Partial<CollectionItem>) => {
        const state: HandleRequestState = { currentPlugin: null, testResults: [] }
        return createRequestData(state, request(fields), {}, {}, undefined, null, [], null, new SendResolver((request(fields)).workspaceId, 'send'))
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
        await createRequestData({ currentPlugin: null, testResults: [] }, request({ headers: [{ name: 'X-Password', value: '{{PASSWORD}}' }] }), environment, {}, undefined, null, [], null, new SendResolver((request({ headers: [{ name: 'X-Password', value: '{{PASSWORD}}' }] })).workspaceId, 'send'))
        const other = await createRequestData({ currentPlugin: null, testResults: [] }, request({ _id: 'other', url: 'https://example.test/{{PASSWORD}}' }), environment, {}, undefined, null, [], null, new SendResolver((request({ _id: 'other', url: 'https://example.test/{{PASSWORD}}' })).workspaceId, 'send'))
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
        expect(await substituteEnvironmentVariables({}, once, 'display', { workspaceId: 'w' })).toBe('prod-pass')
        expect(await substituteEnvironmentVariables({}, once, 'display', { workspaceId: 'other' })).toBe('d')
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
        const preview = (tag: string) => substituteEnvironmentVariables({}, tag, 'display', { noError: true })
        expect(await preview(`{% prompt(title='Id', defaultValue='7') %}`)).toBe('7')
        expect(await preview(`{% prompt(title='Password', defaultValue='x', mask=1) %}`)).toBe('******')
        expect(createPrompt).not.toHaveBeenCalled()
    })

    test('only a send asks, a text resolved outside one shows the preview value even when tags are run', async() => {
        expect(await substituteEnvironmentVariables({}, `{% prompt(title='Id', defaultValue='7') %}`, 'display')).toBe('7')
        expect(await substituteEnvironmentVariables({}, `{% prompt(title='Password', defaultValue='x', mask=1) %}`, 'display')).toBe('******')
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

    test('a prompt waiting behind another box does not open once its send is stopped, unless another send waits for the same ask once prompt', async() => {
        const opened: string[] = []
        let answerFirst: (value: string) => void = () => undefined
        ;(window as any).createPrompt = vi.fn((title: string) => {
            opened.push(title)
            return title === 'First' ? new Promise(resolve => answerFirst = resolve) : Promise.resolve(`typed in ${title}`)
        })
        const stopped = new AbortController()
        const first = new SendResolver('w', 'send').resolve({}, `{% prompt(title='First') %}`, 'url')
        const waiting = new SendResolver('w', 'send', stopped.signal).resolve({}, `{% prompt(title='Waiting') %}`, 'url')
        const sharedByStopped = new SendResolver('w', 'send', stopped.signal).resolve({}, `{% prompt(title='Shared once', ask='once') %}`, 'url')
        const sharedByRunning = new SendResolver('w', 'send').resolve({}, `{% prompt(title='Shared once', ask='once') %}`, 'url')
        await new Promise(resolve => setTimeout(resolve))

        stopped.abort()
        answerFirst('a')
        expect(await first).toBe('a')
        await expect(waiting).rejects.toThrow('The send was stopped')
        expect(await sharedByRunning).toBe('typed in Shared once')
        await sharedByStopped.catch(() => undefined)
        expect(opened).toEqual(['First', 'Shared once'])
        forgetPromptValues()
    })

    test('a url left out goes from the sent headers too: HTTP/2 :path and :authority, and host', async() => {
        const response = { url: 'https://example.test/a', request: { method: 'GET', query: '?k=S3CRET', headers: {}, headersSent: [[':method', 'GET'], [':path', '/a?k=S3CRET'], [':authority', 'example.test'], [':scheme', 'https'], ['host', 'example.test'], ['x-trace', 't1']], body: null, original: {} } } as unknown as RequestFinalResponse
        answers = ['S3CRET']
        const urlSend = new SendResolver('w', 'send')
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
            maskedPromptUsed: true,
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
        const headerSend = new SendResolver('w', 'send')
        await headerSend.resolve({}, tag, { header: 'Authorization' })
        const saved = headerSend.omitMaskedPromptParts(response, request({ url: '{{BASE}}/a?q=1' }))
        expect(saved.request.headers).toEqual({ 'X-Trace': 't1' })
        expect(saved.request.headersSent).toEqual([['host', 'example.test'], ['x-trace', 't1']])
        expect([saved.url, saved.request.query, saved.request.body]).toEqual(['https://example.test/a', '?q=1', 'b'])
        const allSend = new SendResolver('w', 'send')
        await allSend.resolve({}, tag, 'url')
        await allSend.resolve({}, tag, 'body')
        const all = allSend.omitMaskedPromptParts(response, request({ url: '{{BASE}}/a?q=1' }))
        expect([all.url, all.request.query, all.request.body]).toEqual(['{{BASE}}/a?q=1', '', null])
        const unsavedSend = new SendResolver('w', 'send')
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

describe('humanFriendlyRunningTime', () => {
    test('moves by a tenth of a second per tick whatever the tick lands on, as the stopped time shows it', () => {
        // ticks of a little over 100 ms, as a timer lands
        expect([1404, 1505, 1606, 1707].map(humanFriendlyRunningTime)).toEqual(['1.4 s', '1.5 s', '1.6 s', '1.7 s'])
        expect([0, 305, 1000, 4250, 12_345, 65_400].map(humanFriendlyRunningTime)).toEqual(['0 ms', '300 ms', '1000 ms', '4.2 s', '12.3 s', '1.09 m'])
        expect([305, 4250, 65_400].map(humanFriendlyTime)).toEqual(['305 ms', '4.25 s', '1.09 m'])
    })
})

test('a script preparing disabled and unnamed response-tag headers never sends their dependencies', async() => {
    const originalWorkspace = requestStore.state.activeWorkspace
    const originalCollection = requestStore.state.collection
    requestStore.state.activeWorkspace = { _id: 'w' } as any
    requestStore.state.collection = [{ _id: 'login', _type: 'request', name: 'Login', workspaceId: 'w', parentId: null }]
    const fresh = { _id: 'fresh', collectionId: 'login', status: 200, statusText: 'OK', createdAt: Date.now(), headers: [['content-type', 'application/json']], buffer: new TextEncoder().encode('{"token":"fresh"}').buffer }
    const dispatch = vi.spyOn(requestStore, 'dispatch').mockResolvedValue(fresh)
    vi.mocked(getResponsesByCollectionId).mockResolvedValue([])
    const tag = `{% response(request='login', attribute='body', path='$.token', behavior='always') %}`
    const request: CollectionItem = { _id: 'r', _type: 'request', workspaceId: 'w', parentId: null, name: 'R', method: 'GET', url: 'https://example.test', headers: [{ name: 'X-Off', value: tag, disabled: true }, { name: '', value: tag }] }
    const script = { _id: 'script', type: 'script', name: null, workspaceId: null, collectionId: 'r', enabled: true, code: { pre_request: 'rf.request.getMethod()', post_request: '' } } as any
    try {
        await createRequestData({ currentPlugin: null, testResults: [] }, request, {}, {}, undefined, null, [script], null, new SendResolver('w', 'send'))
        expect(dispatch).not.toHaveBeenCalled()
        request.headers!.push({ name: 'X-Used', value: tag })
        const prepared = await createRequestData({ currentPlugin: null, testResults: [] }, request, {}, {}, undefined, null, [script], null, new SendResolver('w', 'send'))
        expect(prepared.headers['X-Used']).toBe('fresh')
        expect(dispatch).toHaveBeenCalledOnce()
    } finally {
        requestStore.state.activeWorkspace = originalWorkspace
        requestStore.state.collection = originalCollection
    }
})
