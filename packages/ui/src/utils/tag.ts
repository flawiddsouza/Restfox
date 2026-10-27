import * as tagParser from '@/parsers/tag'
import { store } from '@/store'
import { getResponsesByCollectionId } from '@/db'
import { bufferToString, filterJSONResponse, filterXmlResponse, getResponseContentType } from './response'
import { CollectionItem, GrpcFinalResponse, RequestFinalResponse, ResolutionMode, ResponseTagCache } from '@/global'
import { jsonStringify } from '@/helpers'
import { GRPC_RESPONSE_TAG_UNARY_MESSAGE, findGrpcMethod, getGrpcCallKind } from './grpc'
import { type GrpcRequestPreparation, getGrpcItemKey, grpcItemSchemaKeys, grpcSchemas, loadGrpcSchemaForItem, startGrpcCallForItem } from './grpc-calls'

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
    mode: ResolutionMode,
    behavior: 'never' | 'no-history' | 'when-expired' | 'always',
    maxAgeInSeconds: number,
    workspaceId?: string,
) {
    const findRequest = (afterWait = false) => {
        const request = store.state.collection.find(collectionItem => collectionItem._id === collectionId && (workspaceId === undefined || collectionItem.workspaceId === workspaceId))
        if(workspaceId !== undefined && store.state.activeWorkspace?._id !== workspaceId) {
            throw new Error('The request this tag reads is in another workspace', { cause: 'display-error' })
        }
        if(afterWait && !request) {
            throw new Error('The request this tag reads was deleted', { cause: 'display-error' })
        }
        return request
    }
    mode = mode === 'send' ? 'send' : 'display'
    const request = findRequest()

    const shouldSend = (responses: SavedResponse[]) => {
        if(mode !== 'send' || behavior === 'never') {
            return false
        }
        if(behavior === 'always') {
            return true
        }
        if(behavior === 'no-history') {
            return responses.length === 0
        }
        const latestResponse = responses[0]
        return behavior === 'when-expired' && (!latestResponse || Date.now() - new Date(latestResponse.createdAt).getTime() > maxAgeInSeconds * 1000)
    }

    if (!request || (request._type !== 'request' && request._type !== 'grpc')) {
        return undefined
    }

    let grpcResponses: SavedResponse[] | undefined
    let requestPreparation: GrpcRequestPreparation | undefined
    if(request._type === 'grpc') {
        if(!request.grpc?.service || !request.grpc?.method) {
            throw new Error(GRPC_RESPONSE_TAG_UNARY_MESSAGE, { cause: 'display-error' })
        }
        grpcResponses = await getResponsesByCollectionId(request.workspaceId, request._id) as SavedResponse[]
        const wholeResponses = await getWholeResponses(request, grpcResponses)
        const schemaMode = shouldSend(wholeResponses) ? 'send' : 'display'
        findRequest(true)
        const selectedSchema = () => grpcSchemas[grpcItemSchemaKeys[getGrpcItemKey(request)] ?? '']?.schema
        const selectedMethod = () => findGrpcMethod(selectedSchema(), request.grpc?.service, request.grpc?.method)
        const saved = grpcResponses.find((response): response is GrpcFinalResponse => 'grpc' in response && !!response.grpc.kind && response.grpc.service === request.grpc?.service && response.grpc.method === request.grpc?.method)
        // Reading history works offline too. A loaded schema is newer evidence of the chosen method's kind.
        let kind = selectedSchema() ? (selectedMethod() ? getGrpcCallKind(selectedMethod()!) : null) : saved?.grpc.kind
        if(kind === undefined) {
            if(mode !== 'send' || (behavior === 'never' && wholeResponses.length === 0)) {
                return undefined
            }
            const loaded = await loadGrpcSchemaForItem(store, request, { automatic: true, mode: schemaMode })
            findRequest(true)
            if(schemaMode === 'send' && loaded?.error) {
                throw new Error(loaded.errorWithoutValues ?? 'Could not load the methods of the request this tag reads', { cause: 'display-error' })
            }
            requestPreparation = schemaMode === 'send' ? loaded?.requestPreparation : undefined
            kind = selectedMethod() ? getGrpcCallKind(selectedMethod()!) : null
            // A call may have saved while the schema loaded.
            grpcResponses = await getResponsesByCollectionId(request.workspaceId, request._id) as SavedResponse[]
            findRequest(true)
        }
        if((kind && kind !== 'unary') || (!kind && (selectedSchema() || mode !== 'send' || behavior === 'never'))) {
            throw new Error(GRPC_RESPONSE_TAG_UNARY_MESSAGE, { cause: 'display-error' })
        }
    }

    const send = async() => {
        findRequest(true)
        const result = request._type === 'grpc'
            ? await startGrpcCallForItem(store, request, { unaryOnly: true, waitForEnd: true, ...(requestPreparation ? { requestPreparation } : {}) })
            : await store.dispatch('sendRequest', request)
        const response = result && ('grpc' in result || ('buffer' in result && !('error' in result)))
            ? (await getWholeResponses(request, [result]))[0]
            : undefined
        if(!response) {
            throw new Error('The request this tag sent did not complete with a whole response', { cause: 'display-error' })
        }
        findRequest(true)
        return response
    }

    if (mode === 'send' && behavior === 'always') {
        return send()
    }

    const responses = await getWholeResponses(request, grpcResponses)
    findRequest(true)
    return shouldSend(responses) ? send() : responses[0]
}

export async function handleResponseTag(parsedTag: tagParser.ParsedResult, mode: ResolutionMode, responseTags: ResponseTagCache | undefined, workspaceId?: string) {
    let returnValue = undefined

    const cacheKey = JSON.stringify([workspaceId, parsedTag])

    let pendingResponse = responseTags?.get(cacheKey)

    if (!pendingResponse) {
        pendingResponse = getResponseForRequest(
            parsedTag.parameters.request as string,
            mode,
            parsedTag.parameters.behavior as 'never' | 'no-history' | 'when-expired' | 'always',
            parsedTag.parameters.maxAge as number,
            workspaceId,
        )
        if (responseTags) {
            responseTags.set(cacheKey, pendingResponse)
            // a failure is not kept, the next resolution tries again
            pendingResponse.catch(() => responseTags.delete(cacheKey))
        }
    }

    const response = await pendingResponse

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
