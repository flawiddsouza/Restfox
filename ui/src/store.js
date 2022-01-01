import { createStore } from 'vuex'
import { nanoid } from 'nanoid'
import {
    toTree,
    flattenTree,
    handleRequest,
    filterTree,
    addSortOrderToTree,
    sortTree,
    removeFromTree,
    getChildIds,
    findItemInTreeById,
    generateNewIdsForTreeItemChildren
} from './helpers'
import { db } from './db'
import { nextTick } from 'vue'

const store = createStore({
    state() {
        return {
            collection: [],
            collectionTree: [],
            tabs: [],
            activeTab: null,
            requestResponseStatus: {},
            requestResponses: {},
            showImportModal: false,
            collectionFilter: '',
            activeSidebarItemForContextMenu: '',
            sidebarContextMenuElement: null
        }
    },
    getters: {
        collectionTreeFiltered(state) {
            if(state.collectionFilter) {
                return filterTree(state.collectionTree, state.collectionFilter)
            }

            return state.collectionTree
        }
    },
    mutations: {
        addTab(state, tab) {
            const existingTab = state.tabs.find(tabItem => tabItem._id === tab._id)
            if(!existingTab) {
                state.tabs.push(tab)
            }
            state.activeTab = tab
            nextTick(() => {
                const activeTabElement = document.querySelector(`.tabs-container > div[data-id="${tab._id}"]`)
                activeTabElement.scrollIntoView()
            })
        },
        setActiveTab(state, tab) {
            state.activeTab = tab
            if(state.activeTab._id in state.requestResponseStatus === false) {
                state.requestResponseStatus[state.activeTab._id] = 'pending'
                state.requestResponses[state.activeTab._id] = null
            }
        },
        closeTab(state, collectionItemId) {
            const tabIndex = state.tabs.findIndex(tabItem => tabItem._id === collectionItemId)

            if(tabIndex === -1) {
                return
            }

            const tabIndexLeft = tabIndex - 1

            if(state.activeTab && state.activeTab._id === collectionItemId) {
                delete state.requestResponseStatus[state.activeTab._id]
                delete state.requestResponses[state.activeTab._id]
                state.activeTab = tabIndexLeft >= 0 ? state.tabs[tabIndexLeft] : null
            }

            state.tabs.splice(tabIndex, 1)
        },
        async sendRequest(state, activeTab) {
            state.requestResponseStatus[activeTab._id] = 'loading'
            const parent = activeTab.parentId ? await db.collections.where({ ':id': activeTab.parentId }).first() : null
            let environment = {}
            if(parent) {
                environment = parent.environment ?? {}
            }
            state.requestResponses[activeTab._id] = await handleRequest(activeTab, environment)
            state.requestResponseStatus[activeTab._id] = 'loaded'
        },
        showImportModal(state, value) {
            state.showImportModal = value
        },
        setCollectionTree(state, collectionTree) {
            addSortOrderToTree(collectionTree)
            const flattenedCollectionTree = flattenTree(collectionTree)
            state.collection = state.collection.concat(flattenedCollectionTree)
            db.collections.bulkPut(flattenedCollectionTree)
            state.collectionTree = collectionTree
        },
        setCollection(state, collection) {
            state.collection = collection
            let collectionTree = toTree(state.collection)
            sortTree(collectionTree)
            state.collectionTree = collectionTree
        },
        clearCollection(state) {
            state.collection = []
            db.collections.clear()
            state.collectionTree = []
            state.activeTab = null
            state.tabs = []
        },
        setCollectionFilter(state, filter) {
            state.collectionFilter = filter
        },
        persistActiveTab(state) {
            if(state.activeTab) {
                db.collections.update(state.activeTab._id, JSON.parse(JSON.stringify(state.activeTab)))
            }
        },
        setActiveSidebarItemForContextMenu(state, payload) {
            state.activeSidebarItemForContextMenu = payload.sidebarItem
            state.sidebarContextMenuElement = payload.element
        },
        clearActiveSidebarItemForContextMenu(state) {
            state.activeSidebarItemForContextMenu = null
            state.sidebarContextMenuElement = null
        },
        async updateCollectionItemEnvironment(_state, collectionItem) {
            await db.collections.update(collectionItem._id, { environment: JSON.parse(JSON.stringify(collectionItem.environment)) })
        }
    },
    actions: {
        async deleteCollectionItem(context, collectionItem) {
            const childIds = getChildIds(context.state.collection, collectionItem._id)
            await db.collections.where(':id').anyOf(childIds).delete()
            await removeFromTree(context.state.collectionTree, '_id', collectionItem._id)
            childIds.forEach(childId => {
                context.commit('closeTab', childId)
            })
            context.state.collection = context.state.collection.filter(item => childIds.includes(item._id) === false)
        },
        async duplicateCollectionItem(context, collectionItem) {
            const newCollectionItem = JSON.parse(JSON.stringify(collectionItem))
            newCollectionItem._id = nanoid()

            if(collectionItem._type === 'request_group') {
                generateNewIdsForTreeItemChildren(newCollectionItem)
            }

            const collectionItemsToSave = flattenTree([newCollectionItem])
            await db.collections.bulkPut(collectionItemsToSave)
            context.state.collection = context.state.collection.concat(collectionItemsToSave)

            if(collectionItem.parentId) {
                let parentCollection = findItemInTreeById(context.state.collectionTree, collectionItem.parentId)
                const childIndex = parentCollection.children.findIndex(item => item._id === collectionItem._id)
                parentCollection.children.splice(childIndex, 0, newCollectionItem)
                // new sort order for new item and its siblings
                parentCollection.children.forEach((item, index) => {
                    item.sortOrder = index
                    db.collections.update(item._id, { sortOrder: index })
                })
            } else {
                const childIndex = context.state.collectionTree.findIndex(item => item._id === collectionItem._id)
                context.state.collectionTree.splice(childIndex, 0, newCollectionItem)
                // new sort order for new item and its siblings
                context.state.collectionTree.forEach((item, index) => {
                    item.sortOrder = index
                    db.collections.update(item._id, { sortOrder: index })
                })
            }
        },
        async createCollectionItem(context, payload) {
            let newCollectionItem = null

            if(payload.type === 'request') {
                newCollectionItem = {
                    _id: nanoid(),
                    _type: 'request',
                    name: payload.name,
                    method: payload.method,
                    body: {
                        mimeType: payload.mimeType
                    },
                    parentId: payload.parentId
                }
            }

            if(payload.type === 'request_group') {
                newCollectionItem = {
                    _id: nanoid(),
                    _type: 'request_group',
                    name: payload.name,
                    children: [],
                    parentId: payload.parentId
                }
            }

            await db.collections.put(newCollectionItem)
            context.state.collection.push(newCollectionItem)

            if(newCollectionItem.parentId) {
                let parentCollection = findItemInTreeById(context.state.collectionTree, newCollectionItem.parentId)
                parentCollection.children.splice(0, 0, newCollectionItem)
                // new sort order for new item and its siblings
                parentCollection.children.forEach((item, index) => {
                    item.sortOrder = index
                    db.collections.update(item._id, { sortOrder: index })
                })
            } else {
                context.state.collectionTree.splice(0, 0, newCollectionItem)
                // new sort order for new item and its siblings
                context.state.collectionTree.forEach((item, index) => {
                    item.sortOrder = index
                    db.collections.update(item._id, { sortOrder: index })
                })
            }

            if(payload.type === 'request') {
                context.commit('addTab', newCollectionItem)
            }
        }
    }
})

export default store
