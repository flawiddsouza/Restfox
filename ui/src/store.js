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
    generateNewIdsForTreeItemChildren,
    isFirstIdIndirectOrDirectParentOfSecondIdInTree
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
            sidebarContextMenuElement: null,
            workspaces: [],
            activeWorkspace: null,
            plugins: []
        }
    },
    getters: {
        collectionTreeFiltered(state) {
            if(state.collectionFilter) {
                return filterTree(state.collectionTree, state.collectionFilter)
            }

            return state.collectionTree
        },
        enabledPlugins(state) {
            return state.plugins.filter(plugin => plugin.enabled)
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
            db.collections.where({ workspaceId: state.activeWorkspace._id }).delete()
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
            if('environment' in collectionItem) {
                await db.collections.update(collectionItem._id, { environment: JSON.parse(JSON.stringify(collectionItem.environment)) })
            }
        },
        async updateCollectionItemName(_state, collectionItem) {
            await db.collections.update(collectionItem._id, { name: collectionItem.name })
        },
        setWorkspaces(state, workspaces) {
            state.workspaces = workspaces
        },
        setActiveWorkspace(state, workspace) {
            state.activeWorkspace = workspace
        },
        async addPlugin(state, plugin) {
            const newPlugin = {
                _id: nanoid(),
                name: plugin.name,
                code: plugin.code,
                enabled: true,
                createdAt: new Date().getTime(),
                updatedAt: new Date().getTime()
            }
            await db.plugins.put(newPlugin)
            state.plugins.push(newPlugin)
        },
        async updatePlugin(state, plugin) {
            const updatePlugin = {
                name: plugin.name,
                code: plugin.code,
                updatedAt: new Date().getTime()
            }
            await db.plugins.update(plugin._id, updatePlugin)
            const foundPlugin = state.plugins.find(item => item._id === plugin._id)
            foundPlugin.name = updatePlugin.name
            foundPlugin.code = updatePlugin.code
            foundPlugin.updatedAt = updatePlugin.updatedAt
        },
        async updatePluginStatus(state, plugin) {
            await db.plugins.update(plugin._id, { enabled: plugin.enabled })
            const foundPlugin = state.plugins.find(item => item._id === plugin._id)
            foundPlugin.enabled = plugin.enabled
        },
        async deletePlugin(state, pluginId) {
            await db.plugins.where({ _id: pluginId }).delete()
            state.plugins = state.plugins.filter(plugin => plugin._id !== pluginId)
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
                    parentId: payload.parentId,
                    workspaceId: context.state.activeWorkspace._id
                }
            }

            if(payload.type === 'request_group') {
                newCollectionItem = {
                    _id: nanoid(),
                    _type: 'request_group',
                    name: payload.name,
                    children: [],
                    parentId: payload.parentId,
                    workspaceId: context.state.activeWorkspace._id
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
        },
        async reorderCollectionItem(context, payload) {
            if(payload.from.id === payload.to.id) { // don't allow an item to be dropped onto itself
                return
            }

            // don't allow an item to be dropped into its children
            if(isFirstIdIndirectOrDirectParentOfSecondIdInTree(context.state.collectionTree, payload.from.id, payload.to.id)) {
                return
            }

            let targetKey = 'parentId'
            if(payload.to.type === 'request_group' && payload.to.cursorPosition === 'bottom') { // dropping an item into a folder, bottom = pink highlight
                targetKey = 'id'
            }

            const sourceParentCollection = !payload.from.parentId ? context.state.collectionTree : findItemInTreeById(context.state.collectionTree, payload.from.parentId).children
            const targetParentCollection = !payload.to[targetKey] ? context.state.collectionTree : findItemInTreeById(context.state.collectionTree, payload.to[targetKey]).children

            let sourceIndex = sourceParentCollection.findIndex(item => item._id === payload.from.id)
            const sourceItem = sourceParentCollection[sourceIndex]
            sourceParentCollection.splice(sourceIndex, 1)
            sourceItem.parentId = payload.to[targetKey] ?? null

            let targetIndex = targetParentCollection.findIndex(item => item._id === payload.to.id)
            if(payload.to.type === 'request_group' && payload.to.cursorPosition === 'bottom') { // dropping an item into a folder, bottom = pink highlight
                targetIndex = 0
            }
            if(payload.to.type === 'request' && payload.to.cursorPosition === 'bottom') {
                targetIndex++
            }
            targetParentCollection.splice(targetIndex, 0, sourceItem)

            await db.collections.update(sourceItem._id, { parentId: sourceItem.parentId })

            targetParentCollection.forEach((item, index) => {
                item.sortOrder = index
                db.collections.update(item._id, { sortOrder: index })
            })
        },
        async loadPlugins(context) {
            const plugins = await db.plugins.toArray()
            context.state.plugins = plugins
        },
        async sendRequest(context, activeTab) {
            context.state.requestResponseStatus[activeTab._id] = 'loading'
            const parent = activeTab.parentId ? await db.collections.where({ ':id': activeTab.parentId }).first() : null
            let environment = {}
            if(parent) {
                environment = parent.environment ?? {}
            }
            context.state.requestResponses[activeTab._id] = await handleRequest(activeTab, environment, context.getters.enabledPlugins)
            context.state.requestResponseStatus[activeTab._id] = 'loaded'
        }
    }
})

export default store
