import Dexie from 'dexie'

export const db = new Dexie('Restfox')

db.version(1).stores({
    collections: '_id'
})
