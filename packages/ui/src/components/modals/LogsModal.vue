<template>
    <div v-if="showModalComp">
        <modal :title="title" v-model="showModalComp" height="70vh" width="55rem">
            <table style="table-layout: fixed">
                <tr v-for="(log, index) in consoleLogs" :key="index">
                    <td>
                        {{ log.message }}
                    </td>
                </tr>
            </table>
        </modal>
    </div>
</template>

<script>
import { mapState } from 'vuex'
import Modal from '@/components/Modal.vue'

export default {
    components: { Modal },
    props: {
        showModal: Boolean,
    },
    computed: {
        title() {
            return 'Logs'
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

