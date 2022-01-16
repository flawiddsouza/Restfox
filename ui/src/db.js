import Dexie from 'dexie'

export const db = new Dexie('Restfox')

db.version(3).stores({
    workspaces: '_id',
    collections: '_id, workspaceId',
    plugins: '_id'
})
