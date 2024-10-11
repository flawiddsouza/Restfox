// @vitest-environment edge-runtime

import { assert, test, describe, expect } from 'vitest'
import {
    substituteEnvironmentVariables,
    parseContentDispositionHeaderAndGetFileName,
    convertPostmanAuthToRestfoxAuth,
    scriptConversion,
    toTree,
    getSpaces
} from './helpers'

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

describe('convertPostmanAuthToRestfoxAuth', () => {
    test('should return No Auth when auth is not present', () => {
        const request = {}
        const result = convertPostmanAuthToRestfoxAuth(request)
        expect(result).toEqual({ type: 'No Auth' })
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
