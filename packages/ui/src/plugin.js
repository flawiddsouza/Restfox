import { getQuickJS } from 'quickjs-emscripten'
import { Arena } from 'quickjs-emscripten-sync'
import getObjectPathValue from 'lodash.get'

export function createRequestContextForPlugin(request, environment) {
    let state = JSON.parse(JSON.stringify(request))

    return {
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
            getQueryParams() {
                return state.parameters
            },
            setQueryParams(queryParams) {
                state.parameters = queryParams
            }
        }
    }
}

export function createResponseContextForPlugin(response, environment) {
    let bufferCopy = response.buffer.slice(0)

    return {
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
            }
        }
    }
}

export async function usePlugin(context, plugin) {
    const vm = (await getQuickJS()).newContext()
    const arena = new Arena(vm, { isMarshalable: true })

    arena.expose({
        console: {
            log: console.log
        },
        context
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
