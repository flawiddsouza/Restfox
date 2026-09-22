// @vitest-environment edge-runtime
import { describe, expect, test } from 'vitest'
import { filterJSONResponse } from './response'

describe(`Function: ${filterJSONResponse.name}`, () => {
    const body = new TextEncoder().encode(JSON.stringify({
        items: [
            { name: 'pen', price: 2 },
            { name: 'book', price: 12 },
        ],
    }))

    test('returns the values a plain path selects', () => {
        expect(filterJSONResponse(body, '$.items[*].name', true)).toEqual(['pen', 'book'])
    })

    test('evaluates a filter expression', () => {
        expect(filterJSONResponse(body, '$.items[?(@.price > 5)].name', true)).toEqual(['book'])
    })

    test('returns the whole body when the path is invalid', () => {
        expect(JSON.parse(filterJSONResponse(body, '$['))).toEqual(JSON.parse(new TextDecoder().decode(body)))
    })
})
