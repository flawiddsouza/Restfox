<template>
    <div v-if="showModalComp">
        <modal :title="title" v-model="showModalComp">
            <ul>
                <li v-for="(log, index) in consoleLogs" :key="index">
                    {{ log.message }}
                </li>
            </ul>
        </modal>
    </div>
</template>

<script>
import { mapState } from 'vuex'
import Modal from '@/components/Modal.vue'

export default {
    components: {Modal},
    props: {
        showModal: Boolean,
    },
    computed: {
        title() {
            let title = 'Logs'
            return title
        },
        showModalComp: {
            get() {
                return this.showModal
            },
            set(value) {
                this.$emit('update:showModal', value)
            }
        },
        ...mapState(['consoleLogs']),
    },
}
</script>

