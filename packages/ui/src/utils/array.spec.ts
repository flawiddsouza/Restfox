import { describe, it, expect } from 'vitest'
import { mergeArraysByProperty } from './array'

describe('mergeArraysByProperty', () => {
    it('should correctly merge two arrays by a specified property, overwriting with values from the second array', () => {
        const arr1 = [
            { id: 1, name: 'Alice', age: 25 },
            { id: 2, name: 'Bob', age: 22 }
        ]
        const arr2 = [
            { id: 2, name: 'Robert' },
            { id: 3, name: 'Charlie', age: 30 }
        ]

        const expected = [
            { id: 1, name: 'Alice', age: 25 },
            { id: 2, name: 'Robert', age: 22 },
            { id: 3, name: 'Charlie', age: 30 }
        ]

        const result = mergeArraysByProperty(arr1, arr2, 'id')
        expect(result).toEqual(expected)
    })

    // handle sub-objects
    it('should correctly merge two arrays by a specified property, overwriting with values from the second array, even if the property is a sub-object', () => {
        const arr1 = [
            { id: 1, environment: { API: 'cat', API_2: 'ball' } },
        ]

        const arr2 = [
            { id: 1, environment: { API: 'bat' } },
        ]

        const expected = [
            { id: 1, environment: { API: 'bat', API_2: 'ball' } },
        ]

        const result = mergeArraysByProperty(arr1, arr2, 'id')
        expect(result).toEqual(expected)
    })
})
