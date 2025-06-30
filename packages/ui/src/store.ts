import { toRaw } from 'vue'
import { ActionContext, createStore } from 'vuex'
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
    setEnvironmentVariable,
    setObjectPathValue,
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
    RequestFinalResponse,
    RequestAuthentication,
} from './global'
import * as queryParamsSync from '@/utils/query-params-sync'

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

    console.log('setActiveTab', tab._id)

    // migrating old unsynced query params to new format
    if('url' in tab || 'parameters' in tab) {
        queryParamsSync.migrateOldData(tab)
    }

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
    let environment = requestWorkspace.environment ? JSON.parse(JSON.stringify(requestWorkspace.environment)) : {}

    if(requestWorkspace._type === 'file') {
        const dotEnv = requestWorkspace._type === 'file' ? requestWorkspace.dotEnv as Record<string, string> : {}
        Object.keys(dotEnv).forEach(key => {
            // this varName array join trick is needed as vite build changes all strings that match process.env to {}
            const varName = [
                'process',
                'env',
                key
            ].join('.')
            environment[varName] = dotEnv[key]
        })
        // substitute process.env variables in workspace environment
        environment = JSON.parse(await substituteEnvironmentVariables(environment, JSON.stringify(environment)))
    }

    const headers: Record<string, string[]> = {}
    let authentication: RequestAuthentication | undefined = undefined

    for(const parent of requestParentArray) {
        if(parent.environment) {
            let tempEnvironment = JSON.stringify(parent.environment)
            tempEnvironment = await substituteEnvironmentVariables(environment, tempEnvironment)
            tempEnvironment = JSON.parse(tempEnvironment)
            Object.assign(environment, tempEnvironment)
        }

        if(parent.authentication && parent.authentication.type !== 'No Auth' && !parent.authentication.disabled) {
            authentication = parent.authentication
        }

        if(parent.headers) {
            const parentHeadersObject: Record<string, string[]> = {}
            parent.headers.filter(header => !header.disabled).forEach(header => {
                if(parentHeadersObject[header.name]) {
                    parentHeadersObject[header.name].push(header.value)
                } else {
                    parentHeadersObject[header.name] = [header.value]
                }
            })
            Object.assign(headers, parentHeadersObject)
        }
    }

    return { environment, parentHeaders: headers, parentAuthentication: authentication }
}

const workspaceCache: WorkspaceCache = {
    tabs: {},
    activeTab: {}
}

async function loadWorkspaceTabs(context: ActionContext<State, State>) {
    const state = context.state

    if(state.activeWorkspace === null) {
        throw new Error('activeWorkspace is null')
    }

    const workspaceId = state.activeWorkspace._id

    const reloadDetachedTabs = (detachedTabIds = state.detachedTabs.map(detachedTab => detachedTab._id)) => {
        const detachedTabs = state.collection.filter(collectionItem => detachedTabIds.includes(collectionItem._id))
        detachedTabs.sort((a, b) => detachedTabIds.indexOf(a._id) - detachedTabIds.indexOf(b._id))
        state.detachedTabs = detachedTabs
    }

    const originalTabIds = state.activeWorkspace.tabIds ?? []
    const detachedTabIds = state.detachedTabs.map(detachedTab => detachedTab._id)
    const tabIds: string[] = []
    const newDetachedTabIds: string[] = []

    const idMap = state.idMap
    let activeTabId: string | null = null

    if(idMap !== null) {
        originalTabIds.forEach(tabId => {
            const retrievedTabId = idMap.get(tabId)
            if(retrievedTabId) {
                tabIds.push(retrievedTabId)
            }
        })
        detachedTabIds.forEach(tabId => {
            const retrievedTabId = idMap.get(tabId)
            if(retrievedTabId) {
                newDetachedTabIds.push(retrievedTabId)
            }
        })
        if(state.activeWorkspace.activeTabId) {
            activeTabId = idMap.get(state.activeWorkspace.activeTabId) ?? null
        }
    } else {
        tabIds.push(...originalTabIds)
        newDetachedTabIds.push(...detachedTabIds)
        activeTabId = state.activeWorkspace.activeTabId ?? null
    }

    const tabIdsOrder: { [tabId: string]: number } = {}

    // to restore tab ordering
    tabIds.forEach((tabId, index) => {
        tabIdsOrder[tabId] = index
    })

    // TODO completely remove usages of workspaceCache, as it doesn't seem useful anymore
    // seems like I'm now just using it as a variable to store some data
    delete workspaceCache.tabs[workspaceId]

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

    reloadDetachedTabs(newDetachedTabIds)

    context.dispatch('reloadTabEnvironmentResolved')
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

export const store = createStore<State>({
    devtools: true,
    state() {
        return {
            collection: [],
            collectionTree: [],
            tabs: [],
            detachedTabs: [],
            activeTab: null,
            requestResponseStatus: {},
            requestResponses: {},
            requestAbortController: {},
            responses: {},
            showImportModal: false,
            showImportAsCurlModal: false,
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
                isWebStandalone: false,
                isElectron: false,
                disableSSLVerification: false,
                electronSwitchToChromiumFetch: false,
                disableIframeSandbox: false,
                disableAutoUpdate: false,
                showTabs: true,
                hidePasswordFields: false,
            },
            settings: {
                customResponseFormats: [],
            },
            openContextMenuElement: null,
            sockets: {},
            tabEnvironmentResolved: {},
            idMap: null,
            skipPersistingActiveTab: false,
            consoleLogs: [],
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
        showImportAsCurlModal(state, value) {
            state.showImportAsCurlModal = value
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
        persistCollectionItem(state, collectionItem) {
            if(state.activeTab && state.activeTab._id === collectionItem._id) {
                if(state.skipPersistingActiveTab) {
                    console.log('persistCollectionItem: skipPersistingActiveTab is true, so skipping')
                    state.skipPersistingActiveTab = false
                    return
                }
            }

            console.log('persistCollectionItem', collectionItem._id)

            const collectionItemToSaveJSON = JSON.stringify(collectionItem)
            const collectionItemToSave = JSON.parse(collectionItemToSaveJSON)

            if('body' in collectionItem && 'params' in collectionItem.body) {
                const params: RequestParam[] = []
                for(const param of collectionItem.body.params) {
                    const paramExtracted = { ...param }
                    if('files' in paramExtracted) {
                        paramExtracted.files = [...paramExtracted.files].filter(file => file instanceof File)
                    }
                    params.push(paramExtracted)
                }
                collectionItemToSave.body.params = params
            }

            if('body' in collectionItem && 'fileName' in collectionItem.body) {
                collectionItemToSave.body.fileName = toRaw(collectionItem.body.fileName)
            }

            updateCollection(collectionItem.workspaceId, collectionItem._id, collectionItemToSave)
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
                state.idMap = null
            }
        },
        async loadWorkspacePlugins(state) {
            if(state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }
            console.log('loadWorkspacePlugins')
            state.plugins.workspace = await getWorkspacePlugins(state.activeWorkspace._id)
            emitter.emit('plugins', {
                name: 'loaded'
            })
        },
        async addPlugin(state, plugin) {
            const newPlugin = {
                _id: nanoid(),
                type: plugin.type,
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

            const previousWorkspaceId = foundPlugin.workspaceId
            const newWorkspaceId = plugin.workspaceId

            foundPlugin.name = updatePluginData.name
            foundPlugin.code = updatePluginData.code
            foundPlugin.workspaceId = updatePluginData.workspaceId
            foundPlugin.updatedAt = updatePluginData.updatedAt

            // plugin scope changed from global to workspace
            if(!previousWorkspaceId && newWorkspaceId) {
                state.plugins.global = state.plugins.global.filter(item => item._id !== foundPlugin._id)
                state.plugins.workspace.push(foundPlugin)

                if(state.activeWorkspace?._type === 'file') {
                    await deletePlugin(plugin._id)
                    await createPlugin(toRaw(foundPlugin), state.activeWorkspace._id)
                    return
                }
            }

            // plugin scope changed from workspace to global
            if(previousWorkspaceId && !newWorkspaceId) {
                state.plugins.workspace = state.plugins.workspace.filter(item => item._id !== foundPlugin._id)
                state.plugins.global.push(foundPlugin)

                if(state.activeWorkspace?._type === 'file') {
                    await deletePlugin(plugin._id, state.activeWorkspace._id)
                    await createPlugin(toRaw(foundPlugin))
                    return
                }
            }

            if(foundPlugin.workspaceId === null && !foundPlugin.collectionId) {
                await updatePlugin(plugin._id, updatePluginData)
            } else {
                if(state.activeWorkspace === null) {
                    throw new Error('activeWorkspace is null')
                }

                await updatePlugin(plugin._id, updatePluginData, state.activeWorkspace._id, foundPlugin.collectionId ?? null)
            }
        },
        async updatePluginStatus(state, plugin) {
            const foundPlugin = [...state.plugins.global, ...state.plugins.workspace].find(item => item._id === plugin._id)

            if(foundPlugin.workspaceId === null && !foundPlugin.collectionId) {
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

            if(foundPlugin.workspaceId === null && !foundPlugin.collectionId) {
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
        async updateWorkspaceNameInIndexedDB(_state, { workspaceId, name }) {
            await updateWorkspace(workspaceId, { name }, true)
        },
        detachTab(state, tab) {
            state.detachedTabs.push(tab)
        },
        addConsoleLog(state, log: string) {
            state.consoleLogs.push(log)
        },
        clearConsoleLogs(state) {
            state.consoleLogs = []
        },
    },
    actions: {
        addTab(context, tab) {
            const id = tab._id

            const existingTab = context.state.tabs.find(tabItem => tabItem._id === id)

            if(!existingTab) {
                // remove from detached tabs if it exists there
                context.state.detachedTabs = context.state.detachedTabs.filter(detachedTab => detachedTab._id !== id)

                const tabCopy = JSON.parse(JSON.stringify(tab))

                if('body' in tab) {
                    if('params' in tab.body) {
                        const params: RequestParam[] = []
                        for(const param of tab.body.params) {
                            const paramExtracted = { ...param }
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
                context.state.tabs.push(tabCopy)
                setActiveTab(context.state, tabCopy)
            } else {
                setActiveTab(context.state, existingTab)
            }

            nextTick(() => {
                const activeTabElement = document.querySelector(`.tabs-container > div[data-id="${id}"]`)
                activeTabElement?.scrollIntoView()
            })

            context.dispatch('reloadTabEnvironmentResolved')
        },
        setActiveTab(context, tab) {
            setActiveTab(context.state, tab, true)
            context.dispatch('reloadTabEnvironmentResolved')
        },
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
                context.state.detachedTabs = context.state.detachedTabs.filter(detachedTab => detachedTab._id !== childId)
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
            const newCollectionItem = structuredClone(collectionItem)

            const oldNewIdMapping: Record<string, string> = {}

            const newCollectionItemId = nanoid()
            oldNewIdMapping[collectionItem._id] = newCollectionItemId
            newCollectionItem._id = newCollectionItemId

            if(collectionItem._type === 'request_group') {
                generateNewIdsForTreeItemChildren(newCollectionItem, oldNewIdMapping)
            }

            const collectionItemsToSave: CollectionItem[] = flattenTree([newCollectionItem])
            const result = await createCollections(collectionItem.workspaceId, collectionItemsToSave)

            if(result.error) {
                emitter.emit('error', result.error)
                return result
            }

            const idMap = new Map<string, string>()

            result.results.forEach((collectionItemResult) => {
                if(collectionItemResult.oldCollectionId && collectionItemResult.newCollectionId) {
                    idMap.set(collectionItemResult.oldCollectionId, collectionItemResult.newCollectionId)
                }
            })

            if(idMap.size > 0) {
                collectionItemsToSave.forEach((collectionItemToSave) => {
                    collectionItemToSave._id = idMap.get(collectionItemToSave._id) ?? collectionItemToSave._id
                    if(collectionItemToSave.parentId) {
                        collectionItemToSave.parentId = idMap.get(collectionItemToSave.parentId) ?? collectionItemToSave.parentId
                    }
                })

                const recursivelyUpdateIdsAndParentIds = (collectionItem: CollectionItem) => {
                    collectionItem._id = idMap.get(collectionItem._id) ?? collectionItem._id
                    if(collectionItem.parentId) {
                        collectionItem.parentId = idMap.get(collectionItem.parentId) ?? collectionItem.parentId
                    }
                    if(collectionItem.children) {
                        collectionItem.children.forEach(recursivelyUpdateIdsAndParentIds)
                    }
                }

                recursivelyUpdateIdsAndParentIds(newCollectionItem)
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

            const collectionIds = getChildIds(context.state.collection, collectionItem._id)

            const plugins: Plugin[] = []

            context.state.plugins.workspace.forEach(plugin => {
                if(collectionIds.includes(plugin.collectionId)) {
                    let newCollectionId = oldNewIdMapping[plugin.collectionId]
                    if(idMap.size > 0 && idMap.has(newCollectionId)) {
                        newCollectionId = idMap.get(newCollectionId) as string
                    }
                    const newPlugin = JSON.parse(JSON.stringify(plugin))
                    newPlugin._id = nanoid()
                    newPlugin.collectionId = newCollectionId
                    newPlugin.createdAt = new Date().getTime()
                    newPlugin.updatedAt = new Date().getTime()
                    plugins.push(newPlugin)
                }
            })

            if(plugins.length > 0) {
                await createPlugins(plugins, collectionItem.workspaceId)
                context.state.plugins.workspace = context.state.plugins.workspace.concat(plugins)
            }

            if(newCollectionItem._type === 'request' || newCollectionItem._type === 'socket') {
                context.dispatch('addTab', newCollectionItem)
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
                    body: payload.body ? payload.body : {
                        mimeType: payload.mimeType
                    },
                    parentId: payload.parentId,
                    workspaceId: context.state.activeWorkspace._id,
                    url: payload.url || ''
                }

                if(payload.headers) {
                    newCollectionItem['headers'] = [...payload.headers]
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
                context.dispatch('addTab', newCollectionItem)
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
            if(payload.to.type === 'sidebar-list' && payload.to.cursorPosition === 'bottom') {
                targetIndex = targetParentCollection.length
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
            } else {
                context.dispatch('refreshWorkspaceTabs')
            }
        },
        async loadGlobalPlugins(context) {
            context.state.plugins.global = await getGlobalPlugins()
        },
        async getEnvironmentForRequest(context, { collectionItem, includeSelf = false }): Promise<{
            environment: any,
            parentHeaders: Record<string, string[]>,
            parentAuthentication?: RequestAuthentication,
            requestParentArray: CollectionItem[]
        }> {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            let requestParentArray: CollectionItem[] = []
            await getAllParents(context.state.activeWorkspace._id, requestParentArray, collectionItem)
            requestParentArray = requestParentArray.reverse()

            if(collectionItem._type === 'request_group' && includeSelf) {
                requestParentArray.push(collectionItem)
            }

            const { environment, parentHeaders, parentAuthentication } = await getEnvironmentForRequest(context.state.activeWorkspace, requestParentArray)

            return { environment, parentHeaders, parentAuthentication, requestParentArray }
        },
        async saveResponse(context, { workspaceId, collectionId, response }) {
            if(response._id) {
                const responseToSave = structuredClone(toRaw(response))

                if(collectionId in context.state.responses === false) {
                    await loadResponses(context.state, collectionId)
                }

                context.state.responses[collectionId].unshift(responseToSave)
                if(context.state.responses[collectionId].length > constants.DEFAULT_LIMITS.RESPONSE_HISTORY) {
                    const responsesToDelete = context.state.responses[collectionId].splice(constants.DEFAULT_LIMITS.RESPONSE_HISTORY)
                    const responseIdsToDelete = responsesToDelete.map(responseItem => responseItem._id)
                    await deleteResponsesByIds(workspaceId, responsesToDelete[0].collectionId, responseIdsToDelete)
                }
                await createResponse(workspaceId, structuredClone(responseToSave))
            }
        },
        async sendRequest(context, activeTab: CollectionItem) {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            context.state.requestResponseStatus[activeTab._id] = 'loading'

            const { environment, parentHeaders, parentAuthentication, requestParentArray }: {
                environment: any,
                parentHeaders: Record<string, string[]>,
                parentAuthentication: RequestAuthentication | undefined,
                requestParentArray: CollectionItem[]
            } = await context.dispatch('getEnvironmentForRequest', { collectionItem: activeTab })

            const setEnvironmentVariableWrapper = (objectPath: string, value: string) => {
                setEnvironmentVariable(context, objectPath, value)
                setObjectPathValue(environment, objectPath, value)
            }

            const globalPlugins: Plugin[] = []
            const workspacePlugins: Plugin[] = []
            const requestGroupPlugins: Plugin[] = []
            const requestPlugins: Plugin[] = [];

            (context.getters.enabledPlugins as Plugin[]).forEach(enabledPlugin => {
                if(!enabledPlugin.workspaceId && !enabledPlugin.collectionId) {
                    globalPlugins.push(enabledPlugin)
                }

                if(context.state.activeWorkspace !== null && enabledPlugin.workspaceId === context.state.activeWorkspace._id && enabledPlugin.collectionId === null) {
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
            const response = await handleRequest(activeTab, environment, parentHeaders, parentAuthentication, setEnvironmentVariableWrapper, enabledPlugins, context.state.activeWorkspace.location ?? null, context.state.requestAbortController[activeTab._id].signal, context.state.flags)

            await context.dispatch('saveResponse', {
                workspaceId: activeTab.workspaceId,
                collectionId: activeTab._id,
                response
            })

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
        async updateWorkspace(context, payload: { _id: string; updatedFields: Partial<Workspace> }) {
            const workspace = context.state.workspaces.find(item => item._id === payload._id)

            if(!workspace) {
                throw new Error('Workspace not found')
            }

            const updatedAt = new Date().getTime()

            payload.updatedFields.updatedAt = updatedAt

            await updateWorkspace(payload._id, payload.updatedFields)

            Object.keys(payload.updatedFields).forEach(updatedField => {
                (workspace as any)[updatedField] = payload.updatedFields[updatedField as keyof Workspace]
            })

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
        async duplicateWorkspace(context, { sourceWorkspace, name, type, location, includeResponseHistory } : { sourceWorkspace: Workspace, name: string, type: string, location: string, includeResponseHistory: boolean }) {
            let newWorkspaceId: string | null = null

            if(type === 'file') {
                newWorkspaceId = await context.dispatch('createWorkspace', {
                    name,
                    _type: type,
                    location,
                })
            } else {
                newWorkspaceId = await context.dispatch('createWorkspace', {
                    name
                })
            }

            if(newWorkspaceId === null) {
                throw new Error('newWorkspaceId is null')
            }

            const { collection: workspaceCollectionItems, workspace } = await getCollectionForWorkspace(sourceWorkspace._id)

            workspaceCollectionItems.forEach(collectionItem => {
                collectionItem.workspaceId = newWorkspaceId as string
            })

            const collectionTree = toTree(workspaceCollectionItems)

            const oldNewIdMapping = generateNewIdsForTree(collectionTree)

            if (type === 'file') {
                // this will call ensureRestfoxCollection to create restfox workspace if it doesn't exist
                // this method will return 0 records
                await getCollectionForWorkspace(newWorkspaceId)
            }

            const result = await createCollections(newWorkspaceId, flattenTree(collectionTree))

            if(result.error) {
                emitter.emit('error', result.error)
                return result
            }

            // duplicate workspace plugins

            const idMap = new Map<string, string>()

            result.results.forEach((collectionItemResult) => {
                if(collectionItemResult.oldCollectionId && collectionItemResult.newCollectionId) {
                    idMap.set(collectionItemResult.oldCollectionId, collectionItemResult.newCollectionId)
                }
            })

            const plugins: Plugin[] = await getWorkspacePlugins(sourceWorkspace._id)

            const newPlugins: Plugin[] = []

            plugins.forEach(plugin => {
                if(plugin.workspaceId) {
                    const newPlugin = JSON.parse(JSON.stringify(plugin))
                    newPlugin._id = nanoid()
                    newPlugin.workspaceId = newWorkspaceId
                    newPlugin.createdAt = new Date().getTime()
                    newPlugin.updatedAt = new Date().getTime()
                    newPlugins.push(newPlugin)
                }

                if(plugin.collectionId && plugin.collectionId in oldNewIdMapping) {
                    const newPlugin = JSON.parse(JSON.stringify(plugin))
                    let newCollectionId = oldNewIdMapping[plugin.collectionId]
                    if(idMap.size > 0 && idMap.has(newCollectionId)) {
                        newCollectionId = idMap.get(newCollectionId) as string
                    }
                    newPlugin._id = nanoid()
                    newPlugin.collectionId = newCollectionId
                    newPlugin.createdAt = new Date().getTime()
                    newPlugin.updatedAt = new Date().getTime()
                    newPlugins.push(newPlugin)
                }
            })

            await createPlugins(newPlugins, newWorkspaceId)

            // duplicate workspace environments

            let updateWorkspaceObject: Partial<Workspace> | null = null

            // is not null if file workspace
            if(workspace) {
                if(workspace.environment) {
                    updateWorkspaceObject = {
                        environment: workspace.environment,
                        environments: workspace.environments,
                        currentEnvironment: workspace.currentEnvironment,
                    }
                }
            } else {
                // get workspace environment for non-file workspaces
                updateWorkspaceObject = {
                    environment: sourceWorkspace.environment,
                    environments: sourceWorkspace.environments,
                    currentEnvironment: sourceWorkspace.currentEnvironment,
                }
            }

            if(updateWorkspaceObject && Object.keys(updateWorkspaceObject).length > 0) {
                context.dispatch('updateWorkspace', {
                    _id: newWorkspaceId,
                    updatedFields: updateWorkspaceObject
                })
            }

            // duplicate response history

            if(includeResponseHistory) {
                console.log('Duplicating response history')

                const responses: RequestFinalResponse[] = []

                for(const oldCollectionId of Object.keys(oldNewIdMapping)) {
                    const responsesForCollectionId = await getResponsesByCollectionId(sourceWorkspace._id, oldCollectionId)
                    responsesForCollectionId.forEach(response => {
                        response._id = nanoid()
                        let newCollectionId = oldNewIdMapping[oldCollectionId]
                        if(idMap.size > 0 && idMap.has(newCollectionId)) {
                            newCollectionId = idMap.get(newCollectionId) as string
                        }
                        response.collectionId = newCollectionId
                    })
                    responses.push(...responsesForCollectionId)
                }

                console.log('responses', responses)

                for(const newResponse of responses) {
                    await createResponse(newWorkspaceId, newResponse)
                }
            }
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

            const idMap = new Map<string, string>()

            result.results.forEach((collectionItemResult) => {
                if(collectionItemResult.oldCollectionId && collectionItemResult.newCollectionId) {
                    idMap.set(collectionItemResult.oldCollectionId, collectionItemResult.newCollectionId)
                }
            })

            if (plugins.length > 0) {
                // assign new ids to the imported / duplicated plugins
                // else the original request & request folders where the
                // plugins were exported from will lose their plugins
                // also update timestamps
                plugins.forEach(plugin => {
                    plugin._id = nanoid()
                    plugin.collectionId = (plugin.collectionId ? idMap.get(plugin.collectionId) : null) ?? plugin.collectionId
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
        async reloadTabEnvironmentResolved(context) {
            console.log('reloadTabEnvironmentResolved')

            const tabs = [...context.state.tabs, ...context.state.detachedTabs]
            // we use forEach instead of for of to run the await in parallel
            tabs.forEach(async tab => {
                const { environment } = await context.dispatch('getEnvironmentForRequest', { collectionItem: tab })
                context.state.tabEnvironmentResolved[tab._id] = environment
            })
        },
        async refreshWorkspaceCollection(context) {
            console.log('refreshWorkspaceCollection')

            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            const { collection, workspace, idMap } = await getCollectionForWorkspace(context.state.activeWorkspace._id)
            context.commit('setCollection', collection)
            context.state.idMap = idMap

            // is not null if file workspace
            if(workspace) {
                context.state.activeWorkspace.name = workspace.name
                if(workspace.environment) {
                    context.state.activeWorkspace.environment = workspace.environment
                    context.state.activeWorkspace.environments = workspace.environments
                    context.state.activeWorkspace.currentEnvironment = workspace.currentEnvironment
                    context.state.activeWorkspace.dotEnv = workspace.dotEnv
                    emitter.emit('dotenv', 'reloaded')
                }
            }
        },
        async refreshWorkspaceTabs(context) {
            console.log('refreshWorkspaceTabs')

            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            context.state.skipPersistingActiveTab = true
            loadWorkspaceTabs(context)

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
        async updateCollectionItem(context, { collectionId, name, parentId, headers, authentication }) {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            const collectionItem = context.state.collection.find(item => item._id === collectionId)

            if(collectionItem === undefined) {
                throw new Error('Collection item not found')
            }

            const propertiesToUpdate: Partial<CollectionItem> = {}

            if(collectionItem.name !== name) {
                propertiesToUpdate.name = name
            }

            if(collectionItem.parentId !== parentId) {
                propertiesToUpdate.parentId = parentId
            }

            if(JSON.stringify(collectionItem.headers) !== JSON.stringify(headers)) {
                propertiesToUpdate.headers = headers
            }

            if(JSON.stringify(collectionItem.authentication) !== JSON.stringify(authentication)) {
                propertiesToUpdate.authentication = authentication
            }

            if(Object.keys(propertiesToUpdate).length === 0) {
                console.log('Skipping updateCollectionItem as there are no changes in properties')
                return {
                    error: null
                }
            }

            console.log('updateCollectionItem: propertiesToUpdate', propertiesToUpdate)

            if(context.state.activeWorkspace._type === 'file') {
                // we split the operations, as the file workspace does not support updating name, parentId, headers & authentication together

                if('name' in propertiesToUpdate) {
                    const result = await updateCollection(context.state.activeWorkspace._id, collectionId, {
                        name
                    })

                    if(result.error) {
                        emitter.emit('error', result.error)
                        return result
                    }
                }

                if('parentId' in propertiesToUpdate) {
                    await updateCollection(context.state.activeWorkspace._id, collectionId, {
                        parentId
                    })
                }

                if('headers' in propertiesToUpdate) {
                    await updateCollection(context.state.activeWorkspace._id, collectionId, {
                        headers
                    })
                }

                if('authentication' in propertiesToUpdate) {
                    await updateCollection(context.state.activeWorkspace._id, collectionId, {
                        authentication
                    })
                }
            } else {
                await updateCollection(context.state.activeWorkspace._id, collectionId, propertiesToUpdate)
            }

            if('name' in propertiesToUpdate || 'parentId' in propertiesToUpdate) {
                if(collectionItem._type === 'request_group') {
                    emitter.emit('request_group', 'renamed')
                }

                await context.dispatch('refreshWorkspace')
            } else {
                console.log('folder collectionItem headers and authentication updated')
                collectionItem.headers = headers
                collectionItem.authentication = authentication

                // keep tab properties in tabs in sync with collectionItem
                const tab = store.state.tabs.find(tab => tab._id === collectionItem._id)
                if(tab) {
                    Object.assign(tab, collectionItem)
                }
            }

            return {
                error: null
            }
        },
        collapseFolders(context, collectionTree: CollectionItem[]) {
            collectionTree.forEach(collectionItem => {
                if(collectionItem._type === 'request_group' && !collectionItem.collapsed) {
                    collectionItem.collapsed = true
                    context.dispatch('saveCollectionItemCollapsedState', { _id: collectionItem._id, collapsed: true })
                }
                if(collectionItem.children) {
                    context.dispatch('collapseFolders', collectionItem.children)
                }
            })
        },
        loadWorkspaceTabs(context) {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            loadWorkspaceTabs(context)
        },
    }
})

export default store
