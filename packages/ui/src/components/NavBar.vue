<template>
    <div class="navbar">
        <div class="heading">
            <img src="/pwa-192x192.png" width="20" height="20" style="margin-right: 5px;">
            <div v-if="!activeWorkspaceLoaded">Workspaces</div>
            <div v-else>
                <a href="#" @click.prevent="setActiveWorkspace(null)">Workspaces</a> > <span>{{ activeWorkspace.name }}</span>
            </div>
            <div style="margin-left: 0.5rem; font-size: 0.6rem" v-if="activeWorkspaceLoaded && activeWorkspace._type === 'file'">
                <button class="button" @click="openWorkspaceFolder">Open Folder</button>
            </div>
        </div>
        <div class="right-nav-container">
            <a href="#" @click.prevent="cycleTheme()" class="bl theme-selector">Theme: {{ getThemeName(theme) }}</a>
            <div v-if="nav === 'collection'" style="height: 100%;">
                <template v-if="activeTab && activeTab._type === 'request'">
                    <a href="#" @click.prevent="requestResponseLayout = 'top-bottom'" v-if="requestResponseLayout === 'left-right'" class="bl view-switcher">View: Column</a>
                    <a href="#" @click.prevent="requestResponseLayout = 'left-right'" v-else class="bl view-switcher">View: Row</a>
                </template>
                <div style="display: inline-flex; align-items: center; height: 100%; margin-right: 0.5rem;">
                    <a href="#" @click.prevent="environmentModalShow = true" style="margin-right: 0.2rem; padding-right: 0.2rem;" class="bl">Environment</a>
                    <div class="custom-dropdown" style="padding-left: 0;" @click="toggleEnvSelectorDropdown">
                        <i class="fa fa-circle" :style="{ color: envColor }"></i> {{ currentEnvironment ?? 'Default' }}
                    <i class="fa fa-caret-down space-right"></i>
                    </div>
                    <ContextMenu
                        :options="getEnvList()"
                        :element="envSelectorElement"
                        :x="envSelectorContextMenuX"
                        :y="envSelectorContextMenuY"
                        v-model:show="envSelectorDropdownVisible"
                        :selected-option="currentEnvironment"
                        @click="selectEnv"
                    />
                </div>
                <a href="#" @click.prevent="showImportModal" class="bl">Import</a>
                <a href="#" @click.prevent="exportCollection" class="bl">Export</a>
            </div>
            <template v-if="nav === 'workspaces'">
                <a href="#" @click.prevent="showAddWorkspace" class="bl">Add Workspace</a>
                <a href="#" @click.prevent="openFileWorkspace" class="bl" title="Open an existing file workspace" v-if="flags.isElectron">Open File Workspace</a>
                <a href="#" @click.prevent="backupAndRestore" class="bl">Backup & Restore</a>
            </template>
            <a href="#" @click.prevent="showPluginsManager" class="bl">Plugins</a>
            <a href="#" @click.prevent="showSettings" class="bl br">Settings</a>
            <a href="#" @click.prevent="showLogs" class="bl br">Logs</a>
            <span class="spacer"></span>
            <div class="github-star">
                <a class="gh-button-container" href="https://github.com/flawiddsouza/Restfox" rel="noopener" target="_blank" title="Star Restfox" aria-label="Star Restfox on GitHub">
                    <svg viewBox="0 0 16 16" width="14" height="14" class="octicon octicon-mark-github" aria-hidden="true">
                        <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
                    </svg>
                    <span style="margin-left: 3px; margin-right: 5px;">Star</span>
                    <span :aria-label="`${githubStarCount} stargazers on GitHub`" style="border-left: 1px solid var(--default-border-color); padding-left: 5px; padding-top: 3px; padding-bottom: 3px;">{{ githubStarCount }}</span>
                </a>
            </div>
        </div>
    </div>
    <PluginManagerModal v-model:showModal="showPluginManagerModal" />
    <AddWorkspaceModal v-model:showModal="showAddWorkspaceModal" :is-electron="flags.isElectron" />
    <SettingsModal v-model:showModal="showSettingsModal" />
    <LogsModal v-model:showModal="showLogsModal"></LogsModal>
    <EnvironmentModal v-model:showModal="environmentModalShow" :workspace="activeWorkspace" v-if="activeWorkspace" />
    <BackupAndRestoreModal />
</template>

<script>
import PluginManagerModal from './modals/PluginManagerModal.vue'
import AddWorkspaceModal from './modals/AddWorkspaceModal.vue'
import SettingsModal from './modals/SettingsModal.vue'
import EnvironmentModal from './modals/EnvironmentModal.vue'
import BackupAndRestoreModal from './modals/BackupAndRestoreModal.vue'
import LogsModal from './modals/LogsModal.vue'
import {
    exportRestfoxCollection,
    applyTheme,
    generateNewIdsForTree,
    toTree,
    flattenTree,
} from '@/helpers'
import { getCollectionForWorkspace } from '@/db'
import constants from '../constants'
import ContextMenu from '@/components/ContextMenu.vue'

export default {
    components: {
        ContextMenu,
        PluginManagerModal,
        AddWorkspaceModal,
        SettingsModal,
        EnvironmentModal,
        BackupAndRestoreModal,
        LogsModal
    },
    props: {
        nav: String,
    },
    data() {
        return {
            showSettingsModal: false,
            showPluginManagerModal: false,
            showAddWorkspaceModal: false,
            environmentModalShow: false,
            showLogsModal: false,
            envSelectorElement: null,
            envSelectorContextMenuX: null,
            envSelectorContextMenuY: null,
            envSelectorDropdownVisible: false,
            envColor: null,
        }
    },
    computed: {
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        },
        activeWorkspaceLoaded() {
            return this.$store.state.activeWorkspaceLoaded
        },
        environments() {
            return this.activeWorkspace.environments ?? [
                {
                    name: constants.DEFAULT_ENVIRONMENT.name,
                    environment: this.activeWorkspace.environment,
                    color: constants.DEFAULT_ENVIRONMENT.color
                }
            ]
        },
        currentEnvironment: {
            get() {
                return this.activeWorkspace?.currentEnvironment ?? constants.DEFAULT_ENVIRONMENT.name
            },
            set(value) {
                this.activeWorkspace.currentEnvironment = value
                this.$store.commit('updateWorkspaceCurrentEnvironment', {
                    workspaceId: this.activeWorkspace._id,
                    currentEnvironment: value
                })
                const selectedEnvironment = this.environments.find(environmentItem => environmentItem.name === value)
                this.activeWorkspace.environment = selectedEnvironment.environment
                this.$store.commit('updateWorkspaceEnvironment',  {
                    workspaceId: this.activeWorkspace._id,
                    environment: selectedEnvironment.environment
                })
            }
        },
        requestResponseLayout: {
            get() {
                return this.$store.state.requestResponseLayout
            },
            set(value) {
                this.$store.state.requestResponseLayout = value
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.REQUEST_RESPONSE_LAYOUT, value)
            }
        },
        theme: {
            get() {
                return this.$store.state.theme
            },
            set(value) {
                this.$store.state.theme = value
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.THEME, value)
                applyTheme(value)
            }
        },
        githubStarCount() {
            return this.$store.state.githubStarCount
        },
        activeTab() {
            return this.$store.state.activeTab
        },
        flags() {
            return this.$store.state.flags
        },
    },
    methods: {
        async exportCollection() {
            let { collection } = await getCollectionForWorkspace(this.activeWorkspace._id)
            for(const item of collection) {
                item.plugins = this.$store.state.plugins.workspace.filter(plugin => plugin.collectionId === item._id)
            }

            // if the workspace is a file workspace, we need to generate new ids for the collection
            // as ids are just file paths in the case of file workspaces
            // we don't want to leak the file paths in the exported collection
            if(this.activeWorkspace._type === 'file') {
                const collectionTree = toTree(collection)
                generateNewIdsForTree(collectionTree)
                collection = flattenTree(collectionTree)
            }

            exportRestfoxCollection(collection, this.activeWorkspace.environments)
        },
        setActiveWorkspace(workspace) {
            this.$store.commit('setActiveWorkspace', workspace)
        },
        showSettings() {
            this.showSettingsModal = true
        },
        showLogs() {
            this.showLogsModal = true
        },
        showPluginsManager() {
            this.showPluginManagerModal = true
        },
        showAddWorkspace() {
            this.showAddWorkspaceModal = true
        },
        showImportModal() {
            this.$store.commit('showImportModalSelectedRequestGroupId', null)
            this.$store.commit('showImportModal', true)
        },
        backupAndRestore() {
            this.$store.commit('showBackupAndRestoreModal', true)
        },
        async openWorkspaceFolder() {
            await window.electronIPC.openFolder(this.activeWorkspace.location)
        },
        async openFileWorkspace() {
            const selectedFolderPath = await window.electronIPC.openFolderSelectionDialog()
            if(selectedFolderPath) {
                try {
                    const workspace = await window.electronIPC.getWorkspaceAtLocation(selectedFolderPath)
                    const existingWorkspace = this.$store.state.workspaces.find(workspaceItem => workspaceItem.location === selectedFolderPath)
                    if(existingWorkspace) {
                        console.log(existingWorkspace)
                        this.setActiveWorkspace(existingWorkspace)
                    } else {
                        this.$store.dispatch('createWorkspace', {
                            name: workspace.name,
                            _type: 'file',
                            location: selectedFolderPath,
                            setAsActive: true
                        })
                    }
                } catch(e) {
                    this.$toast.error('No workspace found in the selected folder')
                }
            }
        },
        getThemeName(theme) {
            return theme.charAt(0).toUpperCase() + theme.slice(1)
        },
        cycleTheme() {
            const themes = [
                'light',
                'dark',
                'dracula'
            ]

            const currentIndex = themes.indexOf(this.theme)
            const nextIndex = (currentIndex + 1) % themes.length
            this.theme = themes[nextIndex]
        },
        toggleEnvSelectorDropdown(event) {
            this.envSelectorDropdownVisible = !this.envSelectorDropdownVisible
            if (this.envSelectorDropdownVisible) {
                const containerElement = event.target.closest('.custom-dropdown')
                this.envSelectorContextMenuX = containerElement.getBoundingClientRect().left
                this.envSelectorContextMenuY = containerElement.getBoundingClientRect().top + containerElement.getBoundingClientRect().height
                this.envSelectorElement = containerElement
            } else {
                this.envSelectorElement = null
            }
        },
        getEnvList() {
            const listHeader = [
                {
                    type: 'option',
                    label: 'Environment',
                    icon: 'fa fa-globe',
                    disabled: true,
                    class: 'text-with-line'
                },]
            const list =  this.environments.map(item => {
                return {
                    type: 'option',
                    label: `&nbsp;<i class="fa fa-circle" style="color:${item.color}"></i> ${item.name}`,
                    value: `${item.name}`,
                    class: 'context-menu-item-with-left-padding'
                }
            })
            return [...listHeader, ...list]
        },
        selectEnv(value) {
            this.currentEnvironment = value
            this.envColor = this.environments.find(env => env.name === value).color || constants.DEFAULT_ENVIRONMENT.color
            this.$store.dispatch('reloadTabEnvironmentResolved')
        }
    },
    watch: {
        currentEnvironment(newVal) {
            this.envColor = this.environments.find(env => env.name === newVal).color || constants.DEFAULT_ENVIRONMENT.color
        },
        activeWorkspaceLoaded(newVal) {
            if (newVal) {
                this.envColor = this.environments.find(env => env.name === this.currentEnvironment).color || constants.DEFAULT_ENVIRONMENT.color
            }
        }
    },
    created() {
        if (this.activeWorkspaceLoaded) {
            this.envColor = this.environments.find(env => env.name === this.currentEnvironment).color || constants.DEFAULT_ENVIRONMENT.color
        }
    }
}
</script>

<style scoped>
.navbar {
    padding-left: 1em;
    padding-right: 1em;
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 31.5px;
}

.spacer {
    padding-left: 1em;
}

.heading {
    font-weight: 500;
    display: flex;
    align-items: center;
}

.right-nav-container {
    display: flex;
    align-items: center;
    height: 100%;
    min-width: fit-content;
}

.heading a:not(:hover), .right-nav-container a {
    text-decoration: none;
}

.right-nav-container a {
    display: inline-flex;
    align-items: center;
    height: 100%;
    padding-left: 0.5rem;
    padding-right: 0.5rem;
    color: var(--text-color);
}

.right-nav-container a:hover {
    background-color: var(--border-color-lighter-darkened);
}

.right-nav-container a.bl {
    border-left: 1px solid var(--border-color-lighter);
}

.right-nav-container a.br {
    border-right: 1px solid var(--border-color-lighter);
}

.right-nav-container .gh-button-container {
    border: 1px solid var(--default-border-color);
    border-radius: 0.25em;
    line-height: 14px;
}

.right-nav-container .gh-button-container > svg {
    fill: var(--github-button-icon-fill-color);
}

@media (max-width: 1150px) {
    .theme-selector, .view-switcher, .github-star {
        display: none !important;
    }
}
</style>
