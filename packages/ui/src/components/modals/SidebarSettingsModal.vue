<template>
    <div v-if="showModalComp">
        <modal :title="collectionItem._type === 'request_group' ? 'Folder Properties' : 'Request Properties'" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Name <span style="color: #7b7a7a; font-weight: normal; font-style: italic;" v-if="collectionItem._type === 'request'">(also rename by double-clicking in sidebar)</span></div>
                <input type="text" class="full-width-input" v-model="collectionItem.name" :placeholder="collectionItem._type === 'request_group' ? 'Folder Name' : 'Request Name'" spellcheck="false" v-focus>
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
