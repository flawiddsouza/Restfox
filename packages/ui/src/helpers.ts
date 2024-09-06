import JSZip from 'jszip'
import { nanoid } from 'nanoid'
import { createRequestContextForPlugin, createResponseContextForPlugin, usePlugin } from './plugin'
import dayjs from 'dayjs'
import getObjectPathValue from 'lodash.get'
import setObjectPathValueLodash from 'lodash.set'
import { toRaw } from 'vue'
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { convert as curlConvert } from './parsers/curl'
import yaml from 'js-yaml'
import {
    CollectionItem,
    RequestBody,
    RequestAuthentication,
    RequestParam,
    RequestInitialResponse,
    RequestFinalResponse,
    Plugin,
    CreateRequestDataReturn,
    HandleRequestState,
    State,
    OpenApiSpecPathParams,
} from './global'
import { ActionContext } from 'vuex'
import { version } from '../../electron/package.json'
import constants from '@/constants'

// From: https://stackoverflow.com/a/67802481/4932305
export function toTree(array: CollectionItem[]): CollectionItem[] {
    const map: Record<string, number> = {}
    let i

    for(i = 0; i < array.length; i += 1) {
        map[array[i]._id] = i
        if(array[i]._type === 'request_group') {
            array[i].children = []
        }
    }

    let node
    const res: any[] = []

    for(i = 0; i < array.length; i += 1) {
        node = array[i]
        if(node.parentId !== null) {
            array[map[node.parentId]].children?.push(node)
        } else {
            res.push(node)
        }
    }

    return res
}

export function flattenTree(array: CollectionItem[]) {
    const level: any = []

    array.forEach(item => {
        const newItem = Object.assign({}, item)
        delete newItem.children
        level.push(newItem)

        if(item.children) {
            level.push(...flattenTree(item.children))
        }
    })

    return level
}

export function substituteEnvironmentVariables(environment: any, string: string) {
    let substitutedString = String(string)

    const possibleEnvironmentObjectPaths = getObjectPaths(environment)

    possibleEnvironmentObjectPaths.forEach(objectPath => {
        let objectPathValue:any = getObjectPathValue(environment, objectPath)

        if (typeof objectPathValue === 'object') {
            objectPathValue = JSON.stringify(objectPathValue)
        }

        /**
         * Insomnia support
         * if "env" doesn't have "_" key, then prefix "objectPath" with "_."
         * and replace occurrences of "_.objectPath"
         */
        if (!environment['_']) {
            substitutedString = substitutedString.replaceAll(`{{ _.${objectPath} }}`, objectPathValue)
            substitutedString = substitutedString.replaceAll(`{{_.${objectPath}}}`, objectPathValue)
        }

        substitutedString = substitutedString.replaceAll(`{{${objectPath}}}`, objectPathValue)
        substitutedString = substitutedString.replaceAll(`{{ ${objectPath} }}`, objectPathValue)
    })

    return substitutedString
}

export function generateBasicAuthString(username: string, password: string) {
    return 'Basic ' + window.btoa(unescape(encodeURIComponent(username)) + ':' + unescape(encodeURIComponent(password)))
}

export async function fetchWrapper(url: URL, method: string, headers: Record<string, string>, body: any, abortControllerSignal: AbortSignal, flags: {
    electronSwitchToChromiumFetch: boolean,
    disableSSLVerification: boolean
}): Promise<RequestInitialResponse> {
    if('__EXTENSION_HOOK__' in window && window.__EXTENSION_HOOK__ === 'Restfox CORS Helper Enabled') {
        let bodyHint: any = null

        if(body instanceof FormData) {
            bodyHint = 'FormData'
            body = Array.from(body.entries())
            let i = 0
            for(const item of body) {
                if(item[1] instanceof File) {
                    body[i][1] = {
                        name: item[1].name,
                        type: item[1].type,
                        buffer: Array.from(new Uint8Array(await item[1].arrayBuffer()))
                    }
                }
                i++
            }
        }

        if(body instanceof File) {
            bodyHint = 'File'
            body = {
                name: body.name,
                type: body.type,
                buffer: Array.from(new Uint8Array(await body.arrayBuffer()))
            }
        }

        return new Promise((resolve, reject) => {
            const eventId = generateId()

            window.postMessage({
                event: 'sendRequest',
                eventId,
                eventData: {
                    url: url.toString(),
                    method,
                    headers,
                    body,
                    bodyHint
                }
            })

            const messageHandler = (message: any) => {
                if (message.data.eventId !== undefined && message.data.eventId !== eventId) {
                    return
                }

                if(message.data.event === 'response') {
                    resolve(message.data.eventData)
                    window.removeEventListener('message',  messageHandler)
                }

                if(message.data.event === 'responseError') {
                    reject(message.data.eventData)
                    window.removeEventListener('message',  messageHandler)
                }
            }

            window.addEventListener('message',  messageHandler)

            abortControllerSignal.onabort = () => {
                window.postMessage({
                    event: 'cancelRequest',
                    eventId,
                })
                reject(new DOMException('The user aborted a request.', 'AbortError'))
                window.removeEventListener('message',  messageHandler)
            }
        })
    }

    if(import.meta.env.MODE === 'web-standalone') {
        const proxyHeaders: Record<string, string> = {
            'x-proxy-req-url': url.toString(),
            'x-proxy-req-method': method
        }

        Object.keys(headers).forEach(header => {
            proxyHeaders[`x-proxy-req-header-${header}`] = headers[header]
        })

        const response = await fetch('/proxy', {
            method: 'POST',
            headers: proxyHeaders,
            body: method !== 'GET' ? body : undefined,
            signal: abortControllerSignal
        })

        const responseBody = await response.json()

        return new Promise((resolve, reject) => {
            if(responseBody.event === 'response') {
                responseBody.eventData.buffer = new Uint8Array(responseBody.eventData.buffer).buffer
                resolve(responseBody.eventData)
            }

            if(responseBody.event === 'responseError') {
                responseBody.eventData = new Error(responseBody.eventData)
                reject(responseBody.eventData)
            }
        })
    }

    if (import.meta.env.MODE === 'desktop-electron' && !flags.electronSwitchToChromiumFetch) {
        let bodyHint: any = null

        if(body instanceof FormData) {
            bodyHint = 'FormData'
            body = Array.from(body.entries())
            let i = 0
            for(const item of body) {
                if(item[1] instanceof File) {
                    body[i][1] = {
                        name: item[1].name,
                        type: item[1].type,
                        buffer: Array.from(new Uint8Array(await item[1].arrayBuffer()))
                    }
                }
                i++
            }
        }

        if(body instanceof File) {
            bodyHint = 'File'
            body = {
                name: body.name,
                type: body.type,
                buffer: Array.from(new Uint8Array(await body.arrayBuffer()))
            }
        }

        return new Promise((resolve, reject) => {
            const requestId = nanoid()

            abortControllerSignal.onabort = () => {
                window.electronIPC.cancelRequest(requestId)
                reject(new DOMException('The user aborted a request.', 'AbortError'))
            }

            window.electronIPC.sendRequest({
                requestId,
                url: url.toString(),
                method,
                headers,
                body,
                bodyHint,
                disableSSLVerification: flags.disableSSLVerification,
            }).then((data: any) => {
                if(data.event === 'response') {
                    data.eventData.buffer = new Uint8Array(data.eventData.buffer).buffer
                    resolve(data.eventData)
                }

                if(data.event === 'responseError') {
                    reject(new Error(data.eventData))
                }
            }).catch((error: any) => {
                reject(error)
            })
        })
    }

    const startTime = new Date()

    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? body : undefined,
        signal: abortControllerSignal
    })

    const endTime = new Date()

    const status = response.status
    const statusText = response.statusText
    const responseHeaders = [...response.headers.entries()]

    const responseBlob = await response.blob()
    const mimeType = responseBlob.type
    const buffer = await responseBlob.arrayBuffer()

    const timeTaken = Number(endTime) - Number(startTime)

    return {
        status,
        statusText,
        headers: responseHeaders,
        mimeType,
        buffer,
        timeTaken
    }
}

export async function createRequestData(
    state: HandleRequestState,
    request: CollectionItem,
    environment: any,
    parentHeaders: Record<string, string>,
    parentAuthentication: RequestAuthentication | undefined,
    setEnvironmentVariable: ((name: string, value: string) => void) | null,
    plugins: Plugin[],
    workspaceLocation: string | null
): Promise<CreateRequestDataReturn> {
    for(const plugin of plugins) {
        const { expose } = createRequestContextForPlugin(request, environment, setEnvironmentVariable, state.testResults)

        state.currentPlugin = plugin.type === 'script' ? 'Script: Pre Request' : `${plugin.name} (Pre Request)`

        await usePlugin(expose, {
            name: state.currentPlugin,
            code: typeof plugin.code === 'object' ? plugin.code.pre_request : plugin.code,
            parentPathForReadFile: workspaceLocation,
        })

        request = {
            ...request,
            headers: expose.context.request.getHeaders(),
            body: expose.context.request.getBody(),
            parameters: expose.context.request.getQueryParams(),
        }
    }

    let body: any = null

    if(request.body && request.body.mimeType === 'application/x-www-form-urlencoded') {
        if('params' in request.body && request.body.params) {
            const formParams = request.body.params.filter(item => !item.disabled).reduce((acc, item) => {
                const name = substituteEnvironmentVariables(environment, item.name)
                const value = substituteEnvironmentVariables(environment, item.value)
                acc.append(name, value)
                return acc
            }, new URLSearchParams())

            body = formParams.toString()
        }
    }

    if(request.body) {
        if(request.body.mimeType === 'multipart/form-data') {
            if('params' in request.body) {
                const formData = new FormData()
                request.body.params?.filter(item => !item.disabled).forEach(param => {
                    if(param.type === 'text') {
                        formData.append(substituteEnvironmentVariables(environment, param.name), substituteEnvironmentVariables(environment, param.value))
                    } else if (param.files) {
                        for(const file of param.files) {
                            formData.append(substituteEnvironmentVariables(environment, param.name), file as File)
                        }
                    }
                })
                body = formData
            }
        }

        if(request.body.mimeType === 'text/plain' || request.body.mimeType === 'application/json' || request.body.mimeType === 'application/graphql') {
            body = substituteEnvironmentVariables(environment, request.body.text ?? '')
        }

        if(request.body.mimeType === 'application/octet-stream' && request.body.fileName instanceof File) {
            body = request.body.fileName
        }
    }

    let urlWithEnvironmentVariablesSubstituted = substituteEnvironmentVariables(environment, request.url!)

    if(request.pathParameters) {
        request.pathParameters.filter(item => !item.disabled).forEach(pathParameter => {
            urlWithEnvironmentVariablesSubstituted = urlWithEnvironmentVariablesSubstituted.replaceAll(
                `:${substituteEnvironmentVariables(environment, pathParameter.name)}`, substituteEnvironmentVariables(environment, pathParameter.value)
            ).replaceAll(
                `{${substituteEnvironmentVariables(environment, pathParameter.name)}}`, substituteEnvironmentVariables(environment, pathParameter.value)
            )
        })
    }

    const url = new URL(urlWithEnvironmentVariablesSubstituted)

    if('parameters' in request && request.parameters) {
        url.search = ''

        request.parameters.filter(item => !item.disabled).forEach(param => {
            const paramName = substituteEnvironmentVariables(environment, param.name)
            const paramValue = substituteEnvironmentVariables(environment, param.value)

            url.searchParams.append(
                paramName,
                decodeURIComponent(paramValue)
            )
        })
    }

    const headers: Record<string, string | any> = {}

    Object.keys(parentHeaders).forEach(header => {
        headers[substituteEnvironmentVariables(environment, header.toLowerCase())] = substituteEnvironmentVariables(environment, parentHeaders[header])
    })

    if('GLOBAL_HEADERS' in environment) {
        Object.keys(environment.GLOBAL_HEADERS).forEach(header => {
            headers[header.toLowerCase()] = environment.GLOBAL_HEADERS[header]
        })
    }

    if('headers' in request && request.headers !== undefined) {
        const enabledHeaders = request.headers.filter(header => !header.disabled)
        for(const header of enabledHeaders) {
            const headerName = substituteEnvironmentVariables(environment, header.name.toLowerCase())
            const headerValue = substituteEnvironmentVariables(environment, header.value)

            if(body instanceof FormData && headerName === 'content-type') { // exclude content-type header for multipart/form-data
                continue
            }

            if(headerName !== '') {
                headers[headerName] = headerValue
            }
        }
    }

    const setAuthentication = (authentication: RequestAuthentication) => {
        headers['Authorization'] = resolveAuthentication(authentication, environment)
    }

    if(request.authentication && request.authentication.type !== 'No Auth' && !request.authentication.disabled) {
        setAuthentication(request.authentication)
    }

    if(parentAuthentication && parentAuthentication.type !== 'No Auth' && !parentAuthentication.disabled && (request.authentication === undefined || request.authentication.type === 'No Auth')) {
        setAuthentication(parentAuthentication)
    }

    return {
        url,
        headers,
        body,
    }
}

export async function handleRequest(
    request: CollectionItem,
    environment: any,
    parentHeaders: Record<string, string>,
    parentAuthentication: RequestAuthentication | undefined,
    setEnvironmentVariable: (name: string, value: string) => void,
    plugins: Plugin[],
    workspaceLocation: string | null,
    abortControllerSignal: AbortSignal,
    flags: {
        electronSwitchToChromiumFetch: boolean,
        disableSSLVerification: boolean
    }
) {
    const state: HandleRequestState = {
        currentPlugin: null,
        testResults: [],
    }

    try {
        const { url, headers, body } = await createRequestData(state, request, environment, parentHeaders, parentAuthentication, setEnvironmentVariable, plugins, workspaceLocation)

        const globalUserAgent = localStorage.getItem(constants.LOCAL_STORAGE_KEY.GLOBAL_USER_AGENT)

        if (!headers['user-agent']) {
            headers['user-agent'] = globalUserAgent || `Restfox/${getVersion()}`
        }

        const response = await fetchWrapper(url, request.method!, headers, body, abortControllerSignal, flags)

        const headersToSave = JSON.parse(JSON.stringify(headers))

        // From: https://fetch.spec.whatwg.org/#forbidden-header-name
        const forbiddenHeaders = [
            'Accept-Charset',
            'Accept-Encoding',
            'Access-Control-Request-Headers',
            'Access-Control-Request-Method',
            'Connection',
            'Content-Length',
            'Cookie',
            'Cookie2',
            'Date',
            'DNT',
            'Expect',
            'Host',
            'Keep-Alive',
            'Origin',
            'Referer',
            'Set-Cookie',
            'TE',
            'Trailer',
            'Transfer-Encoding',
            'Upgrade',
            'Via',
        ]

        forbiddenHeaders.forEach(forbiddenHeader => {
            delete headersToSave[forbiddenHeader.toLowerCase()]
        })

        const originRequestBodyToSave = structuredClone(toRaw(request.body))

        let responseToSend: RequestFinalResponse = {
            _id: nanoid(),
            collectionId: request._id,
            url: url.origin + url.pathname,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            mimeType: response.mimeType,
            buffer: response.buffer,
            timeTaken: response.timeTaken,
            request: {
                method: request.method!,
                query: url.search,
                headers: headersToSave,
                body: request.method !== 'GET' && request.body && request.body.mimeType === 'multipart/form-data' === false ? body : null,
                original: {
                    url: request.url,
                    body: originRequestBodyToSave
                } as CollectionItem
            },
            createdAt: new Date().getTime(),
            testResults: [],
        }

        if(request.parameters) {
            responseToSend.request.original.parameters = JSON.parse(JSON.stringify(request.parameters))
        }

        if(request.pathParameters) {
            responseToSend.request.original.pathParameters = JSON.parse(JSON.stringify(request.pathParameters))
        }

        if(request.headers) {
            responseToSend.request.original.headers = JSON.parse(JSON.stringify(request.headers))
        }

        if(request.authentication) {
            responseToSend.request.original.authentication = JSON.parse(JSON.stringify(request.authentication))
        }

        for(const plugin of plugins) {
            const { expose } = createResponseContextForPlugin(responseToSend, environment, setEnvironmentVariable, state.testResults)

            state.currentPlugin = plugin.type === 'script' ? 'Script: Post Request' : `${plugin.name} (Post Request)`

            await usePlugin(expose, {
                name: state.currentPlugin,
                code: typeof plugin.code === 'object' ? plugin.code.post_request : plugin.code,
                parentPathForReadFile: workspaceLocation,
            })

            responseToSend = { ...responseToSend, buffer: expose.context.response.getBody() }
        }

        responseToSend.testResults = state.testResults

        return responseToSend
    } catch(e: any) {
        console.error(e)

        let error = 'Error: Request failed'

        if(typeof e !== 'string')  {
            if(e.message.includes('Invalid URL')) {
                error = 'Error: Invalid URL'
            }

            if(e.name === 'AbortError') {
                error = 'Error: Request Cancelled'
            }

            if(e.message === 'Unable to parse plugin') {
                error = `Error in Plugin "${state.currentPlugin}"${e.lineNumber !== '' ? ' at line number ' + e.lineNumber : ''}\n\n${e.originalError.name}: ${e.originalError.message}`
            }
        }

        return {
            status: null,
            statusText: 'Error',
            error
        }
    }
}

export function convertInsomniaExportToRestfoxCollection(json: any, workspaceId: string) {
    const collection: CollectionItem[] = []

    const workspace = json.resources.find((item: any) => item._type === 'workspace')

    json.resources.filter((item: any) => ['cookie_jar', 'api_spec', 'environment', 'proto_file', 'unit_test_suite'].includes(item._type) == false).forEach((item: any) => {
        if(item._type === 'workspace' || item._type === 'request_group') {
            let parentId = item.parentId

            if(item.parentId === '__WORKSPACE_ID__' && !workspace) {
                parentId = null
            }

            collection.push({
                _id: item._id,
                _type: 'request_group',
                name: item.name,
                environment: item.environment,
                parentId,
                workspaceId
            })
        } else {
            let body: any = {
                mimeType: 'No Body'
            }

            if(item.body.mimeType === 'application/x-www-form-urlencoded') {
                body = {
                    mimeType: item.body.mimeType,
                    params: 'params' in item.body ? item.body.params.map((parameter: RequestParam) => ({
                        name: parameter.name,
                        value: parameter.value,
                        description: parameter.description,
                        disabled: parameter.disabled
                    })) : []
                }
            }

            if(item.body.mimeType === 'text/plain' || item.body.mimeType === 'application/json' || item.body.mimeType === 'application/graphql') {
                body = {
                    mimeType: item.body.mimeType,
                    text: item.body.text
                }
            }

            let parentId = item.parentId

            if(item.parentId === '__WORKSPACE_ID__' && !workspace) {
                parentId = null
            }

            collection.push({
                _id: item._id,
                _type: item._type,
                name: item.name,
                url: item.url,
                method: item.method,
                body: body,
                headers: item.headers ? item.headers.map((header: RequestParam) => ({
                    name: header.name,
                    value: header.value,
                    description: header.description,
                    disabled: header.disabled
                })) : [],
                parameters: item.parameters ? item.parameters.map((parameter: RequestParam) => ({
                    name: parameter.name,
                    value: parameter.value,
                    description: parameter.description,
                    disabled: parameter.disabled
                })) : [],
                pathParameters: item.pathParameters ?? [],
                authentication: 'authentication' in item && Object.keys(item.authentication).length > 0 ? item.authentication : { type: 'No Auth' },
                description: 'description' in item ? item.description : undefined,
                parentId,
                workspaceId
            })
        }
    })

    return toTree(collection)
}

export async function convertPostmanExportToRestfoxCollection(json: any, isZip: boolean, workspaceId: string) {
    if(isZip) {
        const zip = new JSZip()
        const extractedZip = await zip.loadAsync(json)
        const filePaths = Object.keys(extractedZip.files)
        const filePathMap: Record<string, string> = {}
        const basePath = filePaths[filePaths.length - 1].replace('archive.json', '')
        filePaths.forEach(filePath => {
            filePathMap[filePath.replace(basePath, '')] = filePath
        })

        const archive = await extractedZip.files[filePathMap['archive.json']].async('text')
        const archiveCollection = JSON.parse(archive).collection

        const collections: any[] = []

        for(const collectionId of Object.keys(archiveCollection)) {
            collections.push(JSON.parse(await extractedZip.files[filePathMap[`collection/${collectionId}.json`]].async('text')))
        }

        return importPostmanV2(collections, workspaceId)
    } else {
        if('info' in json) {
            if('schema' in json.info) {
                if(json.info.schema === 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json' || json.info.schema === 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json') {
                    return importPostmanV2([json], workspaceId)
                }
            }
        }
        return importPostmanV1(json.collections, workspaceId)
    }
}

function importPostmanV1(collections: any[], workspaceId: string) {
    const collection: CollectionItem[]  = []

    collections.forEach(item => {
        const requests: CollectionItem[] = []

        item.requests.forEach((request: any) => {
            let body: RequestBody = {
                mimeType: 'No Body'
            }

            if(request.dataMode === 'urlencoded') {
                const params: RequestParam[] = []
                const requestData = request.data !== null ? request.data : []
                requestData.forEach((requestDataItem: any) => {
                    params.push({
                        name: requestDataItem.key,
                        value: requestDataItem.value,
                        description: requestDataItem.description,
                        disabled: !requestDataItem.enabled
                    })
                })
                body = {
                    mimeType: 'application/x-www-form-urlencoded',
                    params
                }
            }

            if(request.dataMode === 'raw') {
                body = {
                    mimeType: 'text/plain',
                    text: request.rawModeData
                }
            }

            const headers: RequestParam[] = []
            request.headerData.forEach((header: any) => {
                headers.push({
                    name: header.key,
                    value: header.value,
                    description: header.description,
                    disabled: !header.enabled
                })
            })

            const parameters: RequestParam[] = []
            const queryParams = request.queryParams !== null ? request.queryParams : []
            queryParams.forEach((queryParam: any) => {
                parameters.push({
                    name: queryParam.key,
                    value: queryParam.value,
                    description: queryParam.description,
                    disabled: !queryParam.enabled
                })
            })

            requests.push({
                _id: request.id,
                _type: 'request',
                method: request.method,
                url: request.url,
                name: request.name,
                body,
                headers,
                parameters,
                parentId: item.id,
                workspaceId
            })
        })

        collection.push({
            _id: item.id,
            _type: 'request_group',
            name: item.name,
            children: requests,
            parentId: null,
            workspaceId
        })
    })

    return collection
}

function handlePostmanV2CollectionItem(postmanCollectionItem: any, parentId: string | null = null, workspaceId: string) {
    const requests: CollectionItem[] = []
    const plugins: Plugin[] = []

    postmanCollectionItem.item.forEach((request: any) => {
        const requestId = request.id ?? nanoid()
        if('item' in request) {
            const { convertedRequests, plugins: newPlugins } = handlePostmanV2CollectionItem(request, requestId, workspaceId)
            plugins.push(...newPlugins)

            requests.push({
                _id: requestId,
                _type: 'request_group',
                name: request.name,
                children: convertedRequests,
                parentId,
                workspaceId
            })
            return
        }

        let body: RequestBody = {
            mimeType: 'No Body'
        }

        if('body' in request.request && 'mode' in request.request.body) {
            if(request.request.body.mode === 'urlencoded') {
                const params: RequestParam[] = []
                const requestData = request.request.body.urlencoded
                requestData.forEach((requestDataItem: any) => {
                    params.push({
                        name: requestDataItem.key,
                        value: requestDataItem.value,
                        description: requestDataItem.description,
                        disabled: requestDataItem.disabled
                    })
                })
                body = {
                    mimeType: 'application/x-www-form-urlencoded',
                    params
                }
            }

            if(request.request.body.mode === 'raw') {
                let mimeType = 'text/plain'

                if('options' in request.request.body && 'raw' in request.request.body.options && request.request.body.options.raw.language === 'json') {
                    mimeType = 'application/json'
                }

                if(mimeType === 'text/plain') {
                    try {
                        JSON.parse(request.request.body.raw)
                        mimeType = 'application/json'
                    } catch {}
                }

                body = {
                    mimeType: mimeType,
                    text: request.request.body.raw
                }
            }
        }

        const headers: RequestParam[] = []
        request.request.header.forEach((header: any) => {
            headers.push({
                name: header.key,
                value: header.value,
                description: header.description,
                disabled: header.disabled
            })
        })

        const parameters: RequestParam[] = []
        const queryParams = 'url' in request.request && typeof request.request.url !== 'string' && 'query' in request.request.url ? request.request.url.query : []
        queryParams.forEach((queryParam: any) => {
            parameters.push({
                name: queryParam.key,
                value: queryParam.value,
                description: queryParam.description,
                disabled: queryParam.disabled
            })
        })

        let url = ''

        if('url' in request.request) {
            url = typeof request.request.url === 'string' ? request.request.url : request.request.url.raw
        }

        let authentication: RequestAuthentication = { type: 'No Auth' }

        if('auth' in request.request) {
            if(request.request.auth.type === 'bearer') {
                authentication = {
                    type: 'bearer'
                }
                const bearerAuth = 'bearer' in request.request.auth ? request.request.auth.bearer : []
                if(bearerAuth.length > 0) {
                    authentication = {
                        type: 'bearer',
                        token: bearerAuth[0].value
                    }
                }
            }
        }

        if(request.event) {
            const scriptId = nanoid()
            let preScript = ''
            let postScript = ''
            request.event.forEach((script: any) => {
                if(script.listen === 'prerequest') {
                    preScript += script.script.exec.join('\n')
                }

                if(script.listen === 'test') {
                    postScript += script.script.exec.join('\n')
                }
            })

            plugins.push({
                '_id': scriptId,
                'type': 'script',
                'name': null,
                'code': {
                    'pre_request': scriptConversion(preScript, 'postmanToRestfox'),
                    'post_request': scriptConversion(postScript, 'postmanToRestfox')
                },
                'collectionId': requestId,
                'workspaceId': workspaceId,
                'enabled': true,
                'createdAt': Date.now(),
                'updatedAt': Date.now()
            })
        }

        requests.push({
            _id: requestId,
            _type: 'request',
            method: request.request.method,
            url,
            name: request.name,
            body,
            headers,
            parameters,
            authentication,
            description: 'description' in request.request ? request.request.description : undefined,
            parentId,
            workspaceId
        })
    })

    return { convertedRequests: requests, plugins }
}

function importPostmanV2(collections: any[], workspaceId: string) {
    const collection: CollectionItem[] = []
    const plugins: Plugin[] = []

    collections.forEach(postmanCollectionItem => {
        const { convertedRequests, plugins: newPlugins } = handlePostmanV2CollectionItem(postmanCollectionItem, postmanCollectionItem.info._postman_id, workspaceId)
        plugins.push(...newPlugins)

        collection.push({
            _id: postmanCollectionItem.info._postman_id,
            _type: 'request_group',
            name: postmanCollectionItem.info.name,
            environment: 'variable' in postmanCollectionItem ? postmanCollectionItem.variable.reduce((prev: any, acc: any) => {
                prev[acc.key] = acc.value
                return prev
            }, {}) : undefined,
            children: convertedRequests,
            parentId: null,
            workspaceId
        })
    })

    return { collection, plugins }
}

function importRestfoxV1(collections: CollectionItem[], workspaceId: string) {
    const collection: CollectionItem[] = []
    const plugins: Plugin[] = []

    collections.forEach(item => {
        if(item._type === 'request_group') {
            collection.push({
                _id: item._id,
                _type: 'request_group',
                name: item.name,
                environment: item.environment,
                environments: item.environments,
                currentEnvironment: item.currentEnvironment,
                parentId: item.parentId,
                workspaceId,
                sortOrder: item.sortOrder
            })
        } else {
            if(item._type === 'socket') {
                collection.push({
                    ...item,
                    workspaceId,
                })
            } else {
                collection.push({
                    _id: item._id,
                    _type: item._type,
                    name: item.name,
                    url: item.url,
                    method: item.method,
                    body: item.body,
                    headers: item.headers ? item.headers.map(header => ({
                        name: header.name,
                        value: header.value,
                        description: header.description,
                        disabled: header.disabled
                    })) : [],
                    parameters: item.parameters ? item.parameters.map(parameter => ({
                        name: parameter.name,
                        value: parameter.value,
                        description: parameter.description,
                        disabled: parameter.disabled
                    })) : [],
                    authentication: item.authentication && Object.keys(item.authentication).length > 0 ? item.authentication : { type: 'No Auth' },
                    parentId: item.parentId,
                    workspaceId,
                    sortOrder: item.sortOrder
                })
            }
        }

        if(item.plugins) {
            plugins.push(...item.plugins)
        }
    })

    const collectionTree = toTree(collection)
    sortTree(collectionTree)

    return {
        newCollectionTree: collectionTree,
        newPlugins: plugins
    }
}

export function convertRestfoxExportToRestfoxCollection(json: any, workspaceId: string) {
    if('exportedFrom' in json) {
        if(json.exportedFrom === 'Restfox-1.0.0') {
            return importRestfoxV1(json.collection, workspaceId)
        }
    }

    throw new Error('Invalid Restfox Export')
}

export function extractPathParameters(openapiSchema: string) {
    const apiSchema = yaml.load(openapiSchema) as OpenApiSpecPathParams
    const pathParams: {
        [x: string]: {
            name: string;
            value: string;
        }[];
    } = {}
    Object.entries(apiSchema.paths).forEach((path) => {
        Object.entries(path[1]).forEach(method => {
            method[1]?.parameters?.forEach(param => {
                if (param.in === 'path') {
                    if (pathParams[path[0] + '-' + [method[0].toLowerCase()]]?.length > 0) {
                        pathParams[path[0] + '-' + [method[0].toLowerCase()]].push({
                            name: param.name,
                            value: param.schema?.example ?? '',
                        })
                    } else {
                        pathParams[path[0] + '-' + [method[0].toLowerCase()]] = [{
                            name: param.name,
                            value:  param.schema?.example ?? '',
                        }]
                    }
                }
            })
        })
    })
    return pathParams
}

export async function convertOpenAPIExportToRestfoxCollection(exportString: string, workspaceId: string) {
    const { convert: insomniaImporter } = await import('insomnia-importers-browser')
    const initExport = await insomniaImporter(
        exportString.replace(/\/{([^}]+)}/g, '/:$1:')
    )
    const pathParams = extractPathParameters(exportString)
    initExport.data.resources = initExport.data.resources.map((item:{[x:string]:any}) => {
        if (item.url) {
            item['url'] = item.url.replace(/\/:([^:]+):/g, '/{$1}')
            item['pathParameters'] = pathParams[item['url'].replace(/{{ base_url }}/, '') + '-' + item['method'].toLowerCase()] ?? []
        }
        return item
    })

    return convertInsomniaExportToRestfoxCollection(initExport.data, workspaceId)
}

export async function convertCurlCommandToRestfoxCollection(curlCommand: string, workspaceId: string) {
    const insomniaExport: any = curlConvert(curlCommand)

    if(insomniaExport === null) {
        throw new Error('Invalid Curl Command')
    }

    if('body' in insomniaExport[0]) {
        if('text' in insomniaExport[0].body) {
            // for some reason we get \\n instead of \n in the text field
            insomniaExport[0].body.text = insomniaExport[0].body.text.replaceAll('\\n', '\n')
        }
    }
    return convertInsomniaExportToRestfoxCollection({ resources: insomniaExport }, workspaceId)
}

// From: https://stackoverflow.com/a/66387148/4932305
export async function fileToJSON(file: File) {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader()
        fileReader.onload = (event: ProgressEvent<FileReader>) => {
            if (event.target) {
                try {
                    resolve(JSON.parse(event.target.result as string))
                } catch(e) {
                    reject(e)
                }
            } else {
                reject(new Error('Failed to read file'))
            }
        }
        fileReader.onerror = error => reject(error)
        fileReader.readAsText(file)
    })
}

export async function fileToString(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader()
        fileReader.onload = (event: ProgressEvent<FileReader>) => {
            if (event.target) {
                resolve(event.target.result as string)
            } else {
                reject(new Error('Failed to read file'))
            }
        }
        fileReader.onerror = error => reject(error)
        fileReader.readAsText(file)
    })
}

// From: https://stackoverflow.com/a/57218589/4932305 but modified to return children on parent matches
export function filterTree(array: CollectionItem[], name: string) {
    return array.reduce((r: any[], { children = [], ...o }) => {
        if(o.name.toLowerCase().includes(name.toLowerCase())) {
            r.push(Object.assign(o, { children }))
            return r
        }
        children = filterTree(children, name)
        if(children.length) {
            r.push(Object.assign(o, { children }))
        }
        return r
    }, [])
}

export function addSortOrderToTree(array: CollectionItem[]) {
    array.forEach((item, index) => {
        item.sortOrder = index
        if(item.children) {
            addSortOrderToTree(item.children)
        }
    })
}

export function sortTree(array: CollectionItem[]) {
    array.sort((a, b) => a.sortOrder! - b.sortOrder!)
    array.forEach(item => {
        if(item.children) {
            sortTree(item.children)
        }
    })
}

export function removeFromTree(array: any[], key: string, keyValue: string): boolean {
    const index = array.findIndex(x => x[key] === keyValue)
    if (index > -1) {
        array.splice(index, 1)
        return true
    } else {
        return array.some(item => {
            if (item.children) {
                return removeFromTree(item.children, key, keyValue)
            } else {
                return false
            }
        })
    }
}

// From: https://stackoverflow.com/a/34720792/4932305
// Note: the final array includes the initially passed id as well
export function getChildIds(arr: any[], id: string) {
    const ret: any[] = []
    for (let i = 0; i < arr.length; i++) {
        const item = arr[i]
        if (item.parentId == id || item._id == id) {
            if (ret.indexOf(item._id) < 0) {
                ret.push(item._id)
                const newret: any[] = []
                for (let x = 0; x < arr.length; x++) {
                    if (x != i) {
                        newret.push(arr[x])
                    }
                }
                const children = getChildIds(newret, item._id)
                if (children.length > 0) {
                    for (let j = 0; j < children.length; j++) {
                        if (!(ret.indexOf(children[j]) >= 0)) {
                            ret.push(children[j])
                        }
                    }
                }
            }

        }
    }
    return ret
}

export function findItemInTreeById(array: CollectionItem[], id: string): CollectionItem | null {
    let result = null
    function findItemInTreeByIdRecurse(array2: CollectionItem[], id2: string) {
        for(let i = 0; i < array2.length; i++) {
            if(array2[i]._id === id2) {
                result = array2[i]
            }

            if('children' in array2[i]) {
                findItemInTreeByIdRecurse(array2[i].children as CollectionItem[], id2)
            }
        }
    }
    findItemInTreeByIdRecurse(array, id)
    return result
}

export function generateNewIdsForTreeItemChildren(treeItem: CollectionItem, oldIdNewIdMapping: Record<string, string> | null = null) {
    const parentId = treeItem._id
    treeItem.children?.forEach(item => {
        const newId = nanoid()
        if(oldIdNewIdMapping !== null) {
            oldIdNewIdMapping[item._id] = newId
        }
        item._id = newId
        item.parentId = parentId
        if('children' in item) {
            generateNewIdsForTreeItemChildren(item, oldIdNewIdMapping)
        }
    })
}

export function generateNewIdsForTree(array: CollectionItem[]) {
    const oldIdNewIdMapping: Record<string, string> = {}

    array.forEach(treeItem => {
        const newId = nanoid()
        oldIdNewIdMapping[treeItem._id] = newId
        treeItem._id = newId
        if('children' in treeItem) {
            treeItem.children?.forEach(item => {
                const newId = nanoid()
                oldIdNewIdMapping[item._id] = newId
                item._id = newId
                item.parentId = treeItem._id
                if('children' in item) {
                    generateNewIdsForTreeItemChildren(item, oldIdNewIdMapping)
                }
            })
        }
    })

    return oldIdNewIdMapping
}

// From: https://stackoverflow.com/a/6470794/4932305
export function arrayMove(array: any[], fromIndex: number, toIndex: number) {
    const element = array[fromIndex]
    array.splice(fromIndex, 1)
    array.splice(toIndex, 0, element)
}

// From: https://stackoverflow.com/a/65939108/4932305
export function downloadObjectAsJSON(filename: string, dataObjToWrite: any) {
    const blob = new Blob([JSON.stringify(dataObjToWrite)], { type: 'text/json' })
    const link = document.createElement('a')

    link.download = filename
    link.href = window.URL.createObjectURL(blob)
    link.dataset.downloadurl = ['text/json', link.download, link.href].join(':')

    const event = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
    })

    link.dispatchEvent(event)
    link.remove()
}

export function todayISODate() {
    return dayjs().format('YYYY-MM-DD')
}

// From: https://stackoverflow.com/a/46800515/4932305
export function isFirstIdIndirectOrDirectParentOfSecondIdInTree(array: any, firstId: any, secondId: any) {
    let result = false

    function f(data: any, a: any, b: any, p = false) {
        if (Array.isArray(data)) {
            data.forEach(function(o) {
                if(p && a == o._id) {
                    result = true
                } else {
                    if('children' in o) {
                        f(o.children, a, b, !p ? b == o._id : p)
                    }
                }
            })
        } else {
            if('children' in data) {
                f(data.children, a, b, p)
            }
        }
    }

    f(array, secondId, firstId)

    return result
}

export function dateFormat(date: number, includeSeconds = false) {
    let format = 'DD-MMM-YY hh:mm A'

    if(includeSeconds) {
        format = 'DD-MMM-YY hh:mm:ss A'
    }

    return dayjs(date).format(format)
}

// From: https://github.com/Kong/insomnia/blob/e5b6f9034e34afc06def38c9d6a79a978fb19bb2/packages/insomnia-app/app/ui/components/tags/time-tag.tsx
export function humanFriendlyTime(milliseconds: number) {
    let unit = 'ms'
    let number = milliseconds

    if (milliseconds > 1000 * 60) {
        unit = 'm'
        number = milliseconds / 1000 / 60
    } else if (milliseconds > 1000) {
        unit = 's'
        number = milliseconds / 1000
    }

    // Round to 0, 1, 2 decimal places depending on how big the number is
    if (number > 100) {
        number = Math.round(number)
    } else if (number > 10) {
        number = Math.round(number * 10) / 10
    } else {
        number = Math.round(number * 100) / 100
    }

    return `${number} ${unit}`
}

export function getObjectPaths(object: object): string[] {
    const paths: any[] = []

    function recurse(obj: any, keyParent = '') {
        if(typeof obj === 'number' || typeof obj === 'string' || obj === null) {
            return
        }
        const isArray = Array.isArray(obj)
        Object.keys(obj).forEach(key => {
            let newKeyParent = keyParent
            if(newKeyParent) {
                if(isArray) {
                    newKeyParent = `${newKeyParent}[${key}]`
                } else {
                    newKeyParent = `${newKeyParent}.${key}`
                }
            } else {
                newKeyParent = key
            }
            paths.push(newKeyParent)
            recurse(obj[key], newKeyParent)
        })
    }

    recurse(object)

    return paths
}

export function exportRestfoxCollection(collection: CollectionItem[], environments = undefined) {
    downloadObjectAsJSON(`Restfox_${todayISODate()}.json`, {
        exportedFrom: 'Restfox-1.0.0',
        collection,
        environments,
    })
}

export function exportCollection(collection: any, appName: 'Postman' | 'Insomnia') {
    downloadObjectAsJSON(`${appName}_${todayISODate()}.json`, collection)
}

// From: https://github.com/Kong/insomnia/blob/fac2627d695a10865d0f7f9ea7b2c04a77d92194/packages/insomnia/src/common/misc.ts#L169-L192
export function humanFriendlySize(bytes: number, long = false) {
    bytes = Math.round(bytes * 10) / 10
    let size
    // NOTE: We multiply these by 2 so we don't end up with
    // values like 0 GB
    let unit

    if (bytes < 1024 * 2) {
        size = bytes
        unit = long ? 'bytes' : 'B'
    } else if (bytes < 1024 * 1024 * 2) {
        size = bytes / 1024
        unit = long ? 'kilobytes' : 'KB'
    } else if (bytes < 1024 * 1024 * 1024 * 2) {
        size = bytes / 1024 / 1024
        unit = long ? 'megabytes' : 'MB'
    } else {
        size = bytes / 1024 / 1024 / 1024
        unit = long ? 'gigabytes' : 'GB'
    }

    const rounded = Math.round(size * 10) / 10
    return `${rounded} ${unit}`
}

export function checkHotkeyAgainstKeyEvent(hotkey: string, event: KeyboardEvent) {
    const keys: string[] = hotkey.split(' + ')
    const ctrlKeyRequired: boolean = keys.includes('Ctrl')
    const altKeyRequired: boolean = keys.includes('Alt')
    const shiftKeyRequired: boolean = keys.includes('Shift')
    const requiredKey = keys.filter(key => !['Ctrl', 'Alt', 'Shift'].includes(key)).pop()

    let hotkeyMatched = true

    if(ctrlKeyRequired) {
        if(!event.ctrlKey) {
            hotkeyMatched = false
        }
    } else {
        if(event.ctrlKey) {
            hotkeyMatched = false
        }
    }

    if(altKeyRequired) {
        if(!event.altKey) {
            hotkeyMatched = false
        }
    } else {
        if(event.altKey) {
            hotkeyMatched = false
        }
    }

    if(shiftKeyRequired) {
        if(!event.shiftKey) {
            hotkeyMatched = false
        }
    } else {
        if(event.shiftKey) {
            hotkeyMatched = false
        }
    }

    if(event.key.toLowerCase() !== requiredKey?.toLowerCase()) {
        hotkeyMatched = false
    }

    return hotkeyMatched
}

export function setObjectPathValue(object: any, path: string, value: string) {
    setObjectPathValueLodash(object, path, value)
}

export function applyTheme(themeName: 'light' | 'dark' | 'dracula', doc: Document = document) {
    doc.documentElement.className = `theme-${themeName}`
}

export function codeMirrorSyntaxHighlighting() {
    const highlightStyle = HighlightStyle.define([
        {
            tag: tags.string,
            class: 'cm-string'
        },
        {
            tag: tags.number,
            class: 'cm-number'
        },
        {
            tag: tags.bool,
            class: 'cm-boolean'
        },
        {
            tag: tags.null,
            class: 'cm-null'
        },
        {
            tag: tags.propertyName,
            class: 'cm-property'
        },
        {
            tag: tags.comment,
            class: 'cm-comment'
        },
        {
            tag: tags.keyword,
            class: 'cm-keyword'
        },
        {
            tag: tags.definition(tags.variableName),
            class: 'cm-variable'
        },
    ])

    return highlightStyle
}

export function downloadBlob(filename: string, blob: Blob) {
    const link = document.createElement('a')

    link.download = filename
    link.href = window.URL.createObjectURL(blob)

    const event = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
    })

    link.dispatchEvent(event)
    link.remove()
}

export function parseContentDispositionHeaderAndGetFileName(headerValue: string, fallbackFileName: string) {
    const filenameItem = headerValue.split(';').map(item => item.trim()).find(item => item.startsWith('filename='))
    if (filenameItem) {
        let fileNameToReturn = filenameItem.split('=')[1]
        if (fileNameToReturn.startsWith('"') && fileNameToReturn.endsWith('"')) {
            fileNameToReturn = fileNameToReturn.slice(1, -1)
        }
        return fileNameToReturn
    }
    return fallbackFileName
}

export function formatTimestamp(epoch: number) {
    return dayjs(epoch).format('YYYY-MM-DD hh:mm:ss A')
}

export function generateId() {
    return nanoid()
}

export function setEnvironmentVariable(store: ActionContext<State, State>, objectPath: string, value: string) {
    try {
        if(store.state.activeWorkspace === null) {
            throw new Error('activeWorkspace is null')
        }

        const environmentToModify = store.state.activeWorkspace.environment ?? {}
        const environmentsToModify = store.state.activeWorkspace.environments ?? [
            {
                name: constants.DEFAULT_ENVIRONMENT.name,
                environment: {},
                color: constants.DEFAULT_ENVIRONMENT.color
            }
        ]
        setObjectPathValue(environmentToModify, objectPath, value)
        store.state.activeWorkspace.environment = environmentToModify
        store.commit('updateWorkspaceEnvironment',  {
            workspaceId: store.state.activeWorkspace._id,
            environment: environmentToModify
        })
        const currentEnvironment = environmentsToModify.find(environmentItem => environmentItem.name === (store.state.activeWorkspace!.currentEnvironment ?? 'Default'))
        currentEnvironment.environment = environmentToModify
        store.commit('updateWorkspaceEnvironments',  {
            workspaceId: store.state.activeWorkspace._id,
            environments: environmentsToModify
        })
    } catch(e) {
        console.error('Failed to set environment variable:')
        console.error(e)
    }
}

export function prependParentTitleToChildTitle(array: CollectionItem[], prepend = '') {
    array.forEach(item => {
        item.name = `${prepend ? prepend + ' ' : ''}${item.name}`
        if(item.children) {
            prependParentTitleToChildTitle(item.children, item.name + ' → ')
        }
    })
}

export function debounce<T extends(...args: any[]) => any>(
    func: T,
    timeout = 300
): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | undefined
    return (...args: Parameters<T>) => {
        clearTimeout(timer)
        timer = setTimeout(() => func(...args), timeout)
    }
}

export function getAlertConfirmPromptContainer(componentRootElement: HTMLElement) : {
    createPrompt: any
    createConfirm: any
    createAlert: any
} {
    return (componentRootElement.ownerDocument?.defaultView ?? window).document.querySelector('alert-confirm-prompt') as any
}

export function getCurrentTimestamp(): string {
    return dayjs().format('HH:mm:ss:SSS')
}

export function getVersion(): string {
    return version
}

export function uriParse(urlString: string): {
    protocol: string | null;
    host: string | null;
    port: string | null;
    pathname: string | null;
    hash: string | null;
    search: string | null;
} {
    const { protocol, host, port, pathname, hash, search}  = new URL(urlString)
    return { protocol, host, port, pathname, hash, search }
}

export function getStatusText(statusCode: number): string {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return constants.STATUS_CODE_TEXT_MAPPING[statusCode.toString()]
}

export function bufferToString(buffer: BufferSource) {
    const textDecoder = new TextDecoder('utf-8')
    return textDecoder.decode(buffer)
}

export function timeAgo(timestamp: number) {
    const now: any = new Date()
    const date: any = new Date(timestamp)
    const secondsPast = Math.floor((now - date) / 1000)

    if (secondsPast < 60) {
        return secondsPast === 1 || secondsPast < 1 ? 'Just Now' : `${secondsPast} seconds ago`
    }
    if (secondsPast < 3600) {
        const minutesPast = Math.floor(secondsPast / 60)
        return minutesPast === 1 ? '1 minute ago' : `${minutesPast} minutes ago`
    }
    if (secondsPast < 86400) {
        const hoursPast = Math.floor(secondsPast / 3600)
        return hoursPast === 1 ? 'one hour ago' : `${hoursPast} hours ago`
    }
    if (secondsPast < 2592000) { // Less than 30 days
        const daysPast = Math.floor(secondsPast / 86400)
        return daysPast === 1 ? 'one day ago' : `${daysPast} days ago`
    }
    if (secondsPast < 31536000) { // Less than 365 days
        const monthsPast = Math.floor(secondsPast / 2592000)
        return monthsPast === 1 ? 'one month ago' : `${monthsPast} months ago`
    }
    const yearsPast = Math.floor(secondsPast / 31536000)
    return yearsPast === 1 ? 'one year ago' : `${yearsPast} years ago`
}

export function responseStatusColorMapping(response: Response) {
    let color

    if(response.status >= 200 && response.status <= 299) {
        color = 'green'
    }

    if(response.status >= 400 && response.status <= 499) {
        color = 'yellow'
    }

    if(response.status >= 500 || response.statusText === 'Error') {
        color = 'red'
    }

    return color
}

// From: https://dexie.org/docs/StorageManager#summary
async function tryPersistWithoutPromtingUser() {
    if (!navigator.storage || !navigator.storage.persisted) {
        return 'never'
    }
    let persisted = await navigator.storage.persisted()
    if (persisted) {
        return 'persisted'
    }
    if (!navigator.permissions || !navigator.permissions.query) {
        return 'prompt' // It MAY be successful to prompt. Don't know.
    }
    const permission = await navigator.permissions.query({
        name: 'persistent-storage'
    })
    if (permission.state === 'granted') {
        persisted = await navigator.storage.persist()
        if (persisted) {
            return 'persisted'
        } else {
            throw new Error('Failed to persist')
        }
    }
    if (permission.state === 'prompt') {
        return 'prompt'
    }
    return 'never'
}

// From: https://dexie.org/docs/StorageManager#summary
export async function initStoragePersistence() {
    const persist = await tryPersistWithoutPromtingUser()
    switch (persist) {
        case 'never':
            console.log('Not possible to persist storage')
            break
        case 'persisted':
            console.log('Successfully persisted storage silently')
            break
        case 'prompt':
            console.log('Not persisted, so we will try to prompt user')
            if(navigator.storage && navigator.storage.persist) {
                if(await navigator.storage.persist()) {
                    console.log('Storage is now persisted')
                } else {
                    console.log('Storage was not persisted')
                }
            }
            break
    }
}

export function resolveAuthentication(authentication: RequestAuthentication, environment: any) {
    if(authentication.type === 'basic') {
        return generateBasicAuthString(
            substituteEnvironmentVariables(environment, authentication.username ?? ''),
            substituteEnvironmentVariables(environment, authentication.password ?? '')
        )
    }

    if(authentication.type === 'bearer') {
        const authenticationBearerPrefix = authentication.prefix !== undefined && authentication.prefix !== '' ? authentication.prefix : 'Bearer'
        const authenticationBearerToken = authentication.token !== undefined ? authentication.token : ''
        return `${substituteEnvironmentVariables(environment, authenticationBearerPrefix)} ${substituteEnvironmentVariables(environment, authenticationBearerToken)}`
    }
}

export function toggleDropdown(event: any, dropdownState: any) {
    dropdownState.visible = !dropdownState.visible

    if (dropdownState.visible) {
        const containerElement = event.target.closest('.custom-dropdown')
        const rect = containerElement.getBoundingClientRect()
        dropdownState.contextMenuX = rect.left
        dropdownState.contextMenuY = rect.top + rect.height
        dropdownState.element = containerElement
    } else {
        dropdownState.element = null
    }
}

/**
 * Convert a script from one environment to another based on script type.
 *
 * @param {string} scriptToConvert - The script to convert.
 * @param {string} scriptType - The type of script being converted.
 * @returns {string} - The converted script.
 */
export function scriptConversion(scriptToConvert: string, scriptType: 'postmanToRestfox' | 'restfoxToPostman' | 'restfoxToInsomnia') {
    const mappings = {
        postmanToRestfox: {
            'pm.environment.set': 'rf.setEnvVar',
            'pm.environment.get': 'rf.getEnvVar',
            'pm.response.json()': 'rf.response.getBodyJSON()'
        },
        restfoxToPostman: {
            'rf.setEnvVar': 'pm.environment.set',
            'rf.getEnvVar': 'pm.environment.get',
            'rf.response.getBodyJSON()': 'pm.response.json()'
        },
        restfoxToInsomnia: {
            'rf.setEnvVar': 'insomnia.setEnvironmentVariable',
            'rf.getEnvVar': 'insomnia.getEnvironmentVariable',
            'rf.response.getBodyJSON()': 'insomnia.response.json()'
        },
    }

    const selectedMapping = mappings[scriptType]
    if (!selectedMapping) {
        throw new Error(`Unsupported script type: ${scriptType}`)
    }

    let convertedScript = scriptToConvert
    for (const [key, value] of Object.entries(selectedMapping)) {
        convertedScript = convertedScript.replaceAll(key, value)
    }

    return convertedScript
}


export async function convertCollectionsFromRestfoxToPostman(restfoxCollections: any) {
    const restfoxData: any = restfoxCollections

    const postmanCollection: any = {
        info: {
            name: 'Imported Collection',
            schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
        },
        item: []
    }

    const folderMap: any = {}

    // First, create all folders and store them in folderMap
    restfoxData.forEach((item: any) => {
        if (item._type === 'request_group') {
            const postmanItem: { name: any, item: any[] } = {
                name: item.name,
                item: []
            }
            folderMap[item._id] = postmanItem

            // Check if the parent folder exists in folderMap and add the folder as a child
            if (item.parentId && folderMap[item.parentId]) {
                folderMap[item.parentId].item.push(postmanItem)
            } else {
                postmanCollection.item.push(postmanItem)
            }
        }
    })

    // Then, create all requests and push them to the appropriate folders in folderMap
    restfoxData.forEach((item: any) => {
        if (item._type === 'request') {
            const postmanRequest: any = {
                name: item.name,
                request: {
                    method: item.method,
                    header: [],
                    body: {
                        mode: 'raw',
                        raw: item.body.text,
                        options: {
                            raw: {
                                language: item.body.mimeType.split('/')[1]
                            }
                        }
                    },
                    url: {
                        raw: item.url,
                        host: item.url,
                        query: item.parameters ? item.parameters.filter((param: any) => !param.disabled).map((param: any) => ({ key: param.name, value: param.value })) : []
                    }
                },
                event: [],
                response: []
            }

            if (item.headers && item.headers.length > 0) {
                postmanRequest.request.header = item.headers.map((header: any) => ({
                    key: header.name,
                    value: header.value
                }))
            }

            if (item.plugins && item.plugins.length > 0) {
                item.plugins.forEach((plugin: any) => {
                    if (plugin.enabled && plugin.type === 'script') {
                        if (plugin.code.pre_request) {
                            postmanRequest.event.push({
                                listen: 'prerequest',
                                script: {
                                    type: 'text/javascript',
                                    exec: scriptConversion(plugin.code.pre_request, 'restfoxToPostman').trim().split('\n')
                                }
                            })
                        }
                        if (plugin.code.post_request) {
                            postmanRequest.event.push({
                                listen: 'test',
                                script: {
                                    type: 'text/javascript',
                                    exec: scriptConversion(plugin.code.post_request, 'restfoxToPostman').trim().split('\n')
                                }
                            })
                        }
                    }
                })
            }

            // Check if the parent folder exists in folderMap and add the request to that folder
            if (item.parentId && folderMap[item.parentId]) {
                folderMap[item.parentId].item.push(postmanRequest)
            } else {
                postmanCollection.item.push(postmanRequest)
            }
        }
    })

    return postmanCollection
}

export async function convertCollectionsFromRestfoxToInsomnia(restfoxCollections: any) {
    const insomniaCollection: any = {
        _type: 'export',
        __export_format: 4,
        __export_date: new Date().toISOString(),
        __export_source: 'restfox-to-insomnia-converter',
        resources: []
    }

    const workspaceId = restfoxCollections[0].workspaceId || 'root_workspace'

    const workspace = {
        _id: workspaceId,
        _type: 'workspace',
        name: 'Imported from Restfox',
        description: '',
        scope: 'collection',
    }

    insomniaCollection.resources.push(workspace)

    const folderMap: any = {}

    // First, create all folders and store them in folderMap
    restfoxCollections.forEach((item: any) => {
        if (item._type === 'request_group') {
            const insomniaFolder = {
                _id: item._id,
                _type: 'request_group',
                parentId: item.parentId || workspaceId,
                name: item.name,
            }
            folderMap[item._id] = insomniaFolder
            insomniaCollection.resources.push(insomniaFolder)
        }
    })

    // Then, create all requests and push them to the appropriate folders in folderMap
    restfoxCollections.forEach((restfoxRequest: any) => {
        if (restfoxRequest._type !== 'request') {
            return
        }

        let body = {}

        if (restfoxRequest.body.mimeType !== 'No Body') {
            body = restfoxRequest.body
        }

        const insomniaRequest: any = {
            _id: restfoxRequest._id,
            _type: 'request',
            parentId: restfoxRequest.parentId || workspaceId,
            name: restfoxRequest.name || restfoxRequest.url,
            method: restfoxRequest.method,
            url: restfoxRequest.url,
            body,
            headers: restfoxRequest.headers,
            authentication: convertRestfoxAuthToInsomniaAuth(restfoxRequest.authentication),
            parameters: restfoxRequest.parameters,
        }

        const scripts = restfoxRequest.plugins?.find((plugin: any) => plugin.type === 'script')
        if (scripts) {
            insomniaRequest.hook = {
                preRequest: scriptConversion(scripts.code.pre_request, 'restfoxToInsomnia').trim() || '',
                postRequest: scriptConversion(scripts.code.post_request, 'restfoxToInsomnia').trim() || ''
            }
        }

        insomniaCollection.resources.push(insomniaRequest)
    })

    return insomniaCollection
}

function convertRestfoxAuthToInsomniaAuth(auth: any) {
    const insomniaAuth: any = {}

    switch (auth?.type) {
        case 'No Auth':
            insomniaAuth.type = 'none'
            break
        case 'Basic Auth':
            insomniaAuth.type = 'basic'
            insomniaAuth.username = auth?.username || ''
            insomniaAuth.password = auth?.password || ''
            break
        case 'Bearer Token':
            insomniaAuth.type = 'bearer'
            insomniaAuth.token = auth?.token || ''
            break
        default:
            insomniaAuth.type = 'none'
            break
    }

    return insomniaAuth
}
