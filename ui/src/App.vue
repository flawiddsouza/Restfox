<script setup>
import WorkspacesFrame from '@/components/WorkspacesFrame.vue'
import Frame from '@/components/Frame.vue'
import ReloadPrompt from '@/components/ReloadPrompt.vue'
</script>

<template>
    <WorkspacesFrame v-if="activeWorkspace === null" />
    <Frame v-if="activeWorkspace" />
    <ReloadPrompt />
</template>

<script>
import { getCollectionForWorkspace } from './db'
import constants from './constants'
import { findItemInTreeById } from './helpers'

export default {
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        }
    },
    watch: {
        'activeTab.url'() {
            // sync query params in url with query params in collection if they are the same
            if(this.activeTab && 'url' in this.activeTab && this.activeTab.url && 'parameters' in this.activeTab) {
                let urlParamsSplit = this.activeTab.url.split('?')
                if(urlParamsSplit.length > 1) {
                    const urlSearchParams = new URLSearchParams(urlParamsSplit[1])
                    for(const urlParam of urlSearchParams.entries()) {
                        this.activeTab.parameters.filter(item => !item.disabled && item.name === urlParam[0]).forEach(matchingParam => {
                            matchingParam.value = urlParam[1]
                        })
                    }
                }
            }
        },
        'activeTab.parameters': {
            handler() {
                // sync query params in url with query params in collection if they are the same
                if(this.activeTab && 'url' in this.activeTab && this.activeTab.url) {
                    let urlParamsSplit = this.activeTab.url.split('?')
                    if(urlParamsSplit.length > 1) {
                        const urlSearchParams = new URLSearchParams(urlParamsSplit[1])
                        this.activeTab.parameters.filter(item => !item.disabled).forEach(param => {
                            if(urlSearchParams.has(param.name)) {
                                urlSearchParams.set(param.name, param.value)
                            }
                        })
                        urlParamsSplit[1] = urlSearchParams.toString()
                        this.activeTab.url = urlParamsSplit.join('?')
                    }
                }
            },
            deep: true
        },
        activeTab: {
            handler(newValue, oldValue) {
                // don't commit change when activeTab is set for the first time
                // and when activeTab is changed from one tab to another,
                // having same id in oldValue & newValue means same object
                // has changed, so we need to save the object
                if(oldValue && newValue && oldValue._id === newValue._id) {
                    this.$store.commit('persistActiveTab')

                    // keep method property in sync
                    const sidebarItem = findItemInTreeById(this.$store.state.collectionTree, this.activeTab._id)
                    if(sidebarItem) {
                        sidebarItem.method = this.activeTab.method
                    }

                    const tab = this.$store.state.tabs.find(tab => tab._id === this.activeTab._id)
                    if(tab) {
                        tab.method = this.activeTab.method
                    }
                }
            },
            deep: true
        },
        async activeWorkspace() {
            if(this.activeWorkspace) {
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.ACTIVE_WORKSPACE_ID, this.activeWorkspace._id)
            } else {
                localStorage.removeItem(constants.LOCAL_STORAGE_KEY.ACTIVE_WORKSPACE_ID)
            }
            await this.fetchSetCollectionForWorkspace()
        }
    },
    methods: {
        async fetchSetCollectionForWorkspace() {
            if(!this.activeWorkspace) {
                this.$store.commit('setCollection', [])
                return
            }

            const collections = await getCollectionForWorkspace(this.activeWorkspace._id)

            if(collections.length > 0) {
                this.$store.commit('setCollection', collections)
            }
        }
    },
    async created() {
        this.$store.dispatch('loadPlugins')
        await this.$store.dispatch('loadWorkspaces')
        await this.fetchSetCollectionForWorkspace()
    },
    mounted() {
        const messageHandler = message => {
            if(message.data.event === '__EXTENSION_HOOK__') {
                window.__EXTENSION_HOOK__ = message.data.eventData
                console.log(message.data.eventData)
            }

            if(message.data.event === '__EXTENSION_UN_HOOK__') {
                delete window.__EXTENSION_HOOK__
                console.log(message.data.eventData)
            }
        }

        window.addEventListener('message', messageHandler)
    }
}
</script>

<style lang="scss">
@import '@/styles/normalize.css';
@import '@/styles/reset.css';
@import '@/styles/main.css';
</style>
