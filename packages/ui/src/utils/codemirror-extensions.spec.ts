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
            valid: false,
        },
    ]

    testValues.forEach((testValue) => {
        let match
        let i = 0
        while ((match = variableMatchingRegex.exec(testValue.var))) {
            const varName = match[1] || match[2]
            expect(varName).toBe(testValue.extract![i])
            i++
        }

        if (testValue.valid) {
            expect(i).toBe(testValue.extract!.length)
        } else {
            expect(i).toBe(0)
        }
    })
})
