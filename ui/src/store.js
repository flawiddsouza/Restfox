import { createStore } from 'vuex'
import { nanoid } from 'nanoid'

function toTree(data, pid = null) {
    return data.reduce((r, e) => {
        if (e.parentId == pid) {
            const obj = { ...e }
            const children = toTree(data, e._id)
            if (children.length) obj.children = children
            r.push(obj)
        }
        return r
    }, [])
}

import insomniaExport from '@/Insomnia_Export.json'
const collection = insomniaExport.resources

const store = createStore({
    state() {
        return {
            collection: collection,
            tabs: [],
            activeTab: null
        }
    },
    getters: {
        collectionTree(state) {
            return toTree(state.collection.filter(item => ['cookie_jar', 'api_spec', 'environment'].includes(item._type) == false))
        }
    },
    mutations: {
        addTab(state, tab) {
            const existingTab = state.tabs.find(tabItem => tabItem._id === tab._id)
            if(!existingTab) {
                state.tabs.push(tab)
            }
            state.activeTab = tab
        },
        setActiveTab(state, tab) {
            state.activeTab = tab
        },
        closeTab(state, tab) {
            state.tabs = state.tabs.filter(tabItem => tabItem._id !== tab._id)
            if(state.activeTab && state.activeTab._id === tab._id) {
                state.activeTab = null
            }
        }
    }
})

export default store
