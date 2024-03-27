<template>
    <form @submit.prevent="duplicateCollectionItem" v-if="showModalComp">
        <modal :title="title" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Name</div>
                <input type="text" class="full-width-input" v-model="newName" :placeholder="placeholder" required spellcheck="false" v-focus>
            </label>

            <template #footer>
                <button class="button">Create</button>
            </template>
        </modal>
    </form>
</template>

<script>
import { toRaw } from 'vue'
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
        },
        title() {
            if(this.collectionItemToDuplicate._type === 'request_group') {
                return 'Duplicate Folder'
            }

            if(this.collectionItemToDuplicate._type === 'request') {
                return 'Duplicate Request'
            }

            if(this.collectionItemToDuplicate._type === 'socket') {
                return 'Duplicate Socket'
            }

            return ''
        },
        placeholder() {
            if(this.collectionItemToDuplicate._type === 'request_group') {
                return 'New Folder Name'
            }

            if(this.collectionItemToDuplicate._type === 'request') {
                return 'New Request Name'
            }

            if(this.collectionItemToDuplicate._type === 'socket') {
                return 'New Socket Name'
            }

            return ''
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
            const newCollectionItem = structuredClone(toRaw(this.collectionItemToDuplicate))
            newCollectionItem.name = this.newName
            const result = await this.$store.dispatch('duplicateCollectionItem', newCollectionItem)

            if(!result.error) {
                this.showModalComp = false
            }
        }
    }
}
</script>
