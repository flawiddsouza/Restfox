<template>
    <form @submit.prevent="duplicateWorkspace" v-if="showModalComp">
        <modal title="Duplicate Workspace" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Name</div>
                <input type="text" class="full-width-input" v-model="newName" placeholder="Workspace Name" required spellcheck="false" v-focus :disabled="duplicating">
            </label>

            <template v-if="isElectron">
                <div style="margin-top: 1rem">
                    <label>
                        <div style="font-weight: 500; margin-bottom: 0.25rem">Type</div>
                        <select class="full-width-input" v-model="workspaceType" required :disabled="duplicating">
                            <option v-for="workspaceTypeItem in workspaceTypes" :value="workspaceTypeItem.value">{{ workspaceTypeItem.label }}</option>
                        </select>
                    </label>
                </div>

                <div style="margin-top: 1rem" v-if="workspaceType === 'file'">
                    <label>
                        <div style="font-weight: 500; margin-bottom: 0.25rem">Choose a folder</div>
                        <div style="display: flex;">
                            <input type="text" class="full-width-input" v-model="workspaceLocation" placeholder="Folder Path" required spellcheck="false" :disabled="duplicating">
                            <button class="button" type="button" @click="openFolderDialog" :disabled="duplicating">Choose</button>
                        </div>
                    </label>
                    <div style="margin-top: 0.5rem">Provide an empty folder</div>
                </div>
            </template>

            <template #footer>
                <button class="button" v-if="!duplicating">Duplicate</button>
                <button class="button" disabled v-else>Duplicating...</button>
            </template>
        </modal>
    </form>
</template>

<script>
import Modal from '@/components/Modal.vue'

export default {
    directives: {
        focus: {
            mounted(element) {
                element.focus()
                element.select()
            }
        }
    },
    props: {
        showModal: Boolean,
        workspaceToDuplicate: Object,
        isElectron: {
            type: Boolean,
            default: false
        },
    },
    components: {
        Modal
    },
    data() {
        return {
            newName: '',
            workspaceType: 'local',
            workspaceLocation: '',
            workspaceTypes: [
                { label: 'In Filesystem (Git Friendly)', value: 'file' },
                { label: 'In Application', value: 'local' }
            ],
            duplicating: false,
        }
    },
    computed: {
        showModalComp: {
            get() {
                return this.showModal
            },
            set(value) {
                if(this.duplicating) {
                    return
                }
                this.$emit('update:showModal', value)
            }
        }
    },
    watch: {
        workspaceToDuplicate() {
            if(this.workspaceToDuplicate) {
                this.newName = this.workspaceToDuplicate.name + ' (copy)'

                if(this.isElectron) {
                    this.workspaceType = 'file'
                    this.workspaceLocation = ''
                }
            }
        }
    },
    methods: {
        async duplicateWorkspace() {
            if(this.isElectron && this.workspaceType === 'file') {
                const result = await window.electronIPC.ensureEmptyFolderOrEmptyWorkspace(this.workspaceLocation)

                if(result.error) {
                    this.$toast.error(result.error)
                    return
                }
            }

            this.duplicating = true

            await this.$store.dispatch('duplicateWorkspace', {
                sourceWorkspace: JSON.parse(JSON.stringify(this.workspaceToDuplicate)),
                name: this.newName,
                type: this.workspaceType,
                location: this.workspaceLocation,
            })

            this.duplicating = false
            this.showModalComp = false

            this.$toast.success('Workspace duplicated successfully')
        },
        async openFolderDialog() {
            this.workspaceLocation = await window.electronIPC.openFolderSelectionDialog()
        },
    }
}
</script>
