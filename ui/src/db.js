import Dexie from 'dexie'

export const db = new Dexie('Restfox')

db.version(2).stores({
    workspaces: '_id',
    collections: '_id, workspaceId'
})
