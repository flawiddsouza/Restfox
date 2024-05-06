import { CollectionItem, RequestParam } from '@/global'

function splitAtFirstMatch(str: string, delimiter: string) {
    const index = str.indexOf(delimiter)
    return index === -1 ? [str] : [str.slice(0, index), str.slice(index + 1)]
}

function newTextToNewJsonQueryParams(newText: string) {
    const newJson: any[] = (newText ?? '').split('&').filter(Boolean).map(part => splitAtFirstMatch(part, '=')).map(([name, value]) => ({ name, value }))

    return newJson
}

function newTextToNewJsonPathParams(newText: string, pathParameters: RequestParam[]) {
    const activeTabPathParameters = pathParameters.filter(param => !param.disabled)

    const urlPathParametersSplit = (newText ?? '').split('/')
        .map(part => {
            const param = splitAtFirstMatch(part, ':')

            if(param[1] === undefined || param[1] === '') {
                const extractedParams = /(?<!{){([^{}]+)}(?!})/.exec(param[0]) ?? ''
                if(extractedParams) {
                    param[1] = extractedParams[1]
                }
            }

            if(param[1] === undefined || param[1] === '') {
                return
            }

            // if param[1] is all digits, it's most likely a port number and we don't want to treat it as a path parameter
            if(/^\d+$/.test(param[1])) {
                return
            }

            return {
                name: param[1],
                value: activeTabPathParameters.find(p => p.name === param[1])?.value ?? '',
            }
        })
        .filter(Boolean)

    return urlPathParametersSplit
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
    const newJsonPathParams = newTextToNewJsonPathParams(urlParamsSplit[0], activeTab.pathParameters)

    activeTab.parameters = updateJsonWithNewText(JSON.parse(JSON.stringify(activeTab.parameters)), newJsonQueryParams)
    const newPathParameters = updateJsonWithNewText(JSON.parse(JSON.stringify(activeTab.pathParameters)), newJsonPathParams)
    const newPathParametersNames = newPathParameters.map(param => param.name)
    // remove duplicate path parameters before setting
    activeTab.pathParameters = newPathParameters.filter((param, index) => newPathParametersNames.indexOf(param.name) === index)

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
    const paramsInUrl: any[] = (urlParamsSplit[1] ?? '').split('&').filter(Boolean).map(part => part.split('=')).map(([name, value]) => ({ name, value }))

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
