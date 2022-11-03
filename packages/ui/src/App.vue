<script setup>
import WorkspacesFrame from '@/components/WorkspacesFrame.vue'
import Frame from '@/components/Frame.vue'
import ReloadPrompt from '@/components/ReloadPrompt.vue'
</script>

<template>
    <WorkspacesFrame v-if="activeWorkspace === null" />
    <Frame v-if="activeWorkspace" />
    <ReloadPrompt />
    <alert-confirm-prompt />
</template>

<script>
import { getCollectionForWorkspace } from './db'
import constants from './constants'
import { checkHotkeyAgainstKeyEvent, findItemInTreeById, applyTheme } from './helpers'
import './web-components/alert-confirm-prompt'

export default {
    data() {
        return {
            currentlySelectedContextMenuItemIndex: -1
        }
    },
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        },
        tabs() {
            return this.$store.state.tabs
        },
        openContextMenuElement() {
            return this.$store.state.openContextMenuElement
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

                    // keep sidebarItem properties in sync with activeTab
                    const sidebarItem = findItemInTreeById(this.$store.state.collectionTree, this.activeTab._id)
                    if(sidebarItem) {
                        Object.assign(sidebarItem, this.activeTab)
                    }

                    // keep tab properties in tabs in sync with activeTab
                    const tab = this.$store.state.tabs.find(tab => tab._id === this.activeTab._id)
                    if(tab) {
                        Object.assign(tab, this.activeTab)
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
        },
        openContextMenuElement() {
            if(this.openContextMenuElement === null) {
                this.currentlySelectedContextMenuItemIndex = -1
            }
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

            this.$store.commit('loadWorkspaceTabs')
        },
        handleGlobalKeydown(event) {
            if(this.openContextMenuElement) {
                const enabledContextMenuItems = Array.from(this.openContextMenuElement.querySelectorAll('.context-menu > div > button:not(:disabled)'))

                if(event.key === 'ArrowUp') {
                    this.currentlySelectedContextMenuItemIndex = this.currentlySelectedContextMenuItemIndex > 0 ? this.currentlySelectedContextMenuItemIndex - 1 : enabledContextMenuItems.length - 1
                    enabledContextMenuItems[this.currentlySelectedContextMenuItemIndex].focus()
                    return
                }

                if(event.key === 'ArrowDown') {
                    this.currentlySelectedContextMenuItemIndex = this.currentlySelectedContextMenuItemIndex < enabledContextMenuItems.length - 1 ? this.currentlySelectedContextMenuItemIndex + 1 : 0
                    enabledContextMenuItems[this.currentlySelectedContextMenuItemIndex].focus()
                    return
                }

                if(event.key === 'Home') {
                    this.currentlySelectedContextMenuItemIndex = 0
                    enabledContextMenuItems[this.currentlySelectedContextMenuItemIndex].focus()
                    return
                }

                if(event.key === 'End') {
                    this.currentlySelectedContextMenuItemIndex = enabledContextMenuItems.length - 1
                    enabledContextMenuItems[this.currentlySelectedContextMenuItemIndex].focus()
                    return
                }

                if(event.key === 'Escape') {
                    this.openContextMenuElement.querySelector('.context-menu-background').click()
                    return
                }
            }

            const hotkeys = constants.HOTKEYS

            // all keyboard shortcuts below depend on the active tab, so we return if there's no active tab
            if(!this.activeTab) {
                return
            }

            if(checkHotkeyAgainstKeyEvent(hotkeys.SEND_REQUEST, event)) {
                event.preventDefault()
                event.stopPropagation()

                this.$store.dispatch('sendRequest', this.activeTab)

                return
            }

            if(checkHotkeyAgainstKeyEvent(hotkeys.CLOSE_TAB, event) || checkHotkeyAgainstKeyEvent(hotkeys.CLOSE_TAB_ALTERNATE, event)) {
                event.preventDefault()
                event.stopPropagation()

                this.$store.commit('closeTab', this.activeTab._id)
                this.$store.commit('persistActiveWorkspaceTabs')

                return
            }

            if(checkHotkeyAgainstKeyEvent(hotkeys.SWITCH_TO_NEXT_TAB, event) || checkHotkeyAgainstKeyEvent(hotkeys.SWITCH_TO_NEXT_TAB_ALTERNATE, event)) {
                event.preventDefault()
                event.stopPropagation()

                const tabIndex = this.tabs.findIndex(tab => tab._id === this.activeTab._id)

                const nextTabIndex = tabIndex + 1

                const nextTab = nextTabIndex <= this.tabs.length - 1 ? this.tabs[nextTabIndex] : this.tabs[0]

                if(nextTab) {
                    this.$store.commit('setActiveTab', nextTab)
                }

                return
            }

            if(checkHotkeyAgainstKeyEvent(hotkeys.SWITCH_TO_PREVIOUS_TAB, event) || checkHotkeyAgainstKeyEvent(hotkeys.SWITCH_TO_PREVIOUS_TAB_ALTERNATE, event)) {
                event.preventDefault()
                event.stopPropagation()

                const tabIndex = this.tabs.findIndex(tab => tab._id === this.activeTab._id)

                const previousTabIndex = tabIndex - 1

                const previousTab = previousTabIndex >= 0 ? this.tabs[previousTabIndex] : this.tabs[this.tabs.length - 1]

                if(previousTab) {
                    this.$store.commit('setActiveTab', previousTab)
                }

                return
            }
        }
    },
    async created() {
        this.$store.dispatch('loadPlugins')
        await this.$store.dispatch('loadWorkspaces')

        if(import.meta.env.MODE === 'desktop') {
            this.$store.state.flags.isBrowser = false
        }
    },
    mounted() {
        const messageHandler = message => {
            if(message.data.event === '__EXTENSION_HOOK__') {
                // this keeps getting called whenever tab is changed, so we do this
                if(window.__EXTENSION_HOOK__ === message.data.eventData) {
                    return
                }
                window.__EXTENSION_HOOK__ = message.data.eventData
                this.$store.state.flags.hideBrowserRelatedResponsePanelErrors = true
                this.$store.state.flags.browserExtensionEnabled = true
                console.log(message.data.eventData)
            }

            if(message.data.event === '__EXTENSION_UN_HOOK__') {
                delete window.__EXTENSION_HOOK__
                this.$store.state.flags.hideBrowserRelatedResponsePanelErrors = false
                this.$store.state.flags.browserExtensionEnabled = false
                console.log(message.data.eventData)
            }
        }

        window.addEventListener('message', messageHandler)

        window.addEventListener('keydown', this.handleGlobalKeydown)

        const savedTheme = localStorage.getItem(constants.LOCAL_STORAGE_KEY.THEME)

        if(savedTheme) {
            this.$store.state.theme = savedTheme
            applyTheme(savedTheme)
        }
    },
    beforeUnmount() {
        window.removeEventListener('keydown', this.handleGlobalKeydown)
    }
}
</script>

<style lang="scss">
@import '@/styles/normalize.css';
@import '@/styles/reset.css';
@import '@/styles/main.css';
</style>
