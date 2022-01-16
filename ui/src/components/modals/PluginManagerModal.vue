<template>
    <div v-if="showModalComp">
        <modal title="Plugin Manager" v-model="showModalComp">
            <div style="text-align: right;">
                <button type="button" @click="startAddPlugin">Add Plugin</button>
            </div>
            <div style="padding-top: 1rem"></div>
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
                            <select :value="plugin.enabled ? '1' : '0'" @change="updatePluginStatus(plugin._id, $event.target.value)">
                                <option value="1">Enabled</option>
                                <option value="0">Disabled</option>
                            </select>
                        </td>
                        <td>{{ plugin.name }}</td>
                        <td>{{ dateFormat(plugin.createdAt) }}</td>
                        <td>{{ dateFormat(plugin.updatedAt) }}</td>
                        <td>
                            <button type="button" @click="startEditPlugin(plugin)">
                                <i class="fa fa-edit"></i>
                            </button>
                            <button type="button" style="margin-left: 0.5rem" @click="deletePlugin(plugin._id)">
                                <i class="fa fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                    <tr v-if="plugins.length === 0">
                        <td colspan="100%">No Plugins Added</td>
                    </tr>
                </tbody>
            </table>
        </modal>
        <PluginManagerEditModal
            v-model:showModal="showPluginManagerEditModal"
            :type="showPluginManagerEditModalType"
            :plugin="showPluginManagerEditModalPlugin"
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
        showModal: Boolean
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
        showModalComp: {
            get() {
                return this.showModal
            },
            set(value) {
                this.$emit('update:showModal', value)
            }
        },
        plugins() {
            return this.$store.state.plugins
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
                this.$store.commit('addPlugin', { name: pluginData.name, code: pluginData.code })
            } else {
                this.$store.commit('updatePlugin', { _id: pluginData._id, name: pluginData.name, code: pluginData.code })
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
    border: 1px solid var(--default-border-color);
}

table th, table td {
    padding: 0.5rem;
    text-align: center;
}

select {
    outline: 0;
}
</style>
