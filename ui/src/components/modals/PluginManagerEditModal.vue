<template>
    <form @submit.prevent="savePlugin" v-if="showModalComp">
        <modal :title="(type === 'Add' ? 'Add' : 'Edit') + ' Plugin'" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Name</div>
                <input type="text" style="width: 100%; border: 1px solid var(--default-border-color); outline: 0; padding: 0.3rem; background: inherit;" v-model="name" placeholder="My Plugin" required spellcheck="false" v-focus>
            </label>
            <div style="padding-bottom: 1rem"></div>
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Code</div>
                <CodeMirrorEditor v-model="code" style="height: 29rem; width: 50vw; max-width: 90vw; overflow-y: auto"></CodeMirrorEditor>
            </label>
            <template #footer>
                <button>Save</button>
            </template>
        </modal>
    </form>
</template>

<script>
import Modal from '@/components/Modal.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'

export default {
    directives: {
        focus: {
            mounted(element) {
                element.focus()
            }
        }
    },
    props: {
        showModal: Boolean,
        type: String,
        plugin: Object
    },
    components: {
        Modal,
        CodeMirrorEditor
    },
    data() {
        return {
            name: '',
            code: ''
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
        plugin() {
            if(this.plugin) {
                this.name = this.plugin.name
                this.code = this.plugin.code
            } else {
                this.name = ''
                this.code = ''
            }
        }
    },
    methods: {
        savePlugin() {
            this.$emit('savePlugin', {
                type: this.type,
                _id: this.plugin ? this.plugin._id : null,
                name: this.name,
                code: this.code
            })
            this.showModalComp = false
        }
    }
}
</script>
