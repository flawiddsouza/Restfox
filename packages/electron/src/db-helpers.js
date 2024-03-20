
const fs = require('fs').promises
const path = require('path')
const fileUtils = require('./file-utils')
const constants = require('./constants')

async function getCollectionItem(workspace, fullPath) {
    const isFolder = fullPath.endsWith('.json') === false
    const fileOrFolderName = path.basename(fullPath)
    const dir = path.dirname(fullPath)

    if (isFolder) {
        const collapsed = await fileUtils.pathExists(path.join(fullPath, constants.FILES.COLLAPSED))

        const collectionName = fileOrFolderName

        let collectionItem = {
            _id: fullPath,
            _type: 'request_group',
            name: fileUtils.decodeFilename(collectionName),
            parentId: dir === workspace.location ? null : dir,
            children: [],
            workspaceId: workspace._id,
            collapsed,
        }

        try {
            const collectionData = JSON.parse(await fs.readFile(`${fullPath}/${constants.FILES.FOLDER_CONFIG}`, 'utf8'))

            const environments = await getEnvironments(`${fullPath}/${constants.FOLDERS.ENVIRONMENTS}`)
            if (environments.length > 0) {
                collectionData.environments = environments
                collectionItem.currentEnvironment = collectionData.currentEnvironment ?? constants.DEFAULT_ENVIRONMENT
                collectionItem.environment = collectionData.environments.find((env) => env.name === collectionItem.currentEnvironment).environment
            }

            collectionItem = {
                ...collectionItem,
                ...collectionData,
            }

            return collectionItem
        } catch (err) {
            console.error(`${fullPath}/${constants.FILES.FOLDER_CONFIG} not found, so skipping adding it to the collection`)
        }
    } else {
        let collectionItem = JSON.parse(await fs.readFile(fullPath, 'utf8'))

        if (collectionItem._type === 'socket') {
            const messagesPath = fullPath.replace('.json', constants.FILES.MESSAGES)
            if (await fileUtils.pathExists(messagesPath)) {
                const clientMessages = JSON.parse(await fs.readFile(messagesPath, 'utf8'))
                collectionItem.clients.forEach((client) => {
                    client.messages = clientMessages[client.id]
                })
            }
        }

        const collectionName = fileOrFolderName.replace('.json', '')

        collectionItem = {
            ...collectionItem,
            _id: fullPath,
            parentId: dir === workspace.location ? null : dir,
            name: fileUtils.decodeFilename(collectionName),
            workspaceId: workspace._id,
        }

        return collectionItem
    }
}

async function getCollection(idMap, workspace, dir = workspace.location) {
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

            if (fileOrFolder.isDirectory()) {
                const collection = await getCollectionItem(workspace, fullPath)

                if(collection) {
                    items.push(collection)

                    // Recursively get files and folders inside this directory
                    const nestedItems = await getCollection(idMap, workspace, fullPath)
                    items = items.concat(nestedItems)
                }
            } else {
                const collectionItem = await getCollectionItem(workspace, fullPath)
                items.push(collectionItem)
            }
            idMap.set(fullPath, fullPath)
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

    await fs.writeFile(`${workspace.location}/${constants.FILES.WORKSPACE_CONFIG}`, JSON.stringify(restfoxData, null, 4))

    if(await fileUtils.pathExists(`${workspace.location}/.gitignore`) === false) {
        await fs.writeFile(`${workspace.location}/.gitignore`, constants.GITIGNORE_CONTENT)
    }
}

async function ensureRestfoxCollection(workspace) {
    try {
        const restfoxJson = await fs.readFile(`${workspace.location}/${constants.FILES.WORKSPACE_CONFIG}`, 'utf8')
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

async function getEnvironments(envsDirPath) {
    const environments = []

    const envFiles = await fileUtils.readdirIgnoreError(envsDirPath)

    for (const fileName of envFiles) {
        try {
            const envData = JSON.parse(await fs.readFile(path.join(envsDirPath, fileName), 'utf8'))
            environments.push({
                name: fileUtils.decodeFilename(fileName.replace('.json', '')),
                environment: envData,
            })
        } catch (err) {
            console.error(`Error reading environment file: ${fileName}`, err)
        }
    }

    return environments
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

    for (const existingEnvironment of existingEnvironments) {
        if (!environmentNames.includes(existingEnvironment)) {
            // this means the environment was removed
            try {
                await fileUtils.deleteFileOrFolder(path.join(envsDirPath, existingEnvironment), fsLog, 'Deleting environment')
            } catch (err) {
                console.error(`Error removing environment file: ${existingEnvironment}`, err)
            }
        }
    }

    for (const env of environments) {
        const envName = fileUtils.encodeFilename(env.name)
        try {
            await fileUtils.writeFileJson(path.join(envsDirPath, `${envName}.json`), env.environment, fsLog, 'Saving environment')
        } catch (err) {
            console.error(`Error writing environment file: ${envName}.json`, err)
        }
    }
}

module.exports = {
    getCollectionItem,
    getCollection,
    ensureRestfoxCollection,
    getEnvironments,
    saveEnvironments,
}
