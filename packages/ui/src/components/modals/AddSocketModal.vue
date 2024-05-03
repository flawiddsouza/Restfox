<template>
    <form @submit.prevent="createSocket" v-if="showModalComp">
        <modal title="New Socket" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Name</div>
                <input type="text" class="full-width-input" v-model="socketName" placeholder="New Socket" required spellcheck="false" v-focus>
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
            socketName: 'New Socket',
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
            if (this.showModal) {
                this.socketName = 'New Socket'
            }
        }
    },
    methods: {
        async createSocket() {
            const result = await this.$store.dispatch('createCollectionItem', {
                type: 'socket',
                name: this.socketName,
                parentId: this.parentId
            })

            if(!result.error) {
                this.showModalComp = false
            }
        }
    },
}
</script>
