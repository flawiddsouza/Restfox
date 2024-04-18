import variant from '@jitl/quickjs-singlefile-browser-release-asyncify'
import { newQuickJSAsyncWASMModuleFromVariant, QuickJSContext, QuickJSHandle } from 'quickjs-emscripten-core'
const QuickJS = await newQuickJSAsyncWASMModuleFromVariant(variant)

import { Arena } from '@flawiddsouza/quickjs-emscripten-sync'
import getObjectPathValue from 'lodash.get'
import chai from 'chai'
import pako from 'pako'
import { substituteEnvironmentVariables } from './helpers'
import {
    CollectionItem,
    RequestParam,
    PluginTestResult,
    PluginExpose,
    RequestInitialResponseHeader,
    RequestFinalResponse,
    PluginExposeContext,
} from './global'

const test = (testResults: PluginTestResult[]) => (description: string, callback: () => void) => {
    try {
        callback()
        testResults.push({
            description,
            passed: true
        })
    } catch(error: any) {
        testResults.push({
            description,
            passed: false,
            error: error.message,
        })
    }
}

const generalContextMethodsBase = {
    base64: {
        toArrayBuffer(base64: string) {
            const binaryString = atob(base64)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i)
            }
            return bytes.buffer
        }
    },
    arrayBuffer: {
        toString(buffer: ArrayBuffer) {
            return new TextDecoder().decode(new Uint8Array(buffer))
        }
    }
}

export function createRequestContextForPlugin(request: CollectionItem, environment: any, setEnvironmentVariable: ((name: string, value: string) => void) | null, testResults: PluginTestResult[]): { expose: PluginExpose } {
    const state: CollectionItem = JSON.parse(JSON.stringify(request))

    if(state.body === undefined) {
        state.body = {
            mimeType: 'No Body'
        }
    }

    if(request.body?.params) {
        const params: RequestParam[] = []
        for(const param of request.body.params) {
            const paramExtracted = {...param}
            if(paramExtracted.files) {
                paramExtracted.files = [...paramExtracted.files] as File[]
            }
            params.push(paramExtracted)
        }
        state.body.params = params
    }

    if(request.body && 'fileName' in request.body) {
        state.body.fileName = request.body.fileName
    }

    const generalContextMethods = {
        ...generalContextMethodsBase,
        getEnvVar(objectPath: string) {
            return getObjectPathValue(environment, objectPath)
        },
        setEnvVar(objectPath: string, value: string) {
            if(setEnvironmentVariable) {
                setEnvironmentVariable(objectPath, value)
            }
        },
    }

    const context: PluginExposeContext = {
        ...generalContextMethods,
        request: {
            getURL() {
                if (state.url === undefined) {
                    return undefined
                }
                return substituteEnvironmentVariables(environment, state.url)
            },
            getMethod() {
                return state.method
            },
            getBody() {
                return state.body
            },
            setBody(requestBody: CollectionItem['body']) {
                state.body = requestBody
            },
            getQueryParams() {
                return state.parameters ?? []
            },
            setQueryParams(queryParams: CollectionItem['parameters']) {
                state.parameters = queryParams
            },
            getHeaders() {
                return state.headers
            },
            setHeaders(requestHeaders: CollectionItem['headers']) {
                state.headers = requestHeaders
            },
            getHeader(headerName: string) {
                if(state.headers === undefined) {
                    state.headers = []
                }
                const header = state.headers.find((header) => header.name.toLowerCase() == headerName.toLowerCase())
                return header ? substituteEnvironmentVariables(environment, header.value) : undefined
            },
            setHeader(headerName: string, value: string) {
                if(state.headers === undefined) {
                    state.headers = []
                }
                const headerIndex = state.headers.findIndex((header) => header.name.toLowerCase() == headerName.toLowerCase())
                if(headerIndex >= 0) {
                    state.headers[headerIndex].value = value
                } else {
                    state.headers.push({ name: headerName, value: value })
                }
            },
            // deprecated but won't be removed
            getEnvironmentVariable: generalContextMethods.getEnvVar,
            setEnvironmentVariable: generalContextMethods.setEnvVar,
        }
    }

    return {
        expose: {
            context, // deprecated but won't be removed
            rf: context,
            test: test(testResults),
        }
    }
}

export function createResponseContextForPlugin(response: RequestFinalResponse, environment: any, setEnvironmentVariable: (name: string, value: string) => void, testResults: PluginTestResult[]): { expose: PluginExpose } {
    let bufferCopy = response.buffer.slice(0)
    const headers = response.headers

    const generalContextMethods = {
        ...generalContextMethodsBase,
        getEnvVar(objectPath: string) {
            return getObjectPathValue(environment, objectPath)
        },
        setEnvVar(objectPath: string, value: string) {
            setEnvironmentVariable(objectPath, value)
        },
    }

    const context: PluginExposeContext = {
        ...generalContextMethods,
        response: {
            getBody() {
                return bufferCopy
            },
            getBodyText() {
                return (new TextDecoder('utf-8')).decode(bufferCopy)
            },
            getBodyJSON() {
                try {
                    return JSON.parse((new TextDecoder('utf-8')).decode(bufferCopy))
                } catch(e) {
                    return undefined
                }
            },
            setBody(buffer: ArrayBuffer) {
                bufferCopy = buffer
            },
            setBodyText(bodyText: string) {
                bufferCopy = (new TextEncoder()).encode(bodyText)
            },
            getURL() {
                return response.url
            },
            getHeaders() {
                return headers
            },
            getHeader(headerName: string) {
                const header = headers.find((header: RequestInitialResponseHeader) => header[0].toLowerCase() == headerName.toLowerCase())
                return header ? header[1] : undefined
            },
            // deprecated but won't be removed
            getEnvironmentVariable: generalContextMethods.getEnvVar,
            setEnvironmentVariable: generalContextMethods.setEnvVar,
        }
    }

    return {
        expose: {
            context, // deprecated but won't be removed
            rf: context,
            test: test(testResults),
        }
    }
}

function addAlertMethodToVM(vm: QuickJSContext) {
    const alertHandle = vm.newFunction('alert', (message) => {
        const messageString = vm.getString(message)
        window.createAlert(messageString)
    })
    vm.setProp(vm.global, 'alert', alertHandle)
    alertHandle.dispose()
}

function addAtobMethodToVM(vm: QuickJSContext) {
    const atobHandle = vm.newFunction('atob', (base64String) => {
        const base64 = vm.getString(base64String)
        const decoded = atob(base64)
        return vm.newString(decoded)
    })
    vm.setProp(vm.global, 'atob', atobHandle)
    atobHandle.dispose()
}

const freeHandles = new Set<QuickJSHandle>()

function addReadFileToVM(vm: QuickJSContext, parentPathForReadFile: string | null) {
    const readFileHandle = vm.newFunction('readFile', (pathHandle) => {
        const path = vm.getString(pathHandle)
        console.log('reading file', path)
        const promise = vm.newPromise()
        window.electronIPC.readFile(path, parentPathForReadFile).then((result: any) => {
            if(result.error) {
                const returnError = vm.newError(result.error)
                promise.reject(returnError)
                returnError.dispose()
            } else {
                const returnString = vm.newString(result.content || '')
                promise.resolve(returnString)
                returnString.dispose()
            }
        }).catch((error: any) => {
            console.log('error', error)
            const returnError = vm.newError(error)
            promise.reject(returnError)
            returnError.dispose()
        })
        // IMPORTANT: Once you resolve an async action inside QuickJS,
        // call runtime.executePendingJobs() to run any code that was
        // waiting on the promise or callback.
        promise.settled.then(vm.runtime.executePendingJobs)
        freeHandles.add(promise.handle)
        return promise.handle
    })

    vm.setProp(vm.global, 'readFile', readFileHandle)
    readFileHandle.dispose()
}

function checkIfCodeRequiresAsync(code: string) {
    const singleLineCommentPattern = /\/\/.*$/gm
    const multiLineCommentPattern = /\/\*[\s\S]*?\*\//gm

    const codeWithoutComments = code
        .replace(singleLineCommentPattern, '')
        .replace(multiLineCommentPattern, '')
        .trim()

    const asyncPattern = /\basync\b/
    const awaitPattern = /\bawait\b/
    const readFilePattern = /\breadFile\b/

    const hasAsync = asyncPattern.test(codeWithoutComments)
    const hasAwait = awaitPattern.test(codeWithoutComments)
    const usesReadFile = readFilePattern.test(codeWithoutComments)

    return hasAsync || hasAwait || usesReadFile
}

const globals = {
    console: {
        log: console.log
    },
    expect: chai.expect,
    assert: chai.assert,
    pako,
}

export async function usePlugin(expose: PluginExpose, plugin: { name: string, code: string, parentPathForReadFile: string | null }) {
    const vm = QuickJS.newContext()
    const arena = new Arena(vm, { isMarshalable: true })

    addAlertMethodToVM(vm)
    addAtobMethodToVM(vm)

    if(import.meta.env.MODE === 'desktop-electron') {
        addReadFileToVM(vm, plugin.parentPathForReadFile)
    }

    arena.expose({
        ...globals,
        ...expose,
    })

    const requiresAsync = checkIfCodeRequiresAsync(plugin.code)

    try {
        console.log(`Executing plugin: ${plugin.name}`)

        if(plugin.code.trim() === '') {
            console.log('Plugin code is empty, skipping execution')
            return
        }

        let codeToExecute = plugin.code

        if(requiresAsync) {
            console.log('Plugin code requires async, wrapping in async function')
            codeToExecute = `
                async function main() {
                    try {
                        ${codeToExecute}
                    } catch(e) {
                        throw e
                    }
                }

                main()
            `
        }

        const result = await vm.evalCodeAsync(codeToExecute)

        if(requiresAsync) {
            const executedPendingJobsCount = arena.executePendingJobs()
            console.log(`Executed ${executedPendingJobsCount} pending jobs`)
        }

        if ('value' in result) {
            const resultHandle = result.value
            const resultValue = vm.dump(resultHandle)
            if(resultValue) {
                if(resultValue.type === 'rejected') {
                    throw resultValue.error
                } else {
                    console.log('Result', resultValue)
                }
                if(resultHandle.alive) {
                    resultHandle.dispose()
                }
            }
        }

        if (result.error) {
            const errorHandle = result.error
            const error = vm.dump(errorHandle)
            if(errorHandle.alive) {
                errorHandle.dispose()
            }
            throw error
        }
    } catch(e: any) {
        console.log(e)
        let lineNumber = ''
        if(e.lineNumber !== null && e.lineNumber !== undefined) {
            lineNumber = e.lineNumber
        } else {
            const lineNumberInfo = /\(eval\.js:(.*?)\)/.exec(e.stack)
            if(lineNumberInfo) {
                lineNumber = lineNumberInfo[1]
            }
        }

        const parsedLineNumber = Number(lineNumber)

        if(!isNaN(parsedLineNumber)) {
            if(parsedLineNumber === 0) {
                lineNumber = '1'
            } else {
                lineNumber = (parsedLineNumber - (requiresAsync ? 3 : 0)).toString()
            }
        }

        const error = new Error('Unable to parse plugin');
        (error as any).lineNumber = lineNumber;
        (error as any).originalError = e
        throw error
    }

    // dispose the VM after 5 seconds, to avoid error QuickJSUseAfterFree: Lifetime not alive
    setTimeout(() => {
        freeHandles.forEach((handle) => {
            if(handle.alive) {
                handle.dispose()
            }
        })
        arena.dispose()
        vm.dispose()
        console.log(`Plugin ${plugin.name}: 5 seconds elapsed, clean up completed`)
    }, 5000)
}
