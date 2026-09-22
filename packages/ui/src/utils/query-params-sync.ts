import { CollectionItem, RequestParam } from '@/global'

function splitAtFirstMatch(str: string, delimiter: string) {
    const index = str.indexOf(delimiter)
    return index === -1 ? [str] : [str.slice(0, index), str.slice(index + 1)]
}

function newTextToNewJsonQueryParams(newText: string) {
    const newJson: any[] = (newText ?? '').split('&').filter(Boolean).map(part => splitAtFirstMatch(part, '=')).map(([name, value]) => ({ name, value }))

    return newJson
}

// the path parameter names in the url, in order, each once
function pathParameterNamesInUrl(newText: string): string[] {
    const names = (newText ?? '').split('/')
        .map(part => {
            let paramType = 'default'
            const param = splitAtFirstMatch(part, ':')

            if(param[1] === undefined || param[1] === '') {
                const extractedParams = /(?<!{){(?=[^%])([^{}]+)(?<!%)}(?!})/.exec(param[0]) ?? ''
                if(extractedParams) {
                    param[1] = extractedParams[1]
                    paramType = 'openapi'
                }
            }

            if(param[1] === undefined || param[1] === '') {
                return
            }

            // if split path item paramType default, it should start with ':' to be treated as a path parameter
            // this will avoid accidentally matching ports or mac addresses in path as path parameters
            if(paramType === 'default' && part.startsWith(':') === false) {
                return
            }

            return param[1]
        })
        .filter((name): name is string => name !== undefined)

    return [...new Set(names)]
}

function valueReferencesPathParameter(value: string, name: string) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`:${escapedName}(?![\\w-])|\\{${escapedName}\\}`).test(value)
}

// a url edit never deletes a row: a row whose name is gone from the url is unchecked, a row whose name comes back is
// checked again, rows referenced from the value of a checked row (`:lat` or `{lat}` inside the value of `:start`)
// count as present so nested parameters survive, and alternate rows for one name are kept as they are (#287, #337)
function syncPathParameters(pathParameters: RequestParam[], namesInUrl: string[]): RequestParam[] {
    const parameters: RequestParam[] = JSON.parse(JSON.stringify(pathParameters))
    const namedParameters = parameters.filter(param => param.name !== '')

    const referencedNames = new Set(namesInUrl)
    let previousSize = -1

    while(referencedNames.size !== previousSize) {
        previousSize = referencedNames.size

        for(const name of referencedNames) {
            const rows = namedParameters.filter(param => param.name === name)
            if(rows.length > 0 && rows.every(param => param.disabled)) {
                delete rows[0].disabled
            }
        }

        for(const param of namedParameters) {
            if(param.disabled || !referencedNames.has(param.name)) {
                continue
            }

            for(const other of namedParameters) {
                if(valueReferencesPathParameter(param.value, other.name)) {
                    referencedNames.add(other.name)
                }
            }
        }
    }

    for(const param of namedParameters) {
        if(!referencedNames.has(param.name)) {
            param.disabled = true
        }
    }

    // a new name gets an empty row after the rows of the name before it in the url
    namesInUrl.forEach((name, index) => {
        if(namedParameters.some(param => param.name === name)) {
            return
        }

        const previousName = namesInUrl[index - 1]
        const insertAt = previousName === undefined ? 0 : parameters.map(param => param.name).lastIndexOf(previousName) + 1
        const row = { name, value: '' }

        parameters.splice(insertAt, 0, row)
        namedParameters.push(row)
    })

    return parameters
}

function updateJsonWithNewText(sourceJson: any, newJson: any[]) {
    newJson.forEach((newParam: any) => {
        const existingParam = sourceJson.find((param: any) => param.name === newParam.name && param.value === newParam.value && param.disabled !== true && param.checked !== true)
        if(existingParam) {
            const existingParamIndex = sourceJson.indexOf(existingParam)
            existingParam.checked = true
            newParam.insertedPosition = existingParamIndex
        }
    })
    newJson.forEach((newParam: any, newParamIndex) => {
        if(newParam.insertedPosition === undefined) {
            if (newParamIndex === 0) {
                sourceJson.unshift(newParam)
                newParam.checked = true
                newParam.insertedPosition = 0
            } else {
                newParam.checked = true
                const insertIndex = newJson[newParamIndex - 1].insertedPosition + 1
                sourceJson.splice(insertIndex, 0, newParam)
                newParam.insertedPosition = insertIndex
            }
        }
    })

    const resultJson: any[] = []

    sourceJson.forEach((param: any) => {
        if(!param.checked && !param.disabled) {
            return
        }

        const newParam: any = {
            name: param.name,
            value: param.value,
        }

        if(param.disabled) {
            newParam.disabled = param.disabled
        }

        resultJson.push(newParam)
    })

    return resultJson
}

export function onUrlChange(activeTab: CollectionItem) {
    if(!activeTab) {
        return false
    }

    if(activeTab.parameters === undefined) {
        activeTab.parameters = []
    }

    if(activeTab.pathParameters === undefined) {
        activeTab.pathParameters = []
    }

    const urlParamsSplit = splitAtFirstMatch(activeTab.url ?? '', '?')
    const newJsonQueryParams = newTextToNewJsonQueryParams(urlParamsSplit[1])

    activeTab.parameters = updateJsonWithNewText(JSON.parse(JSON.stringify(activeTab.parameters)), newJsonQueryParams)
    activeTab.pathParameters = syncPathParameters(activeTab.pathParameters, pathParameterNamesInUrl(urlParamsSplit[0]))

    return true
}

export function onParametersChange(activeTab: CollectionItem) {
    if(activeTab && 'url' in activeTab && activeTab.url && activeTab.parameters) {
        const urlParamsSplit = activeTab.url.split('?')

        const paramsToUpdateToUrl = activeTab.parameters.filter(param => !param.disabled && param.name !== '').map(param => {
            return `${param.name}=${param.value ?? ''}`
        })

        activeTab.url = urlParamsSplit[0] + (paramsToUpdateToUrl.length > 0 ? '?' + paramsToUpdateToUrl.join('&') : '')

        return true
    }

    return false
}

export function migrateOldData(tab: CollectionItem) {
    const urlParamsSplit = splitAtFirstMatch(tab.url ?? '', '?')
    const paramsInUrl: any[] = (urlParamsSplit[1] ?? '').split('&').filter(Boolean).map(part => splitAtFirstMatch(part, '=')).map(([name, value]) => ({ name, value }))

    const parameters: RequestParam[] = tab.parameters ? JSON.parse(JSON.stringify(tab.parameters)) : []

    const urlParamsNotInParams: RequestParam[] = []
    paramsInUrl.forEach(paramInUrl => {
        if(parameters.find(param => param.name === paramInUrl.name && param.value === paramInUrl.value && !param.disabled) === undefined) {
            urlParamsNotInParams.push({
                name: paramInUrl.name,
                value: paramInUrl.value,
            })
        }
    })

    parameters.unshift(...urlParamsNotInParams)

    const tabCopy = JSON.parse(JSON.stringify(tab))
    tabCopy.parameters = parameters
    onParametersChange(tabCopy)

    if(tabCopy.url !== tab.url) {
        console.log('url: migrating old unsynced query params to new format')
        tab.url = tabCopy.url
    }

    if(JSON.stringify(tabCopy.parameters) !== JSON.stringify(tab.parameters)) {
        console.log('parameters: migrating old unsynced query params to new format')
        tab.parameters = tabCopy.parameters
    }
}
