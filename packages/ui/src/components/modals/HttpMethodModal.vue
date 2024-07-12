<template>
    <div v-if="showModalComp">
        <modal title="HTTP Custom Method" v-model="showModalComp">
            <div style="display: flex; justify-content: space-between; gap: 1rem;">
                <div>
                    <div style="margin-bottom: var(--label-margin-bottom);">Name</div>
                    <input type="text" v-model="method" class="full-width-input" placeholder="Some custom method">
                </div>
            </div>
            <div style="font-style: italic; text-align: center;margin-top: 0.5rem">* Common examples are {{ commonCustomHttpMethod }}</div>
            <template #footer>
                <button class="button" @click="saveMethod" style="margin-left: 1rem; cursor: pointer">Done</button>
            </template>
        </modal>
    </div>

</template>

<script>
import Modal from '@/components/Modal.vue'

export default {
    data() {
        return {
            method: '',
            commonCustomHttpMethod: 'PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK, LINK, UNLINK, FIND, PURGE'
        }
    },
    components: {
        Modal
    },
    props: {
        showModal: Boolean,
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
    methods: {
        saveMethod() {
            this.showModalComp = false
            if (this.method === '') {
                this.method = 'GET'
            }
            this.$emit('customHttpMethod', this.method)
        }
    }
}
</script>
