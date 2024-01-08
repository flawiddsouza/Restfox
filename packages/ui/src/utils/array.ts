export function mergeArraysByProperty(arr1: object[], arr2: object[], property: string) {
    const merged = []
    const lookup = new Map()

    // Add all items from the first array to the lookup map
    arr1.forEach(item => lookup.set(item[property], { ...item }))

    // Merge items from the second array with the first, performing a deep merge if necessary
    arr2.forEach(item => {
        const itemFromArr1 = lookup.get(item[property])

        // Create a new merged item using all enumerable properties from both items
        const mergedItem = { ...itemFromArr1, ...item }

        // Perform a deep merge on object properties
        Object.keys(item).forEach(key => {
            // If both values are objects, merge them together
            if (itemFromArr1 && item && typeof itemFromArr1[key] === 'object' && typeof item[key] === 'object') {
                mergedItem[key] = { ...itemFromArr1[key], ...item[key] }
            }
        })

        lookup.set(item[property], mergedItem)
    })

    // Populate the merged array with the values from the lookup map
    lookup.forEach(value => merged.push(value))

    return merged
}
