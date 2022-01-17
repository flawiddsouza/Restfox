<template>
    <form @submit.prevent="done" v-if="showModalComp">
        <modal :title="`Environment (JSON Format) — ${collectionItem.name}`" v-model="showModalComp" height="70vh" width="55rem">
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
        collectionItem: Object
    },
    components: {
        Modal,
        CodeMirrorEditor
    },
    data() {
        return {
            environment: '{}',
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
        environment() {
            let environment = {}
            try {
                environment = JSON.parse(this.environment)
                this.parseError = ''
                this.collectionItem.environment = environment
            } catch(e) {
                this.parseError = e.message
            }
        },
        showModal() {
            if(this.showModal) {
                this.environment = this.collectionItem.environment ? JSON.stringify(this.collectionItem.environment, null, 4) : '{}'
            } else {
                this.$store.commit('updateCollectionItemEnvironment', this.collectionItem)
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
