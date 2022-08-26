<template>
    <form @submit.prevent="done" v-if="showModalComp">
        <modal :title="`Environment (JSON Format) — ${collectionItem ? collectionItem.name : workspace.name}`" v-model="showModalComp" height="70vh" width="55rem">
            <CodeMirrorEditor v-model="environment" lang="json"></CodeMirrorEditor>
            <div style="margin-top: 1rem">
                <div v-if="parseError" class="box">{{ parseError }}</div>
                <div class="box box-hidden" v-else>
                    Spacer Text
                </div>
            </div>

            <template #footer>
                <button>Done</button>
            </template>
        </modal>
    </form>
</template>

<script>
import Modal from '@/components/Modal.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'

export default {
    props: {
        showModal: Boolean,
        collectionItem: Object,
        workspace: Object
    },
    components: {
        Modal,
        CodeMirrorEditor
    },
    data() {
        return {
            environment: '{}',
            environmentToSave: {},
            parseError: ''
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
        collectionItem() {
            this.environment = this.collectionItem.environment ? JSON.stringify(this.collectionItem.environment, null, 4) : '{}'
        },
        workspace() {
            this.environment = this.workspace.environment ? JSON.stringify(this.workspace.environment, null, 4) : '{}'
        },
        environment() {
            let environment = {}
            try {
                environment = JSON.parse(this.environment)
                this.parseError = ''
                this.environmentToSave = environment
            } catch(e) {
                this.parseError = e.message
            }
        },
        showModal() {
            if(this.showModal) {
                if(this.collectionItem) {
                    this.environment = this.collectionItem.environment ? JSON.stringify(this.collectionItem.environment, null, 4) : '{}'
                }
                if(this.workspace) {
                    this.environment = this.workspace.environment ? JSON.stringify(this.workspace.environment, null, 4) : '{}'
                }
            } else {
                if(this.collectionItem) {
                    this.collectionItem.environment = this.environmentToSave
                    this.$store.commit('updateCollectionItemEnvironment', { collectionId: this.collectionItem._id, environment: this.environmentToSave })
                }
                if(this.workspace) {
                    this.workspace.environment = this.environmentToSave
                    this.$store.commit('updatWorkspaceEnvironment',  { workspaceId: this.workspace._id, environment: this.environmentToSave })
                }
            }
        }
    },
    methods: {
        async done() {
            this.showModalComp = false
        }
    }
}
</script>

<style scoped>
.box {
    padding: 0.6rem;
    border: 1px dotted #d04444;
    border-radius: 0.3rem;
}

.box-hidden {
    border: 1px dotted transparent;
    visibility: hidden;
}
</style>
