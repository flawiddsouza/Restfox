<template>
    <form @submit.prevent="savePlugin" v-if="showModalComp">
        <modal :title="(type === 'Add' ? 'Add' : 'Edit') + ' Plugin'" v-model="showModalComp" height="70vh" width="55rem" :full-height="true">
            <div class="plugin-manager-edit-modal-container" :class="{ 'plugin-manager-edit-modal-container-collection-item': collectionItem ? true : false }">
                <label>
                    <div style="font-weight: 500; margin-bottom: 0.25rem">Name</div>
                    <input type="text" class="full-width-input" v-model="name" placeholder="My Plugin" required spellcheck="false" v-focus>
                </label>
                <template v-if="!collectionItem">
                    <div style="padding-bottom: 1rem"></div>
                    <label>
                        <div style="font-weight: 500; margin-bottom: 0.25rem">Scope</div>
                        <select class="full-width-input" v-model="workspaceId" required>
                            <option :value="null">All Workspaces</option>
                            <option :value="activeWorkspace._id" v-if="activeWorkspace">Current Workspace</option>
                        </select>
                    </label>
                </template>
                <div style="padding-bottom: 1rem"></div>
                <label style="overflow: auto;">
                    <div style="font-weight: 500; margin-bottom: 0.25rem">Code</div>
                    <CodeMirrorEditor
                        v-model="code"
                        lang="javascript"
                        :autocompletions="autocompletions"
                        class="code-editor"
                    ></CodeMirrorEditor>
                </label>
            </div>
            <template #footer>
                <button class="button">Save</button>
            </template>
        </modal>
    </form>
</template>

<script>
import Modal from '@/components/Modal.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import constants from '@/constants'

export default {
    directives: {
        focus: {
            mounted(element) {
                element.focus()
            }
        }
    },
    props: {
        showModal: {
            type: Boolean,
            required: true
        },
        type: {
            type: String,
            required: true
        },
        plugin: {
            type: [Object, null],
            required: true
        },
        collectionItem: {
            type: Object,
            required: false
        },
        activeWorkspace: {
            type: [Object, null],
            required: true
        }
    },
    components: {
        Modal,
        CodeMirrorEditor
    },
    data() {
        return {
            name: '',
            code: constants.CODE_EXAMPLE.PLUGIN,
            workspaceId: this.activeWorkspace?._id ?? null
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
        autocompletions() {
            return [
                ...constants.AUTOCOMPLETIONS.PLUGIN.GENERAL_METHODS,
                ...constants.AUTOCOMPLETIONS.PLUGIN.REQUEST_METHODS,
                ...constants.AUTOCOMPLETIONS.PLUGIN.RESPONSE_METHODS
            ]
        },
    },
    watch: {
        plugin() {
            if(this.plugin) {
                this.name = this.plugin.name
                this.code = this.plugin.code
                this.workspaceId = this.plugin.workspaceId ?? null
            } else {
                this.resetPlugin()
            }
        }
    },
    methods: {
        resetPlugin() {
            this.name = ''
            this.code = constants.CODE_EXAMPLE.PLUGIN
            this.workspaceId = this.activeWorkspace?._id ?? null
        },
        savePlugin() {
            this.$emit('savePlugin', {
                type: this.type,
                _id: this.plugin ? this.plugin._id : null,
                name: this.name,
                code: this.code,
                workspaceId: this.workspaceId
            })

            this.resetPlugin()
            this.showModalComp = false
        }
    }
}
</script>

<style scoped>
.plugin-manager-edit-modal-container {
    display: grid;
    grid-template-rows: auto auto auto auto 1fr;
    height: 100%;
}

.plugin-manager-edit-modal-container-collection-item {
    grid-template-rows: auto auto 1fr;
}

.code-editor {
    height: calc(100% - 1.2rem);
    overflow-y: auto;
    border: 1px solid var(--modal-border-color);
}
</style>
