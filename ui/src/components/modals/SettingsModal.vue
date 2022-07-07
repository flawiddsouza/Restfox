<template>
    <div v-if="showModalComp">
        <modal title="Settings" v-model="showModalComp">
            <div>
                Sidebar Width:
                <input type="text" :value="sidebarWidth" disabled>
            </div>
            <div style="padding-top: 1rem"></div>
            <div>
                Request Panel Width:
                <input type="text" :value="requestPanelWidth" disabled>
            </div>
            <div style="padding-top: 1rem"></div>
            <div>
                <button @click="resetSettings('widths')">Reset Widths</button>
                <button @click="resetSettings()" style="margin-left: 1rem">Reset All</button>
            </div>
        </modal>
    </div>
</template>

<script>
import Modal from '@/components/Modal.vue'
import constants from '../../constants'

export default {
    props: {
        showModal: Boolean
    },
    components: {
        Modal
    },
    data() {
        return {
            sidebarWidth: null,
            requestPanelWidth: null
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
            this.fetchSavedSettings()
        }
    },
    methods: {
        resetWidths() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.SIDEBAR_WIDTH)
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.REQUEST_PANEL_WIDTH)
        },
        resetSettings(target=null) {
            if(target) {
                if(target === 'widths') {
                    this.resetWidths()
                }

                document.location.reload()
            }

            this.resetWidths()
            document.location.reload()
        },
        fetchSavedSettings() {
            const savedSidebarWidth = localStorage.getItem(constants.LOCAL_STORAGE_KEY.SIDEBAR_WIDTH)
            const savedRequestPanelWidth = localStorage.getItem(constants.LOCAL_STORAGE_KEY.REQUEST_PANEL_WIDTH)

            if(savedSidebarWidth) {
                this.sidebarWidth = savedSidebarWidth
            }

            if(savedRequestPanelWidth) {
                this.requestPanelWidth = savedRequestPanelWidth
            }
        }
    }
}
</script>
