<template>
    <div v-if="showModalComp">
        <modal :title="title" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Name <span style="color: #7b7a7a; font-weight: normal; font-style: italic;" v-if="collectionItem._type === 'request' || collectionItem._type === 'socket'">(also rename by double-clicking in sidebar)</span></div>
                <input type="text" class="full-width-input" v-model="collectionItem.name" :placeholder="placeholder" spellcheck="false" v-focus>
            </label>
            <div style="padding-bottom: 1rem"></div>
            <template #footer>
                <button class="button" @click="showModalComp = false">Done</button>
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
        },
        title() {
            if(this.collectionItem._type === 'request_group') {
                return 'Folder Properties'
            }

            if(this.collectionItem._type === 'request') {
                return 'Request Properties'
            }

            if(this.collectionItem._type === 'socket') {
                return 'Socket Properties'
            }

            return ''
        },
        placeholder() {
            if(this.collectionItem._type === 'request_group') {
                return 'Folder Name'
            }

            if(this.collectionItem._type === 'request') {
                return 'Request Name'
            }

            if(this.collectionItem._type === 'socket') {
                return 'Socket Name'
            }

            return ''
        }
    },
    watch: {
        'collectionItem.name'() {
            this.$store.commit('updateCollectionItemName', this.collectionItem)
        }
    }
}
</script>
