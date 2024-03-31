import { QuickJSContext, getQuickJS } from 'quickjs-emscripten'
import { Arena } from 'quickjs-emscripten-sync'
import getObjectPathValue from 'lodash.get'
import chai from 'chai'
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
        getEnvironmentVariable(objectPath: string) {
            return getObjectPathValue(environment, objectPath)
        },
        setEnvironmentVariable(objectPath: string, value: string) {
            if(setEnvironmentVariable) {
                setEnvironmentVariable(objectPath, value)
            }
        },
    }

    const context: PluginExposeContext = {
        getEnvVar: generalContextMethods.getEnvironmentVariable,
        setEnvVar: generalContextMethods.setEnvironmentVariable,
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
            getEnvironmentVariable: generalContextMethods.getEnvironmentVariable,
            setEnvironmentVariable: generalContextMethods.setEnvironmentVariable,
        }
    }

    return {
        expose: {
            context,
            rf: context,
            expect: chai.expect,
            assert: chai.assert,
            test: test(testResults),
        }
    }
}

export function createResponseContextForPlugin(response: RequestFinalResponse, environment: any, setEnvironmentVariable: (name: string, value: string) => void, testResults: PluginTestResult[]): { expose: PluginExpose } {
    let bufferCopy = response.buffer.slice(0)
    const headers = response.headers

    const generalContextMethods = {
        getEnvironmentVariable(objectPath: string) {
            return getObjectPathValue(environment, objectPath)
        },
        setEnvironmentVariable(objectPath: string, value: string) {
            setEnvironmentVariable(objectPath, value)
        },
    }

    const context: PluginExposeContext = {
        getEnvVar: generalContextMethods.getEnvironmentVariable,
        setEnvVar: generalContextMethods.setEnvironmentVariable,
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
            getEnvironmentVariable: generalContextMethods.getEnvironmentVariable,
            setEnvironmentVariable: generalContextMethods.setEnvironmentVariable,
        }
    }

    return {
        expose: {
            context, // deprecated but won't be removed
            rf: context,
            expect: chai.expect,
            assert: chai.assert,
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

export async function usePlugin(expose: PluginExpose, plugin: { code: string }) {
    const vm = (await getQuickJS()).newContext()
    const arena = new Arena(vm, { isMarshalable: true })

    addAlertMethodToVM(vm)

    arena.expose({
        console: {
            log: console.log
        },
        ...expose,
    })

    try {
        arena.evalCode(plugin.code ?? '')
    } catch(e) {
        console.log(e)
        const error = new Error('Unable to parse plugin');
        (error as any).originalError = e
        throw error
    }

    arena.dispose()
    vm.dispose()
}
