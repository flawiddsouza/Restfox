import { test, assert } from 'vitest'
import { onUrlChange, onParametersChange, migrateOldData } from './query-params-sync'
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
    assert.equal(onParametersChange(activeTab), true)

    assert.deepEqual(activeTab.parameters, [
        { name: '6', value: 'a' },
        { name: 'b', value: '2' },
        { name: 'c', value: '{{var}}' },
    ])

    activeTab.url = 'cat?6=a'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), true)

    assert.deepEqual(activeTab.parameters, [
        { name: '6', value: 'a' },
    ])

    activeTab.url = 'cat?b={{cat}}&6=a&6=a'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), true)

    assert.deepEqual(activeTab.parameters, [
        { name: 'b', value: '{{cat}}' },
        { name: '6', value: 'a' },
        { name: '6', value: 'a' },
    ])

    activeTab.url = 'cat?b={{cat}}&6=a'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), true)

    assert.deepEqual(activeTab.parameters, [
        { name: 'b', value: '{{cat}}' },
        { name: '6', value: 'a' },
    ])

    activeTab.url = 'cat?a=1&a=2&a=3&b=1&b=2&b=3'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), true)

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
    assert.equal(onUrlChange(activeTab), true)

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
    assert.equal(onParametersChange(activeTab), true)

    assert.deepEqual(activeTab.parameters, [
        { name: 'c', value: '10' },
        ...expectedParameters
    ])

    activeTab.url = 'cat'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), true)

    assert.deepEqual(activeTab.parameters, [
        { name: 'a', value: '3', disabled: true },
    ])

    activeTab.parameters = []

    assert.equal(onParametersChange(activeTab), true)

    assert.deepEqual(activeTab.parameters, [])

    assert.equal(onUrlChange(activeTab), true)

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
    assert.equal(onParametersChange(activeTab), true)

    const expectedParameters = [
        { name: 'cat', value: '1' },
        { name: 'cat', value: '1' },
        { name: 'bat', value: 'f', disabled: true },
        { name: 'cat', value: '2', disabled: true },
        { name: 'hey', value: '54654' },
    ]

    assert.deepEqual(activeTab.parameters, expectedParameters)
})

test('Ordering 2', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: 'cat?cat=2&cat=3&cat=4',
        parameters: [
            { name: 'cat', value: '1', disabled: true },
            { name: 'cat', value: '2' },
            { name: 'cat', value: '3' },
            { name: 'cat', value: '1', disabled: true },
            { name: 'cat', value: '4' },
        ]
    }

    activeTab.url = 'cat?cat=2&cat=3&cat=1&cat=4'

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), true)

    const expectedParameters = [
        { name: 'cat', value: '1', disabled: true },
        { name: 'cat', value: '2' },
        { name: 'cat', value: '3' },
        { name: 'cat', value: '1' },
        { name: 'cat', value: '1', disabled: true },
        { name: 'cat', value: '4' },
    ]

    assert.deepEqual(activeTab.parameters, expectedParameters)
})

test('Migrate Old Data', () => {
    const tab: CollectionItem = {
        '_id': 'Nwmy0w4971yHvqQDNVGoF',
        '_type': 'request',
        'name': 'New Request',
        'method': 'GET',
        'body': {
            'mimeType': 'No Body'
        },
        'parentId': null,
        'workspaceId': 'Hgvsi-H9tgXzT2dwTy42x',
        'sortOrder': 0,
        'url': 'https://echo.hoppscotch.io?test1=232311',
        'parameters': [
            {
                'name': 'testarg',
                'value': '234234'
            },
            {
                'name': 'test1',
                'value': '232311',
                'disabled': true
            },
            {
                'name': 'testarg',
                'value': '111'
            }
        ]
    }

    migrateOldData(tab)

    assert.equal(tab.url, 'https://echo.hoppscotch.io?test1=232311&testarg=234234&testarg=111')

    assert.deepEqual(tab.parameters, [
        {
            'name': 'test1',
            'value': '232311'
        },
        {
            'name': 'testarg',
            'value': '234234'
        },
        {
            'name': 'test1',
            'value': '232311',
            'disabled': true
        },
        {
            'name': 'testarg',
            'value': '111'
        }
    ])
})

test('Migrate Old Data 2', () => {
    const tab: CollectionItem = {
        '_id': '99DNWtghD5bKhlbgDpG_H',
        '_type': 'request',
        'name': 'New Request',
        'method': 'POST',
        'body': {
            'mimeType': 'application/json',
            'text': '{\n    "link": []\n}'
        },
        'parentId': null,
        'workspaceId': 'Hgvsi-H9tgXzT2dwTy42x',
        'sortOrder': 0,
        'headers': [
            {
                'name': 'Content-Type',
                'value': 'application/json'
            }
        ],
        'url': 'http://localhost:5093/add-to-queue?bat=cagsgdds',
        'parameters': [
            {
                'name': 'cat',
                'value': '1'
            },
            {
                'name': 'cat',
                'value': '2',
                'disabled': true
            },
            {
                'name': 'bat',
                'value': 'cagsgdds',
                'disabled': false
            },
            {
                'name': 'va',
                'value': 'assasg',
                'disabled': true
            },
            {
                'name': 'cat',
                'value': '43643'
            }
        ]
    }

    migrateOldData(tab)

    assert.equal(tab.url, 'http://localhost:5093/add-to-queue?cat=1&bat=cagsgdds&cat=43643')

    assert.deepEqual(tab.parameters, [
        {
            'name': 'cat',
            'value': '1'
        },
        {
            'name': 'cat',
            'value': '2',
            'disabled': true
        },
        {
            'name': 'bat',
            'value': 'cagsgdds',
            'disabled': false
        },
        {
            'name': 'va',
            'value': 'assasg',
            'disabled': true
        },
        {
            'name': 'cat',
            'value': '43643'
        }
    ])
})

test('Multiple equal signs test', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: 'cat?cat===1',
        parameters: []
    }

    assert.equal(onUrlChange(activeTab), true)
    assert.equal(onParametersChange(activeTab), true)

    const expectedParameters = [
        { name: 'cat', value: '==1' },
    ]

    assert.deepEqual(activeTab.parameters, expectedParameters)
})

test('Path Params Sync - In Between Substitution Test', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: 'cat/:cat/:cat3',
        pathParameters: [
            { name: 'cat', value: '1' },
            { name: 'cat3', value: '3' },
        ]
    }

    activeTab.url = 'cat/:cat/:cat2/:cat3/'

    assert.equal(onUrlChange(activeTab), true)

    const expectedPathParameters = [
        { name: 'cat', value: '1' },
        { name: 'cat2', value: '' },
        { name: 'cat3', value: '3' },
    ]

    assert.deepEqual(activeTab.pathParameters, expectedPathParameters)
})

test('Path Params Sync - In Between Substitution Test 2', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: 'cat/:cat/:cat3',
        pathParameters: [
            { name: 'cat', value: '1' },
            { name: 'cat3', value: '3' },
        ]
    }

    activeTab.url = 'caat/:cat/:cat2:cat3'

    assert.equal(onUrlChange(activeTab), true)

    const expectedPathParameters = [
        { name: 'cat', value: '1' },
        { name: 'cat2:cat3', value: '' },
        { name: 'cat3', value: '3', disabled: true },
    ]

    assert.deepEqual(activeTab.pathParameters, expectedPathParameters)

    activeTab.url = 'cat/:cat/:cat2/:cat3'

    assert.equal(onUrlChange(activeTab), true)

    const expectedPathParameters2 = [
        { name: 'cat', value: '1' },
        { name: 'cat2', value: '' },
        { name: 'cat2:cat3', value: '', disabled: true },
        { name: 'cat3', value: '3' },
    ]

    assert.deepEqual(activeTab.pathParameters, expectedPathParameters2)
})

test('Path Params Sync - a name repeated in the url gets one row, existing rows for it are kept', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: 'cat/:cat/:cat',
        pathParameters: [
            { name: 'cat', value: '1' },
            { name: 'cat', value: '2' },
            { name: 'cat', value: '3', disabled: true },
        ]
    }

    activeTab.url = 'cat/:cat/:cat/:cat'

    assert.equal(onUrlChange(activeTab), true)

    const expectedPathParameters = [
        { name: 'cat', value: '1' },
        { name: 'cat', value: '2' },
        { name: 'cat', value: '3', disabled: true },
    ]

    assert.deepEqual(activeTab.pathParameters, expectedPathParameters)

    activeTab.url = 'cat/:cat/:bat/:cat/:bat'

    assert.equal(onUrlChange(activeTab), true)

    const expectedPathParameters2 = [
        { name: 'cat', value: '1' },
        { name: 'cat', value: '2' },
        { name: 'cat', value: '3', disabled: true },
        { name: 'bat', value: '' },
    ]

    assert.deepEqual(activeTab.pathParameters, expectedPathParameters2)
})

test('Path Params Sync - Protocol:// should be not treated as a path param', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: '',
        pathParameters: []
    }

    activeTab.url = 'https://google.com/:cat'

    assert.equal(onUrlChange(activeTab), true)

    assert.deepEqual(activeTab.pathParameters, [
        { name: 'cat', value: '' },
    ])
})

test('Path Params Sync - Two types of path params [ :cat, {cat} ]', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: '',
        pathParameters: []
    }

    activeTab.url = 'https://google.com/:cat/{cat2}'

    assert.equal(onUrlChange(activeTab), true)

    assert.deepEqual(activeTab.pathParameters, [
        { name: 'cat', value: '' },
        { name: 'cat2', value: '' },
    ])
})

test('Path Params Sync - env vars should not be treated as {path} type path params', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: '',
        pathParameters: []
    }

    activeTab.url = 'https://google.com/{cat}/{{cat2}}/{cat3}/{{ cat4 }}'

    assert.equal(onUrlChange(activeTab), true)

    assert.deepEqual(activeTab.pathParameters, [
        { name: 'cat', value: '' },
        { name: 'cat3', value: '' },
    ])
})

test('Path Params Sync - :port should not be treated as a path param', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: '',
        pathParameters: []
    }

    activeTab.url = 'https://localhost:7410/:cat'

    assert.equal(onUrlChange(activeTab), true)

    assert.deepEqual(activeTab.pathParameters, [
        { name: 'cat', value: '' },
    ])
})

test('Path Params Sync - mac:addresses:should:not:be:treated as a path param', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: '',
        pathParameters: []
    }

    activeTab.url = 'testing-domain/backend/device/aa:bb:cc:dd:ee:ff/data'

    assert.equal(onUrlChange(activeTab), true)

    assert.deepEqual(activeTab.pathParameters, [])
})

test('Path Params Sync - response tag should not be treated as a path param', () => {
    const activeTab: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        url: '',
        pathParameters: []
    }

    activeTab.url = '{% response() %}'

    assert.equal(onUrlChange(activeTab), true)

    assert.deepEqual(activeTab.pathParameters, [])
})

function tabWithPath(url: string, pathParameters: CollectionItem['pathParameters']): CollectionItem {
    return { _id: 'test', _type: 'request', parentId: 'test', workspaceId: 'test', name: 'test', url, pathParameters }
}

test('Path Params Sync - 287 - a row whose name leaves the url is unchecked, not deleted, and checked again when the name returns', () => {
    const activeTab = tabWithPath('https://example.test/users', [{ name: 'id', value: '123' }])

    activeTab.url = 'https://example.test/users/:'
    assert.equal(onUrlChange(activeTab), true)
    assert.deepEqual(activeTab.pathParameters, [{ name: 'id', value: '123', disabled: true }])

    activeTab.url = 'https://example.test/users/:id'
    assert.equal(onUrlChange(activeTab), true)
    assert.deepEqual(activeTab.pathParameters, [{ name: 'id', value: '123' }])
})

test('Path Params Sync - 287 - alternate values for one name survive a url edit', () => {
    const activeTab = tabWithPath('https://example.test/users/:id', [
        { name: 'id', value: '1' },
        { name: 'id', value: '2', disabled: true },
    ])

    activeTab.url = 'https://example.test/users/:id/posts'
    assert.equal(onUrlChange(activeTab), true)
    assert.deepEqual(activeTab.pathParameters, [
        { name: 'id', value: '1' },
        { name: 'id', value: '2', disabled: true },
    ])
})

test('Path Params Sync - 337 - rows referenced from the value of another row survive a url edit', () => {
    const nested = [
        { name: 'start', value: ':lat,:lon' },
        { name: 'lat', value: '10.76' },
        { name: 'lon', value: '106.68' },
        { name: 'end', value: '{lat2},{lon2}' },
        { name: 'lat2', value: '10.77' },
        { name: 'lon2', value: '106.69' },
    ]
    const activeTab = tabWithPath('https://example.test/path/:start/:end', JSON.parse(JSON.stringify(nested)))

    activeTab.url = 'https://example.test/path/:start/:end/2'
    assert.equal(onUrlChange(activeTab), true)
    assert.deepEqual(activeTab.pathParameters, nested)

    activeTab.url = 'https://example.test/path/:start/2'
    assert.equal(onUrlChange(activeTab), true)
    assert.deepEqual(activeTab.pathParameters, [
        { name: 'start', value: ':lat,:lon' },
        { name: 'lat', value: '10.76' },
        { name: 'lon', value: '106.68' },
        { name: 'end', value: '{lat2},{lon2}', disabled: true },
        { name: 'lat2', value: '10.77', disabled: true },
        { name: 'lon2', value: '106.69', disabled: true },
    ])

    activeTab.url = 'https://example.test/path/:start/:end/2'
    assert.equal(onUrlChange(activeTab), true)
    assert.deepEqual(activeTab.pathParameters, nested)
})

test('Path Params Sync - 337 - an unchecked row does not keep the rows its value references', () => {
    const activeTab = tabWithPath('https://example.test/:start', [
        { name: 'start', value: ':lat', disabled: true },
        { name: 'lat', value: '10' },
    ])

    activeTab.url = 'https://example.test/x'
    assert.equal(onUrlChange(activeTab), true)
    assert.deepEqual(activeTab.pathParameters, [
        { name: 'start', value: ':lat', disabled: true },
        { name: 'lat', value: '10', disabled: true },
    ])
})

test('Path Params Sync - a new name is inserted after the rows of the name before it in the url', () => {
    const activeTab = tabWithPath('https://example.test/:a/:b', [
        { name: 'a', value: '1' },
        { name: 'a', value: '2', disabled: true },
        { name: 'b', value: '3' },
    ])

    activeTab.url = 'https://example.test/:a/:c/:b'
    assert.equal(onUrlChange(activeTab), true)
    assert.deepEqual(activeTab.pathParameters, [
        { name: 'a', value: '1' },
        { name: 'a', value: '2', disabled: true },
        { name: 'c', value: '' },
        { name: 'b', value: '3' },
    ])
})

test('Path Params Sync - a row without a name is left alone', () => {
    const activeTab = tabWithPath('https://example.test/:a', [
        { name: 'a', value: '1' },
        { name: '', value: '' },
    ])

    activeTab.url = 'https://example.test/:a/b'
    assert.equal(onUrlChange(activeTab), true)
    assert.deepEqual(activeTab.pathParameters, [
        { name: 'a', value: '1' },
        { name: '', value: '' },
    ])
})
