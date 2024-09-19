import {
    CollectionItem,
    HandleRequestState,
    RequestAuthentication,
    RequestParam,
} from '@/global'
import { createRequestData, substituteEnvironmentVariables } from '@/helpers'
import { HTTPSnippet, availableTargets } from 'httpsnippet-browser'

export function getAvailableTargets() {
    return availableTargets()
}

export async function generateCode(
    request: CollectionItem,
    environment: any,
    parentHeaders: Record<string, string>,
    parentAuthentication: RequestAuthentication | undefined,
    target: 'shell',
    clientId: 'curl'
) {
    const state: HandleRequestState = {
        currentPlugin: null,
        testResults: []
    }

    const requestData = await createRequestData(state, request, environment, parentHeaders, parentAuthentication, null, [], null)

    const har = {
        method: request.method,
        url: requestData.url.toString(),
        headers: Object.keys(requestData.headers).map(key => ({ name: key, value: requestData.headers[key] })),
        postData: request.body
    }

    if (har.postData && har.postData.mimeType) {
        if(har.postData.mimeType === 'application/x-www-form-urlencoded' || har.postData.mimeType === 'multipart/form-data') {
            har.postData.params = har.postData.params?.filter((param: RequestParam) => !param.disabled)
        }

        if(har.postData.mimeType === 'application/x-www-form-urlencoded') {
            const params = har.postData.params?.map(async(item: RequestParam) => {
                return {
                    name: await substituteEnvironmentVariables(environment, item.name),
                    value: await substituteEnvironmentVariables(environment, item.value)
                }
            })

            har.postData.params = params ? await Promise.all(params) : []
        }

        if(har.postData.mimeType === 'multipart/form-data') {
            for(const param of har.postData.params?.filter((param: RequestParam) => !param.disabled) ?? []) {
                if(param.type === 'text') {
                    param.name = await substituteEnvironmentVariables(environment, param.name)
                    param.value = await substituteEnvironmentVariables(environment, param.value)
                } else {
                    param.name = await substituteEnvironmentVariables(environment, param.name)
                }
            }
        }

        if(har.postData.mimeType === 'text/plain' || har.postData.mimeType === 'application/json' || har.postData.mimeType === 'application/graphql') {
            har.postData.text = await substituteEnvironmentVariables(environment, har.postData.text ?? '')
        }
    }

    const snippet = new HTTPSnippet(har)

    return snippet.convert(target, clientId, {
        indent: '    '
    })
}
