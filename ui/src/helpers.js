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
            body
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
