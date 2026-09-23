import JSZip from 'jszip'
import { nanoid } from 'nanoid'
import {
    CollectionItem,
    RequestBody,
    RequestAuthentication,
    RequestParam,
    Plugin,
} from '@/global'
import { convertPostmanAuthToRestfoxAuth, scriptConversion } from '@/helpers'
import constants from '@/constants'

export interface PostmanEnvironment {
    name: string
    environment: Record<string, unknown>
}

function isPostmanCollectionV2(json: any) {
    return json?.info?.schema === constants.POSTMAN_SCHEMA['v2.0'] || json?.info?.schema === constants.POSTMAN_SCHEMA['v2.1']
}

// an environment or globals file, older ones carry only a name and the values
export function isPostmanVariablesFile(json: any) {
    return json?._postman_variable_scope === 'environment' || json?._postman_variable_scope === 'globals' || (typeof json?.name === 'string' && Array.isArray(json?.values) && !('info' in json) && !('collections' in json))
}

export function isPostmanDataDump(json: any) {
    return json?.version === 1 && Array.isArray(json?.collections)
}

// a disabled variable is not used by Postman, so it is left out
function convertPostmanVariables(values: any): Record<string, unknown> {
    const variables: Record<string, unknown> = {}

    if(Array.isArray(values)) {
        values.forEach((variable: any) => {
            if(variable?.key && variable.enabled !== false) {
                variables[variable.key] = variable.value ?? ''
            }
        })
    }

    return variables
}

// environments and globals come back apart, as globals from one file apply to the environments from another file of the
// same import
export async function convertPostmanExportToRestfoxCollection(json: any, isZip: boolean, workspaceId: string): Promise<{
    collection: CollectionItem[],
    plugins: Plugin[],
    environments: PostmanEnvironment[],
    globals: Record<string, unknown> | null
}> {
    const collections: any[] = []
    const environments: PostmanEnvironment[] = []
    let globals: Record<string, unknown> | null = null

    const addVariablesFile = (variablesFile: any) => {
        if(variablesFile._postman_variable_scope === 'globals') {
            globals = { ...globals, ...convertPostmanVariables(variablesFile.values) }
        } else {
            environments.push({ name: variablesFile.name, environment: convertPostmanVariables(variablesFile.values) })
        }
    }

    // a Postman data export zip holds collection/, environment/ and archive.json, each file is read for what it holds
    // rather than found through archive.json
    if(isZip) {
        const extractedZip = await new JSZip().loadAsync(json)

        for(const file of Object.values(extractedZip.files)) {
            if(file.dir || !file.name.endsWith('.json')) {
                continue
            }

            let fileJson: any

            try {
                fileJson = JSON.parse(await file.async('text'))
            } catch {
                continue
            }

            if(isPostmanCollectionV2(fileJson)) {
                collections.push(fileJson)
            } else if(isPostmanVariablesFile(fileJson)) {
                addVariablesFile(fileJson)
            }
        }

        return { ...importPostmanV2(collections, workspaceId), environments, globals }
    }

    if(isPostmanCollectionV2(json)) {
        return { ...importPostmanV2([json], workspaceId), environments, globals }
    }

    if(isPostmanVariablesFile(json)) {
        addVariablesFile(json)
        return { collection: [], plugins: [], environments, globals }
    }

    // a newer dump keeps each workspace's globals as an environment named "<workspace> - globals"
    if(isPostmanDataDump(json)) {
        (json.environments ?? []).forEach((environment: any) => addVariablesFile({ ...environment, _postman_variable_scope: / - globals$/.test(environment.name ?? '') ? 'globals' : 'environment' }))

        if(Array.isArray(json.globals) && json.globals.length > 0) {
            globals = { ...(globals ?? {}), ...convertPostmanVariables(json.globals) }
        }
    }

    return { ...importPostmanV1(json.collections, workspaceId), environments, globals }
}

// Postman resolves a variable from the environment before the globals, so an environment keeps its own value, and
// globals without an environment become one of their own
export function mergePostmanGlobals(environments: PostmanEnvironment[], globals: Record<string, unknown> | null): PostmanEnvironment[] {
    if(globals === null || Object.keys(globals).length === 0) {
        return environments
    }

    if(environments.length === 0) {
        return [{ name: 'Postman Globals', environment: globals }]
    }

    return environments.map(environment => ({ ...environment, environment: { ...globals, ...environment.environment } }))
}

// Postman sends these Content-Type headers itself when none is typed, Restfox sends only the typed ones, so they are
// added to the imported request
const POSTMAN_RAW_LANGUAGE_CONTENT_TYPES: Record<string, string> = {
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    javascript: 'application/javascript',
}

function addPostmanImplicitContentType(headers: RequestParam[], contentType: string | undefined) {
    if(contentType === undefined || headers.some(header => !header.disabled && header.name?.toLowerCase() === 'content-type')) {
        return
    }

    headers.push({
        name: 'Content-Type',
        value: contentType
    })
}

// a form field Postman sends a file for keeps its name, the file has to be chosen again
function convertPostmanFormDataParam(param: any, disabled: boolean): RequestParam {
    if(param.type === 'file') {
        return {
            name: param.key,
            value: '',
            description: param.description,
            disabled,
            type: 'file',
            files: []
        }
    }

    return {
        name: param.key,
        value: param.value ?? '',
        description: param.description,
        disabled,
        type: 'text'
    }
}

function hasPostmanScript(events: any) {
    return Array.isArray(events) && events.some(event => [event?.script?.exec ?? []].flat().join('').trim() !== '')
}

function createPostmanScriptPlugin(events: any[], collectionId: string): Plugin {
    let preScript = ''
    let postScript = ''

    events.forEach((event: any) => {
        const exec = [event?.script?.exec ?? []].flat().join('\n')

        if(event.listen === 'prerequest') {
            preScript += exec
        }

        if(event.listen === 'test') {
            postScript += exec
        }
    })

    return {
        '_id': nanoid(),
        'type': 'script',
        'name': null,
        'code': {
            'pre_request': scriptConversion(preScript, 'postmanToRestfox'),
            'post_request': scriptConversion(postScript, 'postmanToRestfox')
        },
        'collectionId': collectionId,
        'workspaceId': null,
        'enabled': true,
        'createdAt': Date.now(),
        'updatedAt': Date.now()
    }
}

// an older Postman data dump has the headers only as text, one "Name: value" per line and "//" before a disabled one
function parsePostmanV1HeadersText(headersText: string): RequestParam[] {
    const headers: RequestParam[] = []

    for(const line of headersText.split('\n')) {
        const disabled = line.trim().startsWith('//')
        const header = disabled ? line.trim().slice(2) : line
        const separatorIndex = header.indexOf(':')

        if(separatorIndex === -1 || header.slice(0, separatorIndex).trim() === '') {
            continue
        }

        headers.push({
            name: header.slice(0, separatorIndex).trim(),
            value: header.slice(separatorIndex + 1).trim(),
            disabled
        })
    }

    return headers
}

function convertPostmanV1Request(request: any, workspaceId: string, plugins: Plugin[]): CollectionItem {
    let body: RequestBody = {
        mimeType: 'No Body'
    }

    // Postman leaves "enabled" out of some items, so only an explicit false disables one
    const requestData = Array.isArray(request.data) ? request.data : []

    if(request.dataMode === 'urlencoded') {
        body = {
            mimeType: 'application/x-www-form-urlencoded',
            params: requestData.map((requestDataItem: any) => ({
                name: requestDataItem.key,
                value: requestDataItem.value,
                description: requestDataItem.description,
                disabled: requestDataItem.enabled === false
            }))
        }
    }

    // "params" is Postman's form data, and the mode every request starts in, so one without fields has no body
    if(request.dataMode === 'params' && requestData.length > 0) {
        body = {
            mimeType: 'multipart/form-data',
            params: requestData.map((requestDataItem: any) => convertPostmanFormDataParam(requestDataItem, requestDataItem.enabled === false))
        }
    }

    if(request.dataMode === 'raw') {
        body = {
            mimeType: 'text/plain',
            text: request.rawModeData
        }
    }

    if(request.dataMode === 'binary') {
        body = {
            mimeType: 'application/octet-stream'
        }
    }

    const headers: RequestParam[] = Array.isArray(request.headerData) ? request.headerData.map((header: any) => ({
        name: header.key,
        value: header.value,
        description: header.description,
        disabled: header.enabled === false
    })) : parsePostmanV1HeadersText(request.headers ?? '')

    if(request.dataMode === 'urlencoded') {
        addPostmanImplicitContentType(headers, 'application/x-www-form-urlencoded')
    }

    // without queryParams the query stays in the url, which Send uses as it is when there are no parameters
    const parameters: RequestParam[] | undefined = Array.isArray(request.queryParams) ? request.queryParams.map((queryParam: any) => ({
        name: queryParam.key,
        value: queryParam.value,
        description: queryParam.description,
        disabled: queryParam.enabled === false
    })) : undefined

    // the scripts of an older dump are in preRequestScript and tests, written against a script API Restfox does not
    // have, only the events of a newer one are imported
    if(hasPostmanScript(request.events)) {
        plugins.push(createPostmanScriptPlugin(request.events, request.id))
    }

    return {
        _id: request.id,
        _type: 'request',
        method: request.method,
        url: request.url,
        name: request.name,
        body,
        headers,
        parameters,
        authentication: convertPostmanAuthToRestfoxAuth(request),
        description: request.description || undefined,
        parentId: null,
        workspaceId
    }
}

// a data dump lists every folder of a collection flat, a folder names its subfolders in folders_order and its requests
// in order, and a request names its folder too
function importPostmanV1(collections: any[], workspaceId: string) {
    const collection: CollectionItem[] = []
    const plugins: Plugin[] = []

    collections.forEach(postmanCollection => {
        const postmanFolders: any[] = Array.isArray(postmanCollection.folders) ? postmanCollection.folders : []
        const folderIds = new Set(postmanFolders.map(folder => folder.id))
        const parentIds = new Map<string, string>()

        postmanFolders.forEach(folder => {
            (folder.folders_order ?? []).forEach((childFolderId: string) => parentIds.set(childFolderId, folder.id));
            (folder.order ?? []).forEach((requestId: string) => parentIds.set(requestId, folder.id))
        })

        const getParentId = (id: string, folderId?: string) => {
            const parentId = folderId && folderIds.has(folderId) ? folderId : parentIds.get(id)
            return parentId !== undefined && parentId !== id ? parentId : postmanCollection.id
        }

        const childrenByParentId = new Map<string, { folders: CollectionItem[], requests: CollectionItem[] }>()
        const getChildren = (parentId: string) => {
            if(!childrenByParentId.has(parentId)) {
                childrenByParentId.set(parentId, { folders: [], requests: [] })
            }
            return childrenByParentId.get(parentId)!
        }

        postmanFolders.forEach(folder => {
            const parentId = getParentId(folder.id)
            getChildren(parentId).folders.push({
                _id: folder.id,
                _type: 'request_group',
                name: folder.name,
                authentication: folder.auth ? convertPostmanAuthToRestfoxAuth(folder) : undefined,
                parentId,
                workspaceId
            })

            if(hasPostmanScript(folder.events)) {
                plugins.push(createPostmanScriptPlugin(folder.events, folder.id))
            }
        });

        (postmanCollection.requests ?? []).forEach((request: any) => {
            const parentId = getParentId(request.id, request.folder)
            getChildren(parentId).requests.push({ ...convertPostmanV1Request(request, workspaceId, plugins), parentId })
        })

        // folders first, then requests, each in Postman's order, anything the order leaves out after it
        const inOrder = (items: CollectionItem[], order: string[] | undefined) => {
            const rank = (item: CollectionItem) => {
                const index = (order ?? []).indexOf(item._id)
                return index === -1 ? Infinity : index
            }
            return [...items].sort((a, b) => rank(a) - rank(b))
        }

        const getOrderedChildren = (id: string, folderOrder: string[] | undefined, requestOrder: string[] | undefined): CollectionItem[] => {
            const { folders, requests } = getChildren(id)
            return [
                ...inOrder(folders, folderOrder).map(folder => {
                    const postmanFolder = postmanFolders.find(item => item.id === folder._id)
                    return { ...folder, children: getOrderedChildren(folder._id, postmanFolder.folders_order, postmanFolder.order) }
                }),
                ...inOrder(requests, requestOrder)
            ]
        }

        collection.push({
            _id: postmanCollection.id,
            _type: 'request_group',
            name: postmanCollection.name,
            children: getOrderedChildren(postmanCollection.id, postmanCollection.folders_order, postmanCollection.order),
            authentication: postmanCollection.auth ? convertPostmanAuthToRestfoxAuth(postmanCollection) : undefined,
            parentId: null,
            workspaceId
        })

        if(hasPostmanScript(postmanCollection.events)) {
            plugins.push(createPostmanScriptPlugin(postmanCollection.events, postmanCollection.id))
        }
    })

    return { collection, plugins }
}

function convertPostmanV2Body(postmanBody: any): { body: RequestBody, contentType?: string } {
    if(postmanBody?.mode === 'urlencoded') {
        return {
            body: {
                mimeType: 'application/x-www-form-urlencoded',
                params: (postmanBody.urlencoded ?? []).map((requestDataItem: any) => ({
                    name: requestDataItem.key,
                    value: requestDataItem.value,
                    description: requestDataItem.description,
                    disabled: requestDataItem.disabled
                }))
            },
            contentType: 'application/x-www-form-urlencoded'
        }
    }

    if(postmanBody?.mode === 'raw') {
        const language = postmanBody.options?.raw?.language
        let mimeType = language === 'json' ? 'application/json' : 'text/plain'

        if(mimeType === 'text/plain') {
            try {
                JSON.parse(postmanBody.raw)
                mimeType = 'application/json'
            } catch {}
        }

        return {
            body: {
                mimeType,
                text: postmanBody.raw
            },
            contentType: POSTMAN_RAW_LANGUAGE_CONTENT_TYPES[language]
        }
    }

    if(postmanBody?.mode === 'formdata') {
        return {
            body: {
                mimeType: 'multipart/form-data',
                params: (postmanBody.formdata ?? []).map((param: any) => convertPostmanFormDataParam(param, param.disabled === true))
            }
        }
    }

    // Postman keeps the variables as text, Restfox as the object the text holds
    if(postmanBody?.mode === 'graphql') {
        let variables = {}

        try {
            const parsedVariables = JSON.parse(postmanBody.graphql?.variables || '{}')
            if(parsedVariables !== null && typeof parsedVariables === 'object') {
                variables = parsedVariables
            }
        } catch {}

        return {
            body: {
                mimeType: 'application/graphql',
                text: JSON.stringify({
                    query: postmanBody.graphql?.query ?? '',
                    variables
                })
            },
            contentType: 'application/json'
        }
    }

    // the file has to be chosen again
    if(postmanBody?.mode === 'file') {
        return {
            body: {
                mimeType: 'application/octet-stream'
            }
        }
    }

    return {
        body: {
            mimeType: 'No Body'
        }
    }
}

function handlePostmanV2CollectionItem(postmanCollectionItem: any, parentId: string | null = null, workspaceId: string) {
    const requests: CollectionItem[] = []
    const plugins: Plugin[] = []

    postmanCollectionItem.item.forEach((request: any) => {
        if(!request) {
            return
        }
        const requestId = request.id ?? nanoid()
        if('item' in request) {
            const { convertedRequests, plugins: newPlugins } = handlePostmanV2CollectionItem(request, requestId, workspaceId)
            plugins.push(...newPlugins)

            if(hasPostmanScript(request.event)) {
                plugins.push(createPostmanScriptPlugin(request.event, requestId))
            }

            requests.push({
                _id: requestId,
                _type: 'request_group',
                name: request.name,
                children: convertedRequests,
                authentication: request.auth ? convertPostmanAuthToRestfoxAuth(request) : undefined,
                parentId,
                workspaceId
            })
            return
        }

        const { body, contentType } = convertPostmanV2Body(request.request.body)

        const headers: RequestParam[] = []
        const postmanHeaders = Array.isArray(request.request.header) ? request.request.header : []
        postmanHeaders.forEach((header: any) => {
            headers.push({
                name: header.key,
                value: header.value,
                description: header.description,
                disabled: header.disabled
            })
        })

        addPostmanImplicitContentType(headers, contentType)

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

        const pathParameters: RequestParam[] = []

        const pathParams = 'url' in request.request && typeof request.request.url !== 'string' && 'variable' in request.request.url ? request.request.url.variable : []
        pathParams.forEach((pathParam: any) => {
            pathParameters.push({
                name: pathParam.key,
                value: pathParam.value,
                description: pathParam.description,
                disabled: pathParam.disabled
            })
        })

        let url = ''

        if('url' in request.request) {
            url = typeof request.request.url === 'string' ? request.request.url : request.request.url.raw

            if (request.request.url && url === undefined) {
                if(request.request.url && request.request.url.host) {
                    url = request.request.url.host

                    if(request.request.url.path && request.request.url.path.length > 0) {
                        url += '/' + request.request.url.path.join('/')
                    }

                    if(request.request.url.query && request.request.url.query.length > 0) {
                        url += '?' + request.request.url.query.filter((item: any) => !item.disabled).map((query: any) => `${query.key}=${query.value}`).join('&')
                    }
                }
            }
        }

        const authentication: RequestAuthentication = convertPostmanAuthToRestfoxAuth(request.request)

        if(request.event) {
            plugins.push(createPostmanScriptPlugin(request.event, requestId))
        }

        let description = undefined

        if(request.request.description) {
            if(typeof request.request.description !== 'string' && 'content' in request.request.description) {
                description = request.request.description.content
            } else {
                description = request.request.description
            }
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
            pathParameters: pathParameters.length > 0 ? pathParameters : undefined,
            authentication,
            description,
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

        if(hasPostmanScript(postmanCollectionItem.event)) {
            plugins.push(createPostmanScriptPlugin(postmanCollectionItem.event, postmanCollectionItem.info._postman_id))
        }

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
            authentication: convertPostmanAuthToRestfoxAuth(postmanCollectionItem),
            workspaceId
        })
    })

    return { collection, plugins }
}
