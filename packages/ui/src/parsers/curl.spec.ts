// From: https://github.com/Kong/insomnia/blob/6bd54b5b70259de0f65663eaa33418df0b3d6ebc/packages/insomnia/src/utils/importers/importers/curl.test.ts

/* eslint-disable no-useless-escape */

import { describe, it, expect } from 'vitest'
import { quote } from 'shell-quote'

import { Parameter } from './curl.types'
import { convert } from './curl'

describe('curl', () => {
    describe('cURL --data flags', () => {
        it.each([
            // -d
            { flag: '-d', inputs: ['key=value'], expected: [{ name: 'key', value: 'value' }] },
            { flag: '-d', inputs: ['value'], expected: [{ name: '', value: 'value' }] },
            { flag: '-d', inputs: ['@filename'], expected: [{ name: '', fileName: 'filename', type: 'file' }] },
            {
                flag: '-d',
                inputs: ['first=1', 'second=2', 'third'],
                expected: [{ name: 'first', value: '1' }, {
                    name: 'second',
                    value: '2',
                }, { name: '', value: 'third' }],
            },
            {
                flag: '-d',
                inputs: ['first=1&second=2'],
                expected: [{ name: 'first', value: '1' }, { name: 'second', value: '2' }],
            },
            { flag: '-d', inputs: ['%3D'], expected: [{ name: '', value: '=' }] },
            { flag: '--d', inputs: ['%3D=%3D'], expected: [{ name: '=', value: '=' }] },

            // --data
            { flag: '--data', inputs: ['key=value'], expected: [{ name: 'key', value: 'value' }] },
            { flag: '--data', inputs: ['value'], expected: [{ name: '', value: 'value' }] },
            { flag: '--data', inputs: ['@filename'], expected: [{ name: '', fileName: 'filename' }] },
            {
                flag: '--data',
                inputs: ['first=1', 'second=2', 'third'],
                expected: [{ name: 'first', value: '1' }, {
                    name: 'second',
                    value: '2',
                }, { name: '', value: 'third' }],
            },
            {
                flag: '--data',
                inputs: ['first=1&second=2'],
                expected: [{ name: 'first', value: '1' }, { name: 'second', value: '2' }],
            },
            { flag: '--data', inputs: ['%3D'], expected: [{ name: '', value: '=' }] },
            { flag: '--data', inputs: ['%3D=%3D'], expected: [{ name: '=', value: '=' }] },

            // --data-ascii
            { flag: '--data-ascii', inputs: ['key=value'], expected: [{ name: 'key', value: 'value' }] },
            { flag: '--data-ascii', inputs: ['value'], expected: [{ name: '', value: 'value' }] },
            { flag: '--data-ascii', inputs: ['@filename'], expected: [{ name: '', fileName: 'filename', type: 'file' }] },
            {
                flag: '--data-ascii',
                inputs: ['first=1', 'second=2', 'third'],
                expected: [{ name: 'first', value: '1' }, {
                    name: 'second',
                    value: '2',
                }, { name: '', value: 'third' }],
            },
            {
                flag: '--data-ascii',
                inputs: ['first=1&second=2'],
                expected: [{ name: 'first', value: '1' }, { name: 'second', value: '2' }],
            },

            // --data-binary
            { flag: '--data-binary', inputs: ['key=value'], expected: [{ name: 'key', value: 'value' }] },
            { flag: '--data-binary', inputs: ['value'], expected: [{ name: '', value: 'value' }] },
            { flag: '--data-binary', inputs: ['@filename'], expected: [{ name: '', fileName: 'filename', type: 'file' }] },
            {
                flag: '--data-binary',
                inputs: ['first=1', 'second=2', 'third'],
                expected: [{ name: 'first', value: '1' }, {
                    name: 'second',
                    value: '2',
                }, { name: '', value: 'third' }],
            },
            {
                flag: '--data-binary',
                inputs: ['first=1&second=2'],
                expected: [{ name: 'first', value: '1' }, { name: 'second', value: '2' }],
            },

            // --data-raw
            { flag: '--data-raw', inputs: ['@filename'], expected: [{ name: '', value: '@filename' }] },
            { flag: '--data-raw', inputs: ['key=value'], expected: [{ name: 'key', value: 'value' }] },
            {
                flag: '--data-raw',
                inputs: ['first=1', 'second=2', 'third'],
                expected: [{ name: 'first', value: '1' }, {
                    name: 'second',
                    value: '2',
                }, { name: '', value: 'third' }],
            },
            {
                flag: '--data-raw',
                inputs: ['first=1&second=2'],
                expected: [{ name: 'first', value: '1' }, { name: 'second', value: '2' }],
            },

            // --data-urlencode
            { flag: '--data-urlencode', inputs: ['key=value'], expected: [{ name: 'key', value: 'value' }] },
            {
                flag: '--data-urlencode',
                inputs: ['key@filename'],
                expected: [{ name: 'key', fileName: 'filename', type: 'file' }],
            },
            {
                flag: '--data-urlencode',
                inputs: ['first=1', 'second=2', 'third'],
                expected: [{ name: 'first', value: '1' }, {
                    name: 'second',
                    value: '2',
                }, { name: '', value: 'third' }],
            },
            {
                flag: '--data-urlencode',
                inputs: ['first=1&second=2'],
                expected: [{ name: 'first', value: '1' }, { name: 'second', value: '2' }],
            },
            { flag: '--data-urlencode', inputs: ['=value'], expected: [{ name: '', value: 'value' }] },

            // --data-urlencode URI encoding
            { flag: '--data-urlencode', inputs: ['a='], expected: [{ name: '', value: 'a=' }] },
            { flag: '--data-urlencode', inputs: [' '], expected: [{ name: '', value: ' ' }] },
            { flag: '--data-urlencode', inputs: ['<'], expected: [{ name: '', value: '<' }] },
            { flag: '--data-urlencode', inputs: ['>'], expected: [{ name: '', value: '>' }] },
            { flag: '--data-urlencode', inputs: ['?'], expected: [{ name: '', value: '?' }] },
            { flag: '--data-urlencode', inputs: ['['], expected: [{ name: '', value: '[' }] },
            { flag: '--data-urlencode', inputs: [']'], expected: [{ name: '', value: ']' }] },
            { flag: '--data-urlencode', inputs: ['|'], expected: [{ name: '', value: '|' }] },
            { flag: '--data-urlencode', inputs: ['^'], expected: [{ name: '', value: '^' }] },
            { flag: '--data-urlencode', inputs: ['"'], expected: [{ name: '', value: '"' }] },
            { flag: '--data-urlencode', inputs: ['='], expected: [{ name: '', value: '=' }] },
            { flag: '--data-urlencode', inputs: ['%3D'], expected: [{ name: '', value: '%3D' }] },
        ])('handles %p correctly', async({
            flag,
            inputs,
            expected,
        }: { flag: string; inputs: string[]; expected: Parameter[] }) => {
            const flaggedInputs = inputs.map(input => `${flag} ${quote([input])}`).join(' ')
            const rawData = `curl -X POST https://example.com
            -H 'Content-Type: application/x-www-form-urlencoded'
            ${flaggedInputs}
            `

            expect(convert(rawData)).toMatchObject([{
                body: {
                    params: expected,
                },
            }])
        })
    })

    it('Chrome: Copy as cURL (bash)', () => {
        const chromeCurlBash = `
            curl 'https://httpbin.org/anything' \
                -H 'authority: httpbin.org' \
                -H 'accept: */*' \
                -H 'accept-language: en-US,en;q=0.9' \
                -H 'cache-control: no-cache' \
                -H 'content-type: application/json' \
                -H 'origin: https://restfox.dev' \
                -H 'pragma: no-cache' \
                -H 'referer: https://restfox.dev/' \
                -H 'sec-ch-ua: "Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"' \
                -H 'sec-ch-ua-mobile: ?0' \
                -H 'sec-ch-ua-platform: "Windows"' \
                -H 'sec-fetch-dest: empty' \
                -H 'sec-fetch-mode: cors' \
                -H 'sec-fetch-site: cross-site' \
                -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36' \
                --data-raw $'{\n    "test": "body"\n}' \
                --compressed
        `.trim()
        const result = convert(chromeCurlBash)
        // console.log(result[0])
        expect(result).toMatchObject([{
            _id: '__REQ_1__',
            _type: 'request',
            parentId: '__WORKSPACE_ID__',
            name: 'https://httpbin.org/anything',
            parameters: [],
            url: 'https://httpbin.org/anything',
            method: 'POST',
            headers: [
                { name: 'authority', value: 'httpbin.org' },
                { name: 'accept', value: '*/*' },
                { name: 'accept-language', value: 'en-US,en;q=0.9' },
                { name: 'cache-control', value: 'no-cache' },
                { name: 'content-type', value: 'application/json' },
                { name: 'origin', value: 'https://restfox.dev' },
                { name: 'pragma', value: 'no-cache' },
                { name: 'referer', value: 'https://restfox.dev/' },
                { name: 'sec-ch-ua', value: '"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"' },
                { name: 'sec-ch-ua-mobile', value: '?0' },
                { name: 'sec-ch-ua-platform', value: '"Windows"' },
                { name: 'sec-fetch-dest', value: 'empty' },
                { name: 'sec-fetch-mode', value: 'cors' },
                { name: 'sec-fetch-site', value: 'cross-site' },
                {
                    name: 'user-agent',
                    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
                }
            ],
            authentication: {},
            body: {
                mimeType: 'application/json',
                text: '{     "test": "body" }'
            }
        }])
    })

    it('Chrome: Copy as cURL (cmd)', () => {
        const chromeCurlCmd = `
            curl "https://httpbin.org/anything" ^
                -H "authority: httpbin.org" ^
                -H "accept: */*" ^
                -H "accept-language: en-US,en;q=0.9" ^
                -H "cache-control: no-cache" ^
                -H "content-type: application/json" ^
                -H "origin: https://restfox.dev" ^
                -H "pragma: no-cache" ^
                -H "referer: https://restfox.dev/" ^
                -H "sec-ch-ua: ^\^"Chromium^\^";v=^\^"118^\^", ^\^"Google Chrome^\^";v=^\^"118^\^", ^\^"Not=A?Brand^\^";v=^\^"99^\^"" ^
                -H "sec-ch-ua-mobile: ?0" ^
                -H "sec-ch-ua-platform: ^\^"Windows^\^"" ^
                -H "sec-fetch-dest: empty" ^
                -H "sec-fetch-mode: cors" ^
                -H "sec-fetch-site: cross-site" ^
                -H "user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36" ^
                --data-raw ^"^{^

                    ^\^"test^\^": ^\^"body^\^"^

                ^}^" ^
                --compressed
        `.trim()
        const result = convert(chromeCurlCmd)
        // console.log(result[0])
        expect(result).toMatchObject([{
            _id: '__REQ_1__',
            _type: 'request',
            parentId: '__WORKSPACE_ID__',
            name: 'https://httpbin.org/anything',
            parameters: [],
            url: 'https://httpbin.org/anything',
            method: 'POST',
            headers: [
                { name: 'authority', value: 'httpbin.org' },
                { name: 'accept', value: '*/*' },
                { name: 'accept-language', value: 'en-US,en;q=0.9' },
                { name: 'cache-control', value: 'no-cache' },
                { name: 'content-type', value: 'application/json' },
                { name: 'origin', value: 'https://restfox.dev' },
                { name: 'pragma', value: 'no-cache' },
                { name: 'referer', value: 'https://restfox.dev/' },
                { name: 'sec-ch-ua', value: '^^Chromium^^;v=^^118^^, ^^Google' },
                { name: 'sec-ch-ua-mobile', value: '?0' },
                { name: 'sec-ch-ua-platform', value: '^^Windows^^' },
                { name: 'sec-fetch-dest', value: 'empty' },
                { name: 'sec-fetch-mode', value: 'cors' },
                { name: 'sec-fetch-site', value: 'cross-site' },
                {
                    name: 'user-agent',
                    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
                }
            ],
            authentication: {},
            body: {
                mimeType: 'application/json',
                text: '^^{^                      ^^test^^: ^^body^^^                  ^}^'
            }
        }])
    })

    it('Curl command - GQL request', () => {
        const chromeCurlCmd = `curl 'https://app.argos-ci.com/graphql' \\
  -H 'accept: */*' \\
  -H 'accept-language: en-US,en;q=0.9,vi;q=0.8,de;q=0.7' \\
  -H 'authorization: Bearer token' \\
  -H 'content-type: application/json' \\
  --data-raw $'{"operationName":"AccountBreadcrumb_account","variables":{"slug":"kobenguyent"},"query":"query AccountBreadcrumb_account($slug: String\u0021) {\\\\n  account(slug: $slug) {\\\\n    id\\\\n    slug\\\\n    name\\\\n    avatar {\\\\n      ...AccountAvatarFragment\\\\n      __typename\\\\n    }\\\\n    ...AccountPlanChip_Account\\\\n    __typename\\\\n  }\\\\n}\\\\n\\\\nfragment AccountAvatarFragment on AccountAvatar {\\\\n  url(size: 64)\\\\n  color\\\\n  initial\\\\n  __typename\\\\n}\\\\n\\\\nfragment AccountPlanChip_Account on Account {\\\\n  subscriptionStatus\\\\n  plan {\\\\n    id\\\\n    displayName\\\\n    __typename\\\\n  }\\\\n  __typename\\\\n}"}'`.trim()
        const result = convert(chromeCurlCmd)

        expect(result).toMatchObject([
            {
                '_id': '__REQ_1__',
                '_type': 'request',
                'authentication': {},
                'body': {
                    'mimeType': 'application/graphql',
                    'query': 'query AccountBreadcrumb_account($slug: String!) {\\n  account(slug: $slug) {\\n    id\\n    slug\\n    name\\n    avatar {\\n      ...AccountAvatarFragment\\n      __typename\\n    }\\n    ...AccountPlanChip_Account\\n    __typename\\n  }\\n}\\n\\nfragment AccountAvatarFragment on AccountAvatar {\\n  url(size: 64)\\n  color\\n  initial\\n  __typename\\n}\\n\\nfragment AccountPlanChip_Account on Account {\\n  subscriptionStatus\\n  plan {\\n    id\\n    displayName\\n    __typename\\n  }\\n  __typename\\n}',
                    'text': '{"operationName":"AccountBreadcrumb_account","variables":{"slug":"kobenguyent"},"query":"query AccountBreadcrumb_account($slug: String!) {\\\\n  account(slug: $slug) {\\\\n    id\\\\n    slug\\\\n    name\\\\n    avatar {\\\\n      ...AccountAvatarFragment\\\\n      __typename\\\\n    }\\\\n    ...AccountPlanChip_Account\\\\n    __typename\\\\n  }\\\\n}\\\\n\\\\nfragment AccountAvatarFragment on AccountAvatar {\\\\n  url(size: 64)\\\\n  color\\\\n  initial\\\\n  __typename\\\\n}\\\\n\\\\nfragment AccountPlanChip_Account on Account {\\\\n  subscriptionStatus\\\\n  plan {\\\\n    id\\\\n    displayName\\\\n    __typename\\\\n  }\\\\n  __typename\\\\n}"}',
                    'variables': {
                        'slug': 'kobenguyent',
                    },
                },
                'headers': [
                    {
                        'name': 'accept',
                        'value': '*/*',
                    },
                    {
                        'name': 'accept-language',
                        'value': 'en-US,en;q=0.9,vi;q=0.8,de;q=0.7',
                    },
                    {
                        'name': 'authorization',
                        'value': 'Bearer token',
                    },
                    {
                        'name': 'content-type',
                        'value': 'application/json',
                    },
                ],
                'method': 'POST',
                'name': 'https://app.argos-ci.com/graphql',
                'parameters':  [],
                'parentId': '__WORKSPACE_ID__',
                'url': 'https://app.argos-ci.com/graphql',
            },
        ])
    })
})
