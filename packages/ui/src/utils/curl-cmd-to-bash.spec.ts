import { test, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { convertCurlCmdToBash } from './curl-cmd-to-bash'

async function runTest(type: string) {
    const currentFolder = process.cwd()
    const testDataFolder = path.resolve(path.join(currentFolder,'test-data', 'curl-cmd-to-bash'))

    const input = await readFile(path.join(testDataFolder, `${type}_input.txt`), 'utf-8')
    const expectedOutput = await readFile(path.join(testDataFolder, `${type}_output.txt`), 'utf-8')
    const output = convertCurlCmdToBash(input)

    expect(output).toBe(expectedOutput)
}

test('convertCurlCmdToBash - Type 1', async() => {
    await runTest('1')
})

test('convertCurlCmdToBash - Type 2', async() => {
    await runTest('2')
})

test('convertCurlCmdToBash - Type 3', async() => {
    await runTest('3')
})
