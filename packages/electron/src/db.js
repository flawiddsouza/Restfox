const fs = require('fs').promises
const path = require('path')

const idMap = new Map()

async function getCollection(workspace, dir = workspace.location) {
    let items = []

    try {
        const filesAndFolders = await fs.readdir(dir, { withFileTypes: true })

        for (let fileOrFolder of filesAndFolders) {
            if (fileOrFolder.name.startsWith('.') || fileOrFolder.name.endsWith('.responses.json') || fileOrFolder.name.endsWith('.plugins.json') || fileOrFolder.name === '_.json') {
                continue
            }

            const fullPath = path.join(dir, fileOrFolder.name)
            if (fileOrFolder.isDirectory()) {
                let collection = {
                    _id: fullPath,
                    _type: 'request_group',
                    name: path.basename(fullPath),
                    parentId: dir === workspace.location ? null : dir,
                    children: [],
                    workspaceId: workspace._id,
                }

                try {
                    const collectionData = JSON.parse(await fs.readFile(`${fullPath}/_.json`, 'utf8'))

                    if('environments' in collectionData) {
                        collection.currentEnvironment = collectionData.currentEnvironment ?? 'Default'
                        collection.environment = collectionData.environments.find((env) => env.name === collection.currentEnvironment).environment
                    }

                    collection = {
                        ...collection,
                        ...collectionData,
                    }
                } catch (err) {
                    console.error(`${fullPath}/_.json not found, so skipping adding it to the collection`)
                }

                items.push(collection)

                // Recursively get files and folders inside this directory
                const nestedItems = await getCollection(workspace, fullPath)
                items = items.concat(nestedItems)
            } else {
                items.push({
                    ...JSON.parse(await fs.readFile(fullPath, 'utf8')),
                    _id: fullPath,
                    parentId: dir === workspace.location ? null : dir,
                    name: path.basename(fullPath, '.json'),
                    workspaceId: workspace._id,
                })
            }
            idMap.set(fullPath, fullPath)
        }
    } catch (err) {
        console.error(err)
        throw new Error(`Error getting collection for workspace at location: ${dir}`)
    }

    return items
}

async function ensureRestfoxCollection(workspace) {
    try {
        const restfoxJson = await fs.readFile(`${workspace.location}/_.json`, 'utf8')
        const restfoxData = JSON.parse(restfoxJson)
        if (restfoxData.version !== 1) {
            throw new Error('Unsupported Restfox collection version')
        }
    } catch {
        // check if given workspace.location is a directory & is empty - if yes, create _.json
        let ls
        try {
            ls = await fs.readdir(workspace.location)
        } catch (err) {
            // Given folder path does not exist
            if (err.code === 'ENOENT') {
                try {
                    await fs.mkdir(workspace.location)
                    const restfoxData = {
                        version: 1,
                        name: workspace.name,
                    }
                    await fs.writeFile(`${workspace.location}/_.json`, JSON.stringify(restfoxData, null, 4))
                } catch (err) {
                    console.error(err)
                    throw new Error(`Error creating new directory and _.json file for Restfox collection at ${workspace.location}`)
                }
                return
            } else if (err.code === 'ENOTDIR'){
                throw new Error(`Given folder path is not a directory: ${workspace.location}`)
            } else {
                console.log(err)
                throw err
            }
        }
        if (ls.length === 0) {
            const restfoxData = {
                version: 1,
                name: workspace.name,
            }
            await fs.writeFile(`${workspace.location}/_.json`, JSON.stringify(restfoxData, null, 4))
        } else {
            throw new Error(`Given folder path is not empty and does not have a Restfox collection: ${workspace.location}`)
        }
    }
}

async function getCollectionForWorkspace(workspace, type) {
    console.log('getCollectionForWorkspace', {
        workspace,
        type,
    })

    try {
        await ensureRestfoxCollection(workspace)

        const collection = await getCollection(workspace)

        // this is the only type filter that's required by the app
        if (type === 'request_group') {
            return {
                error: null,
                collection: collection.filter((item) => item._type === 'request_group')
            }
        }

        console.log(collection)

        return {
            error: null,
            collection,
        }
    } catch (error) {
        return {
            error,
            collection: [],
        }
    }
}

function getCollectionById(workspace, collectionId) {
    console.log('getCollectionById', {
        workspace,
        collectionId,
    })
}

async function createCollection(workspace, collection) {
    console.log('createCollection', {
        workspace,
        collection,
    })

    const collectionName = collection.name

    try {
        const collectionId = collection._id

        if (collection._type === 'request_group') {
            let collectionPath = ''
            if (collection.parentId) {
                collectionPath = `${idMap.get(collection.parentId)}/${collection.name}`
            } else {
                collectionPath = `${workspace.location}/${collection.name}`
            }
            await fs.mkdir(collectionPath)
            idMap.set(collectionId, collectionPath)
            console.log(`Created directory: ${collectionPath}`)

            const collectionToSave = {}

            if (collection.environments) {
                collectionToSave.currentEnvironment = collection.currentEnvironment ?? 'Default'
                collectionToSave.environments = collection.environments
            }

            if (collection.sortOrder !== undefined) {
                collectionToSave.sortOrder = collection.sortOrder
            }

            if (collection.collapsed !== undefined) {
                collectionToSave.collapsed = collection.collapsed
            }

            if (Object.keys(collectionToSave).length > 0) {
                await fs.writeFile(`${collectionPath}/_.json`, JSON.stringify(collectionToSave, null, 4), { flag: 'wx' })
                console.log(`Created file: ${collectionPath}/_.json`)
            }
        }

        if (collection._type === 'request' || collection._type === 'socket') {
            let collectionPath = ''
            if (collection.parentId) {
                collectionPath = `${idMap.get(collection.parentId)}/${collection.name}.json`
            } else {
                collectionPath = `${workspace.location}/${collection.name}.json`
            }

            delete collection._id
            delete collection.parentId
            delete collection.workspaceId
            delete collection.name

            await fs.writeFile(collectionPath, JSON.stringify(collection, null, 4), { flag: 'wx' })
            idMap.set(collectionId, collectionPath)
            console.log(`Created file: ${collectionPath}`)
        }

        return {
            error: null,
        }
    } catch (err) {
        if (err.code === 'EEXIST') {
            return {
                error: `Cannot create ${collectionName} as it already exists`,
            }
        }

        return {
            error: `Error creating collection: ${collectionName}: ${err.message}`,
        }
    }
}

async function createCollections(workspace, collections) {
    console.log('createCollections', {
        workspace,
        collections,
    })

    for (const collection of collections) {
        const result = await createCollection(workspace, collection)

        if (result.error) {
            return result
        }
    }

    return {
        error: null,
    }
}

async function updateIdMapForChildren(oldBasePath, newBasePath) {
    for (const [id, pathValue] of idMap) {
        if (pathValue.startsWith(oldBasePath)) {
            const newPathValue = pathValue.replace(oldBasePath, newBasePath)
            idMap.set(id, newPathValue)
        }
    }

    const items = await fs.readdir(newBasePath, { withFileTypes: true })
    for (const item of items) {
        const oldItemPath = path.join(oldBasePath, item.name)
        const newItemPath = path.join(newBasePath, item.name)

        if (item.isDirectory()) {
            await updateIdMapForChildren(oldItemPath, newItemPath)
        }
    }
}

async function updateCollection(workspace, collectionId, updatedFields) {
    console.log('updateCollection', {
        workspace,
        collectionId,
        updatedFields,
    })

    const collectionPath = idMap.get(collectionId)

    if (Object.keys(updatedFields).length === 1 && 'name' in updatedFields) {
        const renameFrom = collectionPath
        let renameTo = `${path.dirname(collectionPath)}/${updatedFields.name}`

        const extension = path.extname(renameFrom)

        if (extension) {
            renameTo += extension
        }

        await fs.rename(renameFrom, renameTo)
        idMap.set(collectionId, renameTo)

        const responsesRenameFrom = renameFrom.replace('.json', '.responses.json')
        const responsesRenameTo = renameTo.replace('.json', '.responses.json')

        try {
            await fs.access(responsesRenameFrom)
            await fs.rename(responsesRenameFrom, responsesRenameTo)
        } catch (err) {
            console.log(`Skipping renaming responses file: ${responsesRenameFrom} as it does not exist`)
        }

        const pluginsRenameFrom = renameFrom.replace('.json', '.plugins.json')
        const pluginsRenameTo = renameTo.replace('.json', '.plugins.json')

        try {
            await fs.access(pluginsRenameFrom)
            await fs.rename(pluginsRenameFrom, pluginsRenameTo)
        } catch (err) {
            console.log(`Skipping renaming plugins file: ${pluginsRenameFrom} as it does not exist`)
        }

        console.log(`Renamed ${renameFrom} to ${renameTo}`)

        return
    }

    if (Object.keys(updatedFields).length === 1 && 'parentId' in updatedFields) {
        const renameFrom = collectionPath
        let renameTo = `${updatedFields.parentId != null ? idMap.get(updatedFields.parentId) : workspace.location}/${path.basename(collectionPath)}`
        await fs.rename(renameFrom, renameTo)
        idMap.set(collectionId, renameTo)

        // endsWith('.json') means it's a file, else it's a folder
        if (renameFrom.endsWith('.json')) {
            const responsesRenameFrom = renameFrom.replace('.json', '.responses.json')
            const responsesRenameTo = renameTo.replace('.json', '.responses.json')

            try {
                await fs.access(responsesRenameFrom)
                await fs.rename(responsesRenameFrom, responsesRenameTo)
            } catch (err) {
                console.log(`Skipping renaming responses file: ${responsesRenameFrom} as it does not exist`)
            }

            const pluginsRenameFrom = renameFrom.replace('.json', '.plugins.json')
            const pluginsRenameTo = renameTo.replace('.json', '.plugins.json')

            try {
                await fs.access(pluginsRenameFrom)
                await fs.rename(pluginsRenameFrom, pluginsRenameTo)
            } catch (err) {
                console.log(`Skipping renaming plugins file: ${pluginsRenameFrom} as it does not exist`)
            }
        } else {
            // if folder, we also need to update idMap with the new parent folder for all children inside this folder, else they'll have the old parent path in their id
            // and will error out when trying to update them
            await updateIdMapForChildren(renameFrom, renameTo)
        }

        console.log(`Moved ${renameFrom} to ${renameTo}`)
        return
    }

    if (Object.keys(updatedFields).length === 1 && ('sortOrder' in updatedFields || 'currentEnvironment' in updatedFields || 'environments' in updatedFields || 'collapsed' in updatedFields)) {
        const fieldToUpdate = Object.keys(updatedFields)[0]
        let collectionPathCopy = collectionPath

        const stats = await fs.stat(collectionPath)

        if (stats.isDirectory()) {
            collectionPathCopy = `${collectionPath}/_.json`
        }

        let collectionExisting = {}

        try {
            collectionExisting = JSON.parse(await fs.readFile(collectionPathCopy, 'utf8'))
        } catch {}

        const collectionUpdated = {
            ...collectionExisting,
            ...updatedFields,
        }

        await fs.writeFile(collectionPathCopy, JSON.stringify(collectionUpdated, null, 4))
        console.log(`Updated ${fieldToUpdate} for ${collectionPathCopy}`)
        return
    }

    if (updatedFields._type === 'request' || updatedFields._type === 'socket') {
        delete updatedFields._id
        delete updatedFields.parentId
        delete updatedFields.workspaceId
        delete updatedFields.name

        const collectionExisting = JSON.parse(await fs.readFile(collectionPath, 'utf8'))

        const collectionUpdated = {
            ...collectionExisting,
            ...updatedFields,
        }

        await fs.writeFile(collectionPath, JSON.stringify(collectionUpdated, null, 4))
        console.log(`Updated file: ${collectionPath}`)
        return
    }
}

async function deleteCollectionsByWorkspaceId(workspace) {
    console.log('deleteCollectionsByWorkspaceId', {
        workspace,
    })

    const items = await fs.readdir(workspace.location, { withFileTypes: true })
    for (const item of items) {
        const itemPath = path.join(workspace.location, item.name)

        if (item.name.endsWith('.git')) {
            continue
        }

        if (item.isDirectory()) {
            await fs.rm(itemPath, { recursive: true })
        } else {
            if (item.name.endsWith('.json')) {
                await fs.rm(itemPath)
            }
        }
    }

    for (const [id, pathValue] of idMap) {
        if (pathValue.startsWith(workspace.location)) {
            idMap.delete(id)
        }
    }

    console.log(`Cleared directory: ${workspace.location}`)
}

async function deleteCollectionsByIds(workspace, collectionIds) {
    console.log('deleteCollectionsByIds', {
        workspace,
        collectionIds,
    })

    for (const collectionId of collectionIds) {
        const collectionPath = idMap.get(collectionId)

        try {
            await fs.access(collectionPath)
        } catch (err) {
            console.log(`Skipping deleting: ${collectionPath} as parent directory has possibly already been deleted`)
            return
        }

        await fs.rm(collectionPath, { recursive: true })
        idMap.delete(collectionId)
    }
}

async function getResponsesByCollectionId(workspace, collectionId) {
    console.log('getResponsesByCollectionId', {
        workspace,
        collectionId,
    })

    const collectionPath = idMap.get(collectionId)

    const responsesPath = collectionPath.replace('.json', '.responses.json')
    const responsesPathExists = await fs.access(responsesPath).then(() => true).catch(() => false)

    if (responsesPathExists) {
        const responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))
        responses.forEach((response) => {
            response.buffer = Buffer.from(response.buffer, 'base64')
        })
        // reverse the responses so that the latest response is shown first
        return responses.reverse()
    }

    return []
}

async function createResponse(workspace, response) {
    console.log('createResponse', {
        workspace,
        response,
    })

    const collectionPath = idMap.get(response.collectionId)

    response.buffer = Buffer.from(response.buffer).toString('base64')

    const responsesPath = collectionPath.replace('.json', '.responses.json')
    const responsesPathExists = await fs.access(responsesPath).then(() => true).catch(() => false)
    let responses = []

    if (responsesPathExists) {
        responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))
    }

    responses.push(response)

    await fs.writeFile(responsesPath, JSON.stringify(responses, null, 4))
}

async function updateResponse(workspace, collectionId, responseId, updatedFields) {
    console.log('updateResponse', {
        workspace,
        collectionId,
        responseId,
        updatedFields,
    })

    const collectionPath = idMap.get(collectionId)

    const responsesPath = collectionPath.replace('.json', '.responses.json')

    const responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))

    const responseIndex = responses.findIndex((response) => response._id === responseId)

    if (responseIndex === -1) {
        return
    }

    responses[responseIndex] = {
        ...responses[responseIndex],
        ...updatedFields,
    }

    await fs.writeFile(responsesPath, JSON.stringify(responses, null, 4))
}

async function deleteResponse(workspace, collectionId, responseId) {
    console.log('deleteResponse', {
        workspace,
        collectionId,
        responseId,
    })

    const collectionPath = idMap.get(collectionId)

    const responsesPath = collectionPath.replace('.json', '.responses.json')

    const responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))

    const responseIndex = responses.findIndex((response) => response._id === responseId)

    if (responseIndex === -1) {
        return
    }

    responses.splice(responseIndex, 1)

    if (responses.length === 0) {
        await fs.unlink(responsesPath)
        console.log(`Deleted responses file: ${responsesPath}`)
        return
    }

    await fs.writeFile(responsesPath, JSON.stringify(responses, null, 4))
    console.log(`Deleted response: ${responseId} from ${responsesPath}`)
}

async function deleteResponsesByIds(workspace, collectionId, responseIds) {
    console.log('deleteResponsesByIds', {
        workspace,
        collectionId,
        responseIds,
    })

    const collectionPath = idMap.get(collectionId)

    const responsesPath = collectionPath.replace('.json', '.responses.json')

    const responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))

    responses = responses.filter((response) => !responseIds.includes(response._id))

    await fs.writeFile(responsesPath, JSON.stringify(responses, null, 4))

    console.log(`Deleted responses: ${responseIds} from ${responsesPath}`)
}

async function deleteResponsesByCollectionIds(workspace, collectionIds) {
    console.log('deleteResponsesByCollectionIds', {
        workspace,
        collectionIds,
    })

    for (const collectionId of collectionIds) {
        const collectionPath = idMap.get(collectionId)

        const stats = await fs.stat(collectionPath)

        if (stats.isDirectory()) {
            console.log(`Skipping deleting responses for directory: ${collectionPath}`)
            continue
        }

        const responsesPath = collectionPath.replace('.json', '.responses.json')

        try {
            await fs.access(responsesPath)
        } catch (err) {
            console.log(`Skipping deleting responses: ${responsesPath} as it does not exist`)
            continue
        }

        await fs.rm(responsesPath)

        console.log(`Deleted responses for collection: ${collectionId} from ${responsesPath}`)
    }
}

async function deleteResponsesByCollectionId(workspace, collectionId) {
    console.log('deleteResponsesByCollectionId', {
        workspace,
        collectionId,
    })

    const collectionPath = idMap.get(collectionId)

    const responsesPath = collectionPath.replace('.json', '.responses.json')

    await fs.rm(responsesPath)

    console.log(`Deleted responses for collection: ${collectionId} from ${responsesPath}`)
}

async function getWorkspacePlugins(workspace) {
    console.log('getWorkspacePlugins', {
        workspace,
    })

    const items = []

    // Workspace Plugins
    const workspacePluginsPath = `${workspace.location}/_.plugins.json`
    try {
        const workspacePluginsData = JSON.parse(await fs.readFile(workspacePluginsPath, 'utf8'))
        workspacePluginsData.forEach((plugin) => {
            plugin.workspaceId = workspace._id
        })
        items.push(...workspacePluginsData)
    } catch (err) {
        // If there is no plugins file for a workspace, it's fine, just continue
    }

    // Collection and Folder Plugins
    const collectionItems = await getCollection(workspace)
    for (const item of collectionItems) {
        if (item._type === 'request_group') {
            const collectionPluginsPath = `${item._id}/_.plugins.json`
            try {
                const collectionPluginsData = JSON.parse(await fs.readFile(collectionPluginsPath, 'utf8'))
                collectionPluginsData.forEach((plugin) => {
                    plugin.collectionId = item._id
                })
                items.push(...collectionPluginsData)
            } catch (err) {
                // If there is no plugins file for a collection, it's fine, just continue
            }
        } else {
            const itemPluginsPath = item._id.replace('.json', '.plugins.json')
            try {
                const itemPluginsData = JSON.parse(await fs.readFile(itemPluginsPath, 'utf8'))
                itemPluginsData.forEach((plugin) => {
                    plugin.collectionId = item._id
                })
                items.push(...itemPluginsData)
            } catch (err) {
                // If there is no plugins file for an item, it's fine, just continue
            }
        }
    }

    return items
}

async function createPlugin(workspace, plugin) {
    console.log('createPlugin', {
        workspace,
        plugin,
    })

    let pluginPath = ''
    if (plugin.collectionId) {
        const collectionPath = idMap.get(plugin.collectionId)
        const stats = await fs.stat(collectionPath)
        if (stats.isDirectory()) {
            pluginPath = `${collectionPath}/_.plugins.json`
        } else {
            const collectionItemName = path.basename(collectionPath, '.json')
            const collectionPathParentPath = path.dirname(collectionPath)
            pluginPath = `${collectionPathParentPath}/${collectionItemName}.plugins.json`
        }
    } else {
        pluginPath = `${workspace.location}/_.plugins.json`
    }

    try {
        let existingPlugins = []
        try {
            existingPlugins = JSON.parse(await fs.readFile(pluginPath, 'utf8'))
        } catch (err) {
            // If file doesn't exist, we will create a new one
        }

        delete plugin.workspaceId
        delete plugin.collectionId

        existingPlugins.push(plugin)
        await fs.writeFile(pluginPath, JSON.stringify(existingPlugins, null, 4))
        console.log(`Plugin created at: ${pluginPath}`)
    } catch (err) {
        console.error(`Error creating plugin in: ${pluginPath}`, err)
    }
}

async function updatePlugin(workspace, collectionId, pluginId, updatedFields) {
    console.log('updatePlugin', {
        workspace,
        collectionId,
        pluginId,
        updatedFields,
    })

    const collectionPath = idMap.get(collectionId)

    let pluginPath = null

    if (collectionId == null) {
        pluginPath = `${workspace.location}/_.plugins.json`
    } else {
        pluginPath = collectionPath.endsWith('.json') ? collectionPath.replace('.json', '.plugins.json') : `${collectionPath}/_.plugins.json`
    }

    try {
        const existingPlugins = JSON.parse(await fs.readFile(pluginPath, 'utf8'))
        const pluginIndex = existingPlugins.findIndex(plugin => plugin._id === pluginId)

        if (pluginIndex !== -1) {
            delete updatedFields.workspaceId
            delete updatedFields.collectionId

            existingPlugins[pluginIndex] = { ...existingPlugins[pluginIndex], ...updatedFields }
            await fs.writeFile(pluginPath, JSON.stringify(existingPlugins, null, 4))
            console.log(`Plugin ${pluginId} updated in ${pluginPath}`)
        } else {
            console.log(`Plugin ${pluginId} not found for update in ${pluginPath}`)
        }
    } catch (err) {
        console.error(`Error updating plugin ${pluginId} in ${pluginPath}`, err)
    }
}

async function deletePlugin(workspace, collectionId, pluginId) {
    console.log('deletePlugin', {
        workspace,
        collectionId,
        pluginId,
    })

    // If collectionId is null, it means it's a workspace plugin
    if (collectionId === null) {
        const workspacePluginsPath = `${workspace.location}/_.plugins.json`
        try {
            let existingPlugins = JSON.parse(await fs.readFile(workspacePluginsPath, 'utf8'))
            const filteredPlugins = existingPlugins.filter(plugin => plugin._id !== pluginId)

            if (filteredPlugins.length < existingPlugins.length) {
                if (filteredPlugins.length === 0) {
                    await fs.unlink(workspacePluginsPath)
                    console.log(`All workspace plugins deleted: ${workspace.location}`)
                } else {
                    await fs.writeFile(workspacePluginsPath, JSON.stringify(filteredPlugins, null, 4))
                    console.log(`Plugin ${pluginId} deleted in ${workspacePluginsPath}`)
                }
            } else {
                console.log(`Plugin ${pluginId} not found for deletion in ${workspacePluginsPath}`)
            }
        } catch (err) {
            console.error(`Error deleting plugin ${pluginId} in ${workspacePluginsPath}`, err)
        }
        return
    }

    const collectionPath = idMap.get(collectionId)
    const pluginPath = collectionPath.endsWith('.json') ? collectionPath.replace('.json', '.plugins.json') : `${collectionPath}/_.plugins.json`

    try {
        let existingPlugins = JSON.parse(await fs.readFile(pluginPath, 'utf8'))
        const filteredPlugins = existingPlugins.filter(plugin => plugin._id !== pluginId)

        if (filteredPlugins.length < existingPlugins.length) {
            await fs.writeFile(pluginPath, JSON.stringify(filteredPlugins, null, 4))
            console.log(`Plugin ${pluginId} deleted in${pluginPath}`)
        } else {
            console.log(`Plugin ${pluginId} not found for deletion in ${pluginPath}`)
        }
    } catch (err) {
        console.error(`Error deleting plugin ${pluginId} in ${pluginPath}`, err)
    }
}

async function deletePluginsByWorkspace(workspace) {
    console.log('deletePluginsByWorkspace', {
        workspace,
    })

    const workspacePluginsPath = `${workspace.location}/_.plugins.json`
    try {
        await fs.access(workspacePluginsPath)
        await fs.unlink(workspacePluginsPath)
        console.log(`All workspace plugins deleted: ${workspace.location}`)
    } catch (err) {
        console.log(`No workspace plugins found for deletion in: ${workspace.location}`)
    }
}

async function deletePluginsByCollectionIds(workspace, collectionIds) {
    console.log('deletePluginsByCollectionIds', {
        workspace,
        collectionIds,
    })

    for (const collectionId of collectionIds) {
        const collectionPath = idMap.get(collectionId)
        const pluginPath = collectionPath.endsWith('_.json') ? `${path.dirname(collectionPath)}/_.plugins.json` : collectionPath.replace('.json', '.plugins.json')

        try {
            await fs.access(pluginPath)
            await fs.unlink(pluginPath)
            console.log(`Deleted plugins for collection: ${collectionId}`)
        } catch(err) {
            console.log(`No plugins found for deletion for collection: ${collectionId}`)
        }
    }
}

async function createPlugins(workspace, plugins) {
    console.log('createPlugins', {
        workspace,
        plugins,
    })

    for (const plugin of plugins) {
        await createPlugin(workspace, plugin)
    }
}

module.exports = {
    getCollectionForWorkspace,
    getCollectionById,
    createCollection,
    createCollections,
    updateCollection,
    deleteCollectionsByWorkspaceId,
    deleteCollectionsByIds,
    getResponsesByCollectionId,
    createResponse,
    updateResponse,
    deleteResponse,
    deleteResponsesByIds,
    deleteResponsesByCollectionIds,
    deleteResponsesByCollectionId,
    getWorkspacePlugins,
    createPlugin,
    updatePlugin,
    deletePlugin,
    deletePluginsByWorkspace,
    deletePluginsByCollectionIds,
    createPlugins,
}
