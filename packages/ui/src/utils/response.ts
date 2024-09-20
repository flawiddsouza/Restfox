import { RequestFinalResponse } from '@/global'
import { jsonStringify } from '@/helpers'
import { JSONPath } from 'jsonpath-plus'
import xpath from 'xpath'

export function bufferToString(buffer: BufferSource) {
    const textDecoder = new TextDecoder('utf-8')
    return textDecoder.decode(buffer)
}

export function bufferToJSONString(buffer: BufferSource) {
    const responseText = bufferToString(buffer)
    try {
        return jsonStringify(JSON.parse(responseText))
    } catch {
        return responseText
    }
}

export function filterJSONResponse(buffer: BufferSource, jsonPath: string, dontStringify = false) {
    try {
        const responseData = JSON.parse(bufferToJSONString(buffer))
        const filteredData = JSONPath({ json: responseData, path: jsonPath })

        if (dontStringify) {
            return filteredData
        }

        return jsonStringify(filteredData)
    } catch (e: any) {
        console.log(`Could not filter response due to ${e.message}`)
        return bufferToJSONString(buffer)
    }

}

export function filterXmlResponse(buffer: BufferSource, query: string) {
    try {
        const doc = new DOMParser().parseFromString(bufferToString(buffer), 'text/xml')
        // @ts-expect-error - Types are incorrect
        const result = xpath.evaluate(query, doc, null, xpath.XPathResult.ANY_TYPE, null)
        const nodes = []
        let node = result.iterateNext()
        while (node) {
            nodes.push(new XMLSerializer().serializeToString(node))
            node = result.iterateNext()
        }
        return nodes.join('\n')
    } catch (error: any) {
        console.error('Error filtering XML:', error.message)
        return bufferToString(buffer)
    }
}

export function getResponseContentType(response: RequestFinalResponse) {
    if(!response || response.headers === undefined) {
        return ''
    }

    const contentTypeHeader = response.headers.find(header => header[0].toLowerCase() === 'content-type')

    if(contentTypeHeader) {
        return contentTypeHeader[1]
    }

    return ''
}
