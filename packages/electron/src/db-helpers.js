
const fs = require('fs').promises
const path = require('path')
const fileUtils = require('./file-utils')
const constants = require('./constants')

async function getCollectionItem(fsLog, workspace, fullPath) {
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

            const { environments, environment, currentEnvironment } = await getEnvironments(`${fullPath}/${constants.FOLDERS.ENVIRONMENTS}`, collectionData.currentEnvironment)

            if(currentEnvironment !== collectionData.currentEnvironment) {
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

        deserializeRequestFiles(collectionItem)

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

            if (fileOrFolder.isDirectory()) {
                const collection = await getCollectionItem(fsLog, workspace, fullPath)

                if(collection) {
                    items.push(collection)

                    // Recursively get files and folders inside this directory
                    const nestedItems = await getCollection(idMap, fsLog, workspace, fullPath)
                    items = items.concat(nestedItems)
                }
            } else {
                const collectionItem = await getCollectionItem(fsLog, workspace, fullPath)
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

async function getEnvironments(envsDirPath, currentEnvironment) {
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

    return returnData
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
    response.buffer = Buffer.from(response.buffer).toString('base64')

    if(response.request.body && response.request.body.buffer instanceof ArrayBuffer) {
        response.request.body = fileUtils.transformFileObjectToSaveableFileObject(response.request.body)
    }

    if(response.request.original.body) {
        if(response.request.original.body.fileName && response.request.original.body.fileName instanceof ArrayBuffer) {
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
    response.buffer = Buffer.from(response.buffer, 'base64')

    if(response.request.body && typeof response.request.body.buffer === 'string') {
        response.request.body = fileUtils.transformSavedFileObjectToFileObject(response.request.body)
    }

    if(response.request.original.body) {
        if(response.request.original.body.fileName && response.request.original.body.fileName instanceof ArrayBuffer) {
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

module.exports = {
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
