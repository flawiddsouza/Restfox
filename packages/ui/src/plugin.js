import { getQuickJS } from 'quickjs-emscripten'
import { Arena } from 'quickjs-emscripten-sync'
import getObjectPathValue from 'lodash.get'
import chai from 'chai'
import { substituteEnvironmentVariables } from './helpers'

const test = (testResults) => (description, callback) => {
    try {
        callback()
        testResults.push({
            description,
            passed: true
        })
    } catch(error) {
        testResults.push({
            description,
            passed: false,
            error: error.message,
        })
    }
}

export function createRequestContextForPlugin(request, environment, setEnvironmentVariable, testResults) {
    let state = JSON.parse(JSON.stringify(request))

    if('params' in request) {
        let params = []
        for(const param of request.params) {
            let paramExtracted = {...param}
            if('files' in paramExtracted) {
                paramExtracted.files = [...paramExtracted.files]
            }
            params.push(paramExtracted)
        }
        state.body.params = params
    }

    if('fileName' in request.body) {
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
                getEnvironmentVariable(objectPath) {
                    return getObjectPathValue(environment, objectPath)
                },
                setBody(requestBody) {
                    state.body = requestBody
                },
                setEnvironmentVariable(objectPath, value) {
                    setEnvironmentVariable(objectPath, value)
                },
                getQueryParams() {
                    return state.parameters ?? []
                },
                setQueryParams(queryParams) {
                    state.parameters = queryParams
                },
                getURL() {
                    return substituteEnvironmentVariables(environment, state.url)
                },
                getHeaders() {
                    return state.headers
                },
                setHeaders(requestHeaders) {
                    state.headers = requestHeaders
                },
                getHeader(headerName) {
                    var header = state.headers.find((header) => header.name.toLowerCase() == headerName.toLowerCase())
                    return header ? substituteEnvironmentVariables(environment, header.value) : undefined
                },
                setHeader(headerName, value) {
                    var headerIndex = state.headers.findIndex((header) => header.name.toLowerCase() == headerName.toLowerCase())
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

export function createResponseContextForPlugin(response, environment, setEnvironmentVariable, testResults) {
    let bufferCopy = response.buffer.slice(0)
    let headers = response.headers

    return {
        context: {
            response: {
                getBody() {
                    return bufferCopy
                },
                getBodyText() {
                    return (new TextDecoder('utf-8')).decode(bufferCopy)
                },
                getEnvironmentVariable(objectPath) {
                    return getObjectPathValue(environment, objectPath)
                },
                setBody(buffer) {
                    bufferCopy = buffer
                },
                setBodyText(bodyText) {
                    bufferCopy = (new TextEncoder('utf-8')).encode(bodyText)
                },
                setEnvironmentVariable(objectPath, value) {
                    setEnvironmentVariable(objectPath, value)
                },
                getURL() {
                    return response.url
                },
                getHeaders() {
                    return headers
                },
                getHeader(headerName) {
                    var header = headers.find((header) => header[0].toLowerCase() == headerName.toLowerCase())
                    return header ? substituteEnvironmentVariables(environment, header[1]) : undefined
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

export async function usePlugin(context, expose, plugin) {
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
        arena.evalCode(plugin.code)
    } catch(e) {
        console.log(e)
        // console.log(plugin.code.split('\n').slice(e.lineNumber - 3, e.lineNumber + 3).join('\n'))
        const error = new Error('Unable to parse plugin')
        error.originalError = e
        throw error
    }

    arena.dispose()
    vm.dispose()
}
