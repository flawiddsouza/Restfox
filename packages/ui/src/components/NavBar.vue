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
            <div style="margin-left: 0.5rem; font-size: 0.6rem" v-if="activeWorkspaceLoaded">
                <button class="button workspace-quick-switcher" @click="openWorkspaceQuickSwitcher"><i class="fa fa-repeat"></i> Switch</button>
            </div>
        </div>
        <div class="right-nav-container">
            <a href="#" @click.prevent="cycleTheme()" class="bl theme-selector">Theme: {{ getThemeName(theme) }}</a>
            <div v-if="nav === 'collection'" style="height: 100%;">
                <template v-if="activeTab && activeTab._type === 'request'">
                    <a href="#" @click.prevent="requestResponseLayout = 'top-bottom'" v-if="requestResponseLayout === 'left-right'" class="bl view-switcher">View: Column</a>
                    <a href="#" @click.prevent="requestResponseLayout = 'left-right'" v-else class="bl view-switcher">View: Row</a>
                </template>
                <div class="navbar-item">
                    <a href="#" @click.prevent="environmentModalShow = true" style="margin-right: 0.2rem; padding-right: 0.2rem;">
                        <i class="fas fa-code" style="padding-right: 0.5rem"></i>
                        Environment
                    </a>
                    <div class="custom-dropdown" style="padding-left: 0; padding-right: 0.5rem;" @click="toggleEnvSelectorDropdown">
                        <i class="fa fa-circle" :style="{ color: currentEnvironmentColor }"></i>&nbsp;&nbsp;{{ currentEnvironment ?? 'Default' }}
                        <i class="fa fa-caret-down space-right"></i>
                    </div>
                    <ContextMenu
                        :options="getEnvList()"
                        :element="envSelectorDropdownState.element"
                        :x="envSelectorDropdownState.contextMenuX"
                        :y="envSelectorDropdownState.contextMenuY"
                        v-model:show="envSelectorDropdownState.visible"
                        :selected-option="currentEnvironment"
                        @click="selectEnv"
                    />
                </div>
                <div class="navbar-item">
                    <a href="#" @click.prevent="showImportModal">
                        <i class="fas fa-file-import" style="padding-right: 0.5rem"></i>
                        Import
                    </a>
                </div>
                <div class="navbar-item">
                    <div
                        class="custom-dropdown"
                        :style="{ 'pointer-events': collectionLength > 0 ? 'auto' : 'none', 'opacity': collectionLength > 0 ? '1' : '0.5' }"
                        style="padding-left: 0.5rem; padding-right: 0.5rem" @click="toggleExportSelectorDropdown"
                    >
                        <i class="fa fa-file-export"></i>&nbsp;&nbsp;{{ 'Export' }}
                        <i class="fa fa-caret-down space-right"></i>
                    </div>
                    <ContextMenu
                        :options="getExportList()"
                        :element="exportSelectorDropdownState.element"
                        :x="exportSelectorDropdownState.contextMenuX"
                        :y="exportSelectorDropdownState.contextMenuY"
                        v-model:show="exportSelectorDropdownState.visible"
                        @click="exportCollection"
                    />
                </div>
            </div>
            <template v-if="nav === 'workspaces'">
                <a href="#" @click.prevent="showAddWorkspace" class="bl">Add Workspace</a>
                <a href="#" @click.prevent="openFileWorkspace" class="bl" title="Open an existing file workspace" v-if="flags.isElectron">Open File Workspace</a>
                <a href="#" @click.prevent="backupAndRestore" class="bl">Backup & Restore</a>
            </template>
            <div class="navbar-item">
                <a href="#" @click.prevent="showPluginsManager">
                    <i class="fas fa-plug" style="padding-right: 0.5rem"></i>
                    Plugins
                </a>
            </div>
            <div class="navbar-item">
                <a href="#" @click.prevent="showSettings">
                    <i class="fas fa-cog" style="padding-right: 0.5rem"></i>
                    Settings
                </a>
            </div>
            <div class="navbar-item">
                <a href="#" @click.prevent="showLogs" class="br">
                    <i class="fas fa-file-lines" style="padding-right: 0.5rem"></i>
                    Logs
                </a>
            </div>
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
    <EnvironmentModal v-model:showModal="environmentModalShow" :workspace="activeWorkspace" v-if="activeWorkspace" :key="activeWorkspace._id" />
    <BackupAndRestoreModal />
    <ContextMenu
        :options="workspaceQuickSwitcherOptions"
        :element="workspaceQuickSwitcherElement"
        :x="workspaceQuickSwitcherContextMenuX"
        :y="workspaceQuickSwitcherContextMenuY"
        v-model:show="workspaceQuickSwitcherDropdownVisible"
        :selected-option="activeWorkspace"
        @click="setActiveWorkspace"
    />
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
    convertCollectionsFromRestfoxToPostman,
    convertCollectionsFromRestfoxToInsomnia,
    exportCollection,
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
            workspaceQuickSwitcherElement: null,
            workspaceQuickSwitcherContextMenuX: null,
            workspaceQuickSwitcherContextMenuY: null,
            workspaceQuickSwitcherDropdownVisible: false,
            exportSelectorDropdownState: {
                visible: false,
                contextMenuX: null,
                contextMenuY: null,
                element: null,
            },
            envSelectorDropdownState: {
                visible: false,
                contextMenuX: null,
                contextMenuY: null,
                element: null,
            },
            collectionLength: 0
        }
    },
    async beforeMount() {
        this.collectionLength = (await getCollectionForWorkspace(this.$store.state.activeWorkspace._id)).collection.length
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
        currentEnvironmentColor() {
            return this.environments.find(env => env.name === this.currentEnvironment).color ?? constants.DEFAULT_ENVIRONMENT.color
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
        workspaceQuickSwitcherOptions() {
            const workspacesOptions = this.$store.state.workspaces.map(workspace => {
                return {
                    type: 'option',
                    label: workspace.name,
                    value: workspace,
                    class: 'context-menu-item-with-left-padding',
                }
            })

            return [
                {
                    type: 'option',
                    label: 'Workspaces',
                    icon: 'fa fa-book',
                    disabled: true,
                    class: 'text-with-line'
                },
                ...workspacesOptions
            ]
        },
    },
    methods: {
        async exportCollection(value) {
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

            if (value === 'Restfox') {
                exportRestfoxCollection(collection, this.activeWorkspace.environments)
            }

            if (value === 'Postman') {
                exportCollection(await convertCollectionsFromRestfoxToPostman(collection), value)
            }

            if (value === 'Insomnia') {
                exportCollection(await convertCollectionsFromRestfoxToInsomnia(collection), value)
            }
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
            this.envSelectorDropdownState.visible = !this.envSelectorDropdownState.visible
            if (this.envSelectorDropdownState.visible) {
                const containerElement = event.target.closest('.custom-dropdown')
                this.envSelectorDropdownState.contextMenuX = containerElement.getBoundingClientRect().left
                this.envSelectorDropdownState.contextMenuY = containerElement.getBoundingClientRect().top + containerElement.getBoundingClientRect().height
                this.envSelectorDropdownState.element = containerElement
            } else {
                this.envSelectorDropdownState.element = null
            }
        },
        toggleExportSelectorDropdown(event) {
            this.exportSelectorDropdownState.visible = !this.exportSelectorDropdownState.visible
            if (this.exportSelectorDropdownState.visible) {
                const containerElement = event.target.closest('.custom-dropdown')
                this.exportSelectorDropdownState.contextMenuX = containerElement.getBoundingClientRect().left
                this.exportSelectorDropdownState.contextMenuY = containerElement.getBoundingClientRect().top + containerElement.getBoundingClientRect().height
                this.exportSelectorDropdownState.element = containerElement
            } else {
                this.exportSelectorDropdownState.element = null
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
                    label: `<i class="fa fa-circle" style="color:${item.color}"></i>&nbsp;&nbsp;${item.name}`,
                    value: `${item.name}`,
                    class: 'context-menu-item-with-left-padding'
                }
            })
            return [...listHeader, ...list]
        },
        getExportList() {
            return [
                {
                    type: 'option',
                    label: 'Restfox collection',
                    value: 'Restfox',
                    class: 'context-menu-item-with-left-padding'
                },
                {
                    type: 'option',
                    label: 'Postman collection',
                    value: 'Postman',
                    class: 'context-menu-item-with-left-padding'
                },
                {
                    type: 'option',
                    label: 'Insomnia collection',
                    value: 'Insomnia',
                    class: 'context-menu-item-with-left-padding'
                },
            ]
        },
        selectEnv(value) {
            this.currentEnvironment = value
            this.$store.dispatch('reloadTabEnvironmentResolved')
        },
        openWorkspaceQuickSwitcher(event) {
            const containerElement = event.target.closest('.workspace-quick-switcher')
            this.workspaceQuickSwitcherContextMenuX = containerElement.getBoundingClientRect().left
            this.workspaceQuickSwitcherContextMenuY = containerElement.getBoundingClientRect().top + containerElement.getBoundingClientRect().height
            this.workspaceQuickSwitcherElement = containerElement
            this.workspaceQuickSwitcherDropdownVisible = true
        },
    },
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

.navbar-item {
    display: inline-flex;
    align-items: center;
    height: 100%;
    border-left: 1px solid var(--border-color-lighter);
}
</style>
