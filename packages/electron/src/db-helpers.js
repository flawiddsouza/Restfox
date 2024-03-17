
const fs = require('fs').promises
const path = require('path')
const fileUtils = require('./file-utils')
const constants = require('./constants')

async function getCollection(idMap, workspace, dir = workspace.location) {
    let items = []

    try {
        const filesAndFolders = await fs.readdir(dir, { withFileTypes: true })

        for (let fileOrFolder of filesAndFolders) {
            if (fileOrFolder.name.startsWith('.') || fileOrFolder.name === constants.FOLDERS.ENVIRONMENTS || fileOrFolder.name.endsWith(constants.FILES.RESPONSES) || fileOrFolder.name.endsWith(constants.FILES.PLUGINS) || fileOrFolder.name === constants.FILES.WORKSPACE_CONFIG || fileOrFolder.name === constants.FILES.FOLDER_CONFIG || fileOrFolder.name === constants.FILES.COLLAPSED) {
                continue
            }

            const fullPath = path.join(dir, fileOrFolder.name)

            if (fileOrFolder.isDirectory()) {
                const collapsed = await fileUtils.pathExists(path.join(fullPath, constants.FILES.COLLAPSED))

                let collection = {
                    _id: fullPath,
                    _type: 'request_group',
                    name: path.basename(fullPath),
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
                        collection.currentEnvironment = collectionData.currentEnvironment ?? constants.DEFAULT_ENVIRONMENT
                        collection.environment = collectionData.environments.find((env) => env.name === collection.currentEnvironment).environment
                    }

                    collection = {
                        ...collection,
                        ...collectionData,
                    }
                } catch (err) {
                    console.error(`${fullPath}/${constants.FILES.FOLDER_CONFIG} not found, so skipping adding it to the collection`)
                }

                items.push(collection)

                // Recursively get files and folders inside this directory
                const nestedItems = await getCollection(idMap, workspace, fullPath)
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
        } catch (err) {
            // Given folder path does not exist
            if (err.code === 'ENOENT') {
                try {
                    await fs.mkdir(workspace.location)
                    const restfoxData = {
                        version: 1,
                        name: workspace.name,
                    }
                    await fs.writeFile(`${workspace.location}/${constants.FILES.WORKSPACE_CONFIG}`, JSON.stringify(restfoxData, null, 4))
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
            const restfoxData = {
                version: 1,
                name: workspace.name,
            }
            await fs.writeFile(`${workspace.location}/${constants.FILES.WORKSPACE_CONFIG}`, JSON.stringify(restfoxData, null, 4))
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
                name: fileName.replace('.json', ''),
                environment: envData,
            })
        } catch (err) {
            console.error(`Error reading environment file: ${fileName}`, err)
        }
    }

    return environments
}

async function saveEnvironments(envsDirPath, environments) {
    await fs.mkdir(envsDirPath, { recursive: true })

    const existingEnvironments = await fileUtils.readdirIgnoreError(envsDirPath)
    const environmentNames = environments.map((env) => `${env.name}.json`)

    for (const existingEnvironment of existingEnvironments) {
        if (!environmentNames.includes(existingEnvironment)) {
            // this means the environment was removed
            try {
                await fs.rm(path.join(envsDirPath, existingEnvironment), { force: true })
            } catch (err) {
                console.error(`Error removing environment file: ${existingEnvironment}`, err)
            }
        }
    }

    for (const env of environments) {
        try {
            await fs.writeFile(path.join(envsDirPath, `${env.name}.json`), JSON.stringify(env.environment, null, 4))
        } catch (err) {
            console.error(`Error writing environment file: ${env.name}.json`, err)
        }
    }
}

module.exports = {
    getCollection,
    ensureRestfoxCollection,
    getEnvironments,
    saveEnvironments,
}
