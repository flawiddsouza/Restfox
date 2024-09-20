import * as tagParser from '@/parsers/tag'
import { store } from '@/store'
import { getResponsesByCollectionId } from '@/db'
import { bufferToString, filterJSONResponse, filterXmlResponse, getResponseContentType } from './response'
import { RequestFinalResponse } from '@/global'
import { jsonStringify } from '@/helpers'

const cache = new Map<string, any>()

async function getResponseForRequest(
    collectionId: string,
    tagTrigger: boolean,
    behavior: 'never' | 'no-history' | 'when-expired' | 'always',
    maxAgeInSeconds: number,
) {
    const request = store.state.collection.find(collectionItem => collectionItem._id === collectionId)

    if (!request) {
        return undefined
    }

    if (!tagTrigger) {
        behavior = 'never'
    }

    if (behavior === 'always') {
        // send request
        await store.dispatch('sendRequest', request)
    }

    let responses = await getResponsesByCollectionId(request.workspaceId, collectionId)
    let latestResponse = responses[0]

    let refetchResponses = false

    if (behavior === 'no-history' && responses.length === 0) {
        // send request
        refetchResponses = true
    }

    if (behavior === 'when-expired') {
        if (!latestResponse) {
            // send request
            refetchResponses = true
        } else {
            const now = new Date().getTime()
            const responseTime = new Date(latestResponse.createdAt).getTime()
            const age = now - responseTime

            if (age > (maxAgeInSeconds * 1000)) {
                // send request
                refetchResponses = true
            }
        }
    }

    if (refetchResponses) {
        await store.dispatch('sendRequest', request)
        responses = await getResponsesByCollectionId(request.workspaceId, collectionId)
        latestResponse = responses[responses.length - 1]
    }

    return latestResponse
}

async function handleResponseTag(parsedTag: tagParser.ParsedResult, tagTrigger: boolean, cacheId: string | undefined) {
    let returnValue = undefined

    const cacheKey = cacheId + JSON.stringify(parsedTag)

    let response: RequestFinalResponse | undefined

    if (cacheId && cache.has(cacheKey)) {
        response = cache.get(cacheKey)
    } else {
        response = await getResponseForRequest(
            parsedTag.parameters.request as string,
            tagTrigger,
            parsedTag.parameters.behavior as 'never' | 'no-history' | 'when-expired' | 'always',
            parsedTag.parameters.maxAge as number,
        )
    }

    if (cacheId) {
        cache.set(cacheKey, response)
    }

    if (response) {
        if (parsedTag.parameters.attribute === 'body') {
            const contentType = getResponseContentType(response)

            if (contentType.startsWith('application/json')) {
                let jsonPath = parsedTag.parameters.path as string

                if (jsonPath === '') {
                    jsonPath = '$'
                }

                returnValue = filterJSONResponse(response.buffer, jsonPath, true)

                if (returnValue.length === 1) {
                    returnValue = returnValue[0]
                }

                if (typeof returnValue === 'object') {
                    returnValue = jsonStringify(returnValue)
                }
            }

            if (contentType.startsWith('application/xml')) {
                returnValue = filterXmlResponse(response.buffer, parsedTag.parameters.query as string)
            }
        }

        if (parsedTag.parameters.attribute === 'raw') {
            returnValue = bufferToString(response.buffer)
        }

        if (parsedTag.parameters.attribute === 'header') {
            const headerNameToFind = parsedTag.parameters.path as string
            returnValue = response.headers.find(header => header[0].toLowerCase() === headerNameToFind.toLowerCase())?.[1]
        }
    }

    return returnValue
}

export async function handleTags(string: string, tagTrigger: boolean, cacheId: string | undefined, noError: boolean) {
    const regex = /{% (.+?) %}/g
    const matches = [...string.matchAll(regex)]

    for(const match of matches) {
        const fullMatch = match[0]
        const start = match.index!
        const end = start + fullMatch.length

        // console.log(`Match: ${fullMatch}, Start: ${start}, End: ${end}`)

        const parsedTag = tagParser.parseFunction(match[1], true)

        let replacement = undefined

        if (parsedTag.functionName === 'response') {
            replacement = await handleResponseTag(parsedTag, tagTrigger, cacheId)
        }

        if (replacement === undefined) {
            if (noError) {
                replacement = '<no value found>'
            } else {
                const at = `${string.slice(0, start)}━>${parsedTag.functionName}(...)<━${string.slice(end)}`

                throw new Error(`Could not resolve tag\n\n${tagParser.toFunctionString(parsedTag)}\n\nat ${at}`, {
                    cause: 'display-error'
                })
            }
        }

        string = string.slice(0, start) + replacement + string.slice(end)
    }

    return string
}
