<template>
    <div v-if="showModalComp">
        <modal :title="collectionItem._type === 'request_group' ? 'Folder Properties' : 'Request Properties'" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Name</div>
                <input type="text" style="width: 100%; border: 1px solid var(--default-border-color); outline: 0; padding: 0.3rem; background: inherit;" v-model="collectionItem.name" :placeholder="collectionItem._type === 'request_group' ? 'Folder Name' : 'Request Name'" spellcheck="false" v-focus>
            </label>
            <div style="padding-bottom: 1rem"></div>
            <template #footer>
                <button @click="showModalComp = false">Done</button>
            </template>
        </modal>
    </div>
</template>

<script>
import Modal from '@/components/Modal.vue'

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
        collectionItem: Object
    },
    components: {
        Modal
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
        'collectionItem.name'() {
            this.$store.commit('updateCollectionItemName', this.collectionItem)
        }
    }
}
</script>
