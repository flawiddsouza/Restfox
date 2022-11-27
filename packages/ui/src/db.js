import Dexie from 'dexie'
import 'dexie-export-import'

export const db = new Dexie('Restfox')

db.version(5).stores({
    workspaces: '_id',
    collections: '_id, workspaceId',
    plugins: '_id, workspaceId, collectionId',
    responses: '_id, collectionId'
})

export async function getCollectionForWorkspace(workspaceId, type = null) {
    let where = {
        workspaceId
    }

    if(type) {
        where._type = type
    }

    return db.collections.where(where).toArray()
}

export async function exportDB() {
    const blob = await db.export()
    return blob
}

export async function importDB(file) {
    await db.delete()
    await db.open()
    await db.import(file)
    document.location.reload()
}
