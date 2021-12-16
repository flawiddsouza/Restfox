export function toTree(data, pid = null) {
    return data.reduce((r, e) => {
        if (e.parentId == pid) {
            const obj = { ...e }
            const children = toTree(data, e._id)
            if (children.length) obj.children = children
            r.push(obj)
        }
        return r
    }, [])
}

export async function handleRequest(request) {
    let body = null

    if(request.body.mimeType === 'application/x-www-form-urlencoded') {
        body = new URLSearchParams(Object.fromEntries(request.body.params.map(item => ([item.name, item.value]))))
    }

    if(request.body.mimeType === 'application/json') {
        body = JSON.stringify(request.body.text)
    }

    if(request.body.mimeType === 'text/plain') {
        body = request.body.text
    }

    try {
        const url = new URL(request.url)

        request.parameters.forEach(param => {
            url.searchParams.append(param.name, param.value)
        })

        const headers = Object.fromEntries(request.headers.map(item => ([item.name, item.value])))

        const response = await fetch(url, {
            method: request.method,
            headers,
            body: request.method !== 'GET' ? body : undefined
        })

        const responseText = await response.text()

        let responseToReturn = null
        let isJSON = true;

        try {
            responseToReturn = JSON.parse(responseText)
        } catch {
            responseToReturn = responseText
            isJSON = false;
        }

        return {
            status: response.status,
            statusText: response.statusText,
            response: responseToReturn,
            json: isJSON
        }
    } catch(e) {
        let error = `Error: Couldn't resolve host name`

        if(e.message.includes('Invalid URL')) {
            error = 'Error: Invalid URL'
        }

        return {
            status: null,
            statusText: 'Error',
            response: error
        }
    }
}

export function convertInsomniaExportToRestfoxCollection(json) {
    let collection = []

    json.resources.filter(item => ['cookie_jar', 'api_spec', 'environment'].includes(item._type) == false).forEach(item => {
        if(item._type === 'workspace' || item._type === 'request_group') {
            collection.push({
                _id: item._id,
                _type: 'request_group',
                name: item.name,
                parentId: item.parentId
            })
        } else {
            let body = {}

            if(item.body.mimeType === 'application/x-www-form-urlencoded') {
                body = {
                    mimeType: item.body.mimeType,
                    params: item.body.params
                }
            }

            if(item.body.mimeType === 'text/plain') {
                body = {
                    mimeType: item.body.mimeType,
                    text: item.body.text
                }
            }

            collection.push({
                _id: item._id,
                _type: item._type === 'workspace' ? 'request_group' : item._type,
                name: item.name,
                url: item.url,
                method: item.method,
                body: item.body,
                headers: item.headers ? item.headers.map(header => ({ name: header.name, value: header.value, description: header.description })) : [],
                parameters: item.parameters ? item.parameters.map(parameter => ({ name: parameter.name, value: parameter.value, description: parameter.description })) : [],
                parentId: item.parentId
            })
        }
    })

    return toTree(collection)
}

export function convertPostmanExportToRestfoxCollection(json) {
    let collection = []

    json.collections.forEach(item => {
        let requests = []

        item.requests.forEach(request => {
            let body = {}

            if(request.dataMode === 'urlencoded' || request.dataMode === null) {
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
                parameters
            })
        })

        collection.push({
            _id: item.id,
            _type: 'request_group',
            name: item.name,
            children: requests
        })
    })

    return collection
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
