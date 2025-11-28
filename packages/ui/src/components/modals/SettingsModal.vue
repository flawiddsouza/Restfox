<template>
    <div v-if="showModalComp">
        <modal title="Settings" v-model="showModalComp" width="600px">
            <div>Running: {{ gitTag }} ({{ gitCommitHash }})</div>
            <div style="padding-top: 1rem"></div>

            <div class="tab-navigation">
                <div
                    v-for="tab in tabs"
                    :key="tab.key"
                    class="tab-button"
                    :class="{ 'tab-button-active': activeTab === tab.key }"
                    @click="activeTab = tab.key"
                >
                    {{ tab.label }}
                </div>
                <div class="tab-button-fill"></div>
            </div>

            <div class="tab-content">
                <div v-show="activeTab === 'user-interface'" class="tab-panel">
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

                    <div style="padding-top: 1rem">
                        <label style="display: flex;">
                            <input type="checkbox" v-model="showTabs"> <div style="margin-left: 0.5rem;">Show Tabs</div>
                        </label>
                        <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Un-ticking this will not show tabs when clicking on either request or folder.</div>
                    </div>

                    <div style="padding-top: 1rem">
                        <label style="display: flex;">
                            <input type="checkbox" v-model="hidePasswordFields"> <div style="margin-left: 0.5rem;">Hide Password Fields</div>
                        </label>
                        <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Ticking this will mask password input fields in the application for better security.</div>
                    </div>

                    <div style="padding-top: 1rem">
                        <div style="margin-bottom: var(--label-margin-bottom);">Editor Indent Size</div>
                        <select class="full-width-input" v-model="indentSize">
                            <option value="2">2</option>
                            <option value="4">4</option>
                        </select>
                    </div>
                </div>

                <div v-show="activeTab === 'request-response'" class="tab-panel">
                    <div>
                        <div style="margin-bottom: var(--label-margin-bottom);">Global User Agent</div>
                        <input type="text" v-model="globalUserAgent" class="full-width-input" placeholder="Enter user agent string">
                        <button
                            class="button"
                            @click="getCurrentUserAgent"
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

                    <template v-if="flags.isElectron || flags.isWebStandalone">
                        <div style="padding-top: 1rem">
                            <label style="display: flex;">
                                <input type="checkbox" v-model="disableSSLVerification"> <div style="margin-left: 0.5rem;">Disable SSL Verification</div>
                            </label>
                            <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Ticking this will disable SSL verification for all requests made from the application. This is useful when you are working with self signed certificates.</div>
                        </div>
                    </template>

                    <template v-if="flags.isElectron">
                        <div style="padding-top: 1rem">
                            <label style="display: flex;">
                                <input type="checkbox" v-model="electronSwitchToChromiumFetch"> <div style="margin-left: 0.5rem;">Switch to Chromium Fetch</div>
                            </label>
                            <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Tick this if you're not able to make any requests despite the server being reachable. This is not recommended for most people and is only provided to temporarily alleviate issues with firewalls and vpns. See <a href="https://github.com/flawiddsouza/Restfox/issues/86" target="_blank">this link</a> for more info.</div>
                        </div>
                    </template>

                    <div style="padding-top: 1rem">
                        <div style="margin-bottom: var(--label-margin-bottom);">Custom Response Formats</div>
                        <div style="margin-bottom: 0.5rem;">Add additional content types to be recognized as supported formats in the response panel (to bypass the binary response warning):</div>
                        <div style="display: flex; margin-bottom: 0.5rem;">
                            <input
                                type="text"
                                v-model="newCustomFormat"
                                class="full-width-input"
                                placeholder="e.g., application/protobuf"
                                @keyup.enter="addCustomFormat"
                                style="margin-right: 0.5rem;"
                            />
                            <button class="button" @click="addCustomFormat" :disabled="!newCustomFormat.trim()">Add</button>
                        </div>
                        <div v-if="customResponseFormats.length > 0" style="border: 1px solid var(--default-border-color); border-radius: var(--default-border-radius); padding: 0.5rem; display: flex; row-gap: 0.25rem; flex-direction: column;">
                            <div v-for="(format, index) in customResponseFormats" :key="index" style="display: flex; justify-content: space-between; align-items: center;">
                                <span>{{ format }}</span>
                                <button class="button" @click="removeCustomFormat(index)" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">Remove</button>
                            </div>
                        </div>
                        <div v-else style="color: var(--text-color); opacity: 0.7; font-style: italic;">No custom formats added</div>
                    </div>

                    <!-- Proxy Settings Section -->
                    <template v-if="flags.isElectron || flags.isWebStandalone">
                        <div style="padding-top: 1rem; border-top: 1px solid var(--default-border-color); margin-top: 1rem;">
                            <h4 style="margin-bottom: 0.5rem;">Proxy Settings</h4>
                            <label style="display: flex; align-items: center; cursor: pointer;">
                                <input type="checkbox" v-model="proxyEnabled" @change="updateProxySetting('enabled')">
                                <div style="margin-left: 0.5rem;">Enable Proxy</div>
                            </label>
                            <div style="margin-left: 1.5rem; margin-top: 0.3rem; font-size: 0.9em; opacity: 0.7;">
                                Route all requests through a proxy server for interception and debugging.
                            </div>
                        </div>
                        <div v-if="proxyEnabled" style="padding-top: 1rem; padding-left: 1.5rem;">
                            <div style="display: flex; gap: 1rem; align-items: flex-end;">
                                <div style="flex: 2;">
                                    <div style="margin-bottom: 0.3rem;">Proxy Host</div>
                                    <input 
                                        type="text" 
                                        v-model="proxyHost" 
                                        @change="updateProxySetting('host')"
                                        class="full-width-input" 
                                        placeholder="127.0.0.1"
                                    >
                                </div>
                                <div style="flex: 1;">
                                    <div style="margin-bottom: 0.3rem;">Proxy Port</div>
                                    <input 
                                        type="number" 
                                        v-model.number="proxyPort" 
                                        @change="updateProxySetting('port')"
                                        class="full-width-input" 
                                        placeholder="8080"
                                    >
                                </div>
                            </div>
                        </div>
                    </template>
                </div>

                <div v-show="activeTab === 'advanced'" class="tab-panel">
                    <div>
                        <label style="display: flex;">
                            <input type="checkbox" v-model="disablePageViewAnalyticsTracking"> <div style="margin-left: 0.5rem;">Disable Page View Analytics Tracking</div>
                        </label>
                        <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Ticking this will prevent the application from sending page view event to the <a href="https://umami.is" target="_blank">analytics server</a> when the application is opened. Please note that we do not track any other actions or the requests you make in the application. Click <a href="https://umami.is/docs/tracker-functions#:~:text=Pageviews,Website%20ID%20(required)" target="_blank">here</a> to see what data gets collected.</div>
                    </div>

                    <div style="padding-top: 1rem">
                        <label style="display: flex;">
                            <input type="checkbox" v-model="disableIframeSandbox"> <div style="margin-left: 0.5rem;">Remove Iframe Sandbox Restriction</div>
                        </label>
                        <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Ticking this will remove iframe sandbox restrictions. See <a href="https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox" target="_blank">this link</a> for more info.</div>
                    </div>

                    <template v-if="flags.isElectron">
                        <div style="padding-top: 1rem">
                            <label style="display: flex;">
                                <input type="checkbox" v-model="disableAutoUpdate"> <div style="margin-left: 0.5rem;">Disable Automatic Updates</div>
                            </label>
                            <div style="margin-left: 1.3rem; margin-top: 0.3rem;">Ticking this will disable automatic updates</div>
                        </div>
                    </template>
                </div>
            </div>

            <div style="padding-top: 2rem; font-style: italic; text-align: center;">Changes you make here will be auto saved</div>
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
import { ref, watch, onMounted } from 'vue'

export default {
    props: {
        showModal: Boolean
    },
    components: {
        Modal
    },
    data() {
        return {
            activeTab: 'user-interface',
            tabs: [
                { key: 'user-interface', label: 'User Interface' },
                { key: 'request-response', label: 'Request / Response' },
                { key: 'advanced', label: 'Advanced' }
            ],
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
            showTabs: false,
            hidePasswordFields: false,
            customResponseFormats: [],
            newCustomFormat: '',

            // Proxy settings refs
            // Change from ref() to plain values for Options API
            proxyEnabled: false,
            proxyHost: '127.0.0.1',
            proxyPort: 8080,
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
        },
        showTabs() {
            localStorage.setItem(constants.LOCAL_STORAGE_KEY.SHOW_TABS, this.showTabs)
            this.$store.state.flags.showTabs = this.showTabs
        },
        hidePasswordFields() {
            localStorage.setItem(constants.LOCAL_STORAGE_KEY.HIDE_PASSWORD_FIELDS, this.hidePasswordFields)
            this.$store.state.flags.hidePasswordFields = this.hidePasswordFields
        },
        customResponseFormats: {
            handler(newFormats) {
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.CUSTOM_RESPONSE_FORMATS, JSON.stringify(newFormats))
                this.$store.state.settings.customResponseFormats = newFormats
            },
            deep: true
        },
        proxyEnabled: {
            handler(newValue) {
                this.$store.state.flags.proxyEnabled = newValue
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.PROXY_ENABLED, newValue)
            },
            immediate: true
        },
        proxyHost: {
            handler(newValue) {
                this.$store.state.flags.proxyHost = newValue
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.PROXY_HOST, newValue)
            },
            immediate: true
        },
        proxyPort: {
            handler(newValue) {
                this.$store.state.flags.proxyPort = newValue
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.PROXY_PORT, newValue)
            },
            immediate: true
        },
    },
    methods: {
        getVersion,
        getStoredJSON(key, defaultValue = []) {
            try {
                const stored = localStorage.getItem(key)
                return stored ? JSON.parse(stored) : defaultValue
            } catch (error) {
                console.error(`Error parsing stored JSON for key ${key}:`, error)
                return defaultValue
            }
        },
        addCustomFormat() {
            const format = this.newCustomFormat.trim()
            if (format && !this.customResponseFormats.includes(format)) {
                this.customResponseFormats.push(format)
                this.newCustomFormat = ''
            }
        },
        removeCustomFormat(index) {
            this.customResponseFormats.splice(index, 1)
        },
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
        resetIndentSize() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.INDENT_SIZE)
            this.indentSize = constants.EDITOR_CONFIG.indent_size
        },
        resetShowTabs() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.SHOW_TABS)
            this.showTabs = true
        },
        resetHidePasswordFields() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.HIDE_PASSWORD_FIELDS)
            this.hidePasswordFields = false
        },
        resetCustomResponseFormats() {
            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.CUSTOM_RESPONSE_FORMATS)
            this.customResponseFormats = []
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
            this.resetIndentSize()
            this.resetShowTabs()
            this.resetHidePasswordFields()
            this.resetCustomResponseFormats()

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
            const savedShowTabs = localStorage.getItem(constants.LOCAL_STORAGE_KEY.SHOW_TABS) || true
            const savedHidePasswordFields = localStorage.getItem(constants.LOCAL_STORAGE_KEY.HIDE_PASSWORD_FIELDS) || false
            const savedProxyEnabled = localStorage.getItem(constants.LOCAL_STORAGE_KEY.PROXY_ENABLED)
            const savedProxyHost = localStorage.getItem(constants.LOCAL_STORAGE_KEY.PROXY_HOST)
            const savedProxyPort = localStorage.getItem(constants.LOCAL_STORAGE_KEY.PROXY_PORT)

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

            if(savedShowTabs) {
                try {
                    this.showTabs = JSON.parse(savedShowTabs)
                } catch (e) {
                    this.showTabs = true
                }
            }

            if(savedHidePasswordFields) {
                this.hidePasswordFields = this.getStoredJSON(constants.LOCAL_STORAGE_KEY.HIDE_PASSWORD_FIELDS, false)
            }

            this.customResponseFormats = this.getStoredJSON(constants.LOCAL_STORAGE_KEY.CUSTOM_RESPONSE_FORMATS)
            this.$store.state.settings.customResponseFormats = this.customResponseFormats

            if (savedProxyEnabled !== null) {
                this.proxyEnabled = savedProxyEnabled === 'true'
                this.$store.state.flags.proxyEnabled = this.proxyEnabled
            }
            if (savedProxyHost) {
                this.proxyHost = savedProxyHost
                this.$store.state.flags.proxyHost = this.proxyHost
            }
            if (savedProxyPort) {
                this.proxyPort = parseInt(savedProxyPort, 10)
                this.$store.state.flags.proxyPort = this.proxyPort
            }
        },
        getCurrentUserAgent() {
            this.globalUserAgent = navigator.userAgent
        },
        updateProxySettings() {
            this.$store.state.flags.proxyEnabled = this.proxyEnabled
            this.$store.state.flags.proxyHost = this.proxyHost
            this.$store.state.flags.proxyPort = this.proxyPort

            localStorage.setItem(constants.LOCAL_STORAGE_KEY.PROXY_ENABLED, this.proxyEnabled)
            localStorage.setItem(constants.LOCAL_STORAGE_KEY.PROXY_HOST, this.proxyHost)
            localStorage.setItem(constants.LOCAL_STORAGE_KEY.PROXY_PORT, this.proxyPort)
        },
        loadProxySettings() {
            const savedEnabled = localStorage.getItem(constants.LOCAL_STORAGE_KEY.PROXY_ENABLED)
            const savedHost = localStorage.getItem(constants.LOCAL_STORAGE_KEY.PROXY_HOST)
            const savedPort = localStorage.getItem(constants.LOCAL_STORAGE_KEY.PROXY_PORT)

            this.proxyEnabled = savedEnabled === 'true'
            this.proxyHost = savedHost || '127.0.0.1'
            this.proxyPort = savedPort ? parseInt(savedPort, 10) : 8080

            this.$store.state.flags.proxyEnabled = this.proxyEnabled
            this.$store.state.flags.proxyHost = this.proxyHost
            this.$store.state.flags.proxyPort = this.proxyPort
        },

        updateProxySetting(type) {
            if (type === 'enabled') {
                this.$store.state.flags.proxyEnabled = this.proxyEnabled
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.PROXY_ENABLED, this.proxyEnabled.toString())
            } else if (type === 'host') {
                this.$store.state.flags.proxyHost = this.proxyHost
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.PROXY_HOST, this.proxyHost)
            } else if (type === 'port') {
                this.$store.state.flags.proxyPort = this.proxyPort
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.PROXY_PORT, this.proxyPort.toString())
            }
        },
    },
    mounted() {
        this.loadProxySettings()
    }
}
</script>

<style scoped>
.tab-navigation {
    display: flex;
    user-select: none;
    background-color: var(--sidebar-item-active-color);
    border-top: 1px solid var(--default-border-color);
}

.tab-button {
    padding: 10px 15px;
    border-bottom: 1px solid var(--default-border-color);
    border-left: 1px solid transparent;
    border-right: 1px solid transparent;
    white-space: nowrap;
    cursor: pointer;
}

.tab-button-active {
    border-bottom: 1px solid transparent;
    border-left: 1px solid var(--default-border-color);
    border-right: 1px solid var(--default-border-color);
    background: var(--background-color);
}

.tab-button-fill {
    width: 100%;
    border-bottom: 1px solid var(--default-border-color);
}

.tab-content {
    padding-top: 1rem;
    overflow-y: auto;
    min-height: 45svh;
}

/* Remove the settings-group, setting-row, checkbox-label, text-input styles 
   that were added at the bottom since we're using existing styles now */
</style>
