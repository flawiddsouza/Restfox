import fs from 'fs/promises'
import path from 'path'
import * as helpers from './helpers.js'
import constants from './constants.js'

export function createDbHelpers(fileUtils, deserializeResponseBuffer) {
    async function getCollectionItem(fsLog, workspace, fullPath, idForCollectionitem) {
        const isFolder = fullPath.endsWith('.json') === false
        const fileOrFolderName = path.basename(fullPath)
        const dir = path.dirname(fullPath)
        const parentIdForCollectionItem = dir === workspace.location ? null : helpers.removePrefixFromString(dir, workspace.location)

        if (isFolder) {
            const collapsed = await fileUtils.pathExists(path.join(fullPath, constants.FILES.COLLAPSED))

            const collectionName = fileOrFolderName

            let collectionItem = {
                _id: idForCollectionitem,
                _type: 'request_group',
                name: fileUtils.decodeFilename(collectionName),
                parentId: parentIdForCollectionItem,
                children: [],
                workspaceId: workspace._id,
                collapsed,
            }

            try {
                const collectionData = JSON.parse(await fs.readFile(path.join(fullPath, constants.FILES.FOLDER_CONFIG), 'utf8'))

                const { environments, environment, currentEnvironment, currentEnvironmentUnreadable } = await getEnvironments(path.join(fullPath, constants.FOLDERS.ENVIRONMENTS), collectionData.currentEnvironment)

                if(currentEnvironment !== collectionData.currentEnvironment && !currentEnvironmentUnreadable) {
                    await fileUtils.writeFileJson(path.join(fullPath, constants.FILES.FOLDER_CONFIG), {
                        ...collectionData,
                        currentEnvironment,
                    }, fsLog, 'Update current environment in folder config')
                }

                collectionItem.currentEnvironment = currentEnvironment

                collectionItem = {
                    ...collectionItem,
                    ...collectionData,
                    environments: environments,
                    environment: environment,
                    currentEnvironment: currentEnvironment,
                }

                return collectionItem
            } catch (err) {
                console.error(`${path.join(fullPath, constants.FILES.FOLDER_CONFIG)} not found, so skipping adding it to the collection`)
            }
        } else {
            try {
                let collectionItem = JSON.parse(await fs.readFile(fullPath, 'utf8'))

                if (collectionItem._type === 'socket') {
                    const messagesPath = fullPath.replace('.json', constants.FILES.MESSAGES)
                    if (await fileUtils.pathExists(messagesPath)) {
                        const clientMessages = JSON.parse(await fs.readFile(messagesPath, 'utf8'))
                        collectionItem.clients.forEach((client) => {
                            client.messages = clientMessages[client.id] ?? []
                        })
                    }
                }

                deserializeRequestFiles(collectionItem)

                const collectionName = fileOrFolderName.replace('.json', '')

                collectionItem = {
                    ...collectionItem,
                    _id: idForCollectionitem,
                    parentId: parentIdForCollectionItem,
                    name: fileUtils.decodeFilename(collectionName),
                    workspaceId: workspace._id,
                }

                return collectionItem
            } catch (err) {
                console.error(`Error reading collection item: ${fullPath}`, err)
            }
        }
    }

    async function getCollection(idMap, fsLog, workspace, dir = workspace.location) {
        let items = []

        try {
            const filesAndFolders = await fs.readdir(dir, { withFileTypes: true })

            for (let fileOrFolder of filesAndFolders) {
                if (
                    fileOrFolder.name.startsWith('.') ||
                    fileOrFolder.name === constants.FOLDERS.ENVIRONMENTS ||
                    fileOrFolder.name.endsWith(constants.FILES.PLUGINS) ||
                    fileOrFolder.name.endsWith(constants.FILES.RESPONSES) ||
                    fileOrFolder.name.endsWith(constants.FILES.MESSAGES) ||
                    fileOrFolder.name === constants.FILES.WORKSPACE_CONFIG ||
                    fileOrFolder.name === constants.FILES.FOLDER_CONFIG ||
                    fileOrFolder.name === constants.FILES.COLLAPSED ||
                    // just to be on the safer side, we only allow .json get through if fileOrFolder is a file
                    // this way if the user creates random files that are not related to restfox, they will be ignored
                    // as long as they are not json
                    (fileOrFolder.isDirectory() === false && fileOrFolder.name.endsWith('.json') === false)
                ) {
                    continue
                }

                const fullPath = path.join(dir, fileOrFolder.name)
                const fullPathWithoutWorkspaceLocation = helpers.removePrefixFromString(fullPath, workspace.location)

                if (fileOrFolder.isDirectory()) {
                    const collection = await getCollectionItem(fsLog, workspace, fullPath, fullPathWithoutWorkspaceLocation)

                    if(collection) {
                        items.push(collection)

                        // Recursively get files and folders inside this directory
                        const nestedItems = await getCollection(idMap, fsLog, workspace, fullPath)
                        items = items.concat(nestedItems)
                    }
                } else {
                    const collectionItem = await getCollectionItem(fsLog, workspace, fullPath, fullPathWithoutWorkspaceLocation)

                    if(collectionItem) {
                        items.push(collectionItem)
                    }
                }

                idMap.set(fullPathWithoutWorkspaceLocation, fullPath)
            }
        } catch (err) {
            console.error(err)
            throw new Error(`Error getting collection for workspace at location: ${dir}`)
        }

        return items
    }

    async function initRestfoxCollection(workspace) {
        const restfoxData = {
            version: 1,
            name: workspace.name,
        }

        await fs.writeFile(path.join(workspace.location, constants.FILES.WORKSPACE_CONFIG), JSON.stringify(restfoxData, null, 4))

        if(await fileUtils.pathExists(path.join(workspace.location, '.gitignore')) === false) {
            await fs.writeFile(path.join(workspace.location, '.gitignore'), constants.GITIGNORE_CONTENT)
        }
    }

    async function ensureRestfoxCollection(workspace) {
        try {
            const restfoxJson = await fs.readFile(path.join(workspace.location, constants.FILES.WORKSPACE_CONFIG), 'utf8')
            const restfoxData = JSON.parse(restfoxJson)
            if (restfoxData.version !== 1) {
                throw new Error('Unsupported Restfox collection version')
            }
        } catch {
            // check if given workspace.location is a directory & is empty - if yes, create constants.FILES.WORKSPACE_CONFIG
            let ls
            try {
                ls = await fs.readdir(workspace.location)
                // ignore hidden files
                ls = ls.filter(filename => !filename.startsWith('.'))
            } catch (err) {
                // Given folder path does not exist
                if (err.code === 'ENOENT') {
                    try {
                        await fs.mkdir(workspace.location)
                        await initRestfoxCollection(workspace)
                    } catch (err) {
                        console.error(err)
                        throw new Error(`Error creating new directory and ${constants.FILES.WORKSPACE_CONFIG} file for Restfox collection at ${workspace.location}`)
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
                await initRestfoxCollection(workspace)
            } else {
                throw new Error(`Given folder path is not empty and does not have a Restfox collection: ${workspace.location}`)
            }
        }
    }

    async function getEnvironments(envsDirPath, currentEnvironment) {
        const environments = []
        const unreadableNames = new Set()

        const envFiles = await fileUtils.readdirIgnoreError(envsDirPath)

        for (const fileName of envFiles) {
            // another file kept beside them, such as a backup Prod.json.bak, is not an environment
            if (fileName.endsWith('.meta.json') || !fileName.endsWith('.json')) {
                continue
            }

            try {
                const envData = JSON.parse(await fs.readFile(path.join(envsDirPath, fileName), 'utf8'))
                let envMeta = {}

                try {
                    const metaFileName = `${fileName.slice(0, -'.json'.length)}.meta.json`
                    envMeta = JSON.parse(await fs.readFile(path.join(envsDirPath, metaFileName), 'utf8'))
                } catch {}

                environments.push({
                    // only the final .json is taken off, as a name may hold one, such as Prod.json.backup
                    name: fileUtils.decodeFilename(fileName.slice(0, -'.json'.length)),
                    environment: envData,
                    ...envMeta,
                })
            } catch (err) {
                console.error(`Error reading environment file: ${fileName}`, err)
                unreadableNames.add(fileUtils.decodeFilename(fileName.slice(0, -'.json'.length)))
            }
        }

        const returnData ={
            environments: [],
            environment: {},
            currentEnvironment: currentEnvironment ?? constants.DEFAULT_ENVIRONMENT
        }

        if (environments.length > 0) {
            returnData.environments = environments
            const currentEnvironment = returnData.environments.find((env) => env.name === returnData.currentEnvironment)
            if (currentEnvironment) {
                returnData.environment = currentEnvironment.environment
                returnData.currentEnvironment = returnData.currentEnvironment
            } else {
                returnData.environment = returnData.environments[0].environment
                returnData.currentEnvironment = returnData.environments[0].name
            }
        } else {
            returnData.environments = [
                {
                    name: constants.DEFAULT_ENVIRONMENT,
                    environment: {},
                }
            ]
            returnData.environment = {}
            returnData.currentEnvironment = constants.DEFAULT_ENVIRONMENT
        }

        // the pick names an environment whose file loading skipped, such as one with git merge conflict markers, so the
        // first one stands in for it until the file is fixed, and the saved pick is left as it is
        returnData.currentEnvironmentUnreadable = currentEnvironment !== undefined && unreadableNames.has(currentEnvironment)

        return returnData
    }

    async function getJsonReadError(filePath) {
        try {
            JSON.parse(await fs.readFile(filePath, 'utf8'))
            return null
        } catch (err) {
            return err
        }
    }

    async function saveEnvironments(fsLog, envsDirPath, environments) {
        try {
            await fileUtils.mkdir(envsDirPath, fsLog, 'Create environments directory')
        } catch (err) {
            if (err.code === 'EEXIST') {
                console.error('Environment directory already exists, skipping creating it')
            } else {
                throw err
            }
        }

        const existingEnvironments = await fileUtils.readdirIgnoreError(envsDirPath)
        const environmentNames = environments.map((env) => `${fileUtils.encodeFilename(env.name)}.json`)

        // A file loading skipped as unreadable, such as one holding git merge conflict markers, was never shown, so it is
        // neither deleted as removed nor written over by an environment of the same name, which alone is not saved. Each
        // target is read rather than looked up by name, which a case-insensitive file system can match under another case.
        // A name ending in .meta is the file of another environment's color, which loading skips, so it is not saved
        // either. A save that refuses one deletes nothing, as an environment renamed to that name is missing from the list
        // but has not been saved under its new one
        const unreadableKept = new Set()
        for (const existingEnvironment of existingEnvironments) {
            if (existingEnvironment.endsWith('.json') && !existingEnvironment.endsWith('.meta.json') && !environmentNames.includes(existingEnvironment) && await getJsonReadError(path.join(envsDirPath, existingEnvironment))) {
                unreadableKept.add(existingEnvironment)
            }
        }
        const refusedTargets = new Set()
        const errors = []
        for (const [index, environmentName] of environmentNames.entries()) {
            // in any case, as Windows and macOS read Prod.META.json as Prod's color file, except a name already saved
            // under its own file, such as by a version or a system that allowed it
            if (environmentName.endsWith('.meta.json') || (environmentName.toLowerCase().endsWith('.meta.json') && !existingEnvironments.includes(environmentName))) {
                refusedTargets.add(environmentName)
                errors.push(`Not saved, as the environment name ${environments[index].name} ends in .meta, which environment colors are saved under`)
                continue
            }
            const readError = await getJsonReadError(path.join(envsDirPath, environmentName))
            if (readError && readError.code !== 'ENOENT') {
                refusedTargets.add(environmentName)
                errors.push(`Not saved, as ${path.join(envsDirPath, environmentName)} cannot be read: ${readError.message}`)
                continue
            }
            // Names that differ only in case, such as Prod and prod, are one file on Windows and macOS, so a workspace
            // shared through git loses one of them there, on every system. A name not saved under its own file yet is
            // refused when another is saved or kept under it in another case, or comes before it in the list. Both of a
            // pair already saved, as on Linux, go on being saved
            if (existingEnvironments.includes(environmentName)) {
                continue
            }
            const sameFileName = [
                ...environmentNames.filter((name, nameIndex) => name !== environmentName && (nameIndex < index || existingEnvironments.includes(name))),
                ...unreadableKept,
            ].find((name) => name.toLowerCase() === environmentName.toLowerCase())
            if (sameFileName !== undefined) {
                refusedTargets.add(environmentName)
                const sameFileEnvironment = environments[environmentNames.indexOf(sameFileName)]
                errors.push(`Not saved, as the environment name ${environments[index].name} differs from ${sameFileEnvironment ? sameFileEnvironment.name : fileUtils.decodeFilename(sameFileName.slice(0, -'.json'.length))} only in case, which Windows and macOS save as one file`)
            }
        }

        for (const existingEnvironment of refusedTargets.size > 0 ? [] : existingEnvironments) {
            if (existingEnvironment.endsWith('.meta.json') || !existingEnvironment.endsWith('.json')) {
                continue
            }

            if (!environmentNames.includes(existingEnvironment)) {
                if (await getJsonReadError(path.join(envsDirPath, existingEnvironment))) {
                    console.error(`Not deleting environment file it cannot read: ${existingEnvironment}`)
                    continue
                }

                // this means the environment was removed
                try {
                    await fileUtils.deleteFileOrFolder(path.join(envsDirPath, existingEnvironment), fsLog, 'Deleting environment')

                    const metaFileName = `${existingEnvironment.slice(0, -'.json'.length)}.meta.json`
                    const metaExists = existingEnvironments.includes(metaFileName)

                    if (metaExists && await getJsonReadError(path.join(envsDirPath, metaFileName))) {
                        console.error(`Not deleting environment meta file it cannot read: ${metaFileName}`)
                    } else if (metaExists) {
                        await fileUtils.deleteFileOrFolder(path.join(envsDirPath, metaFileName), fsLog, 'Deleting environment meta')
                    }
                } catch (err) {
                    console.error(`Error removing environment file: ${existingEnvironment}`, err)
                    errors.push(`Not deleted, as ${path.join(envsDirPath, existingEnvironment)} could not be removed: ${err.message}`)
                }
            }
        }

        for (const env of environments) {
            const envName = fileUtils.encodeFilename(env.name)
            if (refusedTargets.has(`${envName}.json`)) {
                continue
            }
            const targetPath = path.join(envsDirPath, `${envName}.json`)
            try {
                await fileUtils.writeFileJson(targetPath, env.environment, fsLog, 'Saving environment')
            } catch (err) {
                console.error(`Error writing environment file: ${envName}.json`, err)
                errors.push(`Not saved, as ${targetPath} could not be written: ${err.message}`)
                continue
            }
            if (env.color) {
                // an environment saved under a name such as Prod.META has the file Windows and macOS read as Prod's
                // color file, so the color is not written over it, on every system
                const colorSameFileName = environmentNames.find((name) => !refusedTargets.has(name) && name.toLowerCase() === `${envName}.meta.json`.toLowerCase())
                if (colorSameFileName !== undefined) {
                    errors.push(`Not saved, as the color of the environment ${env.name} would go in the file of the environment ${environments[environmentNames.indexOf(colorSameFileName)].name}, which Windows and macOS save as one file`)
                    continue
                }
                // its color, kept apart, is left as it is when it cannot be read, as the environment's own file is
                const metaPath = path.join(envsDirPath, `${envName}.meta.json`)
                const metaReadError = await getJsonReadError(metaPath)
                if (metaReadError && metaReadError.code !== 'ENOENT') {
                    errors.push(`Not saved, as ${metaPath} cannot be read: ${metaReadError.message}`)
                    continue
                }
                try {
                    await fileUtils.writeFileJson(metaPath, { color: env.color }, fsLog, 'Saving environment meta')
                } catch (err) {
                    console.error(`Error writing environment file: ${envName}.meta.json`, err)
                    errors.push(`Not saved, as ${metaPath} could not be written: ${err.message}`)
                }
            }
        }

        // an environment removed or renamed in the same save keeps its file, which the user is told
        let keptFiles = false
        for (const name of refusedTargets.size > 0 ? existingEnvironments : []) {
            if (!name.endsWith('.meta.json') && name.endsWith('.json') && !environmentNames.includes(name) && !await getJsonReadError(path.join(envsDirPath, name))) {
                keptFiles = true
                break
            }
        }
        return {
            error: errors.length > 0 ? `${errors.join('. ')}${keptFiles ? '. Nothing was deleted' : ''}` : null,
        }
    }

    function serializeRequestFiles(collection) {
        if(collection.body && collection.body.fileName && collection.body.fileName.buffer instanceof ArrayBuffer) {
            collection.body.fileName = fileUtils.transformFileObjectToSaveableFileObject(collection.body.fileName)
        }

        if(collection.body && collection.body.params) {
            for(const param of collection.body.params) {
                if(param.files) {
                    param.files = param.files.map(file => fileUtils.transformFileObjectToSaveableFileObject(file))
                }
            }
        }
    }

    function deserializeRequestFiles(collection) {
        if(collection.body && collection.body.fileName && typeof collection.body.fileName.buffer === 'string') {
            collection.body.fileName = fileUtils.transformSavedFileObjectToFileObject(collection.body.fileName)
        }

        if(collection.body && collection.body.params) {
            for(const param of collection.body.params) {
                if(param.files) {
                    param.files = param.files.map(file => fileUtils.transformSavedFileObjectToFileObject(file))
                }
            }
        }
    }

    async function serializeRequestResponseFiles(response) {
        // a gRPC call's entry, or one of a kind only a newer version knows, may have no body, so only the parts it has are converted
        if(response.buffer !== undefined) {
            response.buffer = Buffer.from(response.buffer).toString('base64')
        }

        if(response.request?.body && response.request.body.buffer instanceof ArrayBuffer) {
            response.request.body = fileUtils.transformFileObjectToSaveableFileObject(response.request.body)
        }

        // an entry of a kind only a newer version knows may have a body but no request, or one without an original
        if(response.request?.original?.body) {
            if(response.request.original.body.fileName && response.request.original.body.fileName.buffer instanceof ArrayBuffer) {
                response.request.original.body.fileName = fileUtils.transformFileObjectToSaveableFileObject(response.request.original.body.fileName)
            }

            if(response.request.original.body.params) {
                for(const param of response.request.original.body.params) {
                    if(param.files) {
                        param.files = param.files.map(file => fileUtils.transformFileObjectToSaveableFileObject(file))
                    }
                }
            }
        }
    }

    function deserializeRequestResponseFiles(response) {
        // a gRPC call's entry, or one of a kind only a newer version knows, may have no body, so only the parts it has are converted
        if(response.buffer !== undefined) {
            response.buffer = deserializeResponseBuffer(response.buffer)
        }

        if(response.request?.body && typeof response.request.body.buffer === 'string') {
            response.request.body = fileUtils.transformSavedFileObjectToFileObject(response.request.body)
        }

        if(response.request?.original?.body) {
            if(response.request.original.body.fileName && typeof response.request.original.body.fileName.buffer === 'string') {
                response.request.original.body.fileName = fileUtils.transformSavedFileObjectToFileObject(response.request.original.body.fileName)
            }

            if(response.request.original.body.params) {
                for(const param of response.request.original.body.params) {
                    if(param.files) {
                        param.files = param.files.map(file => fileUtils.transformSavedFileObjectToFileObject(file))
                    }
                }
            }
        }
    }

    return {
        getCollectionItem,
        getCollection,
        ensureRestfoxCollection,
        getEnvironments,
        saveEnvironments,
        serializeRequestFiles,
        deserializeRequestFiles,
        serializeRequestResponseFiles,
        deserializeRequestResponseFiles,
    }
}
