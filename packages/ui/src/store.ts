import { resolveEnvironmentForRequest, type RequestEnvironment } from '@/utils/environment'
import type { ResolutionMode, ResolutionOptions } from '@/global'
import { markRaw, toRaw } from 'vue'
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
    setRequestEnvironmentVariable,
    setObjectPathValue,
    getAllHttpRequestsInFolder,
    getParentPath,
    getAuthenticationType,
    hasOwnAuthentication,
} from './helpers'
import {
    getResponsesByCollectionId,
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
import { clearSkipPersistingActiveTabAfterUpdate } from '@/utils/skip-persisting-active-tab'
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
    CollectionRunnerResult,
    PluginTestResult,
    BodyIncomplete,
    ResponseProgress,
    ResponseStream,
} from './global'
import * as queryParamsSync from '@/utils/query-params-sync'
import { computeTargetIndex, isDropIntoOwnSubtree } from '@/utils/sidebar-drop'
import { BODY_INCOMPLETE_MESSAGES, getStreamView, isSendReplaced, markSendReplaced } from '@/utils/response-stream'
import { getResponseContentType } from '@/utils/response'
import { forgetGrpcCallsForItems, forgetGrpcCallsForWorkspace, moveGrpcCallsToNewItemIds } from '@/utils/grpc-calls'

// the sends still running on each tab, so a new send can cancel them
const runningSends = new Map<string, Set<AbortController>>()

// script plugins kept in memory whose first save failed, so the editor keeps what was typed and the next edit creates
// them again rather than updating a plugin storage does not hold
const scriptPluginsNotSaved = new Set<string>()

// arrival times live only as long as their response does in memory
function dropResponseChunkTimes(state: State, responses: { _id?: string }[] | undefined) {
    responses?.forEach(response => {
        if(response._id) {
            delete state.responseChunkTimes[response._id]
        }
    })
}

// a write the storage refused, such as one to a file it cannot read, which it leaves as it is
function reportUpdateError(result: { error: string | null } | undefined) {
    if(result?.error) {
        emitter.emit('error', result.error)
    }
}

async function loadResponses(state: State, tabId: string) {
    if(tabId in state.responses) {
        return
    }

    if(state.activeWorkspace === null) {
        throw new Error('activeWorkspace is null')
    }

    const workspaceId = state.activeWorkspace._id
    const responses = await getResponsesByCollectionId(workspaceId, tabId)
    if(state.activeWorkspace?._id !== workspaceId) {
        return
    }
    state.responses[tabId] = responses
    // a response shown while the history loaded, such as a gRPC call that ended and is being saved, stays shown
    if((tabId in state.requestResponses) && state.requestResponses[tabId] !== null) {
        return
    }
    if(state.responses[tabId].length > 0) {
        state.requestResponses[tabId] = state.responses[tabId][0]
        state.requestResponseStatus[tabId] = 'loaded'
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

    // migrating old unsynced query params to new format, for the types that had them: a gRPC item's url is a server
    // address with no query, and a type only a newer version knows is never changed
    if((tab._type === 'request' || tab._type === 'socket') && ('url' in tab || 'parameters' in tab)) {
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

function getAllParents(collection: CollectionItem[], parentArray: CollectionItem[], request: CollectionItem) {
    if(!request.parentId) {
        return
    }
    const requestParent = collection.find(item => item._id === request.parentId)
    if(requestParent) {
        parentArray.push(requestParent)
        getAllParents(collection, parentArray, requestParent)
    }
}

async function getEnvironmentForRequest(requestWorkspace: Workspace, requestParentArray: CollectionItem[], mode: ResolutionMode, options: ResolutionOptions) {
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
        environment = JSON.parse(await substituteEnvironmentVariables(environment, JSON.stringify(environment), mode, { ...options, resolvePromptTags: false, workspaceId: requestWorkspace._id }))
    }

    const headers: Record<string, string[]> = {}
    let authentication: RequestAuthentication | undefined = undefined

    for(const parent of requestParentArray) {
        if(parent.environment) {
            let tempEnvironment = JSON.stringify(parent.environment)
            // a prompt tag is left for the send, this runs for every open tab on each tab switch
            tempEnvironment = await substituteEnvironmentVariables(environment, tempEnvironment, mode, { ...options, resolvePromptTags: false, workspaceId: requestWorkspace._id })
            tempEnvironment = JSON.parse(tempEnvironment)
            Object.assign(environment, tempEnvironment)
        }

        if(parent.authentication && hasOwnAuthentication(parent.authentication)) {
            authentication = parent.authentication
        } else if(getAuthenticationType(parent.authentication) === 'none') {
            // a folder set to No Auth stops the auth of the folders above it, one whose own auth is unticked passes it through
            authentication = undefined
        }

        if(parent.headers) {
            const parentHeadersObject: Record<string, string[]> = {}
            parent.headers.filter(header => !header.disabled && header.name !== '').forEach(header => {
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
            requestResponseStreams: {},
            responseChunkTimes: {},
            extractPathInputs: {},
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
                caCertificates: null,
                proxy: null,
                electronSwitchToChromiumFetch: false,
                requestTimeout: 0,
                disableIframeSandbox: false,
                disableAutoUpdate: false,
                showTabs: true,
                hidePasswordFields: false,
                responseLineWrapping: true,
            },
            settings: {
                customResponseFormats: [],
            },
            openContextMenuElement: null,
            sockets: {},
            tabEnvironmentResolved: {},
            tabEnvironmentResolvedRefresh: 0,
            idMap: null,
            skipPersistingActiveTab: false,
            consoleLogs: [],
            collectionRunner: {
                isRunning: false,
                sourceId: null,
                sourceName: null,
                allRequests: [],
                selectedRequests: [],
                currentRequestIndex: 0,
                currentIteration: 1,
                totalIterations: 1,
                delayMs: 0,
                results: [],
                abortController: null,
                continueOnError: true,
                startTime: null,
                currentRequestId: null
            },
            activeMobilePanel: 'content' as 'collections' | 'content' | 'response',
            showEnvironmentModal: false,
            showSettingsModal: false,
            showPluginManagerModal: false,
            showLogsModal: false,
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
        setActiveMobilePanel(state, panel: 'collections' | 'content' | 'response') {
            state.activeMobilePanel = panel
        },
        showEnvironmentModal(state, value: boolean) {
            state.showEnvironmentModal = value
        },
        showSettingsModal(state, value: boolean) {
            state.showSettingsModal = value
        },
        showPluginManagerModal(state, value: boolean) {
            state.showPluginManagerModal = value
        },
        showLogsModal(state, value: boolean) {
            state.showLogsModal = value
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
        async updateCollectionItemEnvironment(state, { collectionId, environment, workspaceId = state.activeWorkspace?._id }) {
            if(environment) {
                if(!workspaceId) {
                    throw new Error('activeWorkspace is null')
                }

                await updateCollection(workspaceId, collectionId, { environment: JSON.parse(JSON.stringify(environment)) })
            }
        },
        async updateWorkspaceEnvironment(_state, { workspaceId, environment }) {
            if(environment) {
                await updateWorkspace(workspaceId, { environment: JSON.parse(JSON.stringify(environment)) })
            }
        },
        async updateCollectionItemEnvironments(state, { collectionId, environments, workspaceId = state.activeWorkspace?._id }) {
            if(environments) {
                if(!workspaceId) {
                    throw new Error('activeWorkspace is null')
                }

                try {
                    reportUpdateError(await updateCollection(workspaceId, collectionId, { environments: JSON.parse(JSON.stringify(environments)) }))
                } catch(error) {
                    // a failed write, which nothing awaiting a mutation would see, shown as a refused one is
                    console.error('Error saving folder environments', error)
                    emitter.emit('error', error instanceof Error ? error.message : String(error))
                }
            }
        },
        async updateWorkspaceEnvironments(_state, { workspaceId, environments }) {
            if(environments) {
                reportUpdateError(await updateWorkspace(workspaceId, { environments: JSON.parse(JSON.stringify(environments)) }))
            }
        },
        async updateCollectionItemCurrentEnvironment(state, { collectionId, currentEnvironment }) {
            if(currentEnvironment) {
                if(state.activeWorkspace === null) {
                    throw new Error('activeWorkspace is null')
                }

                try {
                    reportUpdateError(await updateCollection(state.activeWorkspace._id, collectionId, { currentEnvironment: currentEnvironment }))
                } catch(error) {
                    // a failed write, which nothing awaiting a mutation would see, shown as a refused one is
                    console.error('Error saving folder environment pick', error)
                    emitter.emit('error', error instanceof Error ? error.message : String(error))
                }
            }
        },
        async updateWorkspaceCurrentEnvironment(_state, { workspaceId, currentEnvironment }) {
            if(currentEnvironment) {
                reportUpdateError(await updateWorkspace(workspaceId, { currentEnvironment: currentEnvironment }))
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

            try {
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
            } catch(error: any) {
                emitter.emit('error', error.message)
            }
        },
        async updatePlugin(state, plugin) {
            const updatePluginData = {
                name: plugin.name,
                code: plugin.code,
                workspaceId: plugin.workspaceId,
                updatedAt: new Date().getTime()
            }

            try {
                const foundPlugin = [...state.plugins.global, ...state.plugins.workspace].find(item => item._id === plugin._id)
                const previousWorkspaceId = foundPlugin.workspaceId
                const newWorkspaceId = plugin.workspaceId

                // plugin scope changed from global to workspace
                if(!previousWorkspaceId && newWorkspaceId && state.activeWorkspace?._type === 'file') {
                    await createPlugin({ ...toRaw(foundPlugin), ...updatePluginData }, newWorkspaceId)
                    await deletePlugin(plugin._id)
                // plugin scope changed from workspace to global
                } else if(previousWorkspaceId && !newWorkspaceId && state.activeWorkspace?._type === 'file') {
                    await createPlugin({ ...toRaw(foundPlugin), ...updatePluginData })
                    await deletePlugin(plugin._id, previousWorkspaceId, foundPlugin.collectionId ?? null)
                } else if(newWorkspaceId === null && !foundPlugin.collectionId) {
                    await updatePlugin(plugin._id, updatePluginData)
                } else {
                    if(state.activeWorkspace === null) {
                        throw new Error('activeWorkspace is null')
                    }

                    await updatePlugin(plugin._id, updatePluginData, state.activeWorkspace._id, foundPlugin.collectionId ?? null)
                }

                Object.assign(foundPlugin, updatePluginData)

                if(!previousWorkspaceId && newWorkspaceId) {
                    state.plugins.global = state.plugins.global.filter(item => item._id !== foundPlugin._id)
                    state.plugins.workspace.push(foundPlugin)
                }
                if(previousWorkspaceId && !newWorkspaceId) {
                    state.plugins.workspace = state.plugins.workspace.filter(item => item._id !== foundPlugin._id)
                    state.plugins.global.push(foundPlugin)
                }
            } catch(error: any) {
                emitter.emit('error', error.message)
            }
        },
        async updatePluginStatus(state, plugin) {
            try {
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
            } catch(error: any) {
                emitter.emit('error', error.message)
            }
        },
        async deletePlugin(state, pluginId) {
            try {
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
            } catch(error: any) {
                emitter.emit('error', error.message)
            }
        },
        // These act on the active tab's item, or on the one given, such as a panel's in a window of its own, whose item
        // is not the main window's active tab
        async clearResponseHistory(state, collectionItem?: CollectionItem) {
            const item = collectionItem ?? state.activeTab
            await deleteResponsesByCollectionId(item.workspaceId, item._id)
            dropResponseChunkTimes(state, state.responses[item._id])
            state.responses[item._id] = []
            state.requestResponses[item._id] = null
            state.requestResponseStatus[item._id] = 'pending'
        },
        async renameCurrentlyActiveResponse(state, payload: string | { name: string, collectionItem: CollectionItem }) {
            const { name: newResponseName, collectionItem: item } = typeof payload === 'string' ? { name: payload, collectionItem: state.activeTab } : payload
            const activeResponse = state.requestResponses[item._id]
            activeResponse.name = newResponseName !== '' ? newResponseName : null
            // the history entry, which is a copy of the one shown once a send saved it
            const historyEntry = state.responses[item._id]?.find(response => response._id === activeResponse._id)
            if(historyEntry) {
                historyEntry.name = activeResponse.name
            }
            await updateResponse(item.workspaceId, activeResponse.collectionId, activeResponse._id, { name: activeResponse.name })
        },
        async deleteCurrentlyActiveResponse(state, collectionItem?: CollectionItem) {
            const item = collectionItem ?? state.activeTab
            const responseToDelete = state.requestResponses[item._id]
            await deleteResponse(item.workspaceId, responseToDelete.collectionId, responseToDelete._id)
            dropResponseChunkTimes(state, [responseToDelete])
            state.responses[item._id] = state.responses[item._id].filter(response => response._id !== responseToDelete._id)
            if(state.responses[item._id].length > 0) {
                state.requestResponses[item._id] = state.responses[item._id][0]
                state.requestResponseStatus[item._id] = 'loaded'
            } else {
                state.requestResponses[item._id] = null
                state.requestResponseStatus[item._id] = 'pending'
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
        completeCollectionRunner(state) {
            state.collectionRunner.isRunning = false
        },
        abortCollectionRunner(state) {
            state.collectionRunner.isRunning = false
            state.collectionRunner.results.forEach(result => {
                if (result.status === 'pending' || result.status === 'running') {
                    result.status = 'error'
                    result.error = 'Cancelled'
                }
            })
        },
        resetCollectionRunner(state) {
            state.collectionRunner = {
                isRunning: false,
                sourceId: null,
                sourceName: null,
                allRequests: [],
                selectedRequests: [],
                currentRequestIndex: 0,
                currentIteration: 1,
                totalIterations: 1,
                delayMs: 0,
                results: [],
                abortController: null,
                continueOnError: true,
                startTime: null,
                currentRequestId: null
            }
        },
        advanceCollectionRunnerProgress(state, payload: { requestIndex: number, iteration: number }) {
            state.collectionRunner.currentRequestIndex = payload.requestIndex
            state.collectionRunner.currentIteration = payload.iteration
        },
        startCollectionRunnerRequest(state, payload: { resultIndex: number, requestId: string }) {
            state.collectionRunner.results[payload.resultIndex].status = 'running'
            state.collectionRunner.currentRequestId = payload.requestId
        },
        completeCollectionRunnerRequest(state, payload: {
            resultIndex: number,
            status: 'success' | 'error',
            timeTaken: number,
            statusCode?: number,
            url?: string,
            responseSize?: number,
            testResults?: any[],
            error?: string
        }) {
            const result = state.collectionRunner.results[payload.resultIndex]
            result.status = payload.status
            result.timeTaken = payload.timeTaken
            if (payload.statusCode !== undefined) {
                result.statusCode = payload.statusCode
            }
            if (payload.url !== undefined) {
                result.url = payload.url
            }
            if (payload.responseSize !== undefined) {
                result.responseSize = payload.responseSize
            }
            if (payload.testResults !== undefined) {
                result.testResults = payload.testResults
            }
            if (payload.error !== undefined) {
                result.error = payload.error
            }
            state.collectionRunner.currentRequestId = null
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
            // first, so a call that ends meanwhile saves no response for a deleted item
            forgetGrpcCallsForItems(collectionItem.workspaceId, childIds)
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
                    dropResponseChunkTimes(context.state, context.state.responses[childId])
                    delete context.state.responses[childId]
                    delete context.state.requestResponses[childId]
                    delete context.state.requestResponseStatus[childId]
                }
                delete context.state.requestResponseStreams[childId]
                delete context.state.extractPathInputs[childId]
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
                    updateCollection(item.workspaceId, item._id, { sortOrder: index }).then(reportUpdateError)
                })
            } else {
                const childIndex = context.state.collectionTree.findIndex(item => item._id === collectionItem._id)
                context.state.collectionTree.splice(childIndex + 1, 0, newCollectionItem)
                // new sort order for new item and its siblings
                context.state.collectionTree.forEach((item, index) => {
                    item.sortOrder = index
                    updateCollection(item.workspaceId, item._id, { sortOrder: index }).then(reportUpdateError)
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
                // the item is saved, so a failed script copy is reported and the duplicate still opens
                try {
                    await createPlugins(plugins, collectionItem.workspaceId)
                    context.state.plugins.workspace = context.state.plugins.workspace.concat(plugins)
                } catch(error: any) {
                    emitter.emit('error', error.message)
                }
            }

            if(newCollectionItem._type === 'request' || newCollectionItem._type === 'socket' || newCollectionItem._type === 'grpc') {
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

            if(payload.type === 'grpc') {
                newCollectionItem = {
                    _id: nanoid(),
                    _type: 'grpc',
                    name: payload.name,
                    url: '',
                    body: {
                        mimeType: 'application/json',
                        text: '{}'
                    },
                    grpc: {},
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
                    updateCollection(item.workspaceId, item._id, { sortOrder: index }).then(reportUpdateError)
                })
            } else {
                context.state.collectionTree.splice(0, 0, newCollectionItem)
                // new sort order for new item and its siblings
                context.state.collectionTree.forEach((item, index) => {
                    item.sortOrder = index
                    updateCollection(item.workspaceId, item._id, { sortOrder: index }).then(reportUpdateError)
                })
            }

            if(payload.type === 'request' || payload.type === 'socket' || payload.type === 'grpc') {
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

            // don't allow an item to be dropped into its own nested list or a descendant's nested list
            if(isDropIntoOwnSubtree(context.state.collectionTree, payload.from.id, payload.to.parentId)) {
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

            const targetIndex = computeTargetIndex(targetParentCollection, {
                id: payload.to.id,
                type: payload.to.type,
                cursorPosition: payload.to.cursorPosition,
            })
            targetParentCollection.splice(targetIndex, 0, sourceItem)

            const collectionItemIndex = context.state.collection.findIndex(item => item._id === sourceItem._id)
            if (collectionItemIndex !== -1) {
                context.state.collection[collectionItemIndex].parentId = sourceItem.parentId
            }

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

            const sortOrderResults = await Promise.all(sortOrderUpdates)
            sortOrderResults.forEach(reportUpdateError)

            if(context.state.activeWorkspace?._type === 'file') {
                context.dispatch('refreshWorkspace')
            } else {
                context.dispatch('refreshWorkspaceTabs')
            }
        },
        async loadGlobalPlugins(context) {
            context.state.plugins.global = await getGlobalPlugins()
        },
        async saveRequestScript(context, { collectionId, code }: {
            collectionId: string,
            code: { pre_request: string, post_request: string }
        }) {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            const workspaceId = context.state.activeWorkspace._id
            const scriptPlugins = context.state.plugins.workspace.filter(plugin => {
                return plugin.collectionId === collectionId && plugin.type === 'script'
            })
            const [scriptPlugin, ...duplicateScriptPlugins] = scriptPlugins

            const scriptCode = {
                pre_request: code.pre_request,
                post_request: code.post_request,
            }
            const updatedAt = new Date().getTime()

            try {
                if(scriptPlugin && !scriptPluginsNotSaved.has(scriptPlugin._id)) {
                    await updatePlugin(scriptPlugin._id, {
                        name: null,
                        code: scriptCode,
                        workspaceId: scriptPlugin.workspaceId,
                        updatedAt,
                    }, workspaceId, collectionId)

                    scriptPlugin.name = null
                    scriptPlugin.code = scriptCode
                    scriptPlugin.updatedAt = updatedAt
                } else if(scriptPlugin) {
                    scriptPlugin.code = scriptCode
                    scriptPlugin.updatedAt = updatedAt
                    // marked saved before the wait, as a first create is, so another edit meanwhile updates it
                    scriptPluginsNotSaved.delete(scriptPlugin._id)
                    try {
                        await createPlugin(toRaw(scriptPlugin), workspaceId)
                    } catch(error) {
                        scriptPluginsNotSaved.add(scriptPlugin._id)
                        throw error
                    }
                } else {
                    const newPlugin: Plugin = {
                        _id: nanoid(),
                        type: 'script',
                        name: null,
                        code: scriptCode,
                        workspaceId: null,
                        collectionId,
                        enabled: true,
                        createdAt: updatedAt,
                        updatedAt,
                    }

                    // Reserve the script plugin before persistence so another edit cannot create a
                    // second plugin while the filesystem write is still in progress.
                    context.state.plugins.workspace.push(newPlugin)
                    try {
                        await createPlugin(newPlugin, workspaceId)
                    } catch(error) {
                        scriptPluginsNotSaved.add(newPlugin._id)
                        throw error
                    }
                }

                for(const duplicatePlugin of duplicateScriptPlugins) {
                    await deletePlugin(duplicatePlugin._id, workspaceId, collectionId)
                    context.state.plugins.workspace = context.state.plugins.workspace.filter(plugin => plugin._id !== duplicatePlugin._id)
                }
                return true
            } catch(error: any) {
                emitter.emit('error', error.message)
                return false
            }
        },
        async getEnvironmentForRequest(context, { collectionItem, includeSelf = false, mode, ...options }): Promise<{
            environment: any,
            parentHeaders: Record<string, string[]>,
            parentAuthentication?: RequestAuthentication,
            requestParentArray: CollectionItem[]
        }> {
            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            let requestParentArray: CollectionItem[] = []
            getAllParents(context.state.collection, requestParentArray, collectionItem)
            requestParentArray = requestParentArray.reverse()

            if(collectionItem._type === 'request_group' && includeSelf) {
                requestParentArray.push(collectionItem)
            }

            const { environment, parentHeaders, parentAuthentication } = await getEnvironmentForRequest(context.state.activeWorkspace, requestParentArray, mode === 'send' ? 'send' : 'display', options)

            return { environment, parentHeaders, parentAuthentication, requestParentArray }
        },
        async saveResponse(context, { workspaceId, collectionId, response }) {
            if(response._id) {
                const responseToSave = structuredClone(toRaw(response))

                if(context.state.activeWorkspace?._id === workspaceId && collectionId in context.state.responses === false) {
                    await loadResponses(context.state, collectionId)
                }

                // such as a gRPC call that ended after its workspace was left. The history in memory is the open
                // workspace's, where another file workspace's item can have the same id
                if(context.state.activeWorkspace?._id !== workspaceId) {
                    await createResponse(workspaceId, structuredClone(responseToSave))
                    const responsesSaved = await getResponsesByCollectionId(workspaceId, collectionId)
                    if(responsesSaved.length > constants.DEFAULT_LIMITS.RESPONSE_HISTORY) {
                        await deleteResponsesByIds(workspaceId, collectionId, responsesSaved.slice(constants.DEFAULT_LIMITS.RESPONSE_HISTORY).map(responseItem => responseItem._id))
                    }
                    return
                }

                context.state.responses[collectionId].unshift(responseToSave)
                if(context.state.responses[collectionId].length > constants.DEFAULT_LIMITS.RESPONSE_HISTORY) {
                    const responsesToDelete = context.state.responses[collectionId].splice(constants.DEFAULT_LIMITS.RESPONSE_HISTORY)
                    dropResponseChunkTimes(context.state, responsesToDelete)
                    const responseIdsToDelete = responsesToDelete.map(responseItem => responseItem._id)
                    await deleteResponsesByIds(workspaceId, responsesToDelete[0].collectionId, responseIdsToDelete)
                }
                await createResponse(workspaceId, structuredClone(responseToSave))
            }
        },
        // The user's Send passes cancelEarlierSends, so a send still running on the tab, which no control could reach
        // once this one shows, stops and is not saved. Other sends, such as Send with interval and response tags,
        // may overlap and each one is saved
        async sendRequest(context, payload: CollectionItem | { collectionItem: CollectionItem, cancelEarlierSends: boolean }) {
            const { collectionItem: activeTab, cancelEarlierSends } = 'collectionItem' in payload ? payload : { collectionItem: payload, cancelEarlierSends: false }
            const workspaceId = activeTab.workspaceId

            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            const sendStartedAt = Date.now()
            const tabId = activeTab._id

            const tabSends = runningSends.get(tabId) ?? new Set<AbortController>()
            runningSends.set(tabId, tabSends)
            if(cancelEarlierSends) {
                tabSends.forEach(earlierSend => {
                    markSendReplaced(earlierSend.signal)
                    earlierSend.abort()
                })
            }

            // the newest send owns the tab's status, response and live view, an earlier one still arriving is only saved
            const abortController = new AbortController()
            tabSends.add(abortController)
            context.state.requestAbortController[tabId] = abortController
            const isNewestSend = () => context.state.requestAbortController[tabId] === abortController
            delete context.state.requestResponseStreams[tabId]
            context.state.requestResponseStatus[tabId] = 'loading'

            let environmentResolved: RequestEnvironment
            try {
                environmentResolved = await resolveEnvironmentForRequest(context, activeTab, 'send')
            } catch(error: any) {
                console.error(error)
                tabSends.delete(abortController)
                if(tabSends.size === 0) {
                    runningSends.delete(tabId)
                }
                const response = {
                    status: null,
                    statusText: 'Error',
                    error: error?.cause === 'display-error' ? `Error: ${error.message}` : 'Error: Request failed',
                }
                if(isNewestSend()) {
                    if(context.state.activeWorkspace?._id === workspaceId) {
                        context.state.requestResponses[tabId] = response
                    }
                    if(context.state.requestResponseStatus[tabId] === 'loading') {
                        context.state.requestResponseStatus[tabId] = 'loaded'
                    }
                }
                return response
            }
            const { environment, parentHeaders, parentAuthentication, requestParentArray } = environmentResolved

            const setEnvironmentVariableWrapper = (objectPath: string, value: string, scope: 'workspace' | 'folder' = 'workspace', pluginCollectionId?: string | null) => {
                setObjectPathValue(environment, objectPath, value)
                return setRequestEnvironmentVariable(context, workspaceId, activeTab, objectPath, value, scope, pluginCollectionId)
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

            // an earlier send on this tab that is still arriving, such as one from Send with interval, must not write into this one
            const sendId = nanoid()
            const currentStream = (): ResponseStream | undefined => {
                const stream = context.state.requestResponseStreams[tabId]
                return stream?.sendId === sendId ? stream : undefined
            }

            // kept here as well as in the stream entry, so the arrival times survive a newer send replacing the entry
            const chunkEnds: number[] = []
            const chunkTimes: number[] = []
            let receivedBytes = 0
            let receivingTimer: ReturnType<typeof setTimeout> | undefined
            let progressTimer: ReturnType<typeof setTimeout> | undefined

            const showProgress = () => {
                clearTimeout(progressTimer)
                progressTimer = undefined
                const stream = currentStream()
                if(stream && stream.receivedBytes !== receivedBytes) {
                    stream.receivedBytes = receivedBytes
                    stream.revision++
                }
            }

            const onResponseProgress = (progress: ResponseProgress) => {
                if(progress.type === 'end') {
                    // a body that ended keeps the loading overlay while scripts run, a shown one tells it has ended
                    clearTimeout(receivingTimer)
                    showProgress()
                    const stream = currentStream()
                    if(stream) {
                        stream.endedAt = Date.now()
                    }
                    return
                }

                if(progress.type === 'head') {
                    if(!isNewestSend()) {
                        return
                    }

                    const view = getStreamView(getResponseContentType(progress.head), context.state.settings.customResponseFormats ?? [])

                    context.state.requestResponseStreams[tabId] = {
                        sendId,
                        head: progress.head,
                        view,
                        headAt: Date.now(),
                        receivedBytes: 0,
                        chunks: markRaw([]),
                        chunkTimes: markRaw(chunkTimes),
                        revision: 0,
                        endedAt: null,
                    }

                    // Most responses end at once, an event stream such as an MCP reply too, and keep the loading overlay
                    // then show the result with no flash of the live view. The end of the body clears this timer
                    receivingTimer = setTimeout(() => {
                        if(currentStream()) {
                            context.state.requestResponseStatus[tabId] = 'receiving'
                        }
                    }, 250)
                    return
                }

                receivedBytes += progress.bytes.byteLength
                chunkEnds.push(receivedBytes)
                chunkTimes.push(Date.now() - sendStartedAt)

                const stream = currentStream()
                if(!stream) {
                    return
                }

                stream.chunks.push(progress.bytes)

                if(progressTimer === undefined) {
                    progressTimer = setTimeout(showProgress, 100)
                }
            }

            try {
                const response = await handleRequest(activeTab, environment, parentHeaders, parentAuthentication, setEnvironmentVariableWrapper, enabledPlugins, context.state.activeWorkspace.location ?? null, abortController.signal, context.state.flags, onResponseProgress)

                // a body that ended before the newer Send is a whole response and is kept
                if(isSendReplaced(abortController.signal) && 'bodyIncomplete' in response && response.bodyIncomplete === 'cancelled') {
                    return response
                }

                // only while the body is the bytes that arrived, since a script can replace it
                if('_id' in response && chunkEnds.length > 0 && response.buffer?.byteLength === receivedBytes) {
                    context.state.responseChunkTimes[response._id] = markRaw({ chunkEnds, chunkTimes })
                }

                // A body cut short is kept in history only for a stream, where part of it is the point. Older versions
                // read a saved response as whole, and a response tag there would read half a JSON body. Any other one is
                // shown and not saved, as before streaming, when it was not kept at all
                const keepsResponse = !('bodyIncomplete' in response) || response.bodyIncomplete === undefined
                    || ['events', 'lines'].includes(getStreamView(getResponseContentType(response)))

                if(keepsResponse) {
                    await context.dispatch('saveResponse', {
                        workspaceId: activeTab.workspaceId,
                        collectionId: tabId,
                        response
                    })
                }

                if(isNewestSend()) {
                    context.state.requestResponses[tabId] = response
                    context.state.requestResponseStatus[tabId] = 'loaded'
                }

                // the response of this send, which a newer send on the tab may keep from being the one shown
                return response
            } finally {
                tabSends.delete(abortController)
                if(tabSends.size === 0) {
                    runningSends.delete(tabId)
                }
                clearTimeout(receivingTimer)
                clearTimeout(progressTimer)
                if(currentStream()) {
                    delete context.state.requestResponseStreams[tabId]
                    // the receiving view has nothing left to show when the response could not be saved
                    if(context.state.requestResponseStatus[tabId] === 'receiving') {
                        context.state.requestResponseStatus[tabId] = 'loading'
                    }
                }
            }
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

            reportUpdateError(await updateWorkspace(payload._id, payload.updatedFields))

            Object.keys(payload.updatedFields).forEach(updatedField => {
                (workspace as any)[updatedField] = payload.updatedFields[updatedField as keyof Workspace]
            })

            context.state.workspaces.sort((a, b) => b.updatedAt - a.updatedAt)
        },
        async deleteWorkspace(context, workspaceId) {
            // first, so a call that ends meanwhile saves no response for a deleted item
            forgetGrpcCallsForWorkspace(workspaceId)
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
            forgetGrpcCallsForWorkspace(workspaceId)
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
                // a request's or folder's script that an import gave the workspace's id as well is copied once below,
                // for the new item, so the source item does not get a second copy and the new one belongs to the new workspace
                if(plugin.workspaceId && !plugin.collectionId) {
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
                    if(newPlugin.workspaceId) {
                        newPlugin.workspaceId = newWorkspaceId
                    }
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
                // the items are saved, so a failed script copy is reported and the import still shows them
                try {
                    await createPlugins(plugins, context.state.activeWorkspace._id)
                    context.state.plugins.workspace.push(...plugins)
                } catch(error: any) {
                    emitter.emit('error', error.message)
                }
            }

            const { collection } = await getCollectionForWorkspace(context.state.activeWorkspace._id)

            context.commit('setCollection', collection)

            return result
        },
        async reloadTabEnvironmentResolved(context) {
            console.log('reloadTabEnvironmentResolved')

            const refresh = ++context.state.tabEnvironmentResolvedRefresh
            const tabs = [...context.state.tabs, ...context.state.detachedTabs]
            await Promise.allSettled(tabs.map(async tab => {
                try {
                    const { environment } = await resolveEnvironmentForRequest(context, tab, 'display', { noError: true, responseTagErrors: 'placeholder' })
                    if(context.state.tabEnvironmentResolvedRefresh === refresh) {
                        context.state.tabEnvironmentResolved[tab._id] = environment
                    }
                } catch(error) {
                    if(context.state.tabEnvironmentResolvedRefresh === refresh) {
                        context.state.tabEnvironmentResolved[tab._id] = {}
                        console.error(error)
                    }
                }
            }))
        },
        async refreshWorkspaceCollection(context) {
            console.log('refreshWorkspaceCollection')

            if(context.state.activeWorkspace === null) {
                throw new Error('activeWorkspace is null')
            }

            const { collection, workspace, idMap } = await getCollectionForWorkspace(context.state.activeWorkspace._id)
            // a running gRPC call follows its item to a new id, as after a rename or a move in a file workspace, and
            // stops when its item is gone, as nothing could stop or show it then
            const collectionIds = new Set(collection.map((item: CollectionItem) => item._id))
            if(idMap) {
                // the map also holds items whose files went away outside Restfox, which the collection no longer has
                moveGrpcCallsToNewItemIds(context.state.activeWorkspace._id, context.state.collection.map(item => item._id), new Map([...idMap].filter(([, newId]) => collectionIds.has(newId))))
            } else {
                forgetGrpcCallsForItems(context.state.activeWorkspace._id, context.state.collection.map(item => item._id).filter(id => !collectionIds.has(id)))
            }
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
            // the skip is for the reloaded tab alone. A tab reloaded under a new id, as after a rename in a file
            // workspace, is never saved, so the skip would otherwise drop the user's next change
            clearSkipPersistingActiveTabAfterUpdate(context.state)

            context.commit('persistActiveWorkspaceTabs')
        },
        async refreshWorkspace(context) {
            await context.dispatch('refreshWorkspaceCollection')
            await context.dispatch('refreshWorkspaceTabs')
            context.commit('loadWorkspacePlugins')
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
                    const result = await updateCollection(context.state.activeWorkspace._id, collectionId, {
                        headers
                    })

                    if(result.error) {
                        emitter.emit('error', result.error)
                        return result
                    }
                }

                if('authentication' in propertiesToUpdate) {
                    const result = await updateCollection(context.state.activeWorkspace._id, collectionId, {
                        authentication
                    })

                    if(result.error) {
                        emitter.emit('error', result.error)
                        return result
                    }
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
        async startCollectionRunner(context, { source, selectedRequests, iterations, delayMs, continueOnError }: {
            source: any,
            selectedRequests: CollectionItem[],
            iterations: number,
            delayMs: number,
            continueOnError: boolean
        }) {
            if (context.state.collectionRunner.isRunning) {
                throw new Error('A collection run is already in progress')
            }

            if (selectedRequests.length === 0) {
                throw new Error('No requests selected')
            }

            // Initialize runner state
            const results: CollectionRunnerResult[] = []
            const collectionTree = context.state.collectionTree
            for (let i = 1; i <= iterations; i++) {
                selectedRequests.forEach(req => {
                    results.push({
                        requestId: req._id,
                        requestName: req.name,
                        method: req.method,
                        parentPath: getParentPath(collectionTree, req._id),
                        iteration: i,
                        status: 'pending',
                    })
                })
            }

            context.state.collectionRunner = {
                isRunning: true,
                sourceId: source._id,
                sourceName: source.name,
                allRequests: source._type === 'collection' ? getAllHttpRequestsInFolder({ children: source.children } as any) : getAllHttpRequestsInFolder(source),
                selectedRequests,
                currentRequestIndex: 0,
                currentIteration: 1,
                totalIterations: iterations,
                delayMs,
                results,
                abortController: new AbortController(),
                continueOnError,
                startTime: Date.now(),
                currentRequestId: null
            }

            // Don't await - let it run in background so modal can show immediately
            context.dispatch('executeCollectionRunnerNext')
        },
        async executeCollectionRunnerNext(context) {
            const runner = context.state.collectionRunner
            const isCurrentRun = () => context.state.collectionRunner === runner && runner.isRunning && !runner.abortController?.signal.aborted

            if (!runner.isRunning) {
                return
            }

            // Check if current iteration complete
            if (runner.currentRequestIndex >= runner.selectedRequests.length) {
                // Check if this was the last iteration
                if (runner.currentIteration >= runner.totalIterations) {
                    context.commit('completeCollectionRunner')
                    return
                }
                context.commit('advanceCollectionRunnerProgress', {
                    requestIndex: 0,
                    iteration: runner.currentIteration + 1
                })
                await context.dispatch('executeCollectionRunnerNext')
                return
            }

            // Check if aborted
            if (runner.abortController?.signal.aborted) {
                context.commit('abortCollectionRunner')
                return
            }

            const currentRequest = runner.selectedRequests[runner.currentRequestIndex]
            const resultIndex = (runner.currentIteration - 1) * runner.selectedRequests.length + runner.currentRequestIndex

            // Set status to running and track current request
            context.commit('startCollectionRunnerRequest', {
                resultIndex,
                requestId: currentRequest._id
            })

            const startTime = Date.now()
            // the response of this send, not the one the tab shows, which another send on it can replace
            const response = await context.dispatch('sendRequest', currentRequest)
            if(!isCurrentRun()) {
                return
            }
            const timeTaken = Date.now() - startTime

            // Check for failure: either response error OR any failed tests
            // a body cut short counts as a failed request, even when its tests passed
            const hasResponseError = response && (response.error || response.bodyIncomplete)
            const hasFailedTests = response && response.testResults && response.testResults.some((test: PluginTestResult) => !test.passed)

            if (hasResponseError || hasFailedTests) {
                // Request failed - determine error message
                let errorMessage: string
                if (hasResponseError) {
                    errorMessage = response.error || BODY_INCOMPLETE_MESSAGES[response.bodyIncomplete as BodyIncomplete]
                } else {
                    const failedCount = response.testResults.filter((test: PluginTestResult) => !test.passed).length
                    errorMessage = `${failedCount} test(s) failed`
                }

                context.commit('completeCollectionRunnerRequest', {
                    resultIndex,
                    status: 'error',
                    timeTaken,
                    statusCode: response?.status,
                    url: response?.url,
                    responseSize: response?.buffer?.byteLength,
                    testResults: response?.testResults,
                    error: errorMessage
                })

                if (runner.continueOnError) {
                    // Delay before next request
                    if (runner.delayMs > 0) {
                        await new Promise<void>((resolve) => {
                            const timeout = setTimeout(resolve, runner.delayMs)
                            runner.abortController?.signal.addEventListener('abort', () => {
                                clearTimeout(timeout)
                                resolve()
                            }, { once: true })
                        })
                        if(!isCurrentRun()) {
                            return
                        }
                    }
                    context.commit('advanceCollectionRunnerProgress', {
                        requestIndex: runner.currentRequestIndex + 1,
                        iteration: runner.currentIteration
                    })
                    await context.dispatch('executeCollectionRunnerNext')
                } else {
                    context.commit('completeCollectionRunner')
                }
            } else {
                // Request succeeded
                context.commit('completeCollectionRunnerRequest', {
                    resultIndex,
                    status: 'success',
                    timeTaken,
                    statusCode: response?.status,
                    url: response?.url,
                    responseSize: response?.buffer?.byteLength,
                    testResults: response?.testResults
                })

                // Delay before next request
                if (runner.delayMs > 0) {
                    await new Promise<void>((resolve) => {
                        const timeout = setTimeout(resolve, runner.delayMs)
                        runner.abortController?.signal.addEventListener('abort', () => {
                            clearTimeout(timeout)
                            resolve()
                        }, { once: true })
                    })
                    if(!isCurrentRun()) {
                        return
                    }
                }

                context.commit('advanceCollectionRunnerProgress', {
                    requestIndex: runner.currentRequestIndex + 1,
                    iteration: runner.currentIteration
                })
                await context.dispatch('executeCollectionRunnerNext')
            }
        },
        cancelCollectionRunner(context) {
            // Abort the currently running request if any
            const currentRequestId = context.state.collectionRunner.currentRequestId
            if (currentRequestId && context.state.requestAbortController[currentRequestId]) {
                context.state.requestAbortController[currentRequestId].abort()
            }

            // Abort the runner's abort controller to stop future iterations
            if (context.state.collectionRunner.abortController) {
                context.state.collectionRunner.abortController.abort()
            }

            context.commit('abortCollectionRunner')
        },
    }
})

export default store
