import { assert, test } from 'vitest'
import { substituteEnvironmentVariables } from './helpers.ts'

test('substituteEnvironmentVariables', () => {
    const environment = {
        'string': 'cat',
        'number': 4404,
        'object': {
            'string': 'hey',
            'array': [
                'r1',
                'r2',
                'r3'
            ]
        }
    }

    const json = `{
        "edge case": "{{",
        "accessing object path array": "{{ object.array }}",
        "accessing object path array item": "{{ object.array[0] }}",
        "access object path string": "{{ object.string }}",
        "access top level object key": "{{ string }}",
        "number": {{ number }}
    }`

    const result = substituteEnvironmentVariables(environment, json)

    const expectedResult = `{
        "edge case": "{{",
        "accessing object path array": "r1,r2,r3",
        "accessing object path array item": "r1",
        "access object path string": "hey",
        "access top level object key": "cat",
        "number": 4404
    }`

    assert.equal(result, expectedResult)
})
