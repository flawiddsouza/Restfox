<template>
    <div v-if="showModalComp">
        <modal title="Settings" v-model="showModalComp" width="600px">
            <div>
                Sidebar Width<br>
                <input type="text" :value="sidebarWidth" class="full-width-input" placeholder="Default" disabled>
            </div>
            <div style="padding-top: 1rem"></div>
            <div>
                Request Panel Ratio<br>
                <input type="text" :value="requestPanelRatio" class="full-width-input" placeholder="Default" disabled>
            </div>
            <div style="padding-top: 1rem"></div>
            <div>
                Response Panel Ratio<br>
                <input type="text" :value="responsePanelRatio" class="full-width-input" placeholder="Default" disabled>
            </div>
            <div style="padding-top: 1rem"></div>
            <div style="padding-top: 1rem"></div>
            <div>
                <label style="display: flex;">
                    <input type="checkbox" v-model="disablePageViewAnalyticsTracking"> <div style="margin-left: 0.5rem;">Disable Page View Analytics Tracking</div> <div style="margin-left: 0.5rem;"></div>
                </label>
                <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Disabling this will prevent the application from sending page view event to the <a href="https://umami.is" target="_blank">analytics server</a> when the application is opened. Please note that we do not track any other actions or the requests you make in the application. Click <a href="https://umami.is/docs/tracker-functions#:~:text=Pageviews,Website%20ID%20(required)" target="_blank">here</a> to see what data gets collected.</div>
            </div>
            <div style="padding-top: 1rem"></div>
            <div style="padding-top: 1rem"></div>
            <div style="font-style: italic; text-align: center;">Changes you make here will be auto saved</div>
            <template #footer>
                <button class="button" @click="resetSettings('widths')">Reset Widths</button>
                <button class="button" @click="resetSettings()" style="margin-left: 1rem">Reset All</button>
                <button class="button" @click="showModalComp = false" style="margin-left: 1rem">Done</button>
            </template>
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
            requestPanelRatio: null,
            responsePanelRatio: null,
            disablePageViewAnalyticsTracking: false,
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
        },
        disablePageViewAnalyticsTracking() {
            localStorage.setItem(constants.LOCAL_STORAGE_KEY.DISABLE_PAGE_VIEW_ANALYTICS_TRACKING, this.disablePageViewAnalyticsTracking)
        }
    },
    methods: {
        resetWidths() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.SIDEBAR_WIDTH)
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.REQUEST_PANEL_RATIO)
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.RESPONSE_PANEL_RATIO)
        },
        resetLayout() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.REQUEST_RESPONSE_LAYOUT)
        },
        resetDisablePageViewAnalyticsTracking() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.DISABLE_PAGE_VIEW_ANALYTICS_TRACKING)
        },
        resetSettings(target = null) {
            if(target) {
                if(target === 'widths') {
                    this.resetWidths()
                }

                document.location.reload()
            }

            this.resetWidths()
            this.resetLayout()
            this.resetDisablePageViewAnalyticsTracking()
            document.location.reload()
        },
        fetchSavedSettings() {
            const savedSidebarWidth = localStorage.getItem(constants.LOCAL_STORAGE_KEY.SIDEBAR_WIDTH)
            const savedRequestPanelRatio = localStorage.getItem(constants.LOCAL_STORAGE_KEY.REQUEST_PANEL_RATIO)
            const savedResponsePanelRatio = localStorage.getItem(constants.LOCAL_STORAGE_KEY.RESPONSE_PANEL_RATIO)
            const savedDisablePageViewAnalyticsTracking = localStorage.getItem(constants.LOCAL_STORAGE_KEY.DISABLE_PAGE_VIEW_ANALYTICS_TRACKING)

            if(savedSidebarWidth) {
                this.sidebarWidth = savedSidebarWidth
            }

            if(savedRequestPanelRatio) {
                this.requestPanelRatio = savedRequestPanelRatio
            }

            if(savedResponsePanelRatio) {
                this.responsePanelRatio = savedResponsePanelRatio
            }

            if(savedDisablePageViewAnalyticsTracking) {
                try {
                    this.disablePageViewAnalyticsTracking = JSON.parse(savedDisablePageViewAnalyticsTracking)
                } catch (e) {
                    this.disablePageViewAnalyticsTracking = false
                }
            }
        }
    }
}
</script>
