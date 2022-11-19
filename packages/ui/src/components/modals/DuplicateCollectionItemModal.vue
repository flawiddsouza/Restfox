<template>
    <form @submit.prevent="duplicateCollectionItem" v-if="showModalComp">
        <modal :title="collectionItemToDuplicate._type === 'request_group' ? 'Duplicate Folder' : 'Duplicate Request'" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Name</div>
                <input type="text" class="full-width-input" v-model="newName" :placeholder="collectionItemToDuplicate._type === 'request_group' ? 'Folder Name' : 'Request Name'" required spellcheck="false" v-focus>
            </label>

            <template #footer>
                <button class="button">Create</button>
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
        collectionItemToDuplicate: Object
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
        collectionItemToDuplicate() {
            if(this.collectionItemToDuplicate) {
                this.newName = this.collectionItemToDuplicate.name
            }
        }
    },
    methods: {
        async duplicateCollectionItem() {
            const newCollectionItem = JSON.parse(JSON.stringify(this.collectionItemToDuplicate))
            newCollectionItem.name = this.newName
            this.$store.dispatch('duplicateCollectionItem', newCollectionItem)
            this.showModalComp = false
        }
    }
}
</script>
