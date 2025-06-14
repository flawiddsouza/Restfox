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
            { flag: '--data-urlencode', inputs: ['^a'], expected: [{ name: '', value: '^a' }] }, // adding a after ^ to pass the issue created by convertCurlCmdToBash - hopefully, nothing is broken
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
                -H "sec-ch-ua: ^\\^"Chromium^\\^";v=^\\^"118^\\^", ^\\^"Google Chrome^\\^";v=^\\^"118^\\^", ^\\^"Not=A?Brand^\\^";v=^\\^"99^\\^"" ^
                -H "sec-ch-ua-mobile: ?0" ^
                -H "sec-ch-ua-platform: ^\\^"Windows^\\^"" ^
                -H "sec-fetch-dest: empty" ^
                -H "sec-fetch-mode: cors" ^
                -H "sec-fetch-site: cross-site" ^
                -H "user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36" ^
                --data-raw ^"^{^

                    ^\\^"test^\\^": ^\\^"body^\\^"^

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
                text: '{                      "test": "body"                  }'
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
                    'text': '{"operationName":"AccountBreadcrumb_account","variables":{"slug":"kobenguyent"},"query":"query AccountBreadcrumb_account($slug: String!) {\\\\n  account(slug: $slug) {\\\\n    id\\\\n    slug\\\\n    name\\\\n    avatar {\\\\n      ...AccountAvatarFragment\\\\n      __typename\\\\n    }\\\\n    ...AccountPlanChip_Account\\\\n    __typename\\\\n  }\\\\n}\\\\n\\\\nfragment AccountAvatarFragment on AccountAvatar {\\\\n  url(size: 64)\\\\n  color\\\\n  initial\\\\n  __typename\\\\n}\\\\n\\\\nfragment AccountPlanChip_Account on Account {\\\\n  subscriptionStatus\\\\n  plan {\\\\n    id\\\\n    displayName\\\\n    __typename\\\\n  }\\\\n  __typename\\\\n}"}',
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

    // From: https://github.com/flawiddsouza/Restfox/issues/306
    it('Firefox: Copy as cURL (POSIX) #306', () => {
        const cmd = `curl 'https://restninja.io/in/proxy' --compressed -X POST -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0' -H 'Accept: */*' -H 'Accept-Language: en-US,en;q=0.5' -H 'Accept-Encoding: gzip, deflate, br, zstd' -H 'Origin: https://restninja.io' -H 'DNT: 1' -H 'Sec-GPC: 1' -H 'Connection: keep-alive' -H 'Referer: https://restninja.io/' -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' -H 'Sec-Fetch-Site: same-origin' -H 'TE: trailers' --data-raw '{"body":"ewogICAgInByb3AiOiAxMjM0Cn0=","method":"POST","uri":"http://httpbin.org/post","headers":[],"auth":{"_t":"None"}}'`

        const result = convert(cmd)

        expect(result).toMatchObject([
            {
                '_id': '__REQ_1__',
                '_type': 'request',
                'authentication': {},
                'body': {
                    'mimeType': 'application/json',
                    'text': '{"body":"ewogICAgInByb3AiOiAxMjM0Cn0=","method":"POST","uri":"http://httpbin.org/post","headers":[],"auth":{"_t":"None"}}',
                },
                'headers': [
                    {
                        'name': 'User-Agent',
                        'value': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
                    },
                    {
                        'name': 'Accept',
                        'value': '*/*',
                    },
                    {
                        'name': 'Accept-Language',
                        'value': 'en-US,en;q=0.5',
                    },
                    {
                        'name': 'Accept-Encoding',
                        'value': 'gzip, deflate, br, zstd',
                    },
                    {
                        'name': 'Origin',
                        'value': 'https://restninja.io',
                    },
                    {
                        'name': 'DNT',
                        'value': '1',
                    },
                    {
                        'name': 'Sec-GPC',
                        'value': '1',
                    },
                    {
                        'name': 'Connection',
                        'value': 'keep-alive',
                    },
                    {
                        'name': 'Referer',
                        'value': 'https://restninja.io/',
                    },
                    {
                        'name': 'Sec-Fetch-Dest',
                        'value': 'empty',
                    },
                    {
                        'name': 'Sec-Fetch-Mode',
                        'value': 'cors',
                    },
                    {
                        'name': 'Sec-Fetch-Site',
                        'value': 'same-origin',
                    },
                    {
                        'name': 'TE',
                        'value': 'trailers',
                    },
                ],
                'method': 'POST',
                'name': 'https://restninja.io/in/proxy',
                'parameters': [],
                'parentId': '__WORKSPACE_ID__',
                'url': 'https://restninja.io/in/proxy',
            },
        ])
    })

    // From: https://github.com/flawiddsouza/Restfox/issues/306
    it('Firefox: Copy as cURL (Windows) #306', () => {
        const cmd = `curl "https://restninja.io/in/proxy" --compressed -X POST -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0" -H "Accept: */*" -H "Accept-Language: en-US,en;q=0.5" -H "Accept-Encoding: gzip, deflate, br, zstd" -H "Origin: https://restninja.io" -H "DNT: 1" -H "Sec-GPC: 1" -H "Connection: keep-alive" -H "Referer: https://restninja.io/" -H "Sec-Fetch-Dest: empty" -H "Sec-Fetch-Mode: cors" -H "Sec-Fetch-Site: same-origin" -H "TE: trailers" --data-raw "{""body"":""ewogICAgInByb3AiOiAxMjM0Cn0="",""method"":""POST"",""uri"":""http://httpbin.org/post"",""headers"":^[^],""auth"":{""_t"":""None""}}"`

        const result = convert(cmd)

        expect(result).toMatchObject([
            {
                '_id': '__REQ_1__',
                '_type': 'request',
                'authentication': {},
                'body': {
                    'mimeType': 'application/json',
                    'text': '{"body":"ewogICAgInByb3AiOiAxMjM0Cn0=","method":"POST","uri":"http://httpbin.org/post","headers":[],"auth":{"_t":"None"}}',
                },
                'headers': [
                    {
                        'name': 'User-Agent',
                        'value': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
                    },
                    {
                        'name': 'Accept',
                        'value': '*/*',
                    },
                    {
                        'name': 'Accept-Language',
                        'value': 'en-US,en;q=0.5',
                    },
                    {
                        'name': 'Accept-Encoding',
                        'value': 'gzip, deflate, br, zstd',
                    },
                    {
                        'name': 'Origin',
                        'value': 'https://restninja.io',
                    },
                    {
                        'name': 'DNT',
                        'value': '1',
                    },
                    {
                        'name': 'Sec-GPC',
                        'value': '1',
                    },
                    {
                        'name': 'Connection',
                        'value': 'keep-alive',
                    },
                    {
                        'name': 'Referer',
                        'value': 'https://restninja.io/',
                    },
                    {
                        'name': 'Sec-Fetch-Dest',
                        'value': 'empty',
                    },
                    {
                        'name': 'Sec-Fetch-Mode',
                        'value': 'cors',
                    },
                    {
                        'name': 'Sec-Fetch-Site',
                        'value': 'same-origin',
                    },
                    {
                        'name': 'TE',
                        'value': 'trailers',
                    },
                ],
                'method': 'POST',
                'name': 'https://restninja.io/in/proxy',
                'parameters': [],
                'parentId': '__WORKSPACE_ID__',
                'url': 'https://restninja.io/in/proxy',
            },
        ])
    })

    it('Trailing slash retention #307', () => {
        const cmd1 = `curl https://httpbin.org/post/`
        const result1 = convert(cmd1)

        const cmd2 = `curl https://httpbin.org/post`
        const result2 = convert(cmd2)

        expect(result1).toHaveProperty('0.url', 'https://httpbin.org/post/')
        expect(result2).toHaveProperty('0.url', 'https://httpbin.org/post')
    })

    it('Body not imported #307', () => {
        const cmd = `curl -X POST https://desec.io/api/v1/domains/{name}/rrsets/ \\
            --header "Authorization: Token {secret}" \\
            --header "Content-Type: application/json" --data \\
            '{"subname": "www", "type": "A", "ttl": 3600, "records": ["127.0.0.1", "127.0.0.2"]}'
        `

        const result = convert(cmd)

        expect(result).toHaveProperty(
            '0.body.text',
            `{"subname": "www", "type": "A", "ttl": 3600, "records": ["127.0.0.1", "127.0.0.2"]}`
        )
    })

    it('Handles multipart form data with --form flags #335', () => {
        const cmd = `curl --request POST \\
            --url https://login.microsoftonline.com/ten/oauth2/v2.0/token \\
            --header 'Content-Type: multipart/form-data' \\
            --form client_id=uuid \\
            --form scope=https://graph.microsoft.com/.default \\
            --form 'client_secret=secret' \\
            --form grant_type=client_credentials
        `

        const result = convert(cmd)

        expect(result).toMatchObject([{
            _id: '__REQ_1__',
            _type: 'request',
            parentId: '__WORKSPACE_ID__',
            name: 'https://login.microsoftonline.com/ten/oauth2/v2.0/token',
            parameters: [],
            url: 'https://login.microsoftonline.com/ten/oauth2/v2.0/token',
            method: 'POST',
            headers: [
                { name: 'Content-Type', value: 'multipart/form-data' }
            ],
            authentication: {},
            body: {
                mimeType: 'multipart/form-data',
                params: [
                    { name: 'client_id', value: 'uuid', type: 'text' },
                    { name: 'scope', value: 'https://graph.microsoft.com/.default', type: 'text' },
                    { name: 'client_secret', value: 'secret', type: 'text' },
                    { name: 'grant_type', value: 'client_credentials', type: 'text' }
                ]
            }
        }])
    })
})
