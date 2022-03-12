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
                <a href="#" @click.prevent="this.$store.commit('showImportModal', true)">Import</a>
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
        </div>
    </div>
    <PluginManagerModal v-model:showModal="showPluginManagerModal" />
    <AddWorkspaceModal v-model:showModal="showAddWorkspaceModal" />
</template>

<script>
import PluginManagerModal from './modals/PluginManagerModal.vue'
import AddWorkspaceModal from './modals/AddWorkspaceModal.vue'
import { exportRestfoxCollection } from '@/helpers'
import { getCollectionForWorkspace } from '@/db'

export default {
     components: {
        PluginManagerModal,
        AddWorkspaceModal
    },
    props: {
        nav: String,
        required: false
    },
    data() {
        return {
            showPluginManagerModal: false,
            showAddWorkspaceModal: false
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
        showPluginsManager() {
            this.showPluginManagerModal = true
        },
        showAddWorkspace() {
            this.showAddWorkspaceModal = true
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
