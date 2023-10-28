<template>
    <div class="navbar">
        <div class="heading">
            <div v-if="activeWorkspace === null">Workspaces</div>
            <template v-else>
                <a href="#" @click.prevent="setActiveWorkspace(null)">Workspaces</a> > <span>{{ activeWorkspace.name }}</span>
            </template>
        </div>
        <div class="right-nav-container">
            <a href="#" @click.prevent="theme = 'dark'" v-if="theme === 'light'" class="bl">Theme: Light</a>
            <a href="#" @click.prevent="theme = 'light'" v-else class="bl">Theme: Dark</a>
            <div v-if="nav === 'collection'" style="height: 100%;">
                <template v-if="activeTab && activeTab._type === 'request'">
                    <a href="#" @click.prevent="requestResponseLayout = 'top-bottom'" v-if="requestResponseLayout === 'left-right'" class="bl">View: Column</a>
                    <a href="#" @click.prevent="requestResponseLayout = 'left-right'" v-else class="bl">View: Row</a>
                </template>
                <div style="display: inline-flex; align-items: center; height: 100%; margin-right: 0.5rem;">
                    <a href="#" @click.prevent="environmentModalShow = true" style="margin-right: 0.2rem; padding-right: 0.2rem;" class="bl">Environment</a>
                    <select v-model="currentEnvironment" style="border: 1px solid var(--default-border-color); outline: 0; background-color: inherit;" title="Change Environment">
                        <option v-for="environment in environments">{{ environment.name }}</option>
                    </select>
                </div>
                <a href="#" @click.prevent="showImportModal" class="bl">Import</a>
                <a href="#" @click.prevent="exportCollection" class="bl">Export</a>
                <a href="#" @click.prevent="clearCollection" class="bl">Clear Collection</a>
            </div>
            <template v-if="nav === 'workspaces'">
                <a href="#" @click.prevent="showAddWorkspace" class="bl">Add Workspace</a>
                <a href="#" @click.prevent="backupAndRestore" class="bl">Backup & Restore</a>
            </template>
            <a href="#" @click.prevent="showPluginsManager" class="bl">Plugins</a>
            <a href="#" @click.prevent="showSettings" class="bl br">Settings</a>
            <span class="spacer"></span>
            <div>
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
    <AddWorkspaceModal v-model:showModal="showAddWorkspaceModal" />
    <SettingsModal v-model:showModal="showSettingsModal" />
    <EnvironmentModal v-model:showModal="environmentModalShow" :workspace="activeWorkspace" />
    <BackupAndRestoreModal />
</template>

<script>
import PluginManagerModal from './modals/PluginManagerModal.vue'
import AddWorkspaceModal from './modals/AddWorkspaceModal.vue'
import SettingsModal from './modals/SettingsModal.vue'
import EnvironmentModal from './modals/EnvironmentModal.vue'
import BackupAndRestoreModal from './modals/BackupAndRestoreModal.vue'
import { exportRestfoxCollection, applyTheme } from '@/helpers'
import { getCollectionForWorkspace } from '@/db'
import constants from '../constants'

export default {
    components: {
        PluginManagerModal,
        AddWorkspaceModal,
        SettingsModal,
        EnvironmentModal,
        BackupAndRestoreModal
    },
    props: {
        nav: String
    },
    data() {
        return {
            showSettingsModal: false,
            showPluginManagerModal: false,
            showAddWorkspaceModal: false,
            environmentModalShow: false
        }
    },
    computed: {
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        },
        environments() {
            return this.activeWorkspace.environments ?? [
                {
                    name: 'Default',
                    environment: this.activeWorkspace.environment
                }
            ]
        },
        currentEnvironment: {
            get() {
                return this.activeWorkspace.currentEnvironment ?? 'Default'
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
        }
    },
    methods: {
        async exportCollection() {
            const collection = await getCollectionForWorkspace(this.activeWorkspace._id)
            exportRestfoxCollection(collection)
        },
        async clearCollection() {
            if(await window.createPrompt('Are you sure? Type "clear everything in workspace" to confirm') === 'clear everything in workspace') {
                this.$store.commit('clearCollection')
            }
        },
        setActiveWorkspace(workspace) {
            this.$store.commit('setActiveWorkspace', workspace)
        },
        showSettings() {
            this.showSettingsModal = true
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
}

.right-nav-container {
    display: flex;
    align-items: center;
    height: 100%;
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
</style>
