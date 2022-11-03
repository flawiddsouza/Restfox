<template>
    <form @submit.prevent="duplicateWorkspace" v-if="showModalComp">
        <modal title="Duplicate Workspace" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Name</div>
                <input type="text" class="full-width-input" v-model="newName" placeholder="Workspace Name" required spellcheck="false" v-focus>
            </label>

            <template #footer>
                <button>Create</button>
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
                element.select()
            }
        }
    },
    props: {
        showModal: Boolean,
        workspaceToDuplicate: Object
    },
    components: {
        Modal
    },
    data() {
        return {
            newName: ''
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
        workspaceToDuplicate() {
            if(this.workspaceToDuplicate) {
                this.newName = this.workspaceToDuplicate.name
            }
        }
    },
    methods: {
        async duplicateWorkspace() {
            this.$store.dispatch('duplicateWorkspace', {
                sourceWorkspaceId: this.workspaceToDuplicate._id,
                name: this.newName
            })
            this.showModalComp = false
        }
    }
}
</script>
