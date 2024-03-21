import { toRaw } from 'vue'
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
    isFirstIdIndirectOrDirectParentOfSecondIdInTree,
    generateNewIdsForTree,
    substituteEnvironmentVariables,
    setEnvironmentVariable
} from './helpers'
import {
    getResponsesByCollectionId,
    getCollectionById,
    getCollectionForWorkspace,
    getAllWorkspaces,
    putWorkspace,
    updateWorkspace,
    deleteWorkspace,
    getAllCollectionIdsForGivenWorkspace,
    createCollection,
    createCollections,
    updateCollection,
    createResponse,
    updateResponse,
    deleteResponsesByCollectionIds,
    deleteResponsesByCollectionId,
    deleteResponse,
    deleteResponsesByIds,
    deletePluginsByWorkspace,
    deletePluginsByCollectionIds,
    modifyCollections,
    deleteCollectionsByWorkspaceId,
    getGlobalPlugins,
    getWorkspacePlugins,
    deleteCollectionsByIds,
    createPlugin,
    updatePlugin,
    deletePlugin,
    createPlugins,
} from './db'
import { nextTick } from 'vue'
import constants from './constants'
import { emitter } from './event-bus'
import {
    CollectionItem,
    Plugin,
    RequestParam,
    State,
    WorkspaceCache,
    Workspace,
} from './global'

async function loadResponses(state: State, tabId: string) {
    if(tabId in state.responses) {
        return
    }

    if(state.activeWorkspace === null) {
        throw new Error('activeWorkspace is null')
    }

    state.responses[tabId] = await getResponsesByCollectionId(state.activeWorkspace._id, tabId)
    if(state.responses[tabId].length > 0) {
        if((tabId in state.requestResponses) === false || (tabId in state.requestResponses && state.requestResponses[tabId] === null)) {
            state.requestResponses[tabId] = state.responses[tabId][0]
            state.requestResponseStatus[tabId] = 'loaded'
        }
    } else {
        state.requestResponses[tabId] = null
        state.requestResponseStatus[tabId] = 'pending'
    }
}

function setActiveTab(state: State, tab: CollectionItem, scrollSidebarItemIntoView = false, persistActiveWorkspaceTabsBool = true) {
    // skip setActiveTab as it's already the active tab
    if(state.activeTab && state.activeTab._id === tab._id) {
        return
    }
    // console.log('setActiveTab', tab._id)
    state.activeTab = tab
    loadResponses(state, tab._id)
    if(scrollSidebarItemIntoView) {
        if(tab.parentId) {
            let currentParentId: string | null | undefined = tab.parentId
            while (currentParentId) {
                const parentFolder = findItemInTreeById(state.collectionTree, currentParentId)
                if(parentFolder && parentFolder.collapsed) {
                    parentFolder.collapsed = false
                    store.dispatch('saveCollectionItemCollapsedState', { _id: parentFolder._id, collapsed: parentFolder.collapsed })
                    console.log(`parent folder ${parentFolder.name} was collapsed and has been auto expanded`)
                }
                currentParentId = parentFolder?.parentId
            }
        }
        nextTick(() => {
            const activeSidebarElement = document.querySelector(`.sidebar-list-container div[data-id="${tab._id}"]`)
            if(activeSidebarElement) {
                activeSidebarElement.scrollIntoView({
                    behavior: 'auto',
                    block: 'center',
                    inline: 'center'
                })
            }

            // also scroll active tab element into view
            const activeTabElement = document.querySelector(`.tabs-container > div[data-id="${tab._id}"]`)
            activeTabElement?.scrollIntoView()
        })
    }

    if(persistActiveWorkspaceTabsBool) {
        persistActiveWorkspaceTabs(state)
    }
}

async function getAllParents(workspaceId: string, parentArray: CollectionItem[], request: CollectionItem) {
    if(!request.parentId) {
        return
    }
    const requestParent = await getCollectionById(workspaceId, request.parentId)
    if(requestParent) {
        parentArray.push(requestParent)
        await getAllParents(workspaceId, parentArray, requestParent)
    }
}

async function getEnvironmentForRequest(requestWorkspace: Workspace, requestParentArray: CollectionItem[]) {
    const environment = requestWorkspace.environment ? JSON.parse(JSON.stringify(requestWorkspace.environment)) : {}

    for(const parent of requestParentArray) {
        if(parent.environment) {
            let tempEnvironment = JSON.stringify(parent.environment)
            tempEnvironment = substituteEnvironmentVariables(environment, tempEnvironment)
            tempEnvironment = JSON.parse(tempEnvironment)
            Object.assign(environment, tempEnvironment)
        }
    }

    return environment
}

const workspaceCache: WorkspaceCache = {
    tabs: {},
    activeTab: {}
}

async function loadWorkspaceTabs(state: State) {
    if(state.activeWorkspace === null) {
        throw new Error('activeWorkspace is null')
    }

    const workspaceId = state.activeWorkspace._id

    // we always reset the cache for file workspaces
    // as we don't want to load outdated data for tabs
    // if the files for the tabs have changed meanwhile
    if(state.activeWorkspace._type === 'file') {
        delete workspaceCache.tabs[workspaceId]
    }

    if(workspaceId in workspaceCache.tabs) {
        state.tabs = workspaceCache.tabs[workspaceId]
        if(workspaceCache.activeTab[workspaceId]) {
            setActiveTab(state, workspaceCache.activeTab[workspaceId] as CollectionItem, true, false)
        } else {
            state.activeTab = null
        }
        return
    }

    const originalTabIds = state.activeWorkspace.tabIds ?? []
    const tabIds: string[] = []

    const idMap = state.idMap
    let activeTabId: string | null = null

    if(idMap !== null) {
        originalTabIds.forEach(tabId => {
            const retrievedTabId = idMap.get(tabId)
            if(retrievedTabId) {
                tabIds.push(retrievedTabId)
            }
        })
        if(state.activeWorkspace.activeTabId) {
            activeTabId = idMap.get(state.activeWorkspace.activeTabId) ?? null
        }
    } else {
        tabIds.push(...originalTabIds)
        activeTabId = state.activeWorkspace.activeTabId ?? null
    }

    const tabIdsOrder: { [tabId: string]: number } = {}

    // to restore tab ordering
    tabIds.forEach((tabId, index) => {
        tabIdsOrder[tabId] = index
    })

    workspaceCache.tabs[workspaceId] = state.collection.filter(collectionItem => tabIds.includes(collectionItem._id)).sort((a, b) => tabIdsOrder[a._id] - tabIdsOrder[b._id])

    let activeTab = workspaceCache.tabs[workspaceId].find(tab => tab._id === activeTabId)
    if(activeTab === undefined) {
        if(workspaceCache.tabs[workspaceId].length > 0) {
            activeTab = workspaceCache.tabs[workspaceId][0]
        }
    }
    workspaceCache.activeTab[workspaceId] =  activeTab ?? null

    state.tabs = workspaceCache.tabs[workspaceId]
    state.activeTab = null

    if(workspaceCache.activeTab[workspaceId]) {
        setActiveTab(state, workspaceCache.activeTab[workspaceId] as CollectionItem, true, false)
    }
}

// Called when
// - Tab added
// - Tab made active / switched to
// - Tab closed
// - Tab reordered
async function persistActiveWorkspaceTabs(state: State) {
    if(state.activeWorkspace === null) {
        throw new Error('activeWorkspace is null')
    }

    workspaceCache.tabs[state.activeWorkspace._id] = state.tabs
    workspaceCache.activeTab[state.activeWorkspace._id] = state.activeTab

    const tabIds = state.tabs.map(tab => tab._id)
    const activeTabId = state.activeTab ? state.activeTab._id : null

    // persist to already loaded workspace state
    state.activeWorkspace.tabIds = tabIds
    state.activeWorkspace.activeTabId = activeTabId

    // persist to db
    await updateWorkspace(state.activeWorkspace._id, {
        tabIds,
        activeTabId
    })

    console.log('persistActiveWorkspaceTabs', {
        tabIds,
        activeTabId
    })
}

const store = createStore<State>({
    state() {
        return {
            collection: [],
            collectionTree: [],
            tabs: [],
            activeTab: null,
            requestResponseStatus: {},
            requestResponses: {},
            requestAbortController: {},
            responses: {},
            showImportModal: false,
            showImportModalSelectedRequestGroupId: null,
            showBackupAndRestoreModal: false,
            collectionFilter: '',
            activeSidebarItemForContextMenu: '',
            sidebarContextMenuElement: null,
            workspaces: [],
            activeWorkspace: null,
            activeWorkspaceLoaded: false,
            plugins: {
                global: [],
                workspace: [],
            },
            requestResponseLayout: 'left-right',
            theme: 'light',
            githubStarCount: '0',
            sidebarItemTemporaryName: {},
            flags: {
                hideBrowserRelatedResponsePanelErrors: false,
                browserExtensionEnabled: false,
                isBrowser: true,
                isElectron: false,
                disableSSLVerification: false,
                electronSwitchToChromiumFetch: false,
            },
            openContextMenuElement: null,
            sockets: {},
            activeTabEnvironmentResolved: {},
            idMap: null,
            skipPersistingActiveTab: false,
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
            return [...state.plugins.global, ...state.plugins.workspace].filter(plugin => plugin.enabled)
        }
    },
    mutations: {
        addTab(state, tab) {
            const id = tab._id

            const existingTab = state.tabs.find(tabItem => tabItem._id === id)

            if(!existingTab) {
                const tabCopy = JSON.parse(JSON.stringify(tab))

                if('body' in tab) {
                    if('params' in tab.body) {
                        const params: RequestParam[] = []
                        for(const param of tab.body.params) {
                            const paramExtracted = {...param}
                            if('files' in paramExtracted) {
                                paramExtracted.files = [...paramExtracted.files]
                            }
                            params.push(paramExtracted)
                        }
                        tabCopy.body.params = params
                    }

                    if('fileName' in tab.body) {
                        tabCopy.body.fileName = tab.body.fileName
                    }
                }
                state.tabs.push(tabCopy)
                setActiveTab(state, tabCopy)
            } else {
                setActiveTab(state, existingTab)
            }

            nextTick(() => {
                const activeTabElement = document.querySelector(`.tabs-container > div[data-id="${id}"]`)
                activeTabElement?.scrollIntoView()
            })
        },
        setActiveTab(state, tab) {
            setActiveTab(state, tab, true)
        },
        closeTab(state, collectionItemId) {
            const tabIndex = state.tabs.findIndex(tabItem => tabItem._id === collectionItemId)

            if(tabIndex === -1) {
                return
            }

            const tabIndexLeft = tabIndex - 1
            const tabIndexRight = tabIndex + 1

            if(state.activeTab && state.activeTab._id === collectionItemId) {
                state.activeTab = tabIndexLeft >= 0 ? state.tabs[tabIndexLeft] : (tabIndexRight <= state.tabs.length - 1 ? state.tabs[tabIndexRight] : null)
            }

            state.tabs.splice(tabIndex, 1)

            // remove socket instances for a tab when a tab is closed
            Object.keys(state.sockets).filter(key => key.startsWith(collectionItemId)).forEach(key => {
                delete state.sockets[key]
            })
        },
        closeAllTabs(state) {
            state.activeTab = null
            state.tabs = []
            persistActiveWorkspaceTabs(state)
        },
        showImportModal(state, value) {
            state.showImportModal = value
        },
        showImportModalSelectedRequestGroupId(state, value) {
            state.showImportModalSelectedRequestGroupId = value
        },
        showBackupAndRestoreModal(state, value) {
            state.showBackupAndRestoreModal = value
        },
        setCollection(state, collection) {
            state.collection = collection
            const collectionTree = toTree(state.collection)
            sortTree(collectionTree)
            state.collectionTree = collectionTree
        },
        setCollectionFilter(state, filter) {
            state.collectionFilter = filter
        },
        persistActiveTab(state) {
            if(state.activeTab) {
                if(state.skipPersistingActiveTab) {
                    console.log('persistActiveTab: skipPersistingActiveTab is true, so skipping')
                    state.skipPersistingActiveTab = false
                    return
                }

                console.log('persistActiveTab: skipPersistingActiveTab is false, so persisting')

                const activeTabToSaveJSON = JSON.stringify(state.activeTab)
                const activeTabToSave = JSON.parse(activeTabToSaveJSON)

                if('body' in state.activeTab && 'params' in state.activeTab.body) {
                    const params: RequestParam[] = []
                    for(const param of state.activeTab.body.params) {
                        const paramExtracted = {...param}
                        if('files' in paramExtracted) {
                            paramExtracted.files = [...paramExtracted.files].filter(file => file instanceof File)
                        }
                        params.push(paramExtracted)
                    }
                    activeTabToSave.body.params = params
                }

                if('body' in state.activeTab && 'fileName' in state.activeTab.body) {
                    activeTabToSave.body.fileName = toRaw(state.activeTab.body.fileName)
                }

                updateCollection(state.activeTab.workspaceId, state.activeTab._id, activeTabToSave)
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
        async updateCollectionItemEnvironment(state, { collectionId, environment }) {
            if(environment) {
                if(state.activeWorkspace === null) {
                    throw new Error('activeWorkspace is null')
                }

                await updateCollection(state.activeWorkspace._id, collectionId, { environment: JSON.parse(JSON.stringify(environment)) })
            }
        },
        async updateWorkspaceEnvironment(_state, { workspaceId, environment }) {
            if(environment) {
                await updateWorkspace(workspaceId, { environment: JSON.parse(JSON.stringify(environment)) })
            }
        },
        async updateCollectionItemEnvironments(state, { collectionId, environments }) {
            if(environments) {
                if(state.activeWorkspace === null) {
                    throw new Error('activeWorkspace is null')
                }

                await updateCollection(state.activeWorkspace._id, collectionId, { environments: JSON.parse(JSON.stringify(environments)) })
            }
        },
        async updateWorkspaceEnvironments(_state, { workspaceId, environments }) {
            if(environments) {
                await updateWorkspace(workspaceId, { environments: JSON.parse(JSON.stringify(environments)) })
            }
        },
        async updateCollectionItemCurrentEnvironment(state, { collectionId, currentEnvironment }) {
            if(currentEnvironment) {
                if(state.activeWorkspace === null) {
                    throw new Error('activeWorkspace is null')
                }

                await updateCollection(state.activeWorkspace._id, collectionId, { currentEnvironment: currentEnvironment })
            }
        },
        async updateWorkspaceCurrentEnvironment(_state, { workspaceId, currentEnvironment }) {
            if(currentEnvironment) {
                await updateWorkspace(workspaceId, { currentEnvironment: currentEnvironment })
            }
        },
        setWorkspaces(state, workspaces) {
            state.workspaces = workspaces
        },
        async setActiveWorkspace(state, workspace) {
            state.activeWorkspace = workspace
            if(workspace === null) {
                state.tabs = []
                state.activeTab = null
                state.plugins.workspace = []
            }
        },
        async loadWorkspacePlugins(state, workspaceId) {
            state.plugins.workspace = await getWorkspacePlugins(workspaceId)
        },
        async addPlugin(state, plugin) {
            const newPlugin = {
                _id: nanoid(),
                name: plugin.name,
                code: plugin.code,
                workspaceId: plugin.workspaceId,
                collectionId: plugin.collectionId,
                enabled: true,
                createdAt: new Date().getTime(),
                updatedAt: new Date().getTime()
            }


            if(newPlugin.workspaceId === null && newPlugin.collectionId === null) {
                await createPlugin(newPlugin)
                state.plugins.global.push(newPlugin)
            } else {
                if(state.activeWorkspace === null) {
                    throw new Error('activeWorkspace is null')
                }

                await createPlugin(newPlugin, state.activeWorkspace._id)
                state.plugins.workspace.push(newPlugin)
            }
        },
        async updatePlugin(state, plugin) {
            const updatePluginData = {
                name: plugin.name,
                code: plugin.code,
                workspaceId: plugin.workspaceId,
                updatedAt: new Date().getTime()
            }

            const foundPlugin = [...state.plugins.global, ...state.plugins.workspace].find(item => item._id === plugin._id)

            if(foundPlugin.workspaceId === null && foundPlugin.collectionId === null) {
                await updatePlugin(plugin._id, updatePluginData)
            } else {
                if(state.activeWorkspace === null) {
                    throw new Error('activeWorkspace is null')
                }

                await updatePlugin(plugin._id, updatePluginData, state.activeWorkspace._id, foundPlugin.collectionId ?? null)
            }

            foundPlugin.name = updatePluginData.name
            foundPlugin.code = updatePluginData.code
            foundPlugin.workspaceId = updatePluginData.workspaceId
            foundPlugin.updatedAt = updatePluginData.updatedAt
        },
        async updatePluginStatus(state, plugin) {
            const foundPlugin = [...state.plugins.global, ...state.plugins.workspace].find(item => item._id === plugin._id)

            if(foundPlugin.workspaceId === null && foundPlugin.collectionId === null) {
                await updatePlugin(plugin._id, { enabled: plugin.enabled })
            } else {
                if(state.activeWorkspace === null) {
                    throw new Error('activeWorkspace is null')
                }

                await updatePlugin(plugin._id, { enabled: plugin.enabled }, state.activeWorkspace._id, foundPlugin.collectionId ?? null)
            }

            foundPlugin.enabled = plugin.enabled
        },
        async deletePlugin(state, pluginId) {
            const foundPlugin = [...state.plugins.global, ...state.plugins.workspace].find(item => item._id === pluginId)

            if(foundPlugin.workspaceId === null && foundPlugin.collectionId === null) {
                await deletePlugin(pluginId)
                state.plugins.global = state.plugins.global.filter(plugin => plugin._id !== pluginId)
            } else {
                if(state.activeWorkspace === null) {
                    throw new Error('activeWorkspace is null')
                }

                await deletePlugin(pluginId, state.activeWorkspace._id, foundPlugin.collectionId ?? null)
                state.plugins.workspace = state.plugins.workspace.filter(plugin => plugin._id !== pluginId)
            }
        },
        async saveResponse(state, response) {
            if(response._id) {
                const responseToSave = structuredClone(toRaw(response))
                state.responses[state.activeTab._id].unshift(responseToSave)
                if(state.responses[state.activeTab._id].length > constants.DEFAULT_LIMITS.RESPONSE_HISTORY) {
                    const responsesToDelete = state.responses[state.activeTab._id].splice(constants.DEFAULT_LIMITS.RESPONSE_HISTORY)
                    const responseIdsToDelete = responsesToDelete.map(responseItem => responseItem._id)
                    await deleteResponsesByIds(state.activeTab.workspaceId, responsesToDelete[0].collectionId, responseIdsToDelete)
                }
                await createResponse(state.activeTab.workspaceId, structuredClone(responseToSave))
            }
        },
        async clearResponseHistory(state) {
            await deleteResponsesByCollectionId(state.activeTab.workspaceId, state.activeTab._id)
            state.responses[state.activeTab._id] = []
            state.requestResponses[state.activeTab._id] = null
            state.requestResponseStatus[state.activeTab._id] = 'pending'
        },
        async renameCurrentlyActiveResponse(state, newResponseName) {
            const activeResponse = state.requestResponses[state.activeTab._id]
            activeResponse.name = newResponseName !== '' ? newResponseName : null
            await updateResponse(state.activeTab.workspaceId, activeResponse.collectionId, activeResponse._id, { name: activeResponse.name })
        },
        async deleteCurrentlyActiveResponse(state) {
            const responseToDelete = state.requestResponses[state.activeTab._id]
            await deleteResponse(state.activeTab.workspaceId, responseToDelete.collectionId, responseToDelete._id)
            state.responses[state.activeTab._id] = state.responses[state.activeTab._id].filter(response => response._id !== responseToDelete._id)
            if(state.responses[state.activeTab._id].length > 0) {
                state.requestResponses[state.activeTab._id] = state.responses[state.activeTab._id][0]
                state.requestResponseStatus[state.activeTab._id] = 'loaded'
            } else {
                state.requestResponses[state.activeTab._id] = null
                state.requestResponseStatus[state.activeTab._id] = 'pending'
            }
        },
        persistActiveWorkspaceTabs(state) {
            persistActiveWorkspaceTabs(state)
        },
        loadWorkspaceTabs(state) {
            if(state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            loadWorkspaceTabs(state)
        }
    },
    actions: {
        async deleteCollectionItem(context, collectionItem) {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            const childIds = getChildIds(context.state.collection, collectionItem._id)
            await deleteResponsesByCollectionIds(collectionItem.workspaceId, childIds)
            await deletePluginsByCollectionIds(collectionItem.workspaceId, childIds)
            context.state.plugins.workspace = context.state.plugins.workspace.filter(plugin => childIds.includes(plugin.collectionId) === false)

            const result = await deleteCollectionsByIds(context.state.activeWorkspace._id, childIds)

            if(result.error) {
                emitter.emit('error', result.error)
                return
            }

            removeFromTree(context.state.collectionTree, '_id', collectionItem._id)

            childIds.forEach(childId => {
                context.commit('closeTab', childId)
                // clear unneeded response cache
                if(childId in context.state.responses) {
                    delete context.state.responses[childId]
                    delete context.state.requestResponses[childId]
                    delete context.state.requestResponseStatus[childId]
                }
            })
            context.state.collection = context.state.collection.filter(item => childIds.includes(item._id) === false)

            if(collectionItem._type === 'request_group') {
                emitter.emit('request_group', 'deleted')
            }

            if(childIds.length > 0) {
                persistActiveWorkspaceTabs(context.state)
            }
        },
        async duplicateCollectionItem(context, collectionItem) {
            const newCollectionItem = JSON.parse(JSON.stringify(collectionItem))
            newCollectionItem._id = nanoid()

            if(collectionItem._type === 'request_group') {
                generateNewIdsForTreeItemChildren(newCollectionItem)
            }

            const collectionItemsToSave = flattenTree([newCollectionItem])
            const result = await createCollections(collectionItem.workspaceId, collectionItemsToSave)

            if(result.error) {
                emitter.emit('error', result.error)
                return result
            }

            context.state.collection = context.state.collection.concat(collectionItemsToSave)

            if(collectionItem.parentId) {
                const parentCollection = findItemInTreeById(context.state.collectionTree, collectionItem.parentId)
                if(parentCollection === null) {
                    throw new Error('Parent collection not found')
                }
                if(parentCollection.children === undefined) {
                    throw new Error('Parent collection children not found')
                }
                const childIndex = parentCollection.children.findIndex(item => item._id === collectionItem._id)
                parentCollection.children.splice(childIndex + 1, 0, newCollectionItem)
                // new sort order for new item and its siblings
                parentCollection.children.forEach((item, index) => {
                    item.sortOrder = index
                    updateCollection(item.workspaceId, item._id, { sortOrder: index })
                })
            } else {
                const childIndex = context.state.collectionTree.findIndex(item => item._id === collectionItem._id)
                context.state.collectionTree.splice(childIndex + 1, 0, newCollectionItem)
                // new sort order for new item and its siblings
                context.state.collectionTree.forEach((item, index) => {
                    item.sortOrder = index
                    updateCollection(item.workspaceId, item._id, { sortOrder: index })
                })
            }

            if(newCollectionItem._type === 'request' || newCollectionItem._type === 'socket') {
                context.commit('addTab', newCollectionItem)
            }

            if(newCollectionItem._type === 'request_group') {
                emitter.emit('request_group', 'added')
            }

            return result
        },
        async createCollectionItem(context, payload) {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            let newCollectionItem: CollectionItem | null = null

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

            if(payload.type === 'socket') {
                newCollectionItem = {
                    _id: nanoid(),
                    _type: 'socket',
                    name: payload.name,
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

            if (newCollectionItem === null) {
                throw new Error('Invalid collection item type')
            }

            const result = await createCollection(context.state.activeWorkspace._id, newCollectionItem)

            if(result.error) {
                emitter.emit('error', result.error)
                return result
            }

            if(result.newCollectionId) {
                newCollectionItem._id = result.newCollectionId
            }

            context.state.collection.push(newCollectionItem)

            if(newCollectionItem.parentId) {
                const parentCollection = findItemInTreeById(context.state.collectionTree, newCollectionItem.parentId)
                if(parentCollection === null) {
                    throw new Error('Parent collection not found')
                }
                if(parentCollection.children === undefined) {
                    throw new Error('Parent collection children not found')
                }
                parentCollection.children.splice(0, 0, newCollectionItem)
                // new sort order for new item and its siblings
                parentCollection.children.forEach((item, index) => {
                    item.sortOrder = index
                    updateCollection(item.workspaceId, item._id, { sortOrder: index })
                })
            } else {
                context.state.collectionTree.splice(0, 0, newCollectionItem)
                // new sort order for new item and its siblings
                context.state.collectionTree.forEach((item, index) => {
                    item.sortOrder = index
                    updateCollection(item.workspaceId, item._id, { sortOrder: index })
                })
            }

            if(payload.type === 'request' || payload.type === 'socket') {
                context.commit('addTab', newCollectionItem)
            }

            if(payload.type === 'request_group') {
                emitter.emit('request_group', 'added')
            }

            return result
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

            let sourceParentCollection = !payload.from.parentId ? context.state.collectionTree : findItemInTreeById(context.state.collectionTree, payload.from.parentId)?.children
            let targetParentCollection = !payload.to[targetKey] ? context.state.collectionTree : findItemInTreeById(context.state.collectionTree, payload.to[targetKey])?.children

            if(context.state.activeWorkspace?._type === 'file') {
                if(sourceParentCollection === targetParentCollection) {
                    sourceParentCollection = structuredClone(toRaw(sourceParentCollection)?.map(item => toRaw(item)))
                    // we do this because when we move an item within the same parent,
                    // if both variables don't reference the same array, the item will get doubled in
                    // 2nd array - since we only splice 1 the item from the first array
                    // causing sortOrder update to have duplicates for the reordered item
                    targetParentCollection = sourceParentCollection
                } else {
                    sourceParentCollection = structuredClone(toRaw(sourceParentCollection)?.map(item => toRaw(item)))
                    targetParentCollection = structuredClone(toRaw(targetParentCollection)?.map(item => toRaw(item)))
                }
            }

            if (!sourceParentCollection || !targetParentCollection) {
                throw new Error('Source or target parent collection not found')
            }

            const sourceIndex = sourceParentCollection.findIndex(item => item._id === payload.from.id)
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

            const result = await updateCollection(sourceItem.workspaceId, sourceItem._id, { parentId: sourceItem.parentId })

            if(result.error) {
                emitter.emit('error', result.error)
                return
            }

            const sortOrderUpdates: Promise<{ error: string | null }>[] = []

            targetParentCollection.forEach((item, index) => {
                item.sortOrder = index
                sortOrderUpdates.push(updateCollection(item.workspaceId, item._id, { sortOrder: index }))
            })

            await Promise.all(sortOrderUpdates)

            if(context.state.activeWorkspace?._type === 'file') {
                context.dispatch('refreshWorkspace')
            }
        },
        async loadGlobalPlugins(context) {
            context.state.plugins.global = await getGlobalPlugins()
        },
        async getEnvironmentForRequest(context, request): Promise<{ environment: any, requestParentArray: CollectionItem[] }> {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            let requestParentArray: CollectionItem[] = []
            await getAllParents(context.state.activeWorkspace._id, requestParentArray, request)
            requestParentArray = requestParentArray.reverse()

            const environment = await getEnvironmentForRequest(context.state.activeWorkspace, requestParentArray)

            return { environment, requestParentArray }
        },
        async sendRequest(context, activeTab) {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            context.state.requestResponseStatus[activeTab._id] = 'loading'

            const { environment, requestParentArray }: { environment: any, requestParentArray: CollectionItem[] } = await context.dispatch('getEnvironmentForRequest', activeTab)

            const setEnvironmentVariableWrapper = (objectPath: string, value: string) => {
                setEnvironmentVariable(context, objectPath, value)
            }

            const globalPlugins: Plugin[] = []
            const workspacePlugins: Plugin[] = []
            const requestGroupPlugins: Plugin[] = []
            const requestPlugins: Plugin[] = [];

            (context.getters.enabledPlugins as Plugin[]).forEach(enabledPlugin => {
                if(!enabledPlugin.workspaceId && !enabledPlugin.collectionId) {
                    globalPlugins.push(enabledPlugin)
                }

                if(context.state.activeWorkspace !== null && enabledPlugin.workspaceId === context.state.activeWorkspace._id) {
                    workspacePlugins.push(enabledPlugin)
                }

                if(enabledPlugin.collectionId !== null && requestParentArray.map(collectionItem => collectionItem._id).includes(enabledPlugin.collectionId)) {
                    requestGroupPlugins.push(enabledPlugin)
                }

                if(enabledPlugin.collectionId === activeTab._id) {
                    requestPlugins.push(enabledPlugin)
                }
            })

            const enabledPlugins = [
                ...globalPlugins,
                ...workspacePlugins,
                ...requestGroupPlugins,
                ...requestPlugins
            ]

            context.state.requestAbortController[activeTab._id] = new AbortController()
            const response = await handleRequest(activeTab, environment, setEnvironmentVariableWrapper, enabledPlugins, context.state.requestAbortController[activeTab._id].signal, context.state.flags)
            context.commit('saveResponse', response)
            context.state.requestResponses[activeTab._id] = response
            context.state.requestResponseStatus[activeTab._id] = 'loaded'
        },
        async createWorkspace(context, payload) {
            const newWorkspaceId = nanoid()

            const newWorkspace = {
                _id: newWorkspaceId,
                name: payload.name,
                _type: payload._type,
                location: payload.location,
                createdAt: new Date().getTime(),
                updatedAt: new Date().getTime()
            }

            await putWorkspace(newWorkspace)

            context.state.workspaces.unshift(newWorkspace)

            if(payload.setAsActive) {
                context.commit('setActiveWorkspace', newWorkspace)
            }

            return newWorkspaceId
        },
        async updateWorkspace(context, payload) {
            const workspace = context.state.workspaces.find(item => item._id === payload._id)

            if(!workspace) {
                throw new Error('Workspace not found')
            }

            const updatedAt = new Date().getTime()
            await updateWorkspace(payload._id, {
                name: payload.name,
                location: payload.location,
                updatedAt
            })
            workspace.name = payload.name
            workspace.location = payload.location
            workspace.updatedAt = updatedAt
            context.state.workspaces.sort((a, b) => b.updatedAt - a.updatedAt)
        },
        async deleteWorkspace(context, workspaceId) {
            const collectionIds = await getAllCollectionIdsForGivenWorkspace(workspaceId)
            await deleteResponsesByCollectionIds(workspaceId, collectionIds)
            await deletePluginsByCollectionIds(workspaceId, collectionIds)
            context.state.plugins.workspace = context.state.plugins.workspace.filter(plugin => collectionIds.includes(plugin.collectionId) === false)
            await deletePluginsByWorkspace(workspaceId)
            context.state.plugins.workspace = context.state.plugins.workspace.filter(plugin => plugin.workspaceId !== workspaceId)
            await deleteCollectionsByWorkspaceId(workspaceId)
            await deleteWorkspace(workspaceId)
            context.state.workspaces = context.state.workspaces.filter(item => item._id !== workspaceId)
            collectionIds.forEach(collectionId => {
                context.commit('closeTab', collectionId)
            })
        },
        async closeWorkspace(context, workspaceId) {
            const collectionIds = await getAllCollectionIdsForGivenWorkspace(workspaceId)
            collectionIds.forEach(collectionId => {
                context.commit('closeTab', collectionId)
            })
            await deleteWorkspace(workspaceId)
            context.state.workspaces = context.state.workspaces.filter(item => item._id !== workspaceId)
        },
        async loadWorkspaces(context, noActiveWorkspaceCallback = null) {
            const workspaces = await getAllWorkspaces()

            if(workspaces.length > 0) {
                context.commit('setWorkspaces', workspaces)

                const activeWorkspaceId = localStorage.getItem(constants.LOCAL_STORAGE_KEY.ACTIVE_WORKSPACE_ID)
                if(activeWorkspaceId) {
                    const activeWorkspace = workspaces.find(item => item._id === activeWorkspaceId)
                    if(activeWorkspace) {
                        context.commit('setActiveWorkspace', activeWorkspace)
                    }
                } else {
                    if (noActiveWorkspaceCallback) {
                        noActiveWorkspaceCallback()
                    }
                }
            } else {
                await context.dispatch('createWorkspace', {
                    name: 'My Collection',
                    setAsActive: true
                })

                if (context.state.activeWorkspace === null) {
                    throw new Error('activeWorkspace is null')
                }

                // update pre-existing collections with a default workspaceId, so as to not break
                // collections created before the introduction of workspaces
                await modifyCollections(context.state.activeWorkspace._id)
            }
        },
        async saveCollectionItemCollapsedState(context, payload) {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }
            await updateCollection(context.state.activeWorkspace._id, payload._id, { collapsed: payload.collapsed })
        },
        async duplicateWorkspace(context, workspace) {
            const newWorkspaceId = await context.dispatch('createWorkspace', {
                name: workspace.name
            })
            const { collection: workspaceCollectionItems } = await getCollectionForWorkspace(workspace.sourceWorkspaceId)
            workspaceCollectionItems.forEach(collectionItem => {
                collectionItem.workspaceId = newWorkspaceId
            })
            const collectionTree = toTree(workspaceCollectionItems)
            generateNewIdsForTree(collectionTree)
            await createCollections(newWorkspaceId, flattenTree(collectionTree))
        },
        async setCollectionTree(context, { collectionTree, parentId = null, plugins = [] }: { collectionTree: CollectionItem[], parentId: string | null, plugins: Plugin[] }) {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            if(parentId) {
                const parentCollection = findItemInTreeById(context.state.collectionTree, parentId)
                if(parentCollection === null) {
                    throw new Error('Parent collection not found')
                }
                if(parentCollection.children === undefined) {
                    throw new Error('Parent collection children not found')
                }
                collectionTree = parentCollection.children.concat(collectionTree)
            } else {
                collectionTree = context.state.collectionTree.concat(collectionTree)
            }

            addSortOrderToTree(collectionTree)

            const flattenedCollectionTree = JSON.parse(JSON.stringify(flattenTree(collectionTree)))
            const result = await createCollections(context.state.activeWorkspace._id, flattenedCollectionTree)

            if(result.error) {
                emitter.emit('error', result.error)
                return result
            }

            if (plugins.length > 0) {
                // assign new ids to the imported / duplicated plugins
                // else the original request & request folders where the
                // plugins were exported from will lose their plugins
                // also update timestamps
                plugins.forEach(plugin => {
                    plugin._id = nanoid()
                    plugin.createdAt = new Date().getTime()
                    plugin.updatedAt = new Date().getTime()
                })
                await createPlugins(plugins, context.state.activeWorkspace._id)
                context.state.plugins.workspace.push(...plugins)
            }

            const { collection } = await getCollectionForWorkspace(context.state.activeWorkspace._id)

            context.commit('setCollection', collection)

            return result
        },
        async updateActiveTabEnvironmentResolved(context) {
            if(!context.state.activeTab) {
                // console.warn('updateActiveTabEnvironmentResolved called without an active tab')
                return
            }
            const { environment } = await context.dispatch('getEnvironmentForRequest', context.state.activeTab)
            context.state.activeTabEnvironmentResolved = environment
        },
        async refreshWorkspaceCollection(context) {
            console.log('refreshWorkspaceCollection')

            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            const { collection, idMap } = await getCollectionForWorkspace(context.state.activeWorkspace._id)
            context.commit('setCollection', collection)
            context.state.idMap = idMap
        },
        async refreshWorkspaceTabs(context) {
            console.log('refreshWorkspaceTabs')

            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            context.state.skipPersistingActiveTab = true
            loadWorkspaceTabs(context.state)

            context.commit('persistActiveWorkspaceTabs')
        },
        async refreshWorkspace(context) {
            await context.dispatch('refreshWorkspaceCollection')
            await context.dispatch('refreshWorkspaceTabs')
        },
        async updateCollectionItemName(context, collectionItem) {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            const result = await updateCollection(context.state.activeWorkspace._id, collectionItem._id, { name: collectionItem.name })

            if(result.error) {
                emitter.emit('error', result.error)
                return result
            }

            if(context.state.activeWorkspace._type === 'file') {
                context.dispatch('refreshWorkspace')
            }

            if(collectionItem._type === 'request_group') {
                emitter.emit('request_group', 'renamed')
            }

            return result
        },
        async updateCollectionItemNameAndParentId(context, { collectionId, name, parentId }) {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            if(context.state.activeWorkspace._type === 'file') {
                // we split the operations, as the file workspace does not support updating name & parentId together
                const result = await updateCollection(context.state.activeWorkspace._id, collectionId, {
                    name
                })

                if(result.error) {
                    emitter.emit('error', result.error)
                    return result
                }

                await updateCollection(context.state.activeWorkspace._id, collectionId, {
                    parentId
                })
            } else {
                await updateCollection(context.state.activeWorkspace._id, collectionId, {
                    name,
                    parentId
                })
            }

            const collectionItem = context.state.collection.find(item => item._id === collectionId)

            if(collectionItem?._type === 'request_group') {
                emitter.emit('request_group', 'renamed')
            }

            await context.dispatch('refreshWorkspace')

            return {
                error: null
            }
        },
    }
})

export default store
