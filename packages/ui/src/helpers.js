import JSZip from 'jszip'
import { nanoid } from 'nanoid'
import { createRequestContextForPlugin, createResponseContextForPlugin, usePlugin } from './plugin'
import dayjs from 'dayjs'
import getObjectPathValue from 'lodash.get'

// From: https://stackoverflow.com/a/67802481/4932305
export function toTree(array) {
    let map = {}, node, res = [], i
    for(i = 0; i < array.length; i += 1) {
        map[array[i]._id] = i
        if(array[i]._type === 'request_group') {
            array[i].children = []
        }
    }
    for(i = 0; i < array.length; i += 1) {
       node = array[i]
       if(node.parentId !== null) {
          array[map[node.parentId]].children.push(node)
       } else {
          res.push(node)
       }
    }
    return res
}

export function flattenTree(array) {
    const level = []

    array.forEach(item => {
        let newItem = Object.assign({}, item)
        delete newItem.children
        level.push(newItem)

        if(item.children) {
            level.push(...flattenTree(item.children))
        }
    })

    return level
}

export function substituteEnvironmentVariables(environment, string) {
    let substitutedString = String(string)

    const possibleEnvironmentObjectPaths = getObjectPaths(environment)

    possibleEnvironmentObjectPaths.forEach(objectPath => {
        const objectPathValue = getObjectPathValue(environment, objectPath)
        substitutedString = substitutedString.replace(`{{ _.${objectPath} }}`, objectPathValue)
        substitutedString = substitutedString.replace(`{{${objectPath}}}`, objectPathValue)
        substitutedString = substitutedString.replace(`{{ ${objectPath} }}`, objectPathValue)
    })

    return substitutedString
}

export function generateBasicAuthString(username, password) {
    return 'Basic ' + window.btoa(unescape(encodeURIComponent(username)) + ':' + unescape(encodeURIComponent(password)))
}

export async function fetchWrapper(url, method, headers, body, abortControllerSignal) {
    if('__EXTENSION_HOOK__' in window && window.__EXTENSION_HOOK__ === 'Restfox CORS Helper Enabled') {
        return new Promise((resolve, reject) => {
            window.postMessage({
                event: 'sendRequest',
                eventData: {
                    url: url.toString(),
                    method,
                    headers,
                    body
                }
            })

            const messageHandler = message => {
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
                    event: 'cancelRequest'
                })
                reject(new DOMException('The user aborted a request.', 'AbortError' ))
                window.removeEventListener('message',  messageHandler)
            }
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

    const timeTaken = endTime - startTime

    return {
        status,
        statusText,
        headers: responseHeaders,
        mimeType,
        buffer,
        timeTaken
    }
}

export async function handleRequest(request, environment, plugins, abortControllerSignal) {
    for(const plugin of plugins) {
        const requestContext = createRequestContextForPlugin(request, environment)

        await usePlugin(requestContext, {
            code: plugin.code
        })

        request = { ...request, body: requestContext.request.getBody(), parameters: requestContext.request.getQueryParams() }
    }

    let body = null

    if(request.body.mimeType === 'application/x-www-form-urlencoded') {
        if('params' in request.body) {
            body = new URLSearchParams(
                Object.fromEntries(
                    request.body.params.filter(item => !item.disabled).map(item => {
                        return [
                            substituteEnvironmentVariables(environment, item.name),
                            substituteEnvironmentVariables(environment, item.value)
                        ]
                    })
                )
            ).toString()
        }
    }

    if(request.body.mimeType === 'text/plain' || request.body.mimeType === 'application/json' || request.body.mimeType === 'application/graphql') {
        body = substituteEnvironmentVariables(environment, request.body.text)
    }

    if(request.body.mimeType === 'application/octet-stream' && request.body.fileName instanceof File) {
        body = request.body.fileName
    }

    try {
        let urlWithEnvironmentVariablesSubstituted = substituteEnvironmentVariables(environment, request.url)

        const url = new URL(urlWithEnvironmentVariablesSubstituted)

        if('parameters' in request && request.parameters) {
            request.parameters.filter(item => !item.disabled).forEach(param => {
                url.searchParams.append(
                    substituteEnvironmentVariables(environment, param.name),
                    substituteEnvironmentVariables(environment, param.value)
                )
            })
        }

        let headers = {}

        if('GLOBAL_HEADERS' in environment) {
            Object.keys(environment.GLOBAL_HEADERS).forEach(header => {
                headers[header.toLowerCase()] = environment.GLOBAL_HEADERS[header]
            })
        }

        if('headers' in request) {
            request.headers.filter(header => !header.disabled).forEach(header => {
                headers[substituteEnvironmentVariables(environment, header.name.toLowerCase())] = substituteEnvironmentVariables(environment, header.value)
            })
        }

        if('authentication' in request && request.authentication.type !== 'No Auth' && !request.authentication.disabled) {
            if(request.authentication.type === 'basic') {
                headers['Authorization'] = generateBasicAuthString(
                    substituteEnvironmentVariables(environment, request.authentication.username),
                    substituteEnvironmentVariables(environment, request.authentication.password)
                )
            }

            if(request.authentication.type === 'bearer') {
                const authenticationBearerPrefix = request.authentication.prefix !== undefined && request.authentication.prefix !== '' ? request.authentication.prefix : 'Bearer'
                headers['Authorization'] = `${substituteEnvironmentVariables(environment, authenticationBearerPrefix)} ${substituteEnvironmentVariables(environment, request.authentication.token)}`
            }
        }

        const response = await fetchWrapper(url, request.method, headers, body, abortControllerSignal)

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

        let responseToSend = {
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
                method: request.method,
                query: url.search,
                headers: headersToSave,
                bodyMimeType: request.body.mimeType,
                body
            },
            createdAt: new Date().getTime()
        }

        if(request.authentication) {
            responseToSend.request.authentication = JSON.parse(JSON.stringify(request.authentication))
        }

        for(const plugin of plugins) {
            const responseContext = createResponseContextForPlugin(responseToSend, environment)

            await usePlugin(responseContext, {
                code: plugin.code
            })

            responseToSend = { ...responseToSend, buffer: responseContext.response.getBody() }
        }

        return responseToSend
    } catch(e) {
        console.log(e)

        let error = `Error: Request failed`

        if(typeof e !== 'string')  {
            if(e.message.includes('Invalid URL')) {
                error = 'Error: Invalid URL'
            }

            if(e.name === 'AbortError') {
                error = 'Error: Request Cancelled'
            }
        }

        return {
            status: null,
            statusText: 'Error',
            error
        }
    }
}

export function convertInsomniaExportToRestfoxCollection(json, workspaceId) {
    let collection = []

    json.resources.filter(item => ['cookie_jar', 'api_spec', 'environment'].includes(item._type) == false).forEach(item => {
        if(item._type === 'workspace' || item._type === 'request_group') {
            collection.push({
                _id: item._id,
                _type: 'request_group',
                name: item.name,
                environment: item.environment,
                parentId: item.parentId === '__WORKSPACE_ID__' ? null : item.parentId,
                workspaceId
            })
        } else {
            let body = {
                mimeType: 'No Body'
            }

            if(item.body.mimeType === 'application/x-www-form-urlencoded') {
                body = {
                    mimeType: item.body.mimeType,
                    params: item.body.params.map(parameter => ({
                        name: parameter.name,
                        value: parameter.value,
                        description: parameter.description,
                        disabled: parameter.disabled
                    }))
                }
            }

            if(item.body.mimeType === 'text/plain' || item.body.mimeType === 'application/json' || item.body.mimeType === 'application/graphql') {
                body = {
                    mimeType: item.body.mimeType,
                    text: item.body.text
                }
            }

            collection.push({
                _id: item._id,
                _type: item._type,
                name: item.name,
                url: item.url,
                method: item.method,
                body: body,
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
                authentication: 'authentication' in item && Object.keys(item.authentication).length > 0 ? item.authentication : { type: 'No Auth' },
                description: 'description' in item ? item.description : undefined,
                parentId: item.parentId,
                workspaceId
            })
        }
    })

    return toTree(collection)
}

export async function convertPostmanExportToRestfoxCollection(json, isZip, workspaceId) {
    if(isZip) {
        const zip = new JSZip()
        const extractedZip = await zip.loadAsync(json)
        const filePaths = Object.keys(extractedZip.files)
        const filePathMap = {}
        const basePath = filePaths[filePaths.length - 1].replace('archive.json', '')
        filePaths.forEach(filePath => {
            filePathMap[filePath.replace(basePath, '')] = filePath
        })

        let archive = await extractedZip.files[filePathMap['archive.json']].async('text')
        archive = JSON.parse(archive)
        let archiveCollection = archive.collection

        let collections = []

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

function importPostmanV1(collections, workspaceId) {
    let collection = []

    collections.forEach(item => {
        let requests = []

        item.requests.forEach(request => {
            let body = {
                mimeType: 'No Body'
            }

            if(request.dataMode === 'urlencoded') {
                let params = []
                const requestData = request.data !== null ? request.data : []
                requestData.forEach(requestDataItem => {
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

            let headers = []
            request.headerData.forEach(header => {
                headers.push({
                    name: header.key,
                    value: header.value,
                    description: header.description,
                    disabled: !header.enabled
                })
            })

            let parameters = []
            const queryParams = request.queryParams !== null ? request.queryParams : []
            queryParams.forEach(queryParam => {
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

function handlePostmanV2CollectionItem(postmanCollectionItem, parentId=null, workspaceId) {
    let requests = []

    postmanCollectionItem.item.forEach(request => {
        const requestId = request.id ?? nanoid()
        if('item' in request) {
            requests.push({
                _id: requestId,
                _type: 'request_group',
                name: request.name,
                children: handlePostmanV2CollectionItem(request, requestId, workspaceId),
                parentId,
                workspaceId
            })
            return
        }

        let body = {
            mimeType: 'No Body'
        }

        if('body' in request.request && 'mode' in request.request.body) {
            if(request.request.body.mode === 'urlencoded') {
                let params = []
                const requestData = request.request.body.urlencoded
                requestData.forEach(requestDataItem => {
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

                body = {
                    mimeType: mimeType,
                    text: request.request.body.raw
                }
            }
        }

        let headers = []
        request.request.header.forEach(header => {
            headers.push({
                name: header.key,
                value: header.value,
                description: header.description,
                disabled: header.disabled
            })
        })

        let parameters = []
        const queryParams = 'url' in request.request && typeof request.request.url !== 'string' && 'query' in request.request.url ? request.request.url.query : []
        queryParams.forEach(queryParam => {
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

        requests.push({
            _id: requestId,
            _type: 'request',
            method: request.request.method,
            url,
            name: request.name,
            body,
            headers,
            parameters,
            description: 'description' in request.request ? request.request.description : undefined,
            parentId,
            workspaceId
        })
    })

    return requests
}

function importPostmanV2(collections, workspaceId) {
    let collection = []

    collections.forEach(postmanCollectionItem => {
        collection.push({
            _id: postmanCollectionItem.info._postman_id,
            _type: 'request_group',
            name: postmanCollectionItem.info.name,
            environment: 'variable' in postmanCollectionItem ? postmanCollectionItem.variable.reduce((prev, acc) => {
                prev[acc.key] = acc.value
                return prev
            }, {}) : undefined,
            children: handlePostmanV2CollectionItem(postmanCollectionItem, postmanCollectionItem.info._postman_id, workspaceId),
            parentId: null,
            workspaceId
        })
    })

    return collection
}

function importRestfoxV1(collections, workspaceId) {
    let collection = []

    collections.forEach(item => {
        if(item._type === 'request_group') {
            collection.push({
                _id: item._id,
                _type: 'request_group',
                name: item.name,
                environment: item.environment,
                parentId: item.parentId,
                workspaceId,
                sortOrder: item.sortOrder
            })
        } else {
            let body = {
                mimeType: 'No Body'
            }

            if(item.body.mimeType === 'application/x-www-form-urlencoded') {
                body = {
                    mimeType: item.body.mimeType,
                    params: 'params' in item.body ? item.body.params.map(parameter => ({
                        name: parameter.name,
                        value: parameter.value,
                        description: parameter.description,
                        disabled: parameter.disabled
                    })) : []
                }
            }

            if(item.body.mimeType === 'text/plain') {
                body = {
                    mimeType: item.body.mimeType,
                    text: item.body.text
                }
            }

            if(item.body.mimeType === 'application/json') {
                body = {
                    mimeType: item.body.mimeType,
                    text: item.body.text
                }
            }

            collection.push({
                _id: item._id,
                _type: item._type,
                name: item.name,
                url: item.url,
                method: item.method,
                body: body,
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
                parentId: item.parentId,
                workspaceId,
                sortOrder: item.sortOrder
            })
        }
    })

    const collectionTree = toTree(collection)
    sortTree(collectionTree)

    return collectionTree
}

export function convertRestfoxExportToRestfoxCollection(json, workspaceId) {
    if('exportedFrom' in json) {
        if(json.exportedFrom === 'Restfox-1.0.0') {
            return importRestfoxV1(json.collection, workspaceId)
        }
    }

    throw new Error('Invalid Restfox Export')
}

// From: https://stackoverflow.com/a/66387148/4932305
export async function fileToJSON(file) {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader()
        fileReader.onload = event => resolve(JSON.parse(event.target.result))
        fileReader.onerror = error => reject(error)
        fileReader.readAsText(file)
    })
}

// From: https://stackoverflow.com/a/57218589/4932305 but modified to return children on parent matches
export function filterTree(array, name) {
    return array.reduce((r, { children = [], ...o }) => {
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

export function addSortOrderToTree(array) {
    array.forEach((item, index) => {
        item.sortOrder = index
        if('children' in item) {
            addSortOrderToTree(item.children)
        }
    })
}

export function sortTree(array) {
    array.sort((a, b) => a.sortOrder - b.sortOrder)
    array.forEach(item => {
        if('children' in item) {
            sortTree(item.children)
        }
    })
}

export function removeFromTree(array, key, keyValue) {
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
export function getChildIds(arr, id) {
    arr = arr || data
    var ret = []
    for (var i = 0; i < arr.length; i++) {
        var item = arr[i]
        if (item.parentId == id || item._id == id) {
            if (ret.indexOf(item._id) < 0) {
                ret.push(item._id)
                var newret = []
                for (var x = 0; x < arr.length; x++) {
                    if (x != i) newret.push(arr[x])
                }
                var children = getChildIds(newret, item._id)
                if (children.length > 0) {
                    for (var j = 0; j < children.length; j++) {
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

export function findItemInTreeById(array, id) {
    let result = null
    function findItemInTreeByIdRecurse(array2, id2) {
        for(let i=0; i<array2.length; i++) {
            if(array2[i]._id === id2) {
                result = array2[i]
            }

            if('children' in array2[i]) {
                findItemInTreeByIdRecurse(array2[i].children, id2)
            }
        }
    }
    findItemInTreeByIdRecurse(array, id)
    return result
}

export function generateNewIdsForTreeItemChildren(treeItem) {
    const parentId = treeItem._id
    treeItem.children.forEach(item => {
        item._id = nanoid()
        item.parentId = parentId
        if('children' in item) {
            generateNewIdsForTreeItemChildren(item)
        }
    })
}

export function generateNewIdsForTree(array) {
    array.forEach(treeItem => {
        treeItem._id = nanoid()
        if('children' in treeItem) {
            treeItem.children.forEach(item => {
                item._id = nanoid()
                item.parentId = treeItem._id
                if('children' in item) {
                    generateNewIdsForTreeItemChildren(item)
                }
            })
        }
    })
}

// From: https://stackoverflow.com/a/6470794/4932305
export function arrayMove(array, fromIndex, toIndex) {
    var element = array[fromIndex]
    array.splice(fromIndex, 1)
    array.splice(toIndex, 0, element)
}

// From: https://stackoverflow.com/a/65939108/4932305
export function downloadObjectAsJSON(filename, dataObjToWrite) {
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
export function isFirstIdIndirectOrDirectParentOfSecondIdInTree(array, firstId, secondId) {
    let result = false

    function f(data, a, b, p = false) {
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

export function dateFormat(date, includeSeconds=false) {
    let format = 'DD-MMM-YY hh:mm A'

    if(includeSeconds) {
        format = 'DD-MMM-YY hh:mm:ss A'
    }

    return dayjs(date).format(format)
}

// From: https://github.com/Kong/insomnia/blob/e5b6f9034e34afc06def38c9d6a79a978fb19bb2/packages/insomnia-app/app/ui/components/tags/time-tag.tsx
export function humanFriendlyTime(milliseconds) {
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
        number = Math.round(number);
    } else if (number > 10) {
        number = Math.round(number * 10) / 10;
    } else {
        number = Math.round(number * 100) / 100;
    }

    return `${number} ${unit}`
}

export function getObjectPaths(object) {
    let paths = []

    function recurse(obj, keyParent='') {
        if(typeof obj === 'number' || typeof obj === 'string') {
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

export function exportRestfoxCollection(collection) {
    downloadObjectAsJSON(`Restfox_${todayISODate()}.json`, {
        exportedFrom: 'Restfox-1.0.0',
        collection
    })
}

// From: https://github.com/Kong/insomnia/blob/fac2627d695a10865d0f7f9ea7b2c04a77d92194/packages/insomnia/src/common/misc.ts#L169-L192
export function humanFriendlySize(bytes, long=false) {
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
