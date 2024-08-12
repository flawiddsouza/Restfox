import { test, expect } from 'vitest'
import { variableMatchingRegex } from './codemirror-extensions'

test('validate variableMatchingRegex', async() => {
    const testValues = [
        {
            var: '{{cat}}',
            valid: true,
            extract: [
                'cat'
            ],
        },
        {
            var: '{{ cat }}',
            valid: true,
            extract: [
                'cat'
            ],
        },
        {
            var: '{{ cat}}',
            valid: false
        },
        {
            var: '{{cat }}',
            valid: false
        },
        {
            var: '{{   cat  }}',
            valid: false
        },
        {
            var: '{{process.env.cat}}',
            valid: true,
            extract: [
                'process.env.cat'
            ],
        },
        {
            var: '{{ process.env.cat }}',
            valid: true,
            extract: [
                'process.env.cat'
            ],
        },
        {
            var: '{{ process.env.cat}}',
            valid: false
        },
        {
            var: '{{process.env.cat }}',
            valid: false
        },
        {
            var: '{{   process.env.cat  }}',
            valid: false
        },
        {
            var: '{{ process.env.cat }} {{ cat }}',
            valid: true,
            extract: [
                'process.env.cat',
                'cat'
            ]
        },
        {
            var: '{{ cat! }}',
            valid: true,
            extract: [
                'cat!'
            ]
        },
        {
            // this one doesn't actually substitute in our env substitution, but it's a valid variable path actually
            var: '{{ API["URL"] }}',
            valid: true,
            extract: [
                'API["URL"]'
            ]
        },
        {
            var: '{{ API[0].cat }}',
            valid: true,
            extract: [
                'API[0].cat'
            ]
        },
        {
            var: '{{API[0].cat!}}',
            valid: true,
            extract: [
                'API[0].cat!'
            ]
        },
        {
            // GH Issue #211
            var: '{{my-key}}',
            valid: true,
            extract: [
                'my-key'
            ]
        },
    ]

    testValues.forEach((testValue) => {
        let match
        let i = 0
        while ((match = variableMatchingRegex.exec(testValue.var))) {
            const varName = match[1] || match[2]
            const expectedVarName = testValue.extract ? testValue.extract[i] : 'extract array not defined for valid true case!'
            expect(varName).toBe(expectedVarName)
            i++
        }

        if (testValue.valid) {
            expect(i).toBe(testValue.extract!.length)
        } else {
            expect(i).toBe(0)
        }
    })
})
