import * as tagParser from '@/parsers/tag'
import { store } from '@/store'
import { getResponsesByCollectionId } from '@/db'
import { bufferToString, filterJSONResponse, filterXmlResponse, getResponseContentType } from './response'
import { CollectionItem, GrpcFinalResponse, RequestFinalResponse } from '@/global'
import { jsonStringify } from '@/helpers'
import { GRPC_RESPONSE_TAG_UNARY_MESSAGE, findGrpcMethod, getGrpcCallKind } from './grpc'
import { getGrpcItemKey, grpcItemSchemaKeys, grpcSchemas, loadGrpcSchemaForItem, startGrpcCallForItem } from './grpc-calls'

const cache = new Map<string, any>()
type SavedResponse = RequestFinalResponse | GrpcFinalResponse

// A response cut short holds part of its body, so a tag reads the newest whole one, as when only whole ones were saved
async function getWholeResponses(request: CollectionItem, responses?: SavedResponse[]): Promise<SavedResponse[]> {
    return (responses ?? await getResponsesByCollectionId(request.workspaceId, request._id) as SavedResponse[]).filter(response => {
        if(request._type === 'grpc') {
            if(!('grpc' in response)) {
                return false
            }
            const result = response.grpc
            const received = result?.events?.filter((event: { type: string }) => event.type === 'received') ?? []
            return result?.kind === 'unary' && result.ended === 'completed' && result.status?.code === 0 && received.length === 1 && received[0].json !== undefined
        }
        return !('grpc' in response) && response.bodyIncomplete === undefined
    })
}

async function getResponseForRequest(
    collectionId: string,
    tagTrigger: boolean,
    behavior: 'never' | 'no-history' | 'when-expired' | 'always',
    maxAgeInSeconds: number,
    workspaceId?: string,
) {
    const findRequest = () => {
        const request = store.state.collection.find(collectionItem => collectionItem._id === collectionId && (workspaceId === undefined || collectionItem.workspaceId === workspaceId))
        if(workspaceId !== undefined && !request) {
            throw new Error('The request this tag reads is in another workspace', { cause: 'display-error' })
        }
        return request
    }
    const request = findRequest()

    if (!request || (request._type !== 'request' && request._type !== 'grpc')) {
        return undefined
    }

    let grpcResponses: SavedResponse[] | undefined
    if(request._type === 'grpc') {
        if(!request.grpc?.service || !request.grpc?.method) {
            throw new Error(GRPC_RESPONSE_TAG_UNARY_MESSAGE, { cause: 'display-error' })
        }
        grpcResponses = await getResponsesByCollectionId(request.workspaceId, request._id) as SavedResponse[]
        const selectedSchema = () => grpcSchemas[grpcItemSchemaKeys[getGrpcItemKey(request)] ?? '']?.schema
        const selectedMethod = () => findGrpcMethod(selectedSchema(), request.grpc?.service, request.grpc?.method)
        const saved = grpcResponses.find((response): response is GrpcFinalResponse => 'grpc' in response && !!response.grpc.kind && response.grpc.service === request.grpc?.service && response.grpc.method === request.grpc?.method)
        // Reading history works offline too. A loaded schema is newer evidence of the chosen method's kind.
        let kind = selectedSchema() ? (selectedMethod() ? getGrpcCallKind(selectedMethod()!) : null) : saved?.grpc.kind
        if(kind === undefined) {
            findRequest()
            await loadGrpcSchemaForItem(store, request, { automatic: true })
            kind = selectedMethod() ? getGrpcCallKind(selectedMethod()!) : null
        }
        if((kind && kind !== 'unary') || (!kind && (selectedSchema() || !tagTrigger || behavior === 'never'))) {
            throw new Error(GRPC_RESPONSE_TAG_UNARY_MESSAGE, { cause: 'display-error' })
        }
    }

    const send = () => {
        findRequest()
        return request._type === 'grpc'
            ? startGrpcCallForItem(store, request, { unaryOnly: true, waitForEnd: true })
            : store.dispatch('sendRequest', request)
    }

    if (!tagTrigger) {
        behavior = 'never'
    }

    if (behavior === 'always') {
        // send request
        await send()
    }

    let responses = await getWholeResponses(request, behavior === 'always' ? undefined : grpcResponses)
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
        await send()
        responses = await getWholeResponses(request)
        // newest first, as the database gives them
        latestResponse = responses[0]
    }

    return latestResponse
}

export async function handleResponseTag(parsedTag: tagParser.ParsedResult, tagTrigger: boolean, cacheId: string | undefined, workspaceId?: string) {
    let returnValue = undefined

    const cacheKey = JSON.stringify([workspaceId, cacheId, parsedTag])

    let response: RequestFinalResponse | GrpcFinalResponse | undefined

    if (cacheId && cache.has(cacheKey)) {
        response = cache.get(cacheKey)
    } else {
        response = await getResponseForRequest(
            parsedTag.parameters.request as string,
            tagTrigger,
            parsedTag.parameters.behavior as 'never' | 'no-history' | 'when-expired' | 'always',
            parsedTag.parameters.maxAge as number,
            workspaceId,
        )
    }

    if (cacheId) {
        cache.set(cacheKey, response)
    }

    if (response) {
        const grpc = 'grpc' in response ? response.grpc : null
        const buffer = grpc ? new TextEncoder().encode(grpc.events.find(event => event.type === 'received')!.json!).buffer : (response as RequestFinalResponse).buffer
        if (parsedTag.parameters.attribute === 'body') {
            const contentType = grpc ? 'application/json' : getResponseContentType(response as RequestFinalResponse)

            if (contentType.startsWith('application/json')) {
                let jsonPath = parsedTag.parameters.path as string

                if (jsonPath === '') {
                    jsonPath = '$'
                }

                returnValue = filterJSONResponse(buffer, jsonPath, true)

                if (returnValue.length === 1) {
                    returnValue = returnValue[0]
                }

                if (typeof returnValue === 'object') {
                    returnValue = jsonStringify(returnValue)
                }
            }

            if (contentType.startsWith('application/xml')) {
                returnValue = filterXmlResponse(buffer, parsedTag.parameters.query as string)
            }
        }

        if (parsedTag.parameters.attribute === 'raw') {
            returnValue = bufferToString(buffer)
        }

        if (parsedTag.parameters.attribute === 'header') {
            const headerNameToFind = parsedTag.parameters.path as string
            returnValue = (grpc ? grpc.headers : (response as RequestFinalResponse).headers).find(header => header[0].toLowerCase() === headerNameToFind.toLowerCase())?.[1]
        }
    }

    return returnValue
}
