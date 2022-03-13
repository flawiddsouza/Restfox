import Dexie from 'dexie'

export const db = new Dexie('Restfox')

db.version(4).stores({
    workspaces: '_id',
    collections: '_id, workspaceId',
    plugins: '_id',
    responses: '_id, collectionId'
})

export async function getCollectionForWorkspace(workspaceId, type=null) {
    let where = {
        workspaceId
    }

    if(type) {
        where._type = type
    }

    return db.collections.where(where).toArray()
}
