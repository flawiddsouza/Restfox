import { test, assert } from 'vitest'
import { onUrlChange, onParametersChange } from './query-params-sync'
import { CollectionItem } from '@/global'

test('Main', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: 'cat?6=a&b=2&c={{var}}',
    }

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), false)

    assert.deepEqual(activeTab.parameters, [
        { name: '6', value: 'a' },
        { name: 'b', value: '2' },
        { name: 'c', value: '{{var}}' },
    ])

    activeTab.url = 'cat?6=a'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), false)

    assert.deepEqual(activeTab.parameters, [
        { name: '6', value: 'a' },
    ])

    activeTab.url = 'cat?b={{cat}}&6=a&6=a'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), false)

    assert.deepEqual(activeTab.parameters, [
        { name: 'b', value: '{{cat}}' },
        { name: '6', value: 'a' },
        { name: '6', value: 'a' },
    ])

    activeTab.url = 'cat?b={{cat}}&6=a'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), false)

    assert.deepEqual(activeTab.parameters, [
        { name: 'b', value: '{{cat}}' },
        { name: '6', value: 'a' },
    ])

    activeTab.url = 'cat?a=1&a=2&a=3&b=1&b=2&b=3'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), false)

    assert.deepEqual(activeTab.parameters, [
        { name: 'a', value: '1' },
        { name: 'a', value: '2' },
        { name: 'a', value: '3' },
        { name: 'b', value: '1' },
        { name: 'b', value: '2' },
        { name: 'b', value: '3' },
    ])

    activeTab.parameters!.find(param => param.name === 'a' && param.value === '3')!.disabled = true

    assert.equal(onParametersChange(activeTab), true)
    assert.equal(onUrlChange(activeTab), false)

    assert.equal(activeTab.url, 'cat?a=1&a=2&b=1&b=2&b=3')

    const expectedParameters = [
        { name: 'a', value: '1' },
        { name: 'a', value: '2' },
        { name: 'a', value: '3', disabled: true },
        { name: 'b', value: '1' },
        { name: 'b', value: '2' },
        { name: 'b', value: '3' },
    ]

    assert.deepEqual(activeTab.parameters, expectedParameters)

    activeTab.url = 'cat?c=10&a=1&a=2&b=1&b=2&b=3'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), false)

    assert.deepEqual(activeTab.parameters, [
        { name: 'c', value: '10' },
        ...expectedParameters
    ])

    activeTab.url = 'cat'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), false)

    assert.deepEqual(activeTab.parameters, [
        { name: 'a', value: '3', disabled: true },
    ])

    activeTab.parameters = []

    assert.equal(onParametersChange(activeTab), true)

    assert.deepEqual(activeTab.parameters, [])

    assert.equal(onUrlChange(activeTab), false)

    assert.equal(activeTab.url, 'cat')
})

test('Ordering', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: 'cat?cat=1&hey=54654',
        parameters: [
            { name: 'cat', value: '1' },
            { name: 'bat', value: 'f', disabled: true },
            { name: 'cat', value: '2', disabled: true },
            { name: 'hey', value: '54654' },
        ]
    }

    activeTab.url = 'cat?cat=1&cat=1&hey=54654'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), false)

    // this is the order return currently
    const expectedParameters = [
        { name: 'bat', value: 'f', disabled: true },
        { name: 'cat', value: '1' },
        { name: 'cat', value: '2', disabled: true },
        { name: 'cat', value: '1' },
        { name: 'hey', value: '54654' },
    ]

    // this is the order we want
    // const expectedParameters = [
    //     { name: 'cat', value: '1' },
    //     { name: 'cat', value: '1' },
    //     { name: 'bat', value: 'f', disabled: true },
    //     { name: 'cat', value: '2', disabled: true },
    //     { name: 'hey', value: '54654' },
    // ]

    assert.deepEqual(activeTab.parameters, expectedParameters)
})
