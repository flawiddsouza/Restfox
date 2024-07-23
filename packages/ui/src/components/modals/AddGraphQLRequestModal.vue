<template>
    <form @submit.prevent="createRequest" v-if="showModalComp">
        <modal title="New GraphQL Request" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Name</div>
                <input type="text" class="full-width-input" v-model="requestName" placeholder="My GraphQL Request" required spellcheck="false" v-focus>
            </label>

            <template #footer>
                <button class="button">Create</button>
            </template>
        </modal>
    </form>
</template>

<script>
import Modal from '@/components/Modal.vue'
import constants from '@/constants'

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
        parentId: {
            type: String,
            default: null
        }
    },
    components: {
        Modal
    },
    data() {
        return {
            requestName: 'New GraphQL Request',
            requestMethod: 'POST'
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
                this.requestName = 'New GraphQL Request'
            }
        }
    },
    methods: {
        async createRequest() {
            const result = await this.$store.dispatch('createCollectionItem', {
                type: 'request',
                name: this.requestName,
                method: this.requestMethod,
                mimeType: constants.MIME_TYPE.GRAPHQL,
                parentId: this.parentId,
                headers: [{ name: 'Content-Type', value: constants.MIME_TYPE.JSON }]
            })

            if(!result.error) {
                this.showModalComp = false
            }
        }
    }
}
</script>
