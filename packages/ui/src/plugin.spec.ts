// @vitest-environment edge-runtime

import { test, expect } from 'vitest'
import { createRequestContextForPlugin, createResponseContextForPlugin, usePlugin } from './plugin'
import { CollectionItem, RequestFinalResponse, RequestParam } from './global'
import { nanoid } from 'nanoid'

async function createExpose({ parameters = [] }: { parameters?: RequestParam[] } = {}) {
    const request: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
        parameters,
    }
    const environment: any = {}
    const setEnvironmentVariable = (key: string, value: string) => {
        environment[key] = value
    }
    const state = {
        testResults: []
    }

    const cacheId = nanoid()

    const { expose } = await createRequestContextForPlugin(cacheId, request, environment, setEnvironmentVariable, state.testResults)

    return { expose, environment }
}

function createResponseExpose(responseBuffer: ArrayBuffer) {
    const response: RequestFinalResponse = {
        _id: 'test',
        collectionId: '',
        url: '',
        status: 200,
        statusText: '',
        headers: [],
        mimeType: '',
        buffer: responseBuffer,
        timeTaken: 0,
        request: {} as any,
        createdAt: 0,
        testResults: [],
    }

    const environment: any = {}
    const setEnvironmentVariable = (key: string, value: string) => {
        environment[key] = value
    }

    const state = {
        testResults: [],
    }

    const { expose } = createResponseContextForPlugin(response, environment, setEnvironmentVariable, state.testResults)

    return { expose, environment }
}

test('import crypto-js from esm.sh', async() => {
    const { expose, environment } = await createExpose()

    await usePlugin(expose, {
        name: 'Test Plugin',
        code: `
            import CryptoJS from 'https://esm.sh/crypto-js@latest?target=es2020'

            var data = "cat"

            // Encrypt
            var ciphertext = CryptoJS.AES.encrypt(JSON.stringify(data), 'secret key 123').toString();

            // Decrypt
            var bytes  = CryptoJS.AES.decrypt(ciphertext, 'secret key 123');
            var decryptedData = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));

            rf.setEnvVar('decryptedText', decryptedData)
        `,
        parentPathForReadFile: null,
    })

    expect(environment.decryptedText).toBe('cat')
})

test('import pako from unpkg.com', async() => {
    const { expose, environment } = await createExpose()

    const code = JSON.parse(JSON.stringify(`
        import pako from 'https://unpkg.com/pako@2.1.0/dist/pako.esm.mjs?module'
        const buffer = rf.base64.toUint8Array('EAAAAB+LCAAAAAAAAAqrVvLMKy5JzEtOLVayio6tBQCx9ZeKEAAAAA==')
        const slicedBuffer = buffer.slice(4)
        const decompressedGzip = pako.inflate(slicedBuffer)
        const result = rf.arrayBuffer.toString(decompressedGzip)
        rf.setEnvVar('result', result)
    `))

    await usePlugin(expose, {
        name: 'Test Plugin',
        code,
        parentPathForReadFile: null,
    })

    expect(environment.result).toBe('{"Instances":[]}')
})

test('Setting query params over existing query params', async() => {
    {
        const parameters: RequestParam[] = [{ name: 'testKey', value: 'testValue' }]
        const { expose, environment } = await createExpose({ parameters })

        await usePlugin(expose, {
            name: 'Query Params Plugin',
            code: `
                const queryParams = rf.request.getQueryParams()
                rf.request.setQueryParams([...queryParams, { name: 'cat', value: '3' }])
                const updatedQueryParams = rf.request.getQueryParams()
                rf.setEnvVar('updatedQueryParams', JSON.stringify(updatedQueryParams))
            `,
            parentPathForReadFile: null,
        })

        expect(environment.updatedQueryParams).toBe(JSON.stringify([
            ...parameters,
            { name: 'cat', value: '3' },
        ]))
    }

    // tests for the case mentioned at https://github.com/flawiddsouza/Restfox/issues/110#issue-2218114329, now working:
    {
        const parameters: RequestParam[] = [{ name: 'testKey', value: 'testValue' }]
        const { expose, environment } = await createExpose({ parameters })

        await usePlugin(expose, {
            name: 'Query Params Plugin',
            code: `
                const queryParams = rf.request.getQueryParams()
                queryParams.push({ name: 'cat', value: '2' })
                queryParams.push({ name: 'cat', value: '3' })
                rf.request.setQueryParams(queryParams)
                const updatedQueryParams = rf.request.getQueryParams()
                rf.setEnvVar('updatedQueryParams', JSON.stringify(updatedQueryParams))
            `,
            parentPathForReadFile: null,
        })

        expect(environment.updatedQueryParams).toBe(JSON.stringify([
            ...parameters,
            { name: 'cat', value: '2' },
            { name: 'cat', value: '3' },
        ]))
    }
})

test('ungzip rf.response.getBody() using pako from unpkg.com', async() => {
    const responseBuffer = new TextEncoder().encode('EAAAAB+LCAAAAAAAAAqrVvLMKy5JzEtOLVayio6tBQCx9ZeKEAAAAA==').buffer
    const { expose, environment } = createResponseExpose(responseBuffer)

    await usePlugin(expose, {
        name: 'Test Plugin',
        code: `
            import pako from 'https://unpkg.com/pako@2.1.0/dist/pako.esm.mjs?module'

            const responseBody = rf.response.getBody()
            // this should work but it doesn't:
            // const bufferToString = rf.arrayBuffer.toString(responseBody)
            // for some reason new Uint8Array(...) wrap is needed - most likely a side effect of how we define vm.newFunction('rf.arrayBuffer.toString') in plugin.ts
            const bufferToString = rf.arrayBuffer.toString(new Uint8Array(responseBody))
            const buffer = rf.base64.toUint8Array(bufferToString)
            const bufferSlice = buffer.slice(4)
            const decompressedGzip = pako.inflate(bufferSlice)
            const uncompressedText = rf.arrayBuffer.toString(decompressedGzip)

            rf.setEnvVar('uncompressedText', uncompressedText)
        `,
        parentPathForReadFile: null,
    })

    expect(environment.uncompressedText).toBe('{"Instances":[]}')
})

test('ungzip rf.response.getBodyText() using pako from unpkg.com', async() => {
    const responseBuffer = new TextEncoder().encode('EAAAAB+LCAAAAAAAAAqrVvLMKy5JzEtOLVayio6tBQCx9ZeKEAAAAA==').buffer
    const { expose, environment } = createResponseExpose(responseBuffer)

    await usePlugin(expose, {
        name: 'Test Plugin',
        code: `
            import pako from 'https://unpkg.com/pako@2.1.0/dist/pako.esm.mjs?module'

            const responseBody = rf.response.getBodyText()
            const buffer = rf.base64.toUint8Array(responseBody)
            const bufferSlice = buffer.slice(4)
            const decompressedGzip = pako.inflate(bufferSlice)
            const uncompressedText = rf.arrayBuffer.toString(decompressedGzip)

            rf.setEnvVar('uncompressedText', uncompressedText)
        `,
        parentPathForReadFile: null,
    })

    expect(environment.uncompressedText).toBe('{"Instances":[]}')
})
