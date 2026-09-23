// @vitest-environment happy-dom
import { test, expect } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { envVarDecoration, variableMatchingRegex } from './codemirror-extensions'

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
        {
            // GH Issue #227
            var: '{{my var}} {{ my var }}',
            valid: true,
            extract: [
                'my var',
                'my var'
            ]
        },
        {
            var: '{{my var }} and {{x}}',
            valid: true,
            extract: [
                'x'
            ]
        },
        {
            var: '{{ my var}} and {{ x }}',
            valid: true,
            extract: [
                'x'
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

// the variables an editor marks, with whether they show as found and the value shown on hover
function highlightedVariables(doc: string, envVariables: Record<string, unknown>) {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [envVarDecoration(envVariables)] }), parent })
    const marks = [...parent.querySelectorAll('.valid-env-var, .invalid-env-var')].map(element => ({
        text: element.textContent,
        found: element.classList.contains('valid-env-var'),
        title: element.getAttribute('title'),
    }))
    view.destroy()
    parent.remove()
    return marks
}

test('a variable with a space in its name is marked as found, as substitution finds it', () => {
    expect(highlightedVariables('{{my var}} {{ my var }}', { 'my var': 'x' })).toEqual([
        { text: '{{my var}}', found: true, title: 'x' },
        { text: '{{ my var }}', found: true, title: 'x' },
    ])
})

test('nested paths and the _. prefix are marked as found, as substitution finds them', () => {
    expect(highlightedVariables('{{ nested.inner }} {{arr[0].x}} {{ _.token }}', { nested: { inner: 'i' }, arr: [{ x: 'ax' }], token: 't' })).toEqual([
        { text: '{{ nested.inner }}', found: true, title: 'i' },
        { text: '{{arr[0].x}}', found: true, title: 'ax' },
        { text: '{{ _.token }}', found: true, title: 't' },
    ])
})

test('an object value shows as JSON on hover, a missing variable as not found', () => {
    expect(highlightedVariables('{{ nested }} {{ missing }}', { nested: { inner: 'i' } })).toEqual([
        { text: '{{ nested }}', found: true, title: '{"inner":"i"}' },
        { text: '{{ missing }}', found: false, title: 'Environment variable not found' },
    ])
})
