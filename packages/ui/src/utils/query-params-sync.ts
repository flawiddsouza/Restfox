import { CollectionItem } from '@/global'

let skipUrlUpdate = false
let skipParamsUpdate = false

function splitAtFirstMatch(str: string, delimiter: string) {
    const index = str.indexOf(delimiter)
    return index === -1 ? [str] : [str.slice(0, index), str.slice(index + 1)]
}

function updateJsonWithNewText(sourceJson: any, newText: string) {
    const newTextPairs = (newText ?? '').split('&').filter(Boolean).map(part => part.split('='))
    const newTextOrder: any = {}
    newTextPairs.forEach(([name, value], index) => {
        const key = `${name}=${value}`
        if (key in newTextOrder === false) {
            newTextOrder[key] = []
        }
        newTextOrder[key].push(index) // Track order of each key=value occurrence.
    })

    // Separate disabled and non-disabled items from the source.
    const disabledItems = sourceJson.filter((item: any) => item.disabled)
    const enabledItems = sourceJson.filter((item: any) => !item.disabled)

    // Create the result JSON starting with items from newText if present in sourceJson or as new items.
    const resultJson: any = []
    newTextPairs.forEach(([name, value]) => {
        const key = `${name}=${value}`
        if (newTextOrder[key].length > 0) { // Check if still has occurrences to account for.
            const matchInEnabled = enabledItems.find((item: any) => item.name === name && item.value === value)
            if (matchInEnabled) {
                resultJson.push(matchInEnabled)
                enabledItems.splice(enabledItems.indexOf(matchInEnabled), 1) // Remove the added item.
            } else {
                resultJson.push({ name, value }) // Add as a new item.
            }
            newTextOrder[key].shift() // Mark one occurrence as accounted for.
        }
    })

    // Re-add any unmatched disabled items at the closest position following their last known order.
    disabledItems.forEach((item: any) => {
        const lastIndex = Math.max(...(newTextPairs.map(([name], index) => {
            if (item.name === name) {
                return index
            }
            return -1 // Default if not matching, ensuring it doesn't affect Math.max.
        })))
        const insertIndex = lastIndex + 1 < resultJson.length ? lastIndex + 1 : resultJson.length
        // Only add the disabled item if it wasn't replaced by a matching new item.
        if (!resultJson.some(({ name, value }: any) => name === item.name && value === item.value)) {
            resultJson.splice(insertIndex, 0, item)
        }
    })

    return resultJson
}

export function onUrlChange(activeTab: CollectionItem) {
    if(!activeTab) {
        return false
    }

    if(skipUrlUpdate) {
        skipUrlUpdate = false
        return false
    }

    if(activeTab.parameters === undefined) {
        skipParamsUpdate = true
        activeTab.parameters = []
    }

    const urlParamsSplit = splitAtFirstMatch(activeTab.url ?? '', '?')

    skipParamsUpdate = true
    activeTab.parameters = updateJsonWithNewText(activeTab.parameters, urlParamsSplit[1])

    return true
}

export function onParametersChange(activeTab: CollectionItem) {
    if(skipParamsUpdate) {
        skipParamsUpdate = false
        return false
    }

    if(activeTab && 'url' in activeTab && activeTab.url && activeTab.parameters) {
        const urlParamsSplit = activeTab.url.split('?')

        const paramsToUpdateToUrl = activeTab.parameters.filter(param => !param.disabled && param.name !== '').map(param => {
            return `${param.name}=${param.value ?? ''}`
        })

        skipUrlUpdate = true
        activeTab.url = urlParamsSplit[0] + (paramsToUpdateToUrl.length > 0 ? '?' + paramsToUpdateToUrl.join('&') : '')

        return true
    }

    return false
}
