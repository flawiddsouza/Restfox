import { describe, expect, test } from 'vitest'
import type { CollectionItem } from '@/global'
import { appendInSortOrder, placeInSortOrder, sortOrderBetween } from './sort-order'

const item = (id: string, sortOrder?: number) => ({ _id: id, _type: 'request', name: id, parentId: null, workspaceId: 'w', sortOrder }) as CollectionItem

describe('sortOrderBetween', () => {
    test.each([
        [undefined, undefined, 0],
        [undefined, 0, -1],
        [undefined, -3, -4],
        [undefined, 2.5, 2],
        [4, undefined, 5],
        [4.7, undefined, 5],
        [3, 4, 3.5],
        [3, 3.5, 3.3],
        [3, 3.3, 3.2],
        [3, 3.2, 3.1],
        [3, 3.1, 3.05],
        [0, 10, 5],
        [-2, -1, -1.5],
        [1, 3, 2],
    ])('between %s and %s is %s', (before, after, expected) => {
        expect(sortOrderBetween(before, after)).toBe(expected)
    })

    test('a number that would need more than three decimals is none, nor is one between equal neighbours', () => {
        expect(sortOrderBetween(3, 3.001)).toBe(null)
        expect(sortOrderBetween(2, 2)).toBe(null)
        expect(sortOrderBetween(3, 2)).toBe(null)
    })

    // a number written by hand, too large for one more to differ from it
    test('beside a number too large to step from, there is none', () => {
        expect(sortOrderBetween(1e20, undefined)).toBe(null)
        expect(sortOrderBetween(undefined, -1e20)).toBe(null)
    })

    test('drops into the same gap keep finding a number until three decimals run out', () => {
        let after = 4
        const found: number[] = []
        for(let next = sortOrderBetween(3, after); next !== null; next = sortOrderBetween(3, after)) {
            found.push(next)
            after = next
        }
        expect(found.every(value => (String(value).split('.')[1]?.length ?? 0) <= 3)).toBe(true)
        expect(found.length).toBeGreaterThan(5)
        expect(found).toEqual([...found].sort((a, b) => b - a))
    })
})

describe('placeInSortOrder', () => {
    test('a new item first in its folder is written alone, before the lowest', () => {
        const siblings = [item('new'), item('a', 0), item('b', 1)]
        expect(placeInSortOrder(siblings, 0).map(changed => changed._id)).toEqual(['new'])
        expect(siblings.map(sibling => sibling.sortOrder)).toEqual([-1, 0, 1])
    })

    test('an item put between two is written alone, between them', () => {
        const siblings = [item('a', 0), item('moved', 7), item('b', 1)]
        expect(placeInSortOrder(siblings, 1).map(changed => changed._id)).toEqual(['moved'])
        expect(siblings.map(sibling => sibling.sortOrder)).toEqual([0, 0.5, 1])
    })

    test('an item put last is written alone, after the highest', () => {
        const siblings = [item('a', 0), item('b', 1.5), item('moved', 0)]
        expect(placeInSortOrder(siblings, 2).map(changed => changed._id)).toEqual(['moved'])
        expect(siblings.map(sibling => sibling.sortOrder)).toEqual([0, 1.5, 2])
    })

    test('the only item of a folder takes 0', () => {
        const siblings = [item('only', 5)]
        expect(placeInSortOrder(siblings, 0)).toEqual([siblings[0]])
        expect(siblings[0].sortOrder).toBe(0)
    })

    test('a sibling with no sort order numbers the folder again, writing only the items whose number changed', () => {
        const siblings = [item('new'), item('a', 1), item('b')]
        expect(placeInSortOrder(siblings, 0).map(changed => changed._id)).toEqual(['new', 'b'])
        expect(siblings.map(sibling => sibling.sortOrder)).toEqual([0, 1, 2])
    })

    test('neighbours with the same number, or too close for three decimals, number the folder again', () => {
        const tied = [item('a', 2), item('moved', 0), item('b', 2)]
        // b holds 2 already
        expect(placeInSortOrder(tied, 1).map(changed => changed._id)).toEqual(['a', 'moved'])
        expect(tied.map(sibling => sibling.sortOrder)).toEqual([0, 1, 2])

        const close = [item('a', 3), item('moved', 0), item('b', 3.001)]
        placeInSortOrder(close, 1)
        expect(close.map(sibling => sibling.sortOrder)).toEqual([0, 1, 2])
    })

    // the sidebar, which cannot sort beside an item with no number, can show the others out of their order, as here
    test('others shown out of their numbers\' order number the folder again in the order shown', () => {
        const siblings = [item('a', 4), item('c', 1), item('d', 2), item('moved')]
        placeInSortOrder(siblings, 3)
        expect(siblings.map(sibling => sibling.sortOrder)).toEqual([0, 1, 2, 3])
    })

    test('an item put before a number too large to step from numbers the folder again', () => {
        const siblings = [item('new'), item('a', 1e20)]
        placeInSortOrder(siblings, 0)
        expect(siblings.map(sibling => sibling.sortOrder)).toEqual([0, 1])
    })

    test('the placed item is written even when renumbering gives it the number it had', () => {
        const siblings = [item('moved', 0), item('a')]
        expect(placeInSortOrder(siblings, 0).map(changed => changed._id)).toEqual(['moved', 'a'])
    })
})

describe('appendInSortOrder', () => {
    test('items added after the others take the next whole numbers after the highest, leaving the others', () => {
        const siblings = [item('a', -2), item('b', 3.5)]
        const added = [item('x', 0), item('y', 1)]
        appendInSortOrder(siblings, added)
        expect([...siblings, ...added].map(sibling => sibling.sortOrder)).toEqual([-2, 3.5, 4, 5])
    })

    test('into an empty folder they start at 0', () => {
        const added = [item('x', 9), item('y', 9)]
        appendInSortOrder([], added)
        expect(added.map(sibling => sibling.sortOrder)).toEqual([0, 1])
    })

    test('a sibling with no sort order numbers them all again from 0', () => {
        const siblings = [item('a', 5), item('b')]
        const added = [item('x')]
        appendInSortOrder(siblings, added)
        expect([...siblings, ...added].map(sibling => sibling.sortOrder)).toEqual([0, 1, 2])
    })

    test.each([1e20, -9007199254740996, 9007199254740990])('after %s, too large to step from, they are all numbered again from 0', (highest) => {
        const siblings = [item('a', highest)]
        // enough of them that the last number counted would be a safe one again
        const added = ['t', 'u', 'v', 'w', 'x', 'y'].map(id => item(id))
        appendInSortOrder(siblings, added)
        expect([...siblings, ...added].map(sibling => sibling.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6])
    })
})
