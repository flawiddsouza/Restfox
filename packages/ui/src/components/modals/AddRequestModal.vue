<template>
    <form @submit.prevent="createRequest" v-if="showModalComp">
        <modal title="New Request" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Name</div>
                <input type="text" class="full-width-input" v-model="requestName" placeholder="My Request" required spellcheck="false" v-focus>
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
        parentId: String | null
    },
    components: {
        Modal
    },
    data() {
        return {
            requestName: 'New Request',
            requestMethod: 'GET'
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
        showModal() {
            if(this.showModal) {
                this.requestName = 'New Request'
            }
        }
    },
    methods: {
        async createRequest() {
            this.$store.dispatch('createCollectionItem', {
                type: 'request',
                name: this.requestName,
                method: this.requestMethod,
                mimeType: 'No Body',
                parentId: this.parentId
            })
            this.showModalComp = false
        }
    }
}
</script>
