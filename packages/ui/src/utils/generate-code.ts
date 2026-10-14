import {
    CollectionItem,
    HandleRequestState,
    RequestAuthentication,
    RequestParam,
} from '@/global'
import { createRequestData, getEditorConfig, getSpaces, SendResolver } from '@/helpers'
import { HTTPSnippet, availableTargets } from 'httpsnippet-browser'

export function getAvailableTargets() {
    return availableTargets()
}

export async function generateCode(
    request: CollectionItem,
    environment: any,
    parentHeaders: Record<string, string[]>,
    parentAuthentication: RequestAuthentication | undefined,
    target: 'shell',
    clientId: 'curl'
) {
    // one send for prompt tags, so a prompt in the url and the body asks once. The code is shown, never saved
    const send = new SendResolver(request.workspaceId)

    const state: HandleRequestState = {
        currentPlugin: null,
        testResults: []
    }

    const requestData = await createRequestData(state, request, environment, parentHeaders, parentAuthentication, null, [], null, send)

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
                    name: await send.resolve(environment, item.name, 'unsaved'),
                    value: await send.resolve(environment, item.value, 'unsaved')
                }
            })

            har.postData.params = params ? await Promise.all(params) : []
        }

        if(har.postData.mimeType === 'multipart/form-data') {
            for(const param of har.postData.params?.filter((param: RequestParam) => !param.disabled) ?? []) {
                if(param.type === 'text') {
                    param.name = await send.resolve(environment, param.name, 'unsaved')
                    param.value = await send.resolve(environment, param.value, 'unsaved')
                } else {
                    param.name = await send.resolve(environment, param.name, 'unsaved')
                }
            }
        }

        if(har.postData.mimeType === 'text/plain' || har.postData.mimeType === 'application/json' || har.postData.mimeType === 'application/graphql') {
            har.postData.text = await send.resolve(environment, har.postData.text ?? '', 'unsaved')
        }
    }

    const snippet = new HTTPSnippet(har)

    const indentSize = getSpaces(getEditorConfig().indentSize)

    return snippet.convert(target, clientId, {
        indent: indentSize
    })
}
