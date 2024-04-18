// @vitest-environment edge-runtime

import { test, expect } from 'vitest'
import { createRequestContextForPlugin, usePlugin } from './plugin'
import { CollectionItem } from './global'

function createExpose() {
    const request: CollectionItem = {
        _id: 'test',
        _type: 'request',
        parentId: 'test',
        workspaceId: 'test',
        name: 'test',
    }
    const environment: any = {}
    const setEnvironmentVariable = (key: string, value: string) => {
        environment[key] = value
    }
    const state = {
        testResults: []
    }

    const { expose } = createRequestContextForPlugin(request, environment, setEnvironmentVariable, state.testResults)

    return { expose, environment }
}

test('import crypto-js from esm.sh', async() => {
    const { expose, environment } = createExpose()

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
