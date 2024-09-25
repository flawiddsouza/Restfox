import { test, expect } from 'vitest'
import { tagRegex, parseFunction, toFunctionString } from './tag'

const sumInput = 'sum(a=1, b=2)'
const sumParsedResult = {
    functionName: 'sum',
    parameters: {
        a: 1,
        b: 2,
    },
}

test('parseFunction: sum', async() => {
    const input = sumInput
    const expectedOutput = sumParsedResult
    const output = parseFunction(input)
    expect(output).toEqual(expectedOutput)
})

test('toFunctionString: sum', async() => {
    const input = sumParsedResult
    const expectedOutput = sumInput
    const output = toFunctionString(input)
    expect(output).toBe(expectedOutput)
})

const responseInput = `response(request='xyz', path='abc', behavior='always')`
const responseParsedResult = {
    functionName: 'response',
    parameters: {
        request: 'xyz',
        path: 'abc',
        behavior: 'always',
    },
}

test('parseFunction: response', async() => {
    const input = responseInput
    const expectedOutput = responseParsedResult
    const output = parseFunction(input)
    expect(output).toEqual(expectedOutput)
})

test('toFunctionString: response', async() => {
    const input = responseParsedResult
    const expectedOutput = responseInput
    const output = toFunctionString(input)
    expect(output).toBe(expectedOutput)
})

test('tagRegex', async() => {
    const input = `{% response( %}{% response() %}{% r %}{% response(path="100",cat="436") %} {% faker() %}{% base64() %}`

    const expectedMatches = [
        '{% response() %}',
        'response()',
        '{% response(path="100",cat="436") %}',
        'response(path="100",cat="436")',
        '{% faker() %}',
        'faker()',
        '{% base64() %}',
        'base64()'
    ]

    const matchesArray = Array.from(input.matchAll(tagRegex), m => [m[0], m[1]])
    const flattenedMatches = matchesArray.flat()

    expect(flattenedMatches).toEqual(expectedMatches)
})
