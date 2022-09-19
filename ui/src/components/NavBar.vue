<template>
    <div class="navbar">
        <div class="heading">
            <div v-if="activeWorkspace === null">Workspaces</div>
            <template v-else>
                <a href="#" @click.prevent="setActiveWorkspace(null)">Workspaces</a> > <span>{{ activeWorkspace.name }}</span>
            </template>
        </div>
        <div class="right-nav-container">
            <div v-if="nav === 'collection'">
                <div style="display: inline-flex; align-items: center;">
                    <a href="#" @click.prevent="environmentModalShow = true" style="margin-right: 0.5rem">Environment</a>
                    <select v-model="currentEnvironment" style="border: 1px solid var(--default-border-color); outline: 0; background-color: inherit;" title="Change Environment">
                        <option v-for="environment in environments">{{ environment.name }}</option>
                    </select>
                </div>
                <span class="spacer"></span>
                <a href="#" @click.prevent="showImportModal">Import</a>
                <span class="spacer"></span>
                <a href="#" @click.prevent="exportCollection">Export</a>
                <span class="spacer"></span>
                <a href="#" @click.prevent="clearCollection">Clear Collection</a>
            </div>
            <div v-if="nav === 'workspaces'">
                <a href="#" @click.prevent="showAddWorkspace">Add Workspace</a>
            </div>
            <span class="spacer"></span>
            <a href="#" @click.prevent="showPluginsManager">Plugins</a>
            <span class="spacer"></span>
            <a href="#" @click.prevent="showSettings">Settings</a>
            <span class="spacer-and-half"></span>
            <div style="width: 80px; height: 10px; margin-top: -0.56rem">
                <GithubButton
                    title="Star Restfox"
                    href="https://github.com/flawiddsouza/Restfox"
                    data-show-count="true"
                    data-text="Star"
                    aria-label="Star Restfox on GitHub"
                />
            </div>
        </div>
    </div>
    <PluginManagerModal v-model:showModal="showPluginManagerModal" />
    <AddWorkspaceModal v-model:showModal="showAddWorkspaceModal" />
    <SettingsModal v-model:showModal="showSettingsModal" />
    <EnvironmentModal v-model:showModal="environmentModalShow" :workspace="activeWorkspace" />
</template>

<script>
import PluginManagerModal from './modals/PluginManagerModal.vue'
import AddWorkspaceModal from './modals/AddWorkspaceModal.vue'
import SettingsModal from './modals/SettingsModal.vue'
import EnvironmentModal from './modals/EnvironmentModal.vue'
import { exportRestfoxCollection } from '@/helpers'
import { getCollectionForWorkspace } from '@/db'
import GithubButton from 'vue-github-button'

export default {
    components: {
        PluginManagerModal,
        AddWorkspaceModal,
        SettingsModal,
        EnvironmentModal,
        GithubButton
    },
    props: {
        nav: String,
        required: false
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
        }
    },
    methods: {
        async exportCollection() {
            const collection = await getCollectionForWorkspace(this.activeWorkspace._id)
            exportRestfoxCollection(collection)
        },
        clearCollection() {
            if(confirm('Are you sure?')) {
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
        }
    }
}
</script>

<style scoped>
.navbar {
    padding-top: 0.5em;
    padding-bottom: 0.5em;
    padding-left: 1em;
    padding-right: 1em;
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 31.5px;
}

.spacer {
    margin-left: 1rem;
}

.spacer-and-half {
    margin-left: 1.5rem;
}

.heading {
    font-weight: 500;
}

.heading a:not(:hover) {
    text-decoration: none;
}

.right-nav-container {
    display: flex;
    align-items: center;
}
</style>
