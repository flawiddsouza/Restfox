const fs = require('fs').promises
const path = require('path')

const idMap = new Map()

async function getCollection(workspace, dir = workspace.location) {
    let items = []

    try {
        const filesAndFolders = await fs.readdir(dir, { withFileTypes: true })

        for (let fileOrFolder of filesAndFolders) {
            const fullPath = path.join(dir, fileOrFolder.name)
            if (fileOrFolder.isDirectory()) {
                items.push({
                    _id: fullPath,
                    _type: 'request_group',
                    name: path.basename(fullPath),
                    parentId: dir === workspace.location ? null : dir,
                    children: [],
                    workspaceId: workspace._id,
                })
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
        console.error(`Error reading directory: ${dir}`, err)
    }

    return items
}

async function getCollectionForWorkspace(workspace, type) {
    console.log('getCollectionForWorkspace', {
        workspace,
        type,
    })

    const collection = await getCollection(workspace)

    // this is the only type filter that's required by the app
    if (type === 'request_group') {
        return collection.filter((item) => item._type === 'request_group')
    }

    console.log(collection)

    return collection
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

        await fs.writeFile(collectionPath, JSON.stringify(collection, null, 4))
        idMap.set(collectionId, collectionPath)
        console.log(`Created file: ${collectionPath}`)
    }
}

async function createCollections(workspace, collections) {
    console.log('createCollections', {
        workspace,
        collections,
    })

    for (const collection of collections) {
        await createCollection(collection)
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
        console.log(`Renamed ${renameFrom} to ${renameTo}`)
        return
    }

    if (Object.keys(updatedFields).length === 1 && 'parentId' in updatedFields) {
        const renameFrom = collectionPath
        let renameTo = `${updatedFields.parentId != null ? idMap.get(updatedFields.parentId) : workspace.location}/${path.basename(collectionPath)}`
        await fs.rename(renameFrom, renameTo)
        idMap.set(collectionId, renameTo)
        // if folder, we also need to update idMap with the new parent folder for all children inside this folder, else they'll have the old parent path in their id
        // and will error out when trying to update them
        const stats = await fs.stat(renameTo)
        if (stats.isDirectory()) {
            await updateIdMapForChildren(renameFrom, renameTo)
        }
        console.log(`Moved ${renameFrom} to ${renameTo}`)
        return
    }

    if (Object.keys(updatedFields).length === 1 && 'sortOrder' in updatedFields) {
        // if collectionPath is a directory, return, as we cannot update sortOrder for a directory
        const stats = await fs.stat(collectionPath)
        if (stats.isDirectory()) {
            return
        }

        const collectionExisting = JSON.parse(await fs.readFile(collectionPath, 'utf8'))

        const collectionUpdated = {
            ...collectionExisting,
            ...updatedFields,
        }

        await fs.writeFile(collectionPath, JSON.stringify(collectionUpdated, null, 4))
        console.log(`Updated sortOrder for ${collectionPath}`)
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
        await fs.rm(collectionPath, { recursive: true })
        idMap.delete(collectionId)
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
}
