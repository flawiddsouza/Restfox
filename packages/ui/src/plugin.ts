import { getQuickJS } from 'quickjs-emscripten'
import { Arena } from 'quickjs-emscripten-sync'
import getObjectPathValue from 'lodash.get'
import chai from 'chai'
import { substituteEnvironmentVariables } from './helpers'
import {
    CollectionItem,
    RequestParam,
    Plugin,
    PluginTestResult,
    PluginExpose,
    RequestInitialResponseHeader,
    RequestFinalResponse,
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

export function createRequestContextForPlugin(request: CollectionItem, environment: any, setEnvironmentVariable: ((name: string, value: string) => void) | null, testResults: PluginTestResult[]) {
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

    return {
        context: {
            request: {
                getMethod() {
                    return state.method
                },
                getBody() {
                    return state.body
                },
                getEnvironmentVariable(objectPath: string) {
                    return getObjectPathValue(environment, objectPath)
                },
                setBody(requestBody: CollectionItem['body']) {
                    state.body = requestBody
                },
                setEnvironmentVariable(objectPath: string, value: string) {
                    if(setEnvironmentVariable) {
                        setEnvironmentVariable(objectPath, value)
                    }
                },
                getQueryParams() {
                    return state.parameters ?? []
                },
                setQueryParams(queryParams: CollectionItem['parameters']) {
                    state.parameters = queryParams
                },
                getURL() {
                    if (state.url === undefined) {
                        return undefined
                    }
                    return substituteEnvironmentVariables(environment, state.url)
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
                }
            }
        },
        expose: {
            expect: chai.expect,
            assert: chai.assert,
            test: test(testResults),
        }
    }
}

export function createResponseContextForPlugin(response: RequestFinalResponse, environment: any, setEnvironmentVariable: (name: string, value: string) => void, testResults: PluginTestResult[]) {
    let bufferCopy = response.buffer.slice(0)
    const headers = response.headers

    return {
        context: {
            response: {
                getBody() {
                    return bufferCopy
                },
                getBodyText() {
                    return (new TextDecoder('utf-8')).decode(bufferCopy)
                },
                getEnvironmentVariable(objectPath: string) {
                    return getObjectPathValue(environment, objectPath)
                },
                setBody(buffer: ArrayBuffer) {
                    bufferCopy = buffer
                },
                setBodyText(bodyText: string) {
                    bufferCopy = (new TextEncoder()).encode(bodyText)
                },
                setEnvironmentVariable(objectPath: string, value: string) {
                    setEnvironmentVariable(objectPath, value)
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
                }
            }
        },
        expose: {
            expect: chai.expect,
            assert: chai.assert,
            test: test(testResults),
        }
    }
}

export async function usePlugin(context: any, expose: PluginExpose, plugin: Partial<Plugin>) {
    const vm = (await getQuickJS()).newContext()
    const arena = new Arena(vm, { isMarshalable: true })

    arena.expose({
        console: {
            log: console.log
        },
        context,
        ...expose,
    })

    try {
        arena.evalCode(plugin.code ?? '')
    } catch(e) {
        console.log(e)
        // console.log(plugin.code.split('\n').slice(e.lineNumber - 3, e.lineNumber + 3).join('\n'))
        const error = new Error('Unable to parse plugin');
        (error as any).originalError = e
        throw error
    }

    arena.dispose()
    vm.dispose()
}
