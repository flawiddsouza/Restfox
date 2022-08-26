<template>
    <div class="navbar">
        <div class="heading">
            <div v-if="activeWorkspace === null">Workspaces</div>
            <template v-else>
                <a href="#" @click.prevent="setActiveWorkspace(null)">Workspaces</a> > <span>{{ activeWorkspace.name }}</span> [<a href="#" @click.prevent="environmentModalShow = true">Environment</a>]
            </template>
        </div>
        <div class="right-nav-container">
            <div v-if="nav === 'collection'">
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

export default {
     components: {
        PluginManagerModal,
        AddWorkspaceModal,
        SettingsModal,
        EnvironmentModal
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
}

.spacer {
    margin-left: 1rem;
}

.heading {
    font-weight: 500;
}

.heading a:not(:hover) {
    text-decoration: none;
}

.right-nav-container {
    display: flex;
}
</style>
