import { createRequestData, substituteEnvironmentVariables } from '@/helpers'
import { HTTPSnippet } from 'httpsnippet-browser'

export async function generateCode(request, environment, target: 'shell', clientId: 'curl') {
    const state = {
        currentPlugin: null
    }

    const requestData = await createRequestData(state, request, environment, null, [])

    const har = {
        method: request.method,
        url: requestData.url.toString(),
        headers: Object.keys(requestData.headers).map(key => ({ name: key, value: requestData.headers[key] })),
        postData: request.body
    }

    if (har.postData.mimeType) {
        if(har.postData.mimeType === 'application/x-www-form-urlencoded' || har.postData.mimeType === 'multipart/form-data') {
            har.postData.params = har.postData.params.filter(param => !param.disabled)
        }

        if(har.postData.mimeType === 'application/x-www-form-urlencoded') {
            har.postData.params = har.postData.params.map(item => {
                return {
                    name: substituteEnvironmentVariables(environment, item.name),
                    value: substituteEnvironmentVariables(environment, item.value)
                }
            })
        }

        if(har.postData.mimeType === 'multipart/form-data') {
            har.postData.params.forEach(param => {
                if(param.type === 'text') {
                    param.name = substituteEnvironmentVariables(environment, param.name)
                    param.value = substituteEnvironmentVariables(environment, param.value)
                } else {
                    param.name = substituteEnvironmentVariables(environment, param.name)
                }
            })
        }

        if(har.postData.mimeType === 'text/plain' || har.postData.mimeType === 'application/json' || har.postData.mimeType === 'application/graphql') {
            har.postData.text = substituteEnvironmentVariables(environment, har.postData.text)
        }
    }

    const snippet = new HTTPSnippet(har)

    return snippet.convert(target, clientId, {
        indent: '    '
    })
}
