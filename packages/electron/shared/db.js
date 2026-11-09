import fs from 'fs/promises'
import path from 'path'
import * as helpers from './helpers.js'
import constants from './constants.js'

const { logMethodCall } = helpers

async function readFileJson(filePath, emptyValue) {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf8'))
    } catch (err) {
        if (err.code !== 'ENOENT') {
            // such as a file holding git merge conflict markers, which writing over would lose
            throw new Error(`Not saved, as ${filePath} cannot be read: ${err.message}`, { cause: err })
        }
        return emptyValue
    }
}

// the text of a file about to be written, null when it does not exist, with the same refusal as readFileJson for a
// file that cannot be read or parsed
async function readFileTextBeforeWrite(filePath) {
    let text
    try {
        text = await fs.readFile(filePath, 'utf8')
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw new Error(`Not saved, as ${filePath} cannot be read: ${err.message}`, { cause: err })
        }
        return { text: null, data: null }
    }
    try {
        return { text, data: JSON.parse(text) }
    } catch (err) {
        throw new Error(`Not saved, as ${filePath} cannot be read: ${err.message}`, { cause: err })
    }
}

export function createDatabase(fileUtils, dbHelpers, dotenv, getWorkspaceWatcher = () => null) {
    // item ids to paths, one map per workspace location, so a workspace other than the open one, such as one whose call
    // ends after the user switched away, reads and writes its own files when another workspace has an item at the same path
    const workspaceIdMaps = new Map()
    // per workspace location, the ids a scan kept for the scan after it only, see readCollectionForWorkspace
    const workspaceIdAliases = new Map()
    // the workspace locations scanned since this process started
    const scannedLocations = new Set()
    // per workspace location, the map and kept ids a scan cleared, put back when its read fails, so the ids the page
    // holds keep reaching their files
    const clearedIdMaps = new Map()

    // An id a page sent before this process scanned the workspace, as after web-standalone restarts with a tab open: the
    // page's ids are paths relative to the workspace as its last scan found them, so the path is the id, when a file is
    // still there. A save to it is still checked against the version the page holds
    async function resolveIdBeforeFirstScan(workspace, collectionId) {
        if (scannedLocations.has(workspace.location) || typeof collectionId !== 'string') {
            return undefined
        }
        // an id is the path after the workspace's, such as /Folder/Login.json
        const candidate = path.join(workspace.location, collectionId)
        const relative = path.relative(workspace.location, candidate)
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !await fileUtils.pathExists(candidate)) {
            return undefined
        }
        getIdMap(workspace.location).set(collectionId, candidate)
        return candidate
    }

    function getIdMap(workspaceLocation) {
        if (!workspaceIdMaps.has(workspaceLocation)) {
            workspaceIdMaps.set(workspaceLocation, new Map())
        }
        return workspaceIdMaps.get(workspaceLocation)
    }

    async function getWorkspaceAtLocation(location, getEnvironments = false) {
        logMethodCall('getWorkspaceAtLocation', {
            location,
            getEnvironments,
        })

        try {
            const workspaceData = JSON.parse(await fs.readFile(path.join(location, constants.FILES.WORKSPACE_CONFIG), 'utf8'))

            if(getEnvironments) {
                const envsDirPath = path.join(location, constants.FOLDERS.ENVIRONMENTS)
                const { environments, environment, currentEnvironment, version: environmentsVersion } = await dbHelpers.getEnvironments(envsDirPath, workspaceData.currentEnvironment)

                workspaceData.environmentsVersion = environmentsVersion
                workspaceData.environments = environments
                workspaceData.environment = environment
                workspaceData.currentEnvironment = currentEnvironment

                const dotEnvPath = path.resolve(location, '.env')

                if(await fileUtils.pathExists(dotEnvPath)) {
                    workspaceData.dotEnv = dotenv.parse(await fs.readFile(dotEnvPath))
                } else {
                    workspaceData.dotEnv = {}
                }
            }

            return workspaceData
        } catch (err) {
            console.error(err)
            throw new Error(`Error getting workspace at location: ${location}`)
        }
    }

    async function updateWorkspace(workspace, updatedFields, version) {
        logMethodCall('updateWorkspace', {
            workspace,
            updatedFields,
        })

        const workspacePath = workspace.location
        const workspaceConfigPath = path.join(workspacePath, constants.FILES.WORKSPACE_CONFIG)

        // such as one holding git merge conflict markers, which the UI shows for an environments save
        let workspaceExisting
        try {
            workspaceExisting = JSON.parse(await fs.readFile(workspaceConfigPath, 'utf8'))
        } catch (err) {
            return {
                error: `Not saved, as ${workspaceConfigPath} cannot be read: ${err.message}`,
            }
        }

        const update = {}
        let environmentsError = null
        let environmentsVersion

        if (updatedFields.name) {
            update.name = updatedFields.name
        }

        if (updatedFields.environments) {
            const envsDirPath = path.join(workspacePath, constants.FOLDERS.ENVIRONMENTS)
            const saved = await dbHelpers.saveEnvironments(envsDirPath, updatedFields.environments, version)
            if (saved.changedOutside) {
                return saved
            }
            ;({ error: environmentsError, version: environmentsVersion } = saved)
        }

        if (updatedFields.currentEnvironment) {
            update.currentEnvironment = updatedFields.currentEnvironment
        }

        if (Object.keys(update).length === 0) {
            console.log('No fields to update for workspace')
            return {
                error: environmentsError,
                version: environmentsVersion,
            }
        }

        const workspaceUpdated = {
            ...workspaceExisting,
            ...update,
        }

        await fileUtils.writeFileJson(path.join(workspacePath, constants.FILES.WORKSPACE_CONFIG), workspaceUpdated, `Update workspace`)
        console.log(`Updated workspace: ${path.join(workspacePath, constants.FILES.WORKSPACE_CONFIG)}`)

        return {
            error: environmentsError,
            version: environmentsVersion,
        }
    }

    async function ensureEmptyFolderOrEmptyWorkspace(location) {
        const pathExists = await fileUtils.pathExists(location)

        if (!pathExists) {
            return {
                error: `Given folder path does not exist: ${location}`,
            }
        }

        const workspaceConfigPath = path.join(location, constants.FILES.WORKSPACE_CONFIG)
        const workspaceConfigExists = await fileUtils.pathExists(workspaceConfigPath)

        let ls = await fs.readdir(location).catch(() => [])
        ls = ls.filter(filename => !filename.startsWith('.'))

        if (workspaceConfigExists) {
            if (ls.length === 1 && ls[0] === constants.FILES.WORKSPACE_CONFIG) {
                return {
                    error: null,
                }
            } else {
                return {
                    error: `Given folder path is not an empty Restfox workspace: ${location}`,
                }
            }
        }

        if (ls.length === 0) {
            return {
                error: null,
            }
        } else {
            return {
                error: `Given folder path is not empty: ${location}`,
            }
        }
    }

    function getCollectionById(workspace, collectionId) {
        logMethodCall('getCollectionById', {
            workspace,
            collectionId,
        })

        const idMap = getIdMap(workspace.location)

        const collectionPath = idMap.get(collectionId)
        const collectionPathWithoutWorkspaceLocation = helpers.removePrefixFromString(collectionPath, workspace.location)

        return dbHelpers.getCollectionItem(workspace, collectionPath, collectionPathWithoutWorkspaceLocation)
    }

    async function createCollection(workspace, collection) {
        logMethodCall('createCollection', {
            workspace,
            collection,
        })

        const idMap = getIdMap(workspace.location)

        dbHelpers.serializeRequestFiles(collection)

        const oldCollectionId = collection._id
        const collectionName = fileUtils.encodeFilename(collection.name)
        let environmentsVersion
        let environmentsError = null
        let version

        try {
            let collectionPath = ''
            let collectionPathWithoutWorkspaceLocation = ''

            if (collection._type === 'request_group') {
                if (collection.parentId) {
                    collectionPath = path.join(idMap.get(collection.parentId), collectionName)
                } else {
                    collectionPath = path.join(workspace.location, collectionName)
                }
                await fileUtils.mkdir(collectionPath, 'Create collection item folder')

                collectionPathWithoutWorkspaceLocation = helpers.removePrefixFromString(collectionPath, workspace.location)
                idMap.set(collectionPathWithoutWorkspaceLocation, collectionPath)

                console.log(`Created directory: ${collectionPath}`)

                const collectionToSave = {}
                environmentsVersion = helpers.environmentsVersion(new Map())

                if (collection.environments) {
                    const envsDirPath = path.join(collectionPath, constants.FOLDERS.ENVIRONMENTS)
                    // an environment the save refuses, such as one whose name differs from another only in case, is
                    // told with the result, not as its error, which would stop an import or a duplicate there
                    const { error, version: savedVersion } = await dbHelpers.saveEnvironments(envsDirPath, collection.environments)
                    environmentsError = error ? `${collection.name}: ${error}` : null
                    environmentsVersion = savedVersion
                    collectionToSave.currentEnvironment = collection.currentEnvironment ?? 'Default'
                }

                if (collection.sortOrder !== undefined) {
                    collectionToSave.sortOrder = collection.sortOrder
                }

                // as a duplicate or an import of a folder brings them
                if (collection.headers !== undefined) {
                    collectionToSave.headers = collection.headers
                }

                if (collection.authentication !== undefined) {
                    collectionToSave.authentication = collection.authentication
                }

                if (Object.keys(collectionToSave).length > 0) {
                    await fileUtils.writeFileJsonNewOnly(path.join(collectionPath, constants.FILES.FOLDER_CONFIG), collectionToSave, `Create collection item folder config`)
                    console.log(`Created file: ${path.join(collectionPath, constants.FILES.FOLDER_CONFIG)}`)
                }

                version = helpers.folderSettingsVersion(collectionToSave)
            }

            // every type but a folder is one file, a type only a newer version knows too, so a duplicate or import made
            // here keeps it whole rather than leaving it out
            if (collection._type !== 'request_group') {
                if (collection.parentId) {
                    collectionPath = path.join(idMap.get(collection.parentId), `${collectionName}.json`)
                } else {
                    collectionPath = path.join(workspace.location, `${collectionName}.json`)
                }

                delete collection._id
                delete collection.parentId
                delete collection.workspaceId
                delete collection.name
                delete collection.plugins

                let messages = null
                if (collection._type === 'socket') {
                    if (collection.clients) {
                        messages = {}
                        for(const client of collection.clients) {
                            messages[client.id] = client.messages
                            delete client.messages
                        }
                    }
                }

                version = helpers.itemFileVersion(await fileUtils.writeFileJsonNewOnly(collectionPath, collection, `Create collection item of type ${collection._type}`))

                // only once the item's own file is made, as a name another item has, such as a duplicate's, fails there
                // and must leave that item's messages alone
                if (messages) {
                    await fileUtils.writeFileJson(collectionPath.replace('.json', constants.FILES.MESSAGES), messages, 'Save socket client messages')
                }

                collectionPathWithoutWorkspaceLocation = helpers.removePrefixFromString(collectionPath, workspace.location)
                idMap.set(collectionPathWithoutWorkspaceLocation, collectionPath)

                console.log(`Created file: ${collectionPath}`)
            }

            return {
                error: null,
                oldCollectionId,
                newCollectionId: collectionPathWithoutWorkspaceLocation,
                environmentsError,
                // for a folder, the version of its set of environments
                environmentsVersion,
                // the version of the item's file, or of a folder's headers and auth
                version,
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

        const idMap = getIdMap(workspace.location)

        const results = []

        for (const collection of collections) {
            let result = null

            if (idMap.get(collection._id) && workspaceIdAliases.get(workspace.location)?.get(collection._id) !== idMap.get(collection._id)) {
                // we only allow updating sortOrder for existing collections - no other fields
                // as that is the only use case of this if block
                result = await updateCollection(workspace, collection._id, {
                    sortOrder: collection.sortOrder,
                })

                if (result === undefined) {
                    result = {
                        error: null,
                        oldCollectionId: null,
                        newCollectionId: null,
                    }
                }
            } else {
                result = await createCollection(workspace, structuredClone(collection))

                if(result.error) {
                    let i = 2
                    const collectionName = collection.name
                    while(result.error && result.error.includes('as it already exists')) {
                        collection.name = `${collectionName} (${i})`
                        result = await createCollection(workspace, structuredClone(collection))
                        i++
                    }
                }

                if(!result.error) {
                    collections.forEach(item => {
                        if (item.parentId !== null && item.parentId === collection._id) {
                            item.parentId = result.newCollectionId
                        }
                    })
                }
            }

            if (result && result.error) {
                return {
                    error: result.error,
                    results: results,
                }
            }

            results.push(result)
        }

        return {
            error: null,
            results,
        }
    }

    async function updateIdMapForChildren(oldBasePath, newBasePath, workspaceLocation, ignoreId = null) {
        const idMap = getIdMap(workspaceLocation)
        for (const [id, pathValue] of idMap) {
            // the folder and what is in it, not a folder beside it whose name starts the same, such as Folder2 for Folder
            if ((pathValue === oldBasePath || pathValue.startsWith(oldBasePath + path.sep)) && id !== ignoreId) {
                const newPathValue = pathValue.replace(oldBasePath, newBasePath)
                idMap.set(id, newPathValue)
            }
        }

        const items = await fs.readdir(newBasePath, { withFileTypes: true })
        for (const item of items) {
            const oldItemPath = path.join(oldBasePath, item.name)
            const newItemPath = path.join(newBasePath, item.name)

            if (item.isDirectory()) {
                await updateIdMapForChildren(oldItemPath, newItemPath, workspaceLocation, ignoreId)
            }
        }
    }

    // version is what a save of a whole request, socket or gRPC item was made from: its file's version when the screen
    // read or last saved it, or null when the screen has none. The save is refused when the file holds anything else, as
    // it was changed outside Restfox since. Left out, as by a page from before versions, nothing is checked. For a one-field
    // save of a folder's headers or auth, it is the version of those instead
    async function updateCollection(workspace, collectionId, updatedFields, version) {
        logMethodCall('updateCollection', {
            workspace,
            collectionId,
            updatedFields,
            version,
        })

        const idMap = getIdMap(workspace.location)

        const collectionPath = idMap.get(collectionId) ?? await resolveIdBeforeFirstScan(workspace, collectionId)

        // an id the server no longer maps, such as one another window renamed two scans ago: the page holds an item
        // whose file it cannot find, so it reloads rather than failing on every edit
        if (collectionPath === undefined && (version !== undefined || Object.keys(updatedFields).length === 1)) {
            return {
                error: `Not saved, as ${collectionId} was changed outside Restfox`,
                changedOutside: true,
            }
        }

        if (Object.keys(updatedFields).length === 1 && 'name' in updatedFields) {
            updatedFields.name = fileUtils.encodeFilename(updatedFields.name)

            const renameFrom = collectionPath
            let renameTo = path.join(path.dirname(collectionPath), updatedFields.name)

            if (renameFrom.endsWith('.json')) {
                renameTo += '.json'
            }

            if (renameFrom === renameTo) {
                // no change in name
                return {
                    error: null,
                }
            }

            if(await fileUtils.pathExists(renameTo)) {
                return {
                    error: `An item of the same name already exists in the destination folder. Please rename the item and try again.`
                }
            }

            await fileUtils.renameFileOrFolder(renameFrom, renameTo, `Rename collection item`, getWorkspaceWatcher())
            idMap.set(collectionId, renameTo)
            workspaceIdAliases.get(workspace.location)?.delete(collectionId)

            if (renameFrom.endsWith('.json')) {
                const responsesRenameFrom = renameFrom.replace('.json', constants.FILES.RESPONSES)
                const responsesRenameTo = renameTo.replace('.json', constants.FILES.RESPONSES)

                try {
                    await fs.access(responsesRenameFrom)
                    await fileUtils.renameFileOrFolder(responsesRenameFrom, responsesRenameTo, `Rename responses file`)
                } catch (err) {
                    console.log(`Skipping renaming responses file: ${responsesRenameFrom} as it does not exist`)
                }

                const pluginsRenameFrom = renameFrom.replace('.json', constants.FILES.PLUGINS)
                const pluginsRenameTo = renameTo.replace('.json', constants.FILES.PLUGINS)

                try {
                    await fs.access(pluginsRenameFrom)
                    await fileUtils.renameFileOrFolder(pluginsRenameFrom, pluginsRenameTo, `Rename plugins file`)
                } catch (err) {
                    console.log(`Skipping renaming plugins file: ${pluginsRenameFrom} as it does not exist`)
                }

                const messagesRenameFrom = renameFrom.replace('.json', constants.FILES.MESSAGES)
                const messagesRenameTo = renameTo.replace('.json', constants.FILES.MESSAGES)

                try {
                    await fs.access(messagesRenameFrom)
                    await fileUtils.renameFileOrFolder(messagesRenameFrom, messagesRenameTo, `Rename messages file`)
                } catch (err) {
                    console.log(`Skipping renaming messages file: ${messagesRenameFrom} as it does not exist`)
                }
            } else {
                // if folder, we also need to update idMap with the new parent folder for all children inside this folder, else they'll have the old parent path in their id
                // and will error out when trying to update them
                await updateIdMapForChildren(renameFrom, renameTo, workspace.location, collectionId)
            }

            console.log(`Renamed ${renameFrom} to ${renameTo}`)

            return {
                error: null,
            }
        }

        if (Object.keys(updatedFields).length === 1 && 'parentId' in updatedFields) {
            const renameFrom = collectionPath
            const parentPath = updatedFields.parentId != null
                ? idMap.get(updatedFields.parentId) ?? await resolveIdBeforeFirstScan(workspace, updatedFields.parentId)
                : workspace.location
            // a folder the server does not know, such as one deleted outside Restfox: the page reloads
            if (parentPath === undefined) {
                return {
                    error: `Not moved, as ${updatedFields.parentId} was changed outside Restfox`,
                    changedOutside: true,
                }
            }
            const renameTo = path.join(parentPath, path.basename(collectionPath))

            if (renameFrom === renameTo) {
                // no change in parent
                return {
                    error: null,
                }
            }

            try {
                if(await fileUtils.pathExists(renameTo)) {
                    return {
                        error: `An item of the same name already exists in the destination folder. Please rename the item and try again.`
                    }
                }
                await fileUtils.renameFileOrFolder(renameFrom, renameTo, `Move collection item`)
                idMap.set(collectionId, renameTo)
                workspaceIdAliases.get(workspace.location)?.delete(collectionId)
            }  catch (err) {
                console.error(`Error renaming ${renameFrom} to ${renameTo}`, err)
                return {
                    error: `Error renaming ${renameFrom} to ${renameTo}: ${err.message}`,
                }
            }

            // endsWith('.json') means it's a file, else it's a folder
            if (renameFrom.endsWith('.json')) {
                const responsesRenameFrom = renameFrom.replace('.json', constants.FILES.RESPONSES)
                const responsesRenameTo = renameTo.replace('.json', constants.FILES.RESPONSES)

                try {
                    await fs.access(responsesRenameFrom)
                    await fileUtils.renameFileOrFolder(responsesRenameFrom, responsesRenameTo, `Rename responses file`)
                } catch (err) {
                    console.log(`Skipping renaming responses file: ${responsesRenameFrom} as it does not exist`)
                }

                const pluginsRenameFrom = renameFrom.replace('.json', constants.FILES.PLUGINS)
                const pluginsRenameTo = renameTo.replace('.json', constants.FILES.PLUGINS)

                try {
                    await fs.access(pluginsRenameFrom)
                    await fileUtils.renameFileOrFolder(pluginsRenameFrom, pluginsRenameTo, `Rename plugins file`)
                } catch (err) {
                    console.log(`Skipping renaming plugins file: ${pluginsRenameFrom} as it does not exist`)
                }

                // a socket's messages go with it, as on a rename
                const messagesRenameFrom = renameFrom.replace('.json', constants.FILES.MESSAGES)
                const messagesRenameTo = renameTo.replace('.json', constants.FILES.MESSAGES)

                try {
                    await fs.access(messagesRenameFrom)
                    await fileUtils.renameFileOrFolder(messagesRenameFrom, messagesRenameTo, 'Move messages file')
                } catch {
                    console.log(`Skipping moving messages file: ${messagesRenameFrom} as it does not exist`)
                }
            } else {
                // if folder, we also need to update idMap with the new parent folder for all children inside this folder, else they'll have the old parent path in their id
                // and will error out when trying to update them
                await updateIdMapForChildren(renameFrom, renameTo, workspace.location)
            }

            console.log(`Moved ${renameFrom} to ${renameTo}`)
            return {
                error: null,
            }
        }

        if (Object.keys(updatedFields).length === 1 && ('sortOrder' in updatedFields || 'currentEnvironment' in updatedFields || 'environments' in updatedFields || 'collapsed' in updatedFields || 'headers' in updatedFields || 'authentication' in updatedFields)) {
            if(updatedFields.environments) {
                const envsDirPath = path.join(collectionPath, constants.FOLDERS.ENVIRONMENTS)
                return dbHelpers.saveEnvironments(envsDirPath, updatedFields.environments, version)
            }

            if('collapsed' in updatedFields) {
                const collapsedFilePath = path.join(collectionPath, constants.FILES.COLLAPSED)
                if (updatedFields.collapsed) {
                    try {
                        await fileUtils.writeEmptyFileNewOnly(collapsedFilePath, `Mark directory as collapsed`)
                        console.log(`Marked as collapsed: ${collapsedFilePath}`)
                    } catch (err) {
                        console.error(`Error marking directory as collapsed: ${collapsedFilePath}`, err)
                    }
                } else {
                    try {
                        await fileUtils.deleteFileOrFolder(collapsedFilePath, `Mark directory as expanded`)
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

            let stats
            try {
                stats = await fs.stat(collectionPath)
            } catch (err) {
                // a file gone since the screen read it, which a merge would otherwise make again with one field
                if (err.code === 'ENOENT') {
                    return {
                        error: `Not saved, as ${collectionPath} was changed outside Restfox`,
                        changedOutside: true,
                    }
                }
                throw err
            }

            const isFolder = stats.isDirectory()
            if (isFolder) {
                collectionPathCopy = path.join(collectionPath, constants.FILES.FOLDER_CONFIG)
            }

            let collectionExistingText
            let collectionExisting

            try {
                const existing = await readFileTextBeforeWrite(collectionPathCopy)
                collectionExistingText = existing.text
                collectionExisting = existing.data ?? {}
            } catch (err) {
                return {
                    error: err.message,
                }
            }

            // a folder's headers or auth from an older copy would otherwise replace what the file has now
            if (isFolder && version !== undefined && helpers.folderSettingsVersion(collectionExisting) !== version) {
                return {
                    error: `Not saved, as ${collectionPathCopy} was changed outside Restfox`,
                    changedOutside: true,
                }
            }

            // one field merged into the file as it is now, which keeps any change made outside Restfox
            const collectionUpdated = {
                ...collectionExisting,
                ...updatedFields,
            }

            const write = fieldToUpdate === 'sortOrder' ? fileUtils.writeFileJsonInPlace : fileUtils.writeFileJson
            const writtenText = await write(collectionPathCopy, collectionUpdated, `Update ${fieldToUpdate}`)
            console.log(`Updated ${fieldToUpdate} for ${collectionPathCopy}`)

            // the screen takes the new version only where it held versionBefore, as the file then had no change it missed
            return {
                error: null,
                versionBefore: isFolder ? helpers.folderSettingsVersion(collectionExisting) : collectionExistingText === null ? null : helpers.itemFileVersion(collectionExistingText),
                version: isFolder ? helpers.folderSettingsVersion(collectionUpdated) : helpers.itemFileVersion(writtenText),
            }
        }

        if (updatedFields._type === 'request' || updatedFields._type === 'socket' || updatedFields._type === 'grpc') {
            delete updatedFields._id
            delete updatedFields.parentId
            delete updatedFields.workspaceId
            delete updatedFields.name

            let collectionExistingText = null
            try {
                collectionExistingText = await fs.readFile(collectionPath, 'utf8')
            } catch (err) {
                // a file gone since the screen read it is a change made outside Restfox too
                if (err.code !== 'ENOENT' || version === undefined) {
                    throw err
                }
            }

            // checked before any write, so a refused save of a socket leaves its messages file alone too
            if (version !== undefined && (collectionExistingText === null || helpers.itemFileVersion(collectionExistingText) !== version)) {
                return {
                    error: `Not saved, as ${collectionPath} was changed outside Restfox`,
                    changedOutside: true,
                }
            }

            const collectionExisting = JSON.parse(collectionExistingText)

            if (updatedFields._type === 'socket') {
                if (updatedFields.clients) {
                    const existingMessages = await readFileJson(collectionPath.replace('.json', constants.FILES.MESSAGES), {})
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
                    await fileUtils.writeFileJson(collectionPath.replace('.json', constants.FILES.MESSAGES), existingMessages, 'Save socket client messages')
                }
            }

            dbHelpers.serializeRequestFiles(updatedFields)

            const collectionUpdated = {
                ...collectionExisting,
                ...updatedFields,
            }

            // the order is written by merges and creates alone, so a window whose copy of it is older keeps the file's
            if ('sortOrder' in collectionExisting) {
                collectionUpdated.sortOrder = collectionExisting.sortOrder
            } else {
                delete collectionUpdated.sortOrder
            }

            const writtenText = await fileUtils.writeFileJson(collectionPath, collectionUpdated, 'Update collection item')
            console.log(`Updated file: ${collectionPath}`)
            return {
                error: null,
                version: helpers.itemFileVersion(writtenText),
            }
        }
    }

    async function deleteCollectionsByWorkspaceId(workspace) {
        logMethodCall('deleteCollectionsByWorkspaceId', {
            workspace,
        })

        const idMap = getIdMap(workspace.location)

        const items = await fs.readdir(workspace.location, { withFileTypes: true })
        for (const item of items) {
            const itemPath = path.join(workspace.location, item.name)

            if (item.name.endsWith('.git')) {
                continue
            }

            if (item.isDirectory()) {
                const folderConfigExists = await fileUtils.pathExists(path.join(itemPath, constants.FILES.FOLDER_CONFIG))
                if (folderConfigExists || item.name === constants.FOLDERS.ENVIRONMENTS) {
                    await fs.rm(itemPath, { recursive: true })
                }
            } else {
                if (item.name.endsWith('.json')) {
                    await fileUtils.deleteFileOrFolder(itemPath, `Delete collection item`)
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

    async function deleteCollectionsByIds(workspace, collectionIds, idMap) {
        let collectionItemsToDelete = []

        for (const collectionId of collectionIds) {
            const collectionPath = idMap.get(collectionId)
            collectionItemsToDelete.push({ collectionId, collectionPath })
        }

        collectionItemsToDelete.sort((a, b) => b.collectionPath.localeCompare(a.collectionPath))

        for (const collectionItem of collectionItemsToDelete) {
            console.log(`Deleting collection item: ${collectionItem.collectionPath}`)

            if (collectionItem.collectionPath.endsWith('.json') === false) {
                await fileUtils.deleteFileOrFolder(path.join(collectionItem.collectionPath, constants.FILES.FOLDER_CONFIG), `Delete collection item folder config`)

                try {
                    await fileUtils.deleteFileOrFolder(path.join(collectionItem.collectionPath, constants.FILES.COLLAPSED), `Delete collection item collapsed state marker`)
                } catch {
                    console.log(`No collapsed state marker found for deletion for collection item: ${collectionItem.collectionPath}`)
                }

                try {
                    const environmentsDir = await fs.readdir(path.join(collectionItem.collectionPath, constants.FOLDERS.ENVIRONMENTS))
                    for (const envFile of environmentsDir) {
                        await fileUtils.deleteFileOrFolder(path.join(collectionItem.collectionPath, constants.FOLDERS.ENVIRONMENTS, envFile), `Delete collection item environment`)
                    }
                    await fileUtils.deleteFileOrFolder(path.join(collectionItem.collectionPath, constants.FOLDERS.ENVIRONMENTS), `Delete collection item environments folder`)
                } catch {
                    console.log(`No environments found for deletion for collection item: ${collectionItem.collectionPath}`)
                }
            } else {
                try {
                    await fileUtils.deleteFileOrFolder(collectionItem.collectionPath.replace('.json', constants.FILES.MESSAGES), `Delete messages for collection item`)
                } catch {
                    console.log(`No messages found for deletion for collection item: ${collectionItem.collectionPath}`)
                }
            }

            await fileUtils.deleteFileOrFolder(collectionItem.collectionPath, `Delete collection item`)
            idMap.delete(collectionItem.collectionId)
        }

        return {
            error: null,
        }
    }

    async function getResponsesByCollectionId(workspace, collectionId) {
        logMethodCall('getResponsesByCollectionId', {
            workspace,
            collectionId,
        })

        const idMap = getIdMap(workspace.location)

        const collectionPath = idMap.get(collectionId)

        // if it's a folder, we don't have responses
        if (collectionPath.endsWith('.json') === false) {
            return []
        }

        const responsesPath = collectionPath.replace('.json', constants.FILES.RESPONSES)
        const responsesPathExists = await fileUtils.pathExists(responsesPath)

        if (responsesPathExists) {
            const responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))
            responses.forEach((response) => {
                dbHelpers.deserializeRequestResponseFiles(response)
                // add back the collectionId we removed in createResponse
                response.collectionId = collectionId
            })
            // sort by createdAt desc so that the latest response is shown first
            return responses.sort((a, b) => b.createdAt - a.createdAt)
        }

        return []
    }

    async function createResponse(workspace, response) {
        logMethodCall('createResponse', {
            workspace,
            response,
        })

        const idMap = getIdMap(workspace.location)

        const collectionPath = idMap.get(response.collectionId)

        const responsesPath = collectionPath.replace('.json', constants.FILES.RESPONSES)
        const responsesPathExists = await fileUtils.pathExists(responsesPath)
        let responses = []

        if (responsesPathExists) {
            responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))
        }

        delete response.collectionId

        dbHelpers.serializeRequestResponseFiles(response)

        responses.push(response)

        await fileUtils.writeFileJson(responsesPath, responses, `Create response`)
    }

    async function updateResponse(workspace, collectionId, responseId, updatedFields) {
        logMethodCall('updateResponse', {
            workspace,
            collectionId,
            responseId,
            updatedFields,
        })

        const idMap = getIdMap(workspace.location)

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

        await fileUtils.writeFileJson(responsesPath, responses, `Update response`)
    }

    async function deleteResponse(workspace, collectionId, responseId) {
        logMethodCall('deleteResponse', {
            workspace,
            collectionId,
            responseId,
        })

        const idMap = getIdMap(workspace.location)

        const collectionPath = idMap.get(collectionId)

        const responsesPath = collectionPath.replace('.json', constants.FILES.RESPONSES)

        const responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))

        const responseIndex = responses.findIndex((response) => response._id === responseId)

        if (responseIndex === -1) {
            return
        }

        responses.splice(responseIndex, 1)

        if (responses.length === 0) {
            await fileUtils.deleteFileOrFolder(responsesPath, `Delete responses file`)
            console.log(`Deleted responses file: ${responsesPath}`)
            return
        }

        await fileUtils.writeFileJson(responsesPath, responses, `Delete response`)
        console.log(`Deleted response: ${responseId} from ${responsesPath}`)
    }

    async function deleteResponsesByIds(workspace, collectionId, responseIds) {
        logMethodCall('deleteResponsesByIds', {
            workspace,
            collectionId,
            responseIds,
        })

        const idMap = getIdMap(workspace.location)

        const collectionPath = idMap.get(collectionId)

        const responsesPath = collectionPath.replace('.json', constants.FILES.RESPONSES)

        let responses = JSON.parse(await fs.readFile(responsesPath, 'utf8'))

        responses = responses.filter((response) => !responseIds.includes(response._id))

        await fileUtils.writeFileJson(responsesPath, responses, `Delete responses`)

        console.log(`Deleted responses: ${responseIds} from ${responsesPath}`)
    }

    async function deleteResponsesByCollectionIds(workspace, collectionIds) {
        logMethodCall('deleteResponsesByCollectionIds', {
            workspace,
            collectionIds,
        })

        const idMap = getIdMap(workspace.location)

        for (const collectionId of collectionIds) {
            const collectionPath = idMap.get(collectionId)

            if (!collectionPath) {
                console.log(`Skipping deleting responses for collection: ${collectionId} as it does not exist`)
                continue
            }

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

            await fileUtils.deleteFileOrFolder(responsesPath, `Delete responses for collection item`)

            console.log(`Deleted responses for collection: ${collectionId} from ${responsesPath}`)
        }
    }

    async function deleteResponsesByCollectionId(workspace, collectionId) {
        logMethodCall('deleteResponsesByCollectionId', {
            workspace,
            collectionId,
        })

        const idMap = getIdMap(workspace.location)

        const collectionPath = idMap.get(collectionId)

        const responsesPath = collectionPath.replace('.json', constants.FILES.RESPONSES)

        await fileUtils.deleteFileOrFolder(responsesPath, `Delete responses for collection item`)

        console.log(`Deleted responses for collection: ${collectionId} from ${responsesPath}`)
    }

    async function getWorkspacePlugins(workspace) {
        logMethodCall('getWorkspacePlugins', {
            workspace,
        })

        const idMap = getIdMap(workspace.location)

        const items = []

        // Workspace Plugins
        const workspacePluginsPath = path.join(workspace.location, constants.FILES.WORKSPACE_PLUGINS)
        try {
            const workspacePluginsData = JSON.parse(await fs.readFile(workspacePluginsPath, 'utf8'))
            workspacePluginsData.forEach((plugin) => {
                plugin.workspaceId = workspace._id
                plugin.collectionId = null
            })
            items.push(...workspacePluginsData)
        } catch (err) {
            // If there is no plugins file for a workspace, it's fine, just continue
        }

        // Collection and Folder Plugins
        const collectionItems = await dbHelpers.getCollection(idMap, workspace)
        for (const item of collectionItems) {
            const collectionPath = idMap.get(item._id)
            if (item._type === 'request_group') {
                const collectionPluginsPath = path.join(collectionPath, constants.FILES.FOLDER_PLUGINS)
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
                const itemPluginsPath = collectionPath.replace('.json', constants.FILES.PLUGINS)
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

        const idMap = getIdMap(workspace.location)

        let pluginPath = ''
        if (plugin.collectionId) {
            const collectionPath = idMap.get(plugin.collectionId) ?? await resolveIdBeforeFirstScan(workspace, plugin.collectionId)
            const stats = await fs.stat(collectionPath)
            if (stats.isDirectory()) {
                pluginPath = path.join(collectionPath, constants.FILES.FOLDER_PLUGINS)
            } else {
                const collectionItemName = path.basename(collectionPath, '.json')
                const collectionPathParentPath = path.dirname(collectionPath)
                pluginPath = `${path.join(collectionPathParentPath, collectionItemName)}${constants.FILES.PLUGINS}`
            }
        } else {
            pluginPath = path.join(workspace.location, constants.FILES.WORKSPACE_PLUGINS)
        }

        const existingPlugins = await readFileJson(pluginPath, [])

        delete plugin.workspaceId
        delete plugin.collectionId

        existingPlugins.push(plugin)
        await fileUtils.writeFileJson(pluginPath, existingPlugins, `Create plugin`)
        console.log(`Plugin created at: ${pluginPath}`)
    }

    // expectedCode is the script's code the save was made from, whose text it would otherwise replace. Left out, as by a
    // page from before it or for a change that is not to the code, nothing is checked
    async function updatePlugin(workspace, collectionId, pluginId, updatedFields, expectedCode) {
        logMethodCall('updatePlugin', {
            workspace,
            collectionId,
            pluginId,
            updatedFields,
        })

        const idMap = getIdMap(workspace.location)

        const collectionPath = collectionId == null ? undefined : idMap.get(collectionId) ?? await resolveIdBeforeFirstScan(workspace, collectionId)

        // renamed or deleted where this page has not seen it
        if (collectionId != null && collectionPath === undefined && expectedCode !== undefined) {
            return {
                error: `Not saved, as ${collectionId} was changed outside Restfox`,
                changedOutside: true,
            }
        }

        let pluginPath = null

        if (collectionId == null) {
            pluginPath = path.join(workspace.location, constants.FILES.WORKSPACE_PLUGINS)
        } else {
            pluginPath = collectionPath.endsWith('.json') ? collectionPath.replace('.json', constants.FILES.PLUGINS) : path.join(collectionPath, constants.FILES.FOLDER_PLUGINS)
        }

        const existingPlugins = await readFileJson(pluginPath, [])
        const pluginIndex = existingPlugins.findIndex(plugin => plugin._id === pluginId)

        if (expectedCode !== undefined && 'code' in updatedFields && (pluginIndex === -1 || JSON.stringify(existingPlugins[pluginIndex].code) !== JSON.stringify(expectedCode))) {
            return {
                error: `Not saved, as the script in ${pluginPath} was changed outside Restfox`,
                changedOutside: true,
            }
        }

        if (pluginIndex === -1) {
            throw new Error(`Plugin ${pluginId} not found for update in ${pluginPath}`)
        }

        delete updatedFields.workspaceId
        delete updatedFields.collectionId

        existingPlugins[pluginIndex] = { ...existingPlugins[pluginIndex], ...updatedFields }
        await fileUtils.writeFileJson(pluginPath, existingPlugins, `Update plugin`)
        console.log(`Plugin ${pluginId} updated in ${pluginPath}`)
    }

    async function deletePlugin(workspace, collectionId, pluginId) {
        logMethodCall('deletePlugin', {
            workspace,
            collectionId,
            pluginId,
        })

        const idMap = getIdMap(workspace.location)

        const collectionPath = collectionId === null ? undefined : idMap.get(collectionId) ?? await resolveIdBeforeFirstScan(workspace, collectionId)
        const pluginPath = collectionId === null
            ? path.join(workspace.location, constants.FILES.WORKSPACE_PLUGINS)
            : collectionPath.endsWith('.json') ? collectionPath.replace('.json', constants.FILES.PLUGINS) : path.join(collectionPath, constants.FILES.FOLDER_PLUGINS)

        const existingPlugins = await readFileJson(pluginPath, [])
        const filteredPlugins = existingPlugins.filter(plugin => plugin._id !== pluginId)

        if (filteredPlugins.length === existingPlugins.length) {
            return
        }

        if (collectionId === null && filteredPlugins.length === 0) {
            await fileUtils.deleteFileOrFolder(pluginPath, `Delete workspace plugins`)
            console.log(`All workspace plugins deleted: ${workspace.location}`)
        } else {
            await fileUtils.writeFileJson(pluginPath, filteredPlugins, `Delete plugin`)
            console.log(`Plugin ${pluginId} deleted in ${pluginPath}`)
        }
    }

    async function deletePluginsByWorkspace(workspace) {
        logMethodCall('deletePluginsByWorkspace', {
            workspace,
        })

        const workspacePluginsPath = path.join(workspace.location, constants.FILES.WORKSPACE_PLUGINS)
        try {
            await fs.access(workspacePluginsPath)
            await fileUtils.deleteFileOrFolder(workspacePluginsPath, `Delete workspace plugins`)
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

        const idMap = getIdMap(workspace.location)

        for (const collectionId of collectionIds) {
            const collectionPath = idMap.get(collectionId)

            if (!collectionPath) {
                console.log(`Skipping deleting plugins for collection: ${collectionId} as it does not exist`)
                continue
            }

            const pluginPath = collectionPath.endsWith('.json') ? collectionPath.replace('.json', constants.FILES.PLUGINS) : path.join(collectionPath, constants.FILES.FOLDER_PLUGINS)

            try {
                await fileUtils.deleteFileOrFolder(pluginPath, `Delete plugins for collection item`)
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

    async function clearCollectionIdMap(workspace) {
        // first, so a workspace that cannot be read now, such as on a network share gone for a moment, clears nothing
        await dbHelpers.ensureRestfoxCollection(workspace)
        const idMap = getIdMap(workspace.location)
        // ids the scan before kept only for its own time expire here, so a stale one never reaches a path another
        // item has taken since
        const aliases = workspaceIdAliases.get(workspace.location) ?? new Map()
        clearedIdMaps.set(workspace.location, { idMap: new Map(idMap), aliases })
        workspaceIdAliases.delete(workspace.location)
        const idMapBeforeClear = new Map([...idMap].filter(([id, idPath]) => aliases.get(id) !== idPath))
        // loop through idMapBeforeClear and remove prefix from values
        // as the idMap needed for the ui and electron is not the same
        for (const [key, value] of idMapBeforeClear) {
            idMapBeforeClear.set(key, helpers.removePrefixFromString(value, workspace.location))
        }
        idMap.clear()

        return idMapBeforeClear
    }

    async function readCollectionForWorkspace(workspace, type, idMapBeforeClear) {
        const idMap = getIdMap(workspace.location)
        // item id to the version of its file
        const versions = {}
        // workspace's or folder's id, '' for the workspace, to the version of its environments, kept apart from them
        const environmentVersions = {}
        let collection
        let workspaceData
        try {
            [ collection, workspaceData ] = await Promise.all([
                // we do not want to modify the idMap if returning the request_group type
                // this messes up the idMap - as ui and elecron will go out of sync
                dbHelpers.getCollection(type === null ? idMap : new Map(), workspace, workspace.location, versions, environmentVersions),
                getWorkspaceAtLocation(workspace.location, true),
            ])
        } catch (err) {
            const cleared = clearedIdMaps.get(workspace.location)
            if (type === null && cleared) {
                clearedIdMaps.delete(workspace.location)
                idMap.clear()
                cleared.idMap.forEach((idPath, id) => idMap.set(id, idPath))
                workspaceIdAliases.set(workspace.location, cleared.aliases)
            }
            throw err
        }
        if (type === null) {
            clearedIdMaps.delete(workspace.location)
            scannedLocations.add(workspace.location)
        }
        environmentVersions[''] = workspaceData.environmentsVersion
        delete workspaceData.environmentsVersion

        // An id from before this scan, such as an item's before a rename, keeps reaching the path it had reached until
        // the next scan, so a save the screen sent with it while this scan ran still finds the file. Ids this scan read
        // win, and the screen's version check refuses a save that reaches an item it was not made from
        if (type === null && idMapBeforeClear) {
            const aliases = new Map()
            for (const [previousId, relativePath] of idMapBeforeClear) {
                if (!idMap.has(previousId)) {
                    idMap.set(previousId, path.join(workspace.location, relativePath))
                    aliases.set(previousId, idMap.get(previousId))
                }
            }
            workspaceIdAliases.set(workspace.location, aliases)
        }

        // this is the only type filter that's required by the app
        if (type === 'request_group') {
            return {
                error: null,
                collection: collection.filter((item) => item._type === 'request_group'),
                workspace: null,
                idMap: null,
            }
        }

        return {
            error: null,
            collection,
            workspace: workspaceData,
            idMap: idMapBeforeClear,
            versions,
            environmentVersions,
        }
    }

    const database = {
        getWorkspaceAtLocation,
        updateWorkspace,
        ensureEmptyFolderOrEmptyWorkspace,
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
        getIdMap,
        clearCollectionIdMap,
        readCollectionForWorkspace,
    }

    // Each function takes the workspace or its location first. A location typed with forward slashes on Windows, such as
    // C:/work/api, or with a trailing separator never matches the paths built from it with path.join, so the items' ids
    // and parents come out wrong and the sidebar is empty. Every function, a later one included, gets it as the platform
    // writes it
    return Object.fromEntries(Object.entries(database).map(([name, value]) => [
        name,
        typeof value === 'function' ? (workspaceOrLocation, ...rest) => value(withPlatformLocation(workspaceOrLocation), ...rest) : value,
    ]))
}

// The platform's separators and no trailing one. A relative location stays relative, as the Electron watcher watches the
// location as typed and reports its changes in that form, which must match the paths Restfox logs for its own writes
export function platformLocation(location) {
    const normalized = path.normalize(location)
    return normalized.length > path.parse(normalized).root.length && normalized.endsWith(path.sep) ? normalized.slice(0, -1) : normalized
}

function withPlatformLocation(workspaceOrLocation) {
    if (typeof workspaceOrLocation === 'string' && workspaceOrLocation !== '') {
        return platformLocation(workspaceOrLocation)
    }
    if (typeof workspaceOrLocation?.location === 'string' && workspaceOrLocation.location !== '') {
        return { ...workspaceOrLocation, location: platformLocation(workspaceOrLocation.location) }
    }
    return workspaceOrLocation
}
