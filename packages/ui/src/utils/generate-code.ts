import { createRequestData } from '@/helpers'
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

    if (har.postData.mimeType && har.postData.mimeType === 'application/x-www-form-urlencoded') {
        har.postData.params = har.postData.params.filter(param => !param.disabled)
    }

    const snippet = new HTTPSnippet(har)

    return snippet.convert(target, clientId, {
        indent: '    '
    })
}
