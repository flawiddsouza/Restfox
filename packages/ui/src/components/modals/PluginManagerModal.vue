<template>
    <div v-if="showModalComp">
        <modal :title="title" v-model="showModalComp">
            <div style="text-align: right;">
                <button class="button" type="button" @click="startAddPlugin">Add Plugin</button>
            </div>
            <div style="padding-bottom: 0.5rem;" v-if="!collectionItem">Global Plugins</div>
            <div style="padding-top: 1rem;" v-else></div>
            <table>
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Name</th>
                        <th>Date Added</th>
                        <th>Date Updated</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="plugin in plugins">
                        <td>
                            <select :value="plugin.enabled ? '1' : '0'" @change="updatePluginStatus(plugin._id, $event.target.value)" class="full-width-input slim">
                                <option value="1">Enabled</option>
                                <option value="0">Disabled</option>
                            </select>
                        </td>
                        <td>{{ plugin.name }}</td>
                        <td>{{ dateFormat(plugin.createdAt) }}</td>
                        <td>{{ dateFormat(plugin.updatedAt) }}</td>
                        <td>
                            <button class="button" type="button" @click="startEditPlugin(plugin)">
                                <i class="fa fa-edit"></i>
                            </button>
                            <button class="button" type="button" style="margin-left: 0.5rem" @click="deletePlugin(plugin._id)">
                                <i class="fa fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                    <tr v-if="plugins.length === 0">
                        <td colspan="100%">No Plugins Added</td>
                    </tr>
                </tbody>
            </table>
            <template v-if="!collectionItem">
                <div style="padding-top: 1rem; padding-bottom: 0.5rem;">Workspace Plugins</div>
                <table>
                    <thead>
                        <tr>
                            <th>Status</th>
                            <th>Name</th>
                            <th>Date Added</th>
                            <th>Date Updated</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="plugin in currentWorkspacePlugins">
                            <td>
                                <select :value="plugin.enabled ? '1' : '0'" @change="updatePluginStatus(plugin._id, $event.target.value)" class="full-width-input slim">
                                    <option value="1">Enabled</option>
                                    <option value="0">Disabled</option>
                                </select>
                            </td>
                            <td>{{ plugin.name }}</td>
                            <td>{{ dateFormat(plugin.createdAt) }}</td>
                            <td>{{ dateFormat(plugin.updatedAt) }}</td>
                            <td>
                                <button class="button" type="button" @click="startEditPlugin(plugin)">
                                    <i class="fa fa-edit"></i>
                                </button>
                                <button class="button" type="button" style="margin-left: 0.5rem" @click="deletePlugin(plugin._id)">
                                    <i class="fa fa-trash"></i>
                                </button>
                            </td>
                        </tr>
                        <tr v-if="currentWorkspacePlugins.length === 0">
                            <td colspan="100%">No Plugins Added</td>
                        </tr>
                    </tbody>
                </table>
            </template>
        </modal>
        <PluginManagerEditModal
            v-model:showModal="showPluginManagerEditModal"
            :type="showPluginManagerEditModalType"
            :plugin="showPluginManagerEditModalPlugin"
            :collection-item="collectionItem"
            :active-workspace="activeWorkspace"
            @savePlugin="handleSavePlugin"
        />
    </div>
</template>

<script>
import Modal from '@/components/Modal.vue'
import PluginManagerEditModal from '@/components/modals/PluginManagerEditModal.vue'
import dayjs from 'dayjs'

export default {
    props: {
        showModal: Boolean,
        collectionItem: {
            type: Object,
            required: false
        }
    },
    components: {
        Modal,
        PluginManagerEditModal
    },
    data() {
        return {
            showPluginManagerEditModal: false,
            showPluginManagerEditModalType: 'Add',
            showPluginManagerEditModalPlugin: null
        }
    },
    computed: {
        title() {
            let title = 'Plugins'

            if(this.collectionItem) {
                title = `${title} — ${this.collectionItem.name}`
            }

            return title
        },
        showModalComp: {
            get() {
                return this.showModal
            },
            set(value) {
                this.$emit('update:showModal', value)
            }
        },
        plugins() {
            let plugins = this.$store.state.plugins.filter(plugin => !plugin.workspaceId)

            if(this.collectionItem) {
                plugins = plugins.filter(plugin => plugin.collectionId === this.collectionItem._id)
            } else {
                plugins = plugins.filter(plugin => !plugin.collectionId)
            }

            return plugins
        },
        currentWorkspacePlugins() {
            return this.$store.state.plugins.filter(plugin => plugin.workspaceId === this.activeWorkspace._id)
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        }
    },
    watch: {
        showPluginManagerEditModal() {
            if(this.showPluginManagerEditModal === false) {
                this.showPluginManagerEditModalPlugin = null
            }
        }
    },
    methods: {
        startAddPlugin() {
            this.showPluginManagerEditModalType = 'Add'
            this.showPluginManagerEditModalPlugin = null
            this.showPluginManagerEditModal = true
        },
        startEditPlugin(plugin) {
            this.showPluginManagerEditModalType = 'Edit'
            this.showPluginManagerEditModalPlugin = plugin
            this.showPluginManagerEditModal = true
        },
        handleSavePlugin(pluginData) {
            if(pluginData.type === 'Add') {
                this.$store.commit('addPlugin', {
                    name: pluginData.name,
                    code: pluginData.code,
                    workspaceId: !this.collectionItem ? pluginData.workspaceId : null,
                    collectionId: this.collectionItem ? this.collectionItem._id : null
                })
            } else {
                this.$store.commit('updatePlugin', {
                    _id: pluginData._id,
                    name: pluginData.name,
                    code: pluginData.code,
                    workspaceId: pluginData.workspaceId
                })
            }
        },
        updatePluginStatus(pluginId, enabled) {
            this.$store.commit('updatePluginStatus', { _id: pluginId, enabled: enabled === '1' ? true : false })
        },
        deletePlugin(pluginId) {
            if(confirm('Are you sure?')) {
                this.$store.commit('deletePlugin', pluginId)
            }
        },
        dateFormat(date) {
            return dayjs(date).format('DD-MMM-YY hh:mm A')
        }
    }
}
</script>

<style scoped>
table {
    border-collapse: collapse;
    width: 100%;
}

table, table th, table td {
    border: 1px solid var(--modal-border-color);
}

table th, table td {
    padding: 0.5rem;
    text-align: center;
}
</style>
