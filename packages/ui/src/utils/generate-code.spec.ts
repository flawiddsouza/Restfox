// @vitest-environment edge-runtime

import { assert, test, describe, vi, beforeAll } from 'vitest'
import { generateCode } from './generate-code'

describe(`${generateCode.name}`, () => {
    beforeAll(() => {
        // Define a full localStorage mock to match the Storage interface
        const localStorageMock = (() => {
            let store: Record<string, string> = {}

            return {
                getItem: vi.fn((key: string) => store[key] || null),
                setItem: vi.fn((key: string, value: string) => {
                    store[key] = value
                }),
                removeItem: vi.fn((key: string) => {
                    delete store[key]
                }),
                clear: vi.fn(() => {
                    store = {}
                }),
                // `length` getter to return the number of items stored
                get length() {
                    return Object.keys(store).length
                },
                // `key` method to return the key at a specific index
                key: vi.fn((index: number) => Object.keys(store)[index] || null),
            }
        })()

        // Assign the mock to the global object
        Object.defineProperty(global, 'localStorage', {
            value: localStorageMock,
            configurable: true, // Allows reassignment if needed
            writable: true,     // Ensures it can be changed during tests
        })
    })

    test('shell - curl', async() => {
        const request = {
            '_id': 'dUrySgUfq8DUMn5Az6z2H',
            '_type': 'request' as const,
            'name': 'New Request',
            'method': 'POST',
            'body': {
                'mimeType': 'application/json',
                'text': '[{"event_type":"api_event","event_id":"954a6478-88bf-4baf-8c1b-efe2ea9fd0e6","timestamp":1697544030000,"app_id":"demo_app2","attributes":{"environment":"test","value":279.9}}]'
            },
            'parentId': null,
            'workspaceId': 'Hgvsi-H9tgXzT2dwTy42x',
            'sortOrder': 0,
            'url': '{{ API_URL }}/collect',
            'headers': [
                {
                    'name': 'Content-Type',
                    'value': 'application/json; charset=utf-8'
                }
            ],
            'parameters': [
                {
                    'name': 'appId',
                    'value': 'demo_app2',
                    'disabled': false
                }
            ],
            'authentication': {
                'type': 'No Auth'
            }
        }

        const environment = {
            API_URL: 'http://clicks-inges-abc-xyz.ap-south-1.elb.amazonaws.com'
        }

        const input = await generateCode(request, environment, {}, undefined, 'shell', 'curl')
        const expectedOutput = `curl --request POST \\
    --url 'http://clicks-inges-abc-xyz.ap-south-1.elb.amazonaws.com/collect?appId=demo_app2' \\
    --header 'content-type: application/json; charset=utf-8' \\
    --data '[{"event_type":"api_event","event_id":"954a6478-88bf-4baf-8c1b-efe2ea9fd0e6","timestamp":1697544030000,"app_id":"demo_app2","attributes":{"environment":"test","value":279.9}}]'`
        assert.equal(input, expectedOutput)
    })
})
