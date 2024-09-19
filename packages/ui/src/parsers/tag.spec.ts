import { test, expect } from 'vitest'
import { parseFunction, toFunctionString } from './tag'

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
