const fs = require('fs').promises
const path = require('path')
const chokidar = require('chokidar')
const dbHelpers = require('./db-helpers')
const fileUtils = require('./file-utils')
const constants = require('./constants')

const idMap = new Map()
const fsLog = []

const LOG_ONLY_METHOD_NAME = true
const LOG_ONLY_METHOD_NAME_EXCEPT = []

function logMethodCall(methodName, args) {
    if (LOG_ONLY_METHOD_NAME && !LOG_ONLY_METHOD_NAME_EXCEPT.includes(methodName)) {
        console.log(methodName)
        return
    }
    console.log(methodName, args)
}

async function getWorkspaceAtLocation(location, getEnvironments = false) {
    logMethodCall('getWorkspaceAtLocation', {
        location,
        getEnvironments,
    })

    try {
        const workspaceData = JSON.parse(await fs.readFile(`${location}/${constants.FILES.WORKSPACE_CONFIG}`, 'utf8'))

        if(getEnvironments) {
            const envsDirPath = path.join(location, constants.FOLDERS.ENVIRONMENTS)
            const environments = await dbHelpers.getEnvironments(envsDirPath)
            if (environments.length > 0) {
                workspaceData.environments = environments
                const currentEnvironment = workspaceData.environments.find((env) => env.name === workspaceData.currentEnvironment)
                if (currentEnvironment) {
                    workspaceData.environment = currentEnvironment.environment
                    workspaceData.currentEnvironment = workspaceData.currentEnvironment
                } else {
                    workspaceData.environment = workspaceData.environments[0].environment
                    workspaceData.currentEnvironment = workspaceData.environments[0].name
                }
            }
        }

        return workspaceData
    } catch (err) {
        console.error(err)
        throw new Error(`Error getting workspace at location: ${location}`)
    }
}

async function updateWorkspace(workspace, updatedFields) {
    logMethodCall('updateWorkspace', {
        workspace,
        updatedFields,
    })

    const workspacePath = workspace.location

    const workspaceExisting = JSON.parse(await fs.readFile(`${workspacePath}/${constants.FILES.WORKSPACE_CONFIG}`, 'utf8'))

    const update = {}

    if (updatedFields.name) {
        update.name = updatedFields.name
    }

    if (updatedFields.environments) {
        const envsDirPath = path.join(workspacePath, constants.FOLDERS.ENVIRONMENTS)
        await dbHelpers.saveEnvironments(fsLog, envsDirPath, updatedFields.environments)
    }

    if (updatedFields.currentEnvironment) {
        update.currentEnvironment = updatedFields.currentEnvironment
    }

    if (Object.keys(update).length === 0) {
        console.log('No fields to update for workspace')
        return
    }

    const workspaceUpdated = {
        ...workspaceExisting,
        ...update,
    }

    await fileUtils.writeFileJson(`${workspacePath}/${constants.FILES.WORKSPACE_CONFIG}`, workspaceUpdated, fsLog, `Update workspace`)
    console.log(`Updated workspace: ${workspacePath}/${constants.FILES.WORKSPACE_CONFIG}`)
}

/** @type{chokidar.FSWatcher} */
let workspaceWatcher = null

async function getCollectionForWorkspace(workspace, type) {
    logMethodCall('getCollectionForWorkspace', {
        workspace,
        type,
    })

    try {
        let idMapBeforeClear = null

        if (type === null) {
            if (workspaceWatcher) {
                await workspaceWatcher.close()
                workspaceWatcher = null
            }

            fsLog.length = 0
            idMapBeforeClear = new Map(idMap)
            idMap.clear()

            await dbHelpers.ensureRestfoxCollection(workspace)

            workspaceWatcher = chokidar.watch(workspace.location, {
                ignored: /(^|[\/\\])\../, // ignore dotfiles
                ignoreInitial: true, // (default: false) if set to false then add/addDir events are also emitted for matching paths while instantiating the watching as chokidar discovers these file paths (before the ready event)
                awaitWriteFinish: true, // was getting an add & change event even thought there was only one fs.writeFile wx call - this seems to fix it
            }).on('all', (event, path) => {
                console.log(event, path)
                let controlledChange = false
                let controlledChangeReason = null
                const checkIfFsLogExists = fsLog.findIndex((log) => log.path === path && log.event === event)
                if (checkIfFsLogExists !== -1) {
                    controlledChangeReason = fsLog[checkIfFsLogExists].reason ?? null
                    fsLog.splice(checkIfFsLogExists, 1)
                    controlledChange = true
                }
                globalThis.electronApplicationWindow.webContents.send('workspaceChanged', event, path, controlledChange, controlledChangeReason)
            })
        }

        const [ collection, workspaceData ] = await Promise.all([
            // we do not want to modify the idMap if returning the request_group type
            // this messes up the idMap - as ui and elecron will go out of sync
            dbHelpers.getCollection(type === null ? idMap : new Map(), workspace),
            getWorkspaceAtLocation(workspace.location, true),
        ])

        // this is the only type filter that's required by the app
        if (type === 'request_group') {
            return {
                error: null,
                collection: collection.filter((item) => item._type === 'request_group'),
                workspace: null,
                idMap: null,
            }
        }

        // console.log({ collection, workspaceData })

        return {
            error: null,
            collection,
            workspace: workspaceData,
            idMap: idMapBeforeClear,
        }
    } catch (error) {
        return {
            error,
            collection: [],
            workspace: null,
            idMap: null,
        }
    }
}

function getCollectionById(workspace, collectionId) {
    logMethodCall('getCollectionById', {
        workspace,
        collectionId,
    })

    const collectionPath = idMap.get(collectionId)

    return dbHelpers.getCollectionItem(workspace, collectionPath)
}

async function createCollection(workspace, collection) {
    logMethodCall('createCollection', {
        workspace,
        collection,
    })

    const collectionName = fileUtils.encodeFilename(collection.name)

    try {
        let collectionPath = ''

        if (collection._type === 'request_group') {
            if (collection.parentId) {
                collectionPath = `${idMap.get(collection.parentId)}/${collectionName}`
            } else {
                collectionPath = `${workspace.location}/${collectionName}`
            }
            await fileUtils.mkdir(collectionPath, fsLog, 'Create collection item folder')
            idMap.set(collectionPath, collectionPath)
            console.log(`Created directory: ${collectionPath}`)

            const collectionToSave = {}

            if (collection.environments) {
                const envsDirPath = path.join(collectionPath, constants.FOLDERS.ENVIRONMENTS)
                await dbHelpers.saveEnvironments(fsLog, envsDirPath, collection.environments)
                collectionToSave.currentEnvironment = collection.currentEnvironment ?? 'Default'
            }

            if (collection.sortOrder !== undefined) {
                collectionToSave.sortOrder = collection.sortOrder
            }

            if (Object.keys(collectionToSave).length > 0) {
                await fileUtils.writeFileJsonNewOnly(`${collectionPath}/${constants.FILES.FOLDER_CONFIG}`, collectionToSave, fsLog, `Create collection item folder config`)
                console.log(`Created file: ${collectionPath}/${constants.FILES.FOLDER_CONFIG}`)
            }
        }

        if (collection._type === 'request' || collection._type === 'socket') {
            if (collection.parentId) {
                collectionPath = `${idMap.get(collection.parentId)}/${collectionName}.json`
            } else {
                collectionPath = `${workspace.location}/${collectionName}.json`
            }

            delete collection._id
            delete collection.parentId
            delete collection.workspaceId
            delete collection.name

            await fileUtils.writeFileJsonNewOnly(collectionPath, collection, fsLog, `Create collection item of type ${collection._type}`)
            idMap.set(collectionPath, collectionPath)
            console.log(`Created file: ${collectionPath}`)
        }

        return {
            error: null,
            newCollectionId: collectionPath,
        }
    } catch (err) {
        if (err.code === 'EEXIST') {
            return {
                error: `Cannot create ${collectionName} as it already exists`,
            }
        }

        console.log(err)

        return {
            error: `Error creating collection: ${collectionName}: ${err.message}`,
        }
    }
}

async function createCollections(workspace, collections) {
    logMethodCall('createCollections', {
        workspace,
        collections,
    })

    for (const collection of collections) {
        let result = null

        if (idMap.get(collection._id)) {
            result = await updateCollection(workspace, collection._id, collection)
        } else {
            result = await createCollection(workspace, collection)
            collections.forEach(item => {
                if (item.parentId !== null && item.parentId === collection._id) {
                    item.parentId = result.newCollectionId
                }
            })
        }

        if (result && result.error) {
            return result
        }
    }

    return {
        error: null,
    }
}

async function updateIdMapForChildren(oldBasePath, newBasePath, ignoreId = null) {
    for (const [id, pathValue] of idMap) {
        if (pathValue.startsWith(oldBasePath) && id !== ignoreId) {
            const newPathValue = pathValue.replace(oldBasePath, newBasePath)
            idMap.set(id, newPathValue)
        }
    }

    const items = await fs.readdir(newBasePath, { withFileTypes: true })
    for (const item of items) {
        const oldItemPath = path.join(oldBasePath, item.name)
        const newItemPath = path.join(newBasePath, item.name)

        if (item.isDirectory()) {
            await updateIdMapForChildren(oldItemPath, newItemPath, ignoreId)
        }
    }
}

async function updateCollection(workspace, collectionId, updatedFields) {
    logMethodCall('updateCollection', {
        workspace,
        collectionId,
        updatedFields,
    })

    const collectionPath = idMap.get(collectionId)

    if (Object.keys(updatedFields).length === 1 && 'name' in updatedFields) {
        updatedFields.name = fileUtils.encodeFilename(updatedFields.name)

        const renameFrom = collectionPath
        let renameTo = `${path.dirname(collectionPath)}/${updatedFields.name}`

        const extension = path.extname(renameFrom)

        if (extension) {
            renameTo += extension
        }

        await fileUtils.renameFileOrFolder(renameFrom, renameTo, fsLog, `Rename collection item`)
        idMap.set(collectionId, renameTo)

        if (renameFrom.endsWith('.json')) {
            const responsesRenameFrom = renameFrom.replace('.json', constants.FILES.RESPONSES)
            const responsesRenameTo = renameTo.replace('.json', constants.FILES.RESPONSES)

            try {
                await fs.access(responsesRenameFrom)
                await fileUtils.renameFileOrFolder(responsesRenameFrom, responsesRenameTo, fsLog, `Rename responses file`)
            } catch (err) {
                console.log(`Skipping renaming responses file: ${responsesRenameFrom} as it does not exist`)
            }

            const pluginsRenameFrom = renameFrom.replace('.json', constants.FILES.PLUGINS)
            const pluginsRenameTo = renameTo.replace('.json', constants.FILES.PLUGINS)

            try {
                await fs.access(pluginsRenameFrom)
                await fileUtils.renameFileOrFolder(pluginsRenameFrom, pluginsRenameTo, fsLog, `Rename plugins file`)
            } catch (err) {
                console.log(`Skipping renaming plugins file: ${pluginsRenameFrom} as it does not exist`)
            }
        } else {
            // if folder, we also need to update idMap with the new parent folder for all children inside this folder, else they'll have the old parent path in their id
            // and will error out when trying to update them
            await updateIdMapForChildren(renameFrom, renameTo, collectionId)
        }

        console.log(`Renamed ${renameFrom} to ${renameTo}`)

        return {
            error: null,
        }
    }

    if (Object.keys(updatedFields).length === 1 && 'parentId' in updatedFields) {
        const renameFrom = collectionPath
        let renameTo = `${updatedFields.parentId != null ? idMap.get(updatedFields.parentId) : workspace.location}/${path.basename(collectionPath)}`
        await fileUtils.renameFileOrFolder(renameFrom, renameTo, fsLog, `Move collection item`)
        idMap.set(collectionId, renameTo)

        // endsWith('.json') means it's a file, else it's a folder
        if (renameFrom.endsWith('.json')) {
            const responsesRenameFrom = renameFrom.replace('.json', constants.FILES.RESPONSES)
            const responsesRenameTo = renameTo.replace('.json', constants.FILES.RESPONSES)

            try {
                await fs.access(responsesRenameFrom)
                await fileUtils.renameFileOrFolder(responsesRenameFrom, responsesRenameTo, fsLog, `Rename responses file`)
            } catch (err) {
                console.log(`Skipping renaming responses file: ${responsesRenameFrom} as it does not exist`)
            }

            const pluginsRenameFrom = renameFrom.replace('.json', constants.FILES.PLUGINS)
            const pluginsRenameTo = renameTo.replace('.json', constants.FILES.PLUGINS)

            try {
                await fs.access(pluginsRenameFrom)
                await fileUtils.renameFileOrFolder(pluginsRenameFrom, pluginsRenameTo, fsLog, `Rename plugins file`)
            } catch (err) {
                console.log(`Skipping renaming plugins file: ${pluginsRenameFrom} as it does not exist`)
            }
        } else {
            // if folder, we also need to update idMap with the new parent folder for all children inside this folder, else they'll have the old parent path in their id
            // and will error out when trying to update them
            await updateIdMapForChildren(renameFrom, renameTo)
        }

        console.log(`Moved ${renameFrom} to ${renameTo}`)
        return {
            error: null,
        }
    }

    if (Object.keys(updatedFields).length === 1 && ('sortOrder' in updatedFields || 'currentEnvironment' in updatedFields || 'environments' in updatedFields || 'collapsed' in updatedFields)) {
        if(updatedFields.environments) {
            const envsDirPath = path.join(collectionPath, constants.FOLDERS.ENVIRONMENTS)
            await dbHelpers.saveEnvironments(fsLog, envsDirPath, updatedFields.environments)
            return
        }

        if('collapsed' in updatedFields) {
            const collapsedFilePath = path.join(collectionPath, constants.FILES.COLLAPSED)
            if (updatedFields.collapsed) {
                try {
                    await fileUtils.writeEmptyFileNewOnly(collapsedFilePath, fsLog, `Mark directory as collapsed`)
                    console.log(`Marked as collapsed: ${collapsedFilePath}`)
                } catch (err) {
                    console.error(`Error marking directory as collapsed: ${collapsedFilePath}`, err)
                }
            } else {
                try {
                    await fileUtils.deleteFileOrFolder(collapsedFilePath, fsLog, `Mark directory as expanded`)
                    console.log(`Marked as expanded (collapsed file removed): ${collapsedFilePath}`)
                } catch (err) {
                    console.error(`Error marking directory as expanded: ${collapsedFilePath}`, err)
                }
            }
            return {
                error: null,
            }
        }

        const fieldToUpdate = Object.keys(updatedFields)[0]
        let collectionPathCopy = collectionPath

        const stats = await fs.stat(collectionPath)

        if (stats.isDirectory()) {
            collectionPathCopy = `${collectionPath}/${constants.FILES.FOLDER_CONFIG}`
        }

        let collectionExisting = {}

        try {
            collectionExisting = JSON.parse(await fs.readFile(collectionPathCopy, 'utf8'))
        } catch {}

        const collectionUpdated = {
            ...collectionExisting,
            ...updatedFields,
        }

        await fileUtils.writeFileJson(collectionPathCopy, collectionUpdated, fsLog, `Update ${fieldToUpdate}`)
        console.log(`Updated ${fieldToUpdate} for ${collectionPathCopy}`)

        return {
            error: null,
        }
    }

    if (updatedFields._type === 'request' || updatedFields._type === 'socket') {
        delete updatedFields._id
        delete updatedFields.parentId
        delete updatedFields.workspaceId
        delete updatedFields.name

        const collectionExisting = JSON.parse(await fs.readFile(collectionPath, 'utf8'))

        if (updatedFields._type === 'socket') {
            if (updatedFields.clients) {
                let existingMessages = {}
                try {
                    existingMessages = JSON.parse(await fs.readFile(collectionPath.replace('.json', constants.FILES.MESSAGES), 'utf8'))
                } catch {}
                const clientIds = []
                for(const client of updatedFields.clients) {
                    existingMessages[client.id] = client.messages
                    clientIds.push(client.id)
                    delete client.messages
                }
                Object.keys(existingMessages).forEach((clientId) => {
                    if(!clientIds.includes(clientId)) {
                        delete existingMessages[clientId]
                    }
                })
                await fileUtils.writeFileJson(collectionPath.replace('.json', constants.FILES.MESSAGES), existingMessages, fsLog, 'Save socket client messages')
            }
        }

        const collectionUpdated = {
            ...collectionExisting,
            ...updatedFields,
        }

        await fileUtils.writeFileJson(collectionPath, collectionUpdated, fsLog)
        console.log(`Updated file: ${collectionPath}`)
        return
    }
}

async function deleteCollectionsByWorkspaceId(workspace) {
    logMethodCall('deleteCollectionsByWorkspaceId', {
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
                await fileUtils.deleteFileOrFolder(itemPath, fsLog, `Delete collection item`)
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
    logMethodCall('deleteCollectionsByIds', {
        workspace,
        collectionIds,
    })

    let collectionItemsToDelete = []

    for (const collectionId of collectionIds) {
        const collectionPath = idMap.get(collectionId)
        collectionItemsToDelete.push({ collectionId, collectionPath })
    }

    collectionItemsToDelete = collectionItemsToDelete.sort((a, b) => b.collectionPath.localeCompare(a.collectionPath))

    for (const collectionItem of collectionItemsToDelete) {
        if (collectionItem.collectionPath.endsWith('.json') === false) {
            await fileUtils.deleteFileOrFolder(path.join(collectionItem.collectionPath, constants.FILES.FOLDER_CONFIG), fsLog, `Delete collection item folder config`)

            try {
                await fileUtils.deleteFileOrFolder(path.join(collectionItem.collectionPath, constants.FILES.COLLAPSED), fsLog, `Delete collection item collapsed state marker`)
            } catch {
                console.log(`No collapsed state marker found for deletion for collection item: ${collectionItem.collectionPath}`)
            }

            try {
                const environmentsDir = await fs.readdir(path.join(collectionItem.collectionPath, constants.FOLDERS.ENVIRONMENTS))
                for (const envFile of environmentsDir) {
                    await fileUtils.deleteFileOrFolder(path.join(collectionItem.collectionPath, constants.FOLDERS.ENVIRONMENTS, envFile), fsLog, `Delete collection item environment`)
                }
                await fileUtils.deleteFileOrFolder((path.join(collectionItem.collectionPath, constants.FOLDERS.ENVIRONMENTS)), fsLog, `Delete collection item environments folder`)
            } catch {
                console.log(`No environments found for deletion for collection item: ${collectionItem.collectionPath}`)
            }
        }

        try {
            await fileUtils.deleteFileOrFolder(collectionItem.collectionPath.replace('.json', constants.FILES.MESSAGES), fsLog, `Delete messages for collection item`)
        } catch {
            console.log(`No messages found for deletion for collection item: ${collectionItem.collectionPath}`)
        }

        await fileUtils.deleteFileOrFolder(collectionItem.collectionPath, fsLog, `Delete collection item`)
        idMap.delete(collectionItem.collectionId)
    }
}

async function getResponsesByCollectionId(workspace, collectionId) {
    logMethodCall('getResponsesByCollectionId', {
        workspace,
        collectionId,
    })

    const collectionPath = idMap.get(collectionId)

    const responsesPath = collectionPath.replace('.json', constants.FILES.RESPONSES)
    const responsesPathExists = await fileUtils.pathExists(responsesPath)

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
    logMethodCall('createResponse', {
        workspace,
        response,
    })

    const collectionPath = idMap.get(response.collectionId)

    response.buffer = Buffer.from(response.buffer).toString('base64')

    const responsesPath = collectionPath.replace('.json', constants.FILES.RESPONSES)
    const responsesPathExists = await fileUtils.pathExists(responsesPath)
    let responses = []

    if (responsesPathExists) {
        responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))
    }

    responses.push(response)

    await fileUtils.writeFileJson(responsesPath, responses, fsLog, `Create response`)
}

async function updateResponse(workspace, collectionId, responseId, updatedFields) {
    logMethodCall('updateResponse', {
        workspace,
        collectionId,
        responseId,
        updatedFields,
    })

    const collectionPath = idMap.get(collectionId)

    const responsesPath = collectionPath.replace('.json', constants.FILES.RESPONSES)

    const responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))

    const responseIndex = responses.findIndex((response) => response._id === responseId)

    if (responseIndex === -1) {
        return
    }

    responses[responseIndex] = {
        ...responses[responseIndex],
        ...updatedFields,
    }

    await fileUtils.writeFileJson(responsesPath, responses, fsLog, `Update response`)
}

async function deleteResponse(workspace, collectionId, responseId) {
    logMethodCall('deleteResponse', {
        workspace,
        collectionId,
        responseId,
    })

    const collectionPath = idMap.get(collectionId)

    const responsesPath = collectionPath.replace('.json', constants.FILES.RESPONSES)

    const responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))

    const responseIndex = responses.findIndex((response) => response._id === responseId)

    if (responseIndex === -1) {
        return
    }

    responses.splice(responseIndex, 1)

    if (responses.length === 0) {
        await fileUtils.deleteFileOrFolder(responsesPath, fsLog, `Delete responses file`)
        console.log(`Deleted responses file: ${responsesPath}`)
        return
    }

    await fileUtils.writeFileJson(responsesPath, responses, fsLog, `Delete response`)
    console.log(`Deleted response: ${responseId} from ${responsesPath}`)
}

async function deleteResponsesByIds(workspace, collectionId, responseIds) {
    logMethodCall('deleteResponsesByIds', {
        workspace,
        collectionId,
        responseIds,
    })

    const collectionPath = idMap.get(collectionId)

    const responsesPath = collectionPath.replace('.json', constants.FILES.RESPONSES)

    const responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))

    responses = responses.filter((response) => !responseIds.includes(response._id))

    await fileUtils.writeFileJson(responsesPath, responses, fsLog, `Delete responses`)

    console.log(`Deleted responses: ${responseIds} from ${responsesPath}`)
}

async function deleteResponsesByCollectionIds(workspace, collectionIds) {
    logMethodCall('deleteResponsesByCollectionIds', {
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

        const responsesPath = collectionPath.replace('.json', constants.FILES.RESPONSES)

        try {
            await fs.access(responsesPath)
        } catch (err) {
            console.log(`Skipping deleting responses: ${responsesPath} as it does not exist`)
            continue
        }

        await fileUtils.deleteFileOrFolder(responsesPath, fsLog, `Delete responses for collection item`)

        console.log(`Deleted responses for collection: ${collectionId} from ${responsesPath}`)
    }
}

async function deleteResponsesByCollectionId(workspace, collectionId) {
    logMethodCall('deleteResponsesByCollectionId', {
        workspace,
        collectionId,
    })

    const collectionPath = idMap.get(collectionId)

    const responsesPath = collectionPath.replace('.json', constants.FILES.RESPONSES)

    await fileUtils.deleteFileOrFolder(responsesPath, fsLog, `Delete responses for collection item`)

    console.log(`Deleted responses for collection: ${collectionId} from ${responsesPath}`)
}

async function getWorkspacePlugins(workspace) {
    logMethodCall('getWorkspacePlugins', {
        workspace,
    })

    const items = []

    // Workspace Plugins
    const workspacePluginsPath = `${workspace.location}/${constants.FILES.WORKSPACE_PLUGINS}`
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
    const collectionItems = await dbHelpers.getCollection(idMap, workspace)
    for (const item of collectionItems) {
        if (item._type === 'request_group') {
            const collectionPluginsPath = `${item._id}/${constants.FILES.FOLDER_PLUGINS}`
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
            const itemPluginsPath = item._id.replace('.json', constants.FILES.PLUGINS)
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
    logMethodCall('createPlugin', {
        workspace,
        plugin,
    })

    let pluginPath = ''
    if (plugin.collectionId) {
        const collectionPath = idMap.get(plugin.collectionId)
        const stats = await fs.stat(collectionPath)
        if (stats.isDirectory()) {
            pluginPath = `${collectionPath}/${constants.FILES.FOLDER_PLUGINS}`
        } else {
            const collectionItemName = path.basename(collectionPath, '.json')
            const collectionPathParentPath = path.dirname(collectionPath)
            pluginPath = `${collectionPathParentPath}/${collectionItemName}${constants.FILES.PLUGINS}`
        }
    } else {
        pluginPath = `${workspace.location}/${constants.FILES.WORKSPACE_PLUGINS}`
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
        await fileUtils.writeFileJson(pluginPath, existingPlugins, fsLog, `Create plugin`)
        console.log(`Plugin created at: ${pluginPath}`)
    } catch (err) {
        console.error(`Error creating plugin in: ${pluginPath}`, err)
    }
}

async function updatePlugin(workspace, collectionId, pluginId, updatedFields) {
    logMethodCall('updatePlugin', {
        workspace,
        collectionId,
        pluginId,
        updatedFields,
    })

    const collectionPath = idMap.get(collectionId)

    let pluginPath = null

    if (collectionId == null) {
        pluginPath = `${workspace.location}/${constants.FILES.WORKSPACE_PLUGINS}`
    } else {
        pluginPath = collectionPath.endsWith('.json') ? collectionPath.replace('.json', constants.FILES.PLUGINS) : `${collectionPath}/${constants.FILES.FOLDER_PLUGINS}`
    }

    try {
        const existingPlugins = JSON.parse(await fs.readFile(pluginPath, 'utf8'))
        const pluginIndex = existingPlugins.findIndex(plugin => plugin._id === pluginId)

        if (pluginIndex !== -1) {
            delete updatedFields.workspaceId
            delete updatedFields.collectionId

            existingPlugins[pluginIndex] = { ...existingPlugins[pluginIndex], ...updatedFields }
            await fileUtils.writeFileJson(pluginPath, existingPlugins, fsLog, `Update plugin`)
            console.log(`Plugin ${pluginId} updated in ${pluginPath}`)
        } else {
            console.log(`Plugin ${pluginId} not found for update in ${pluginPath}`)
        }
    } catch (err) {
        console.error(`Error updating plugin ${pluginId} in ${pluginPath}`, err)
    }
}

async function deletePlugin(workspace, collectionId, pluginId) {
    logMethodCall('deletePlugin', {
        workspace,
        collectionId,
        pluginId,
    })

    // If collectionId is null, it means it's a workspace plugin
    if (collectionId === null) {
        const workspacePluginsPath = `${workspace.location}/${constants.FILES.WORKSPACE_PLUGINS}`
        try {
            let existingPlugins = JSON.parse(await fs.readFile(workspacePluginsPath, 'utf8'))
            const filteredPlugins = existingPlugins.filter(plugin => plugin._id !== pluginId)

            if (filteredPlugins.length < existingPlugins.length) {
                if (filteredPlugins.length === 0) {
                    await fileUtils.deleteFileOrFolder(workspacePluginsPath, fsLog, `Delete workspace plugins`)
                    console.log(`All workspace plugins deleted: ${workspace.location}`)
                } else {
                    await fileUtils.writeFileJson(workspacePluginsPath, filteredPlugins, fsLog, `Delete plugin`)
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
    const pluginPath = collectionPath.endsWith('.json') ? collectionPath.replace('.json', constants.FILES.PLUGINS) : `${collectionPath}/${constants.FILES.FOLDER_PLUGINS}`

    try {
        let existingPlugins = JSON.parse(await fs.readFile(pluginPath, 'utf8'))
        const filteredPlugins = existingPlugins.filter(plugin => plugin._id !== pluginId)

        if (filteredPlugins.length < existingPlugins.length) {
            await fileUtils.writeFileJson(pluginPath, filteredPlugins, fsLog, `Delete plugin`)
            console.log(`Plugin ${pluginId} deleted in${pluginPath}`)
        } else {
            console.log(`Plugin ${pluginId} not found for deletion in ${pluginPath}`)
        }
    } catch (err) {
        console.error(`Error deleting plugin ${pluginId} in ${pluginPath}`, err)
    }
}

async function deletePluginsByWorkspace(workspace) {
    logMethodCall('deletePluginsByWorkspace', {
        workspace,
    })

    const workspacePluginsPath = `${workspace.location}/${constants.FILES.WORKSPACE_PLUGINS}`
    try {
        await fs.access(workspacePluginsPath)
        await fileUtils.deleteFileOrFolder(workspacePluginsPath, fsLog, `Delete workspace plugins`)
        console.log(`All workspace plugins deleted: ${workspace.location}`)
    } catch (err) {
        console.log(`No workspace plugins found for deletion in: ${workspace.location}`)
    }
}

async function deletePluginsByCollectionIds(workspace, collectionIds) {
    logMethodCall('deletePluginsByCollectionIds', {
        workspace,
        collectionIds,
    })

    for (const collectionId of collectionIds) {
        const collectionPath = idMap.get(collectionId)
        const pluginPath = collectionPath.endsWith('.json') ? collectionPath.replace('.json', constants.FILES.PLUGINS) : `${collectionPath}/${constants.FILES.FOLDER_PLUGINS}`

        try {
            await fileUtils.deleteFileOrFolder(pluginPath, fsLog, `Delete plugins for collection item`)
            console.log(`Deleted plugins for collection: ${collectionId}`)
        } catch(err) {
            console.log(`No plugins found for deletion for collection: ${collectionId}`)
        }
    }
}

async function createPlugins(workspace, plugins) {
    logMethodCall('createPlugins', {
        workspace,
        plugins,
    })

    for (const plugin of plugins) {
        await createPlugin(workspace, plugin)
    }
}

module.exports = {
    getWorkspaceAtLocation,
    updateWorkspace,
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
