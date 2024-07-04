<script setup>
import WorkspacesFrame from '@/components/WorkspacesFrame.vue'
import Frame from '@/components/Frame.vue'
import ReloadPrompt from '@/components/ReloadPrompt.vue'
</script>

<template>
    <WorkspacesFrame v-if="appLoaded && !activeWorkspaceLoaded" />
    <Frame v-if="appLoaded && activeWorkspaceLoaded" />
    <ReloadPrompt />
    <alert-confirm-prompt attach-to-window="true" />
</template>

<script>
import { getCollectionForWorkspace } from './db'
import constants from './constants'
import { checkHotkeyAgainstKeyEvent, applyTheme, debounce } from './helpers'
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
                if(this.activeWorkspace.name !== workspace.name) {
                    console.log('workspace name is different, updating in IndexedDB', {
                        oldName: this.activeWorkspace.name,
                        newName: workspace.name
                    })
                    this.$store.commit('updateWorkspaceNameInIndexedDB', {
                        workspaceId: this.activeWorkspace._id,
                        name: workspace.name
                    })
                }
                this.activeWorkspace.name = workspace.name
                if(workspace.environment) {
                    this.activeWorkspace.environment = workspace.environment
                    this.activeWorkspace.environments = workspace.environments
                    this.activeWorkspace.currentEnvironment = workspace.currentEnvironment
                    this.activeWorkspace.dotEnv = workspace.dotEnv
                }
            }

            this.$store.commit('loadWorkspacePlugins')

            this.appLoaded = true
            this.activeWorkspaceLoaded = true

            if(collections.length > 0) {
                this.$store.commit('setCollection', collections)
            }

            this.$store.dispatch('loadWorkspaceTabs')
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
                    this.$store.dispatch('setActiveTab', nextTab)
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
                    this.$store.dispatch('setActiveTab', previousTab)
                }

                return
            }
        },
        handleError(errorMessage) {
            this.$toast.error(errorMessage)
        },
        onWorkspaceChanged(refreshWorkspace, event, path, controlledChange, controlledChangeReason) {
            console.log('workspaceChanged', { event, path, controlledChange, controlledChangeReason })
            if(!controlledChange && this.activeWorkspace) {
                refreshWorkspace()

                if((event === 'add' || event === 'addDir') && path.endsWith('.responses.json') === false && path.endsWith('_collapsed') === false) {
                    let eventType = 'collectionItem'

                    const event = {
                        name: 'added',
                        data: {
                            path
                        }
                    }

                    if(path.includes('_environments')) {
                        eventType = 'environment'
                    }

                    if(path.endsWith('.plugins.json')) {
                        eventType = 'plugin'
                    }

                    console.log(`emit: ${eventType}`, event)
                    emitter.emit(eventType, event)
                }

                if((event === 'change') && path.endsWith('.responses.json') === false && path.endsWith('_collapsed') === false) {
                    let eventType = 'collectionItem'

                    const event = {
                        name: 'updated',
                        data: {
                            path
                        }
                    }

                    if(path.includes('_environments')) {
                        eventType = 'environment'
                    }

                    if(path.endsWith('.plugins.json')) {
                        eventType = 'plugin'
                    }

                    console.log(`emit: ${eventType}`, event)
                    emitter.emit(eventType, event)
                }

                if((event === 'unlinkDir' || event === 'unlink') && path.endsWith('.responses.json') === false && path.endsWith('_collapsed') === false) {
                    let eventType = 'collectionItem'

                    const event = {
                        name: 'deleted',
                        data: {
                            path
                        }
                    }

                    if(path.includes('_environments')) {
                        eventType = 'environment'
                    }

                    if(path.endsWith('.plugins.json')) {
                        eventType = 'plugin'
                    }

                    console.log(`emit: ${eventType}`, event)
                    emitter.emit(eventType, event)
                }
            }
        }
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
        const savedDisableIframeSandbox = localStorage.getItem(constants.LOCAL_STORAGE_KEY.DISABLE_IFRAME_SANDBOX)
        let savedDisableAutoUpdate = localStorage.getItem(constants.LOCAL_STORAGE_KEY.DISABLE_AUTO_UPDATE)

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

        if(savedDisableIframeSandbox) {
            try {
                this.$store.state.flags.disableIframeSandbox = JSON.parse(savedDisableIframeSandbox)
            } catch(e) {
                this.$store.state.flags.disableIframeSandbox = false
            }
        }

        if(savedDisableAutoUpdate) {
            try {
                savedDisableAutoUpdate = JSON.parse(savedDisableAutoUpdate)
            } catch(e) {
                savedDisableAutoUpdate = false
            }
        }
        this.$store.state.flags.disableAutoUpdate = savedDisableAutoUpdate

        emitter.on('error', this.handleError)

        if(import.meta.env.MODE === 'desktop-electron') {
            if (!savedDisableAutoUpdate) {
                console.log("invoke updateElectronApp")
                window.electronIPC.updateElectronApp()
            }
            const refreshWorkspace = debounce(() => {
                this.$store.dispatch('refreshWorkspace')
                this.$store.commit('loadWorkspacePlugins')
            }, 500)
            window.electronIPC.workspaceChanged((...args) => this.onWorkspaceChanged(refreshWorkspace, ...args))
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
