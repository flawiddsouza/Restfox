<template>
    <div v-if="showModalComp">
        <modal title="Settings" v-model="showModalComp" width="600px">
            <div>Running: {{ gitTag }} ({{ gitCommitHash }})</div>
            <div style="padding-top: 1rem"></div>
            <div style="display: flex; justify-content: space-between; gap: 1rem;">
                <div>
                    <div style="margin-bottom: var(--label-margin-bottom);">Sidebar Width</div>
                    <input type="text" :value="sidebarWidth" class="full-width-input" placeholder="Default" disabled>
                </div>
                <div>
                    <div style="margin-bottom: var(--label-margin-bottom);">Request Panel Ratio</div>
                    <input type="text" :value="requestPanelRatio" class="full-width-input" placeholder="Default" disabled>
                </div>
                <div>
                    <div style="margin-bottom: var(--label-margin-bottom);">Response Panel Ratio</div>
                    <input type="text" :value="responsePanelRatio" class="full-width-input" placeholder="Default" disabled>
                </div>
            </div>
            <div style="padding-top: 1rem"></div>
            <div>
                <div style="margin-bottom: var(--label-margin-bottom);">Global User Agent</div>
                <input type="text" v-model="globalUserAgent" class="full-width-input" placeholder="Enter user agent string">
                <button
                    class="button"
                    @click="getCurentUserAgent"
                    style="margin-top: 0.5rem"
                    aria-label="Get the current browser's UserAgent string"
                    title="Get the current browser's UserAgent string"
                >
                    Get Browser UserAgent
                </button>
                <div style="margin-top: 1rem">
                    Note that the default user agent <strong>Restfox/{{ getVersion() }}</strong> is used when no global user agent is set here or on request level.
                </div>
            </div>
            <div>
                <div style="margin-top: 1rem">
                    <div style="margin-bottom: var(--label-margin-bottom);">Editor Indent Size</div>
                    <select class="full-width-input" v-model="indentSize">
                        <option value="2">2</option>
                        <option value="4" selected>4</option>
                    </select>
                </div>
            </div>
            <div style="padding-top: 1rem"></div>
            <div>
                <label style="display: flex;">
                    <input type="checkbox" v-model="disablePageViewAnalyticsTracking"> <div style="margin-left: 0.5rem;">Disable Page View Analytics Tracking</div> <div style="margin-left: 0.5rem;"></div>
                </label>
                <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Ticking this will prevent the application from sending page view event to the <a href="https://umami.is" target="_blank">analytics server</a> when the application is opened. Please note that we do not track any other actions or the requests you make in the application. Click <a href="https://umami.is/docs/tracker-functions#:~:text=Pageviews,Website%20ID%20(required)" target="_blank">here</a> to see what data gets collected.</div>
            </div>
            <div>
                <label style="padding-top: 1rem; display: flex;">
                    <input type="checkbox" v-model="disableIframeSandbox"> <div style="margin-left: 0.5rem;">Remove Iframe Sandbox Restriction</div> <div style="margin-left: 0.5rem;"></div>
                </label>
                <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Ticking this will remove iframe sandbox restrictions. See <a href="https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox" target="_blank">this link</a> for more info.</div>
            </div>
            <template v-if="flags.isElectron">
                <div style="padding-top: 1rem"></div>
                <div>
                    <label style="display: flex;">
                        <input type="checkbox" v-model="disableSSLVerification"> <div style="margin-left: 0.5rem;">Disable SSL Verification</div> <div style="margin-left: 0.5rem;"></div>
                    </label>
                    <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Ticking this will disable SSL verification for all requests made from the application. This is useful when you are working with self signed certificates.</div>
                </div>
                <div style="padding-top: 1rem"></div>
                <div>
                    <label style="display: flex;">
                        <input type="checkbox" v-model="disableAutoUpdate"> <div style="margin-left: 0.5rem;">Disable Automatic Updates</div> <div style="margin-left: 0.5rem;"></div>
                    </label>
                    <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Ticking this will disable automatic updates</div>
                </div>
                <div style="padding-top: 1rem"></div>
                <div>
                    <label style="display: flex;">
                        <input type="checkbox" v-model="electronSwitchToChromiumFetch"> <div style="margin-left: 0.5rem;">Switch to Chromium Fetch</div> <div style="margin-left: 0.5rem;"></div>
                    </label>
                    <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Tick this if you're not able to make any requests despite the server being reachable. This is not recommended for most people and is only provided to temporarily alleviate issues with firewalls and vpns. See <a href="https://github.com/flawiddsouza/Restfox/issues/86" target="_blank">this link</a> for more info.</div>
                </div>
            </template>
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
import { getVersion } from '@/helpers'

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
            disableSSLVerification: false,
            electronSwitchToChromiumFetch: false,
            disableIframeSandbox: false,
            disableAutoUpdate: false,
            globalUserAgent: '',
            indentSize: constants.EDITOR_CONFIG.indent_size,
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
        flags() {
            return this.$store.state.flags
        },
        gitTag() {
            return import.meta.env.VITE_GIT_TAG
        },
        gitCommitHash() {
            return import.meta.env.VITE_GIT_COMMIT_HASH
        },
    },
    watch: {
        showModal() {
            this.fetchSavedSettings()
        },
        disablePageViewAnalyticsTracking() {
            localStorage.setItem(constants.LOCAL_STORAGE_KEY.DISABLE_PAGE_VIEW_ANALYTICS_TRACKING, this.disablePageViewAnalyticsTracking)
        },
        disableSSLVerification() {
            localStorage.setItem(constants.LOCAL_STORAGE_KEY.DISABLE_SSL_VERIFICATION, this.disableSSLVerification)
            this.$store.state.flags.disableSSLVerification = this.disableSSLVerification
        },
        electronSwitchToChromiumFetch() {
            localStorage.setItem(constants.LOCAL_STORAGE_KEY.ELECTRON_SWITCH_TO_CHROMIUM_FETCH, this.electronSwitchToChromiumFetch)
            this.$store.state.flags.electronSwitchToChromiumFetch = this.electronSwitchToChromiumFetch
        },
        disableIframeSandbox() {
            localStorage.setItem(constants.LOCAL_STORAGE_KEY.DISABLE_IFRAME_SANDBOX, this.disableIframeSandbox)
            this.$store.state.flags.disableIframeSandbox = this.disableIframeSandbox
        },
        disableAutoUpdate() {
            localStorage.setItem(constants.LOCAL_STORAGE_KEY.DISABLE_AUTO_UPDATE, this.disableAutoUpdate)
            this.$store.state.flags.disableAutoUpdate = this.disableAutoUpdate
        },
        globalUserAgent() {
            localStorage.setItem(constants.LOCAL_STORAGE_KEY.GLOBAL_USER_AGENT, this.globalUserAgent)
        },
        indentSize() {
            localStorage.setItem(constants.LOCAL_STORAGE_KEY.INDENT_SIZE, this.indentSize)
        }
    },
    methods: {
        getVersion,
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
        resetDisableSSLVerification() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.DISABLE_SSL_VERIFICATION)
        },
        resetElectronSwitchToChromiumFetch() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.ELECTRON_SWITCH_TO_CHROMIUM_FETCH)
        },
        resetDisableIframeSandbox() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.DISABLE_IFRAME_SANDBOX)
        },
        resetDisableAutoUpdate() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.DISABLE_AUTO_UPDATE)
        },
        resetGlobalUserAgent() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.GLOBAL_USER_AGENT)
            this.globalUserAgent = ''
        },
        resetSettings(target = null) {
            if(target) {
                if(target === 'widths') {
                    this.resetWidths()
                }

                document.location.reload()

                return
            }

            this.resetWidths()
            this.resetLayout()
            this.resetDisablePageViewAnalyticsTracking()
            this.resetDisableSSLVerification()
            this.resetElectronSwitchToChromiumFetch()
            this.resetDisableIframeSandbox()
            this.resetDisableAutoUpdate()
            this.resetGlobalUserAgent()

            document.location.reload()
        },
        fetchSavedSettings() {
            const savedSidebarWidth = localStorage.getItem(constants.LOCAL_STORAGE_KEY.SIDEBAR_WIDTH)
            const savedRequestPanelRatio = localStorage.getItem(constants.LOCAL_STORAGE_KEY.REQUEST_PANEL_RATIO)
            const savedResponsePanelRatio = localStorage.getItem(constants.LOCAL_STORAGE_KEY.RESPONSE_PANEL_RATIO)
            const savedDisablePageViewAnalyticsTracking = localStorage.getItem(constants.LOCAL_STORAGE_KEY.DISABLE_PAGE_VIEW_ANALYTICS_TRACKING)
            const savedDisableSSLVerification = localStorage.getItem(constants.LOCAL_STORAGE_KEY.DISABLE_SSL_VERIFICATION)
            const savedElectronSwitchToChromiumFetch = localStorage.getItem(constants.LOCAL_STORAGE_KEY.ELECTRON_SWITCH_TO_CHROMIUM_FETCH)
            const savedDisableIframeSandbox = localStorage.getItem(constants.LOCAL_STORAGE_KEY.DISABLE_IFRAME_SANDBOX)
            const savedDisableAutoUpdate = localStorage.getItem(constants.LOCAL_STORAGE_KEY.DISABLE_AUTO_UPDATE)
            const savedGlobalUserAgent = localStorage.getItem(constants.LOCAL_STORAGE_KEY.GLOBAL_USER_AGENT)
            const savedIndentSize = localStorage.getItem(constants.LOCAL_STORAGE_KEY.INDENT_SIZE) || 4

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

            if(savedDisableSSLVerification) {
                try {
                    this.disableSSLVerification = JSON.parse(savedDisableSSLVerification)
                } catch (e) {
                    this.disableSSLVerification = false
                }
            }

            if(savedElectronSwitchToChromiumFetch) {
                try {
                    this.electronSwitchToChromiumFetch = JSON.parse(savedElectronSwitchToChromiumFetch)
                } catch (e) {
                    this.electronSwitchToChromiumFetch = false
                }
            }
            if(savedDisableIframeSandbox) {
                try {
                    this.disableIframeSandbox = JSON.parse(savedDisableIframeSandbox)
                } catch (e) {
                    this.disableIframeSandbox = false
                }
            }
            if(savedDisableAutoUpdate) {
                try {
                    this.disableAutoUpdate = JSON.parse(savedDisableAutoUpdate)
                } catch (e) {
                    this.disableAutoUpdate = false
                }
            }
            if(savedGlobalUserAgent) {
                this.globalUserAgent = savedGlobalUserAgent
            }
            if(savedIndentSize) {
                this.indentSize = savedIndentSize
            }
        },
        getCurentUserAgent() {
            this.globalUserAgent = navigator.userAgent
        }
    }
}
</script>
