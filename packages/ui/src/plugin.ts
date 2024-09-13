import variant from '@jitl/quickjs-singlefile-browser-release-asyncify'
import { newQuickJSAsyncWASMModuleFromVariant, QuickJSAsyncContext, QuickJSContext, QuickJSHandle } from 'quickjs-emscripten-core'
const QuickJS = await newQuickJSAsyncWASMModuleFromVariant(variant)

import { Arena } from '@flawiddsouza/quickjs-emscripten-sync'
import getObjectPathValue from 'lodash.get'
import chai from 'chai'
import { fetchWrapper, substituteEnvironmentVariables } from './helpers'
import {
    CollectionItem,
    RequestParam,
    PluginTestResult,
    PluginExpose,
    RequestInitialResponseHeader,
    RequestFinalResponse,
    PluginExposeContext,
} from './global'
import constants from './constants'

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
        toUint8Array(base64: string) {
            const binaryString = atob(base64)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i)
            }
            return bytes
        },
        fromUint8Array(uint8Array: Uint8Array) {
            let binaryString = ''
            for (let i = 0; i < uint8Array.byteLength; i++) {
                binaryString += String.fromCharCode(uint8Array[i])
            }
            return btoa(binaryString)
        },
    },
    arrayBuffer: {
        toString(buffer: ArrayBuffer) {
            return new TextDecoder().decode(new Uint8Array(buffer))
        },
        fromString(string: string) {
            return new TextEncoder().encode(string)
        },
    },
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
        const decoded = window.atob(base64)
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

function addFetchSyncToVM(vm: QuickJSAsyncContext) {
    const fetchSyncHandle = vm.newAsyncifiedFunction('fetchSync', async(urlHandle, optionsHandle) => {
        const url = vm.getString(urlHandle)
        const options: RequestInit = optionsHandle ? vm.dump(optionsHandle) : {}

        const abortController = new AbortController()

        const savedDisableSSLVerification = localStorage.getItem(constants.LOCAL_STORAGE_KEY.DISABLE_SSL_VERIFICATION)

        const flags = {
            electronSwitchToChromiumFetch: false,
            disableSSLVerification: savedDisableSSLVerification === 'true' ? true : false,
        }
        const emptyHeaders: Record<string, string> = {}
        const response = await fetchWrapper(
            new URL(url),
            options.method ?? 'GET',
            options.headers as any ?? emptyHeaders,
            options.body,
            abortController.signal,
            flags
        )

        const responseBuffer = vm.newArrayBuffer(response.buffer)
        const responseStatus = vm.newNumber(response.status)
        const responseStatusText = vm.newString(response.statusText)

        const responseObject = vm.newObject()

        vm.setProp(responseObject, 'status', responseStatus)
        vm.setProp(responseObject, 'statusText', responseStatusText)

        const responseHeaders = vm.evalCode(`
            {
                const escapedText = JSON.stringify(${JSON.stringify(response.headers)})
                const headersArray = JSON.parse(escapedText)
                const headers = new Headers(headersArray)
                headers
            }
        `)

        vm.setProp(responseObject, 'headers', vm.unwrapResult(responseHeaders))
        vm.setProp(responseObject, 'arrayBuffer', vm.newFunction('arrayBuffer', () => responseBuffer))

        const text = new TextDecoder().decode(response.buffer)

        vm.setProp(responseObject, 'text', vm.newFunction('text', () => vm.newString(text)))
        vm.setProp(responseObject, 'json', vm.newFunction('json', () => {
            const escapedText = JSON.stringify(text)
            const jsonString = `JSON.parse(${escapedText})`
            return vm.evalCode(jsonString)
        }))

        return responseObject
    })
    vm.setProp(vm.global, 'fetchSync', fetchSyncHandle)
    fetchSyncHandle.dispose()
}

function setDeepProperty(vm: QuickJSContext, path: string, value: QuickJSHandle) {
    const properties = path.split('.')
    let target: QuickJSHandle = vm.global

    for (let i = 0; i < properties.length - 1; i++) {
        target = vm.getProp(target, properties[i])
    }

    vm.setProp(target, properties[properties.length - 1], value)
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
    // crypto-js throws 'Native crypto module could not be used to get secure random number.' if the below two are missing:
    crypto: window.crypto,
    Uint32Array(...args: any) {
        return Reflect.construct(Uint32Array, args)
    },
    // Headers is used by fetchSync - we need this as it's not implemented by QuickJS
    Headers(...args: any) {
        return Reflect.construct(Headers, args)
    },
}

const runtime = QuickJS.newRuntime()

let lastModulePath = ''

runtime.setModuleLoader(async(modulePath) => {
    if(modulePath.startsWith('/') === false) {
        lastModulePath = ''
    }
    console.log('Loading module', modulePath, lastModulePath + modulePath)
    const response = await fetch(lastModulePath + modulePath)
    const moduleSource = await response.text()
    if(modulePath.startsWith('/') === false) {
        if(modulePath.startsWith('https://esm.sh/')) {
            lastModulePath = 'https://esm.sh'
        }
    }
    return moduleSource
})

export async function usePlugin(expose: PluginExpose, plugin: { name: string, code: string, parentPathForReadFile: string | null }) {
    const vm = runtime.newContext()
    const arena = new Arena(vm, { isMarshalable: true })

    addAlertMethodToVM(vm)
    addAtobMethodToVM(vm)

    if(import.meta.env.MODE === 'desktop-electron') {
        addReadFileToVM(vm, plugin.parentPathForReadFile)
    }

    addFetchSyncToVM(vm)

    arena.expose({
        ...globals,
        ...expose,
    })

    vm.newFunction('rf.arrayBuffer.toString', (arrayBufferHandle) => {
        // logically, this should work, but it doesn't
        // const arrayBuffer = vm.getArrayBuffer(arrayBufferHandle)
        // const string = expose.rf.arrayBuffer.toString(arrayBuffer.value)
        // return vm.newString(string)
        // so we do this:
        const buffer = vm.dump(arrayBufferHandle)
        const string = expose.rf.arrayBuffer.toString(new Uint8Array(Object.values(buffer)))
        return vm.newString(string)
    }).consume(func => {
        setDeepProperty(vm, 'rf.arrayBuffer.toString', func)
    })

    vm.newFunction('rf.base64.toUint8Array', (base64Handle) => {
        const base64 = vm.getString(base64Handle)
        const uint8Array = expose.rf.base64.toUint8Array(base64)
        return vm.unwrapResult(vm.evalCode(`new Uint8Array(${JSON.stringify(Array.from(uint8Array))})`))
    }).consume(func => {
        setDeepProperty(vm, 'rf.base64.toUint8Array', func)
    })

    if(expose.rf.request) {
        // not required looks like, only setQueryParams needed to be overridden
        // vm.newFunction('rf.request.getQueryParams', () => {
        //     console.log('getQueryParams')
        //     const queryParams = expose.rf.request.getQueryParams()
        //     const stringifiedQueryParams = JSON.stringify(queryParams)
        //     return vm.unwrapResult(vm.evalCode(`JSON.parse(\`${stringifiedQueryParams}\`)`))
        // }).consume(func => {
        //     setDeepProperty(vm, 'rf.request.getQueryParams', func)
        // })

        vm.newFunction('rf.request.setQueryParams', (queryParamsHandle) => {
            const queryParams = vm.dump(queryParamsHandle)
            expose.rf.request.setQueryParams(queryParams)
        }).consume(func => {
            setDeepProperty(vm, 'rf.request.setQueryParams', func)
        })
    }

    if(expose.rf.response) {
        vm.newFunction('rf.response.getBody', () => {
            const originalBody = expose.rf.response.getBody()
            return vm.newArrayBuffer(originalBody)
        }).consume(func => {
            vm.setProp(vm.getProp(vm.getProp(vm.global, 'rf'), 'response'), 'getBody', func)
        })
    }

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
