import { assert, test, describe } from 'vitest'
import {
    substituteEnvironmentVariables,
    parseContentDispositionHeaderAndGetFileName,
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

    test('Positive Case', () => {
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
        assert.equal(substituteEnvironmentVariables(env, input), expectedOutput)

    })

    test('Negative Case', () => {
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

        assert.equal(substituteEnvironmentVariables(env, input), input)
        assert.equal(substituteEnvironmentVariables(env, extraForRegExSpecific), extraForRegExSpecific)

    })

    test('Insomnia support', () => {
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
        assert.equal(substituteEnvironmentVariables(env, input), expectedOutput)
    })

    test('Insomnia support will not be used if "_" is present as a key in "environment"', () => {
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
        assert.equal(substituteEnvironmentVariables(env, input), expectedOutput)
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
