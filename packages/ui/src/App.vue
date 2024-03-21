<script setup>
import WorkspacesFrame from '@/components/WorkspacesFrame.vue'
import Frame from '@/components/Frame.vue'
import ReloadPrompt from '@/components/ReloadPrompt.vue'
</script>

<template>
    <WorkspacesFrame v-if="appLoaded && !activeWorkspaceLoaded" />
    <Frame v-if="appLoaded && activeWorkspaceLoaded" />
    <ReloadPrompt />
    <alert-confirm-prompt />
</template>

<script>
import { getCollectionForWorkspace } from './db'
import constants from './constants'
import { checkHotkeyAgainstKeyEvent, findItemInTreeById, applyTheme } from './helpers'
import { emitter } from './event-bus'
import './web-components/alert-confirm-prompt'

export default {
    data() {
        return {
            currentlySelectedContextMenuItemIndex: -1,
            appLoaded: false,
        }
    },
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        },
        activeWorkspaceLoaded: {
            get() {
                return this.$store.state.activeWorkspaceLoaded
            },
            set(value) {
                this.$store.state.activeWorkspaceLoaded = value
            }
        },
        tabs() {
            return this.$store.state.tabs
        },
        openContextMenuElement() {
            return this.$store.state.openContextMenuElement
        }
    },
    watch: {
        // sync query params in url with query params in request
        'activeTab.url'(newValue, previousValue) {
            if (!newValue || !previousValue) {
                return
            }

            const previousParams = new URLSearchParams(previousValue.split('?')[1] || '')
            const newParams = new URLSearchParams(newValue.split('?')[1] || '')

            // no change in url query params
            if(previousParams.toString() === newParams.toString()) {
                return
            }

            const paramMap = new Map()

            // Add all parameters from the new URL to paramMap, overriding any existing ones
            newParams.forEach((value, key) => paramMap.set(key, value))

            // Detect changed parameters by comparing previous and new values
            const changedParams = []
            previousParams.forEach((value, key) => {
                if (!newParams.has(key)) { // Parameter is removed
                    changedParams.push(key)
                }
            })

            if(this.activeTab.parameters === undefined) {
                this.activeTab.parameters = []
            }

            this.activeTab.parameters = this.activeTab.parameters.filter(param => {
                // Keep all parameters except the ones that have been explicitly changed
                return !changedParams.includes(param.name) || paramMap.has(param.name)
            })

            // Map existing parameters to keep track of which ones have been handled
            const existingParameters = new Map()
            this.activeTab.parameters.forEach(param => existingParameters.set(param.name, param))

            // Update the values of parameters or create new ones based on the new URL
            paramMap.forEach((value, key) => {
                if (existingParameters.has(key)) {
                    // Update existing parameter's value
                    existingParameters.get(key).value = value
                } else {
                    // Add new parameter
                    this.activeTab.parameters.push({
                        name: key,
                        value: value,
                        disabled: false
                    })
                }
            })
        },
        'activeTab.parameters': {
            handler() {
                // sync query params in url with query params in collection if they are the same
                if(this.activeTab && 'url' in this.activeTab && this.activeTab.url && this.activeTab.parameters) {
                    let urlParamsSplit = this.activeTab.url.split('?')
                    if(urlParamsSplit.length > 1) {
                        const urlSearchParams = new URLSearchParams(urlParamsSplit[1])
                        this.activeTab.parameters.filter(item => !item.disabled).forEach(param => {
                            if(urlSearchParams.has(param.name)) {
                                urlSearchParams.set(param.name, param.value)
                            }
                        })
                        urlParamsSplit[1] = [...urlSearchParams.entries()].map(entry => `${entry[0]}=${entry[1]}`).join('&')
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

                if(newValue !== null) {
                    this.$store.dispatch('updateActiveTabEnvironmentResolved')
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
                this.activeWorkspaceLoaded = false
                this.$store.commit('setCollection', [])
                return
            }

            const { error, collection: collections, workspace } = await getCollectionForWorkspace(this.activeWorkspace._id)

            if(error) {
                this.$store.commit('setActiveWorkspace', null)
                this.$toast.error(error.message)
                this.appLoaded = true
                return
            }

            // is not null if file workspace
            if(workspace) {
                this.activeWorkspace.name = workspace.name
                if(workspace.environment) {
                    this.activeWorkspace.environment = workspace.environment
                    this.activeWorkspace.environments = workspace.environments
                    this.activeWorkspace.currentEnvironment = workspace.currentEnvironment
                }
            }

            this.$store.commit('loadWorkspacePlugins', this.activeWorkspace._id)

            this.appLoaded = true
            this.activeWorkspaceLoaded = true

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
        },
        handleError(errorMessage) {
            this.$toast.error(errorMessage)
        },
    },
    async created() {
        this.$store.dispatch('loadGlobalPlugins')
        await this.$store.dispatch('loadWorkspaces', () => {
            this.appLoaded = true
        })

        if(import.meta.env.MODE === 'desktop' || import.meta.env.MODE === 'desktop-electron' || import.meta.env.MODE === 'web-standalone') {
            this.$store.state.flags.isBrowser = false
        }

        if(import.meta.env.MODE === 'desktop-electron') {
            this.$store.state.flags.isElectron = true
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
        const savedGithubStarCount = localStorage.getItem(constants.LOCAL_STORAGE_KEY.GITHUB_STAR_COUNT)
        let savedDisablePageViewAnalyticsTracking = localStorage.getItem(constants.LOCAL_STORAGE_KEY.DISABLE_PAGE_VIEW_ANALYTICS_TRACKING)
        const savedDisableSSLVerification = localStorage.getItem(constants.LOCAL_STORAGE_KEY.DISABLE_SSL_VERIFICATION)
        const savedElectronSwitchToChromiumFetch = localStorage.getItem(constants.LOCAL_STORAGE_KEY.ELECTRON_SWITCH_TO_CHROMIUM_FETCH)

        if(savedTheme) {
            this.$store.state.theme = savedTheme
            applyTheme(savedTheme)
        }

        if(savedGithubStarCount) {
            this.$store.state.githubStarCount = savedGithubStarCount
        }

        fetch('https://api.github.com/repos/flawiddsouza/Restfox').then(async response => {
            if(response.ok) {
                const responseData = await response.json()
                this.$store.state.githubStarCount = responseData.stargazers_count
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.GITHUB_STAR_COUNT, this.$store.state.githubStarCount)
            }
        })

        if(savedDisablePageViewAnalyticsTracking) {
            try {
                savedDisablePageViewAnalyticsTracking = JSON.parse(savedDisablePageViewAnalyticsTracking)
            } catch(e) {
                savedDisablePageViewAnalyticsTracking = false
            }
        }

        if(!savedDisablePageViewAnalyticsTracking) {
            const script = document.createElement('script')
            script.async = true
            script.defer = true
            script.dataset.websiteId = 'ed9e95fd-48af-4aac-a929-2a9f04ce9883'
            script.src = 'https://umami.artelin.dev/umami-analytics.js'
            document.body.appendChild(script)
        }

        if(savedDisableSSLVerification) {
            try {
                this.$store.state.flags.disableSSLVerification = JSON.parse(savedDisableSSLVerification)
            } catch(e) {
                this.$store.state.flags.disableSSLVerification = false
            }
        }

        if(savedElectronSwitchToChromiumFetch) {
            try {
                this.$store.state.flags.electronSwitchToChromiumFetch = JSON.parse(savedElectronSwitchToChromiumFetch)
            } catch(e) {
                this.$store.state.flags.electronSwitchToChromiumFetch = false
            }
        }

        emitter.on('error', this.handleError)

        if(import.meta.env.MODE === 'desktop-electron') {
            window.electronIPC.workspaceChanged((event, path, controlledChange, controlledChangeReason) => {
                console.log('workspaceChanged', { event, path, controlledChange, controlledChangeReason })
                if(!controlledChange && this.activeWorkspace) {
                    this.$store.dispatch('refreshWorkspace')
                }
            })
        }
    },
    beforeUnmount() {
        window.removeEventListener('keydown', this.handleGlobalKeydown)
        emitter.off('error', this.handleError)
    }
}
</script>

<style lang="scss">
@import '@/styles/normalize.css';
@import '@/styles/reset.css';
@import '@/styles/main.css';
</style>
