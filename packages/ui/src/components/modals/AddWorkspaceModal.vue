<template>
    <form @submit.prevent="createWorkspace" v-if="showModalComp">
        <modal :title="!workspace ? 'New Workspace' : 'Rename Workspace'" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Name</div>
                <input type="text" style="width: 100%; border: 1px solid var(--default-border-color); outline: 0; padding: 0.3rem; background: inherit;" v-model="workspaceName" :placeholder="!workspace ? 'New Workspace' : 'Workspace Name'" required spellcheck="false" v-focus>
            </label>

            <template #footer>
                <button v-if="!workspace">Create</button>
                <button v-else>Rename</button>
            </template>
        </modal>
    </form>
</template>

<script>
import Modal from '@/components/Modal.vue'

export default {
    directives: {
        focus: {
            mounted(element, binding) {
                element.focus()
                if(!binding.instance.workspace) {
                    element.select()
                }
            }
        }
    },
    props: {
        showModal: Boolean,
        workspace: {
            type: Object,
            required: false
        }
    },
    components: {
        Modal
    },
    data() {
        return {
            workspaceName: 'New Workspace'
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
        }
    },
    watch: {
        workspace() {
            if(this.workspace) {
                this.workspaceName = this.workspace.name
            }
        },
        showModal() {
            if(this.showModal && this.workspace === undefined) {
                this.workspaceName = 'New Workspace'
            }
        }
    },
    methods: {
        async createWorkspace() {
            if(!this.workspace) {
                this.$store.dispatch('createWorkspace', {
                    name: this.workspaceName
                })
            } else {
                this.$store.dispatch('updateWorkspace', {
                    _id: this.workspace._id,
                    name: this.workspaceName
                })
            }
            this.showModalComp = false
        }
    }
}
</script>
