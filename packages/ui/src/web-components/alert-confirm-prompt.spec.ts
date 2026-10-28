// @vitest-environment happy-dom

import { test, expect, afterEach } from 'vitest'
import './alert-confirm-prompt'

afterEach(() => {
    document.body.innerHTML = ''
})

function promptElement() {
    const element = document.createElement('alert-confirm-prompt') as HTMLElement & {
        createPrompt: (title: string, defaultValue?: string, selectList?: string[]) => Promise<string | null>
    }
    document.body.appendChild(element)
    return element
}

// names from collection data, which may have been imported
const name = 'Prod"><img src=x onerror="window.ranPrompt = true"> &amp;'

test('a rename prompt shows the saved name as typed in its box and runs nothing', () => {
    const element = promptElement()

    element.createPrompt('Enter new environment name', name)

    const input = element.shadowRoot!.querySelector('#dialog-input') as HTMLInputElement
    expect(element.shadowRoot!.querySelector('img')).toBeNull()
    expect(input.value).toBe(name)
})

test('the variable names offered by a prompt are the names as typed and run nothing', () => {
    const element = promptElement()

    element.createPrompt('Select / Enter environment variable name', '', [name, 'token'])

    const options = [...element.shadowRoot!.querySelectorAll('#selectList option')] as HTMLOptionElement[]
    expect(element.shadowRoot!.querySelector('img')).toBeNull()
    expect(options.map(option => option.value)).toEqual([name, 'token'])
})

test('a color prompt starts from the saved color, which runs nothing when it is not one', () => {
    const element = promptElement()

    element.createPrompt('Choose another color for your environment', '#ff0000"><img src=x>')

    expect(element.shadowRoot!.querySelector('img')).toBeNull()
    expect(element.shadowRoot!.querySelector('#dialog-color-input')).not.toBeNull()
})
