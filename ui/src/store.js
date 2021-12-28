import { createStore } from 'vuex'
import { nanoid } from 'nanoid'
import { toTree, flattenTree, handleRequest, filterTree, addSortOrderToTree, sortTree } from './helpers'
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
            collectionFilter: ''
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
        closeTab(state, tab) {
            const tabIndex = state.tabs.findIndex(tabItem => tabItem._id === tab._id)
            const tabIndexLeft = tabIndex - 1

            if(state.activeTab && state.activeTab._id === tab._id) {
                delete state.requestResponseStatus[state.activeTab._id]
                delete state.requestResponses[state.activeTab._id]
                state.activeTab = tabIndexLeft >= 0 ? state.tabs[tabIndexLeft] : null
            }

            state.tabs.splice(tabIndex, 1)
        },
        async sendRequest(state, activeTab) {
            state.requestResponseStatus[activeTab._id] = 'loading'
            const parent = await db.collections.where({ ':id': activeTab.parentId }).first()
            const environment = parent.environment ?? {}
            state.requestResponses[activeTab._id] = await handleRequest(activeTab, environment)
            state.requestResponseStatus[activeTab._id] = 'loaded'
        },
        showImportModal(state, value) {
            state.showImportModal = value
        },
        setCollectionTree(state, collectionTree) {
            addSortOrderToTree(collectionTree)
            state.collection = state.collection.concat(flattenTree(collectionTree))
            state.collection.forEach(item => {
                db.collections.put(JSON.parse(JSON.stringify(item)), [item._id])
            })
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
        }
    }
})

export default store
