<template>
    <div class="loading-overlay" v-if="status === 'loading'">
        <h2 style="font-variant-numeric: tabular-nums; font-weight: 500">Loading...</h2>
        <div class="pad">
            <i class="fas fa-sync fa-spin"></i>
        </div>
        <div class="pad">
            <button @click="cancelRequest">Cancel Request</button>
        </div>
    </div>
    <template v-if="status !== 'not loaded' && response !== null">
        <div class="response-panel-address-bar">
            <div class="response-panel-address-bar-tag-container">
                <div class="tag" :class="{
                    'green': response.status >= 200 && response.status <= 299,
                    'yellow': response.status >= 400 && response.status <= 499,
                    'red': response.status >= 500 || response.statusText === 'Error'
                }">
                    <span class="bold">{{ response.status }}</span>
                    {{ response.statusText }}
                </div>
                <div class="tag plr-0 ml-0_6rem" v-if="response.timeTaken">{{ humanFriendlyTime(response.timeTaken) }}</div>
                <div class="tag plr-0 ml-0_6rem" v-if="responseSize">{{ humanFriendlySize(responseSize) }}</div>
            </div>
            <div class="response-panel-address-bar-select-container">
                <select v-model="response" v-if="responses.length > 0" @contextmenu.prevent="handleResponseHistoryContextMenu">
                    <option v-for="response in responses" :value="response">{{ dateFormat(response.createdAt, true) }} | {{ response.url }}</option>
                </select>
            </div>
        </div>
        <div class="response-panel-tabs">
            <div class="response-panel-tab" :class="{ 'response-panel-tab-active': activeResponsePanelTab === responsePanelTab.name }" @click="activeResponsePanelTab = responsePanelTab.name" v-for="responsePanelTab in responsePanelTabs">
                {{ responsePanelTab.name }}
            </div>
            <div class="response-panel-tab-fill"></div>
            <div class="response-panel-tab-actions">
                <i class="fas fa-paste" @click="copyResponseToClipboard" title="Copy response to clipboard"></i>
            </div>
        </div>
        <div class="response-panel-tabs-context">
            <template v-if="activeResponsePanelTab === 'Preview'">
                <template v-if="response.statusText !== 'Error'">
                    <CodeMirrorResponsePanelPreview :model-value="bufferToJSONString(response.buffer)" />
                </template>
                <div class="content-box" v-else>
                    <div>{{ response.error }}</div>
                    <div style="margin-top: 1.5rem; width: 30rem;" v-if="response.error !== 'Error: Request Cancelled'">
                        <div style="margin-bottom: 0.5rem">Possible causes for this error:</div>
                        <div style="margin-left: 0.5rem; margin-bottom: 0.4rem; line-height: 1rem;">1) Given request URL is incorrect or invalid</div>
                        <div style="margin-left: 0.5rem; margin-bottom: 0.4rem; line-height: 1rem;">2) The server for the url isn't returning a valid response for the created request</div>
                        <template v-if="flags.isBrowser">
                            <template v-if="!flags.hideBrowserRelatedResponsePanelErrors">
                                <div style="margin-left: 0.5rem; margin-bottom: 0.4rem; line-height: 1rem;">3) No CORS headers present for the requested url and requested http method</div>
                                <div style="margin-left: 0.5rem; margin-bottom: 0.4rem; line-height: 1rem;">4) On the browser version, only https urls and localhost can be loaded at the moment. So if you're hitting a http url, the request will fail because https doesn't like requesting http urls.</div>
                            </template>
                            <div v-show="!flags.browserExtensionEnabled" style="margin-top: 1.5rem; line-height: 1rem;">
                                Points 3 & 4 can be bypassed using the <a href="https://chrome.google.com/webstore/detail/restfox-cors-helper/pgoncladmcclnmilkbnmmbldcihdgfnf" target="_blank">Chrome</a> or <a href="https://addons.mozilla.org/en-US/firefox/addon/restfox-cors-helper/" target="_blank">Firefox</a> extension for Restfox
                            </div>
                            <div v-show="flags.browserExtensionEnabled" style="margin-top: 1.5rem; line-height: 1rem;">
                                Browser extension is active. CORS will be bypassed and http requests will also work now.
                            </div>
                        </template>
                    </div>
                </div>
            </template>
            <template v-if="activeResponsePanelTab === 'Header'">
                <div class="content-box">
                    <table>
                        <tr v-for="header in response.headers">
                            <td style="white-space: nowrap">{{ header[0] }}</td>
                            <td style="word-break: break-word">{{ header[1] }}</td>
                        </tr>
                    </table>
                </div>
            </template>
            <div class="content-box" v-if="activeResponsePanelTab === 'Request'">
                <div><span :class="`request-method--${response.request.method}`" style="padding-right: 0.25rem;">{{ response.request.method }}</span> {{ response.url }}{{ response.request.query }}</div>
                <div style="margin-top: 0.5rem">
                    <table>
                        <tr v-for="header in Object.keys(response.request.headers)">
                            <td style="white-space: nowrap">{{ header }}</td>
                            <td style="word-break: break-word">{{ response.request.headers[header] }}</td>
                        </tr>
                    </table>
                </div>
                <div style="margin-top: 1rem" v-html="responseRequestBodyOutput"></div>
                <div style="margin-top: 1rem">
                    <button @click="restoreCurrentResponseRequest">Restore</button>
                </div>
            </div>
        </div>
    </template>
    <template v-else>
        <div style="display: grid; place-items: center; height: 100%; grid-row: span 3;">
            <div>Send request to see response here</div>
        </div>
    </template>
    <ContextMenu :options="responseHistoryContextMenuOptions" :element="responseHistoryContextMenuElement" v-model:show="showResponseHistoryContextMenu" @click="handleResponseHistoryContextMenuItemClick" />
</template>

<script>
import CodeMirrorResponsePanelPreview from './CodeMirrorResponsePanelPreview.vue'
import ContextMenu from './ContextMenu.vue'
import { dateFormat, humanFriendlyTime, humanFriendlySize } from '@/helpers'
import { emitter } from '@/event-bus'

export default {
    components: {
        CodeMirrorResponsePanelPreview,
        ContextMenu
    },
    data() {
        return {
            activeResponsePanelTab: 'Preview',
            responseHistoryContextMenuElement: null,
            showResponseHistoryContextMenu: false
        }
    },
    computed: {
        responsePanelTabs() {
            let tabs = [
                {
                    name: 'Preview'
                },
                {
                    name: 'Header'
                }
            ]

            if(this.response && 'request' in this.response) {
                tabs.push({
                    name: 'Request'
                })
            }

            return tabs
        },
        activeTab() {
            return this.$store.state.activeTab
        },
        status() {
            if(this.activeTab && this.activeTab._id in this.$store.state.requestResponseStatus) {
                return this.$store.state.requestResponseStatus[this.activeTab._id]
            }

            return 'not loaded'
        },
        responses() {
            return this.$store.state.responses[this.activeTab._id]
        },
        response: {
            get() {
                if(this.activeTab && this.activeTab._id in this.$store.state.requestResponses) {
                    return this.$store.state.requestResponses[this.activeTab._id]
                }

                return null
            },
            set(response) {
                this.$store.state.requestResponses[this.activeTab._id] = response
            }
        },
        requestAbortController() {
            if(this.activeTab && this.activeTab._id in this.$store.state.requestResponses) {
                return this.$store.state.requestAbortController[this.activeTab._id]
            }

            return null
        },
        responseHistoryContextMenuOptions() {
            return [
                {
                    'type': 'option',
                    'label': 'Delete Current Response',
                    'value': 'Delete Current Response',
                    'icon': 'fa fa-trash',
                },
                {
                    'type': 'option',
                    'label': 'Clear History',
                    'value': 'Clear History',
                    'icon': 'fa fa-trash',
                }
            ]
        },
        flags() {
            return this.$store.state.flags
        },
        responseSize() {
            if(this.response && 'buffer' in this.response) {
                return this.response.buffer.byteLength
            }

            return null
        },
        responseRequestBodyOutput() {
            if(this.response.request.body === null) {
                return null
            }

            if(this.response.request.body instanceof File) {
                // prevent memory leak
                if('responseRequestBodyObjectUrl' in window) {
                    URL.revokeObjectURL(window.responseRequestBodyObjectUrl)
                }
                window.responseRequestBodyObjectUrl = URL.createObjectURL(this.response.request.body)
                return `<div><a href="${window.responseRequestBodyObjectUrl}" download="${this.response.request.body.name}">${this.response.request.body.name}</a></div>`
            } else {
                return `<div>${this.response.request.body}</div>`
            }
        }
    },
    watch: {
        response() {
            if(this.responsePanelTabs.length === 2 && this.activeResponsePanelTab === 'Request') {
                this.activeResponsePanelTab = 'Preview'
            }
        }
    },
    methods: {
        cancelRequest() {
            this.requestAbortController.abort()
        },
        bufferToString(buffer) {
            const textDecoder = new TextDecoder('utf-8')
            return textDecoder.decode(buffer)
        },
        bufferToJSONString(buffer) {
            const responseText = this.bufferToString(buffer)
            try {
                return JSON.stringify(JSON.parse(responseText), null, 4)
            } catch {
                return responseText
            }
        },
        dateFormat,
        humanFriendlyTime,
        humanFriendlySize,
        handleResponseHistoryContextMenu(event) {
            this.responseHistoryContextMenuElement = event.target
            this.showResponseHistoryContextMenu = true
        },
        handleResponseHistoryContextMenuItemClick(clickedContextMenuitem) {
            if(clickedContextMenuitem === 'Delete Current Response') {
                this.$store.commit('deleteCurrentlyActiveResponse')
            }

            if(clickedContextMenuitem === 'Clear History') {
                this.$store.commit('clearResponseHistory')
            }
        },
        async copyResponseToClipboard() {
            if(!window.isSecureContext) {
                alert('Copy to clipboard needs Restfox running under a https url')
                return
            }
            await navigator.clipboard.writeText(this.bufferToJSONString(this.response.buffer))
            this.$toast.success('Copied to clipboard')
        },
        restoreCurrentResponseRequest() {
            if(!confirm('Are you sure? Restoring a request will reset your existing request and make it the same as the saved response\'s request.')) {
                return
            }

            this.activeTab.url = this.response.request.original.url
            this.activeTab.body = JSON.parse(JSON.stringify(this.response.request.original.body))

            if(this.response.request.original.parameters) {
                this.activeTab.parameters = JSON.parse(JSON.stringify(this.response.request.original.parameters))
            }

            if(this.response.request.original.headers) {
                this.activeTab.headers = JSON.parse(JSON.stringify(this.response.request.original.headers))
            }

            if(this.response.request.original.authentication) {
                this.activeTab.authentication = JSON.parse(JSON.stringify(this.response.request.original.authentication))
            }

            emitter.emit('response_panel', 'request restored')
        }
    }
}
</script>

<style scoped>
.loading-overlay {
    background-color: #29292969;
    color: #292929;
    opacity: 1;
    transition: opacity 200ms ease-out;
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    bottom: 0;
    z-index: 9;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    text-align: center;
}

.loading-overlay .pad {
    padding: calc(1rem * 1.2);
}

.loading-overlay .fas {
    font-size: 4rem;
}

.response-panel-address-bar {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px solid var(--default-border-color);
    height: 2rem;
    align-items: center;
    min-width: 0;
    padding-left: 0.5rem;
}

.response-panel-address-bar .response-panel-address-bar-tag-container {
    display: flex;
}

.response-panel-address-bar .tag {
    padding: 0.2rem 0.6rem;
    white-space: nowrap;
    user-select: none;
}

.response-panel-address-bar .tag .bold {
    font-weight: 500;
}

.response-panel-address-bar .tag.green {
    background: #75ba24;
    color: white;
}

.response-panel-address-bar .tag.yellow {
    background: #ec8702;
    color: white;
}

.response-panel-address-bar .tag.red {
    background: #e15251;
    color: white;
}

.response-panel-address-bar .tag.plr-0 {
    padding-left: 0;
    padding-right: 0;
}

.response-panel-address-bar .tag.ml-0_6rem {
    margin-left: 0.6rem;
}

.response-panel-address-bar .response-panel-address-bar-select-container {
    height: 100%;
    margin-left: 1rem;
}

.response-panel-address-bar  .response-panel-address-bar-select-container select {
    width: 100%;
    height: 100%;
    border: 0;
    outline: 0;
    padding-left: 0.5em;
    padding-right: 0.5em;
}

.response-panel-address-bar  .response-panel-address-bar-select-container select:hover {
    background-color: #f7f7f7;
}

.response-panel-tabs {
    display: flex;
    user-select: none;
}

.response-panel-tabs .response-panel-tab {
    padding: 10px 15px;
    border-bottom: 1px solid var(--default-border-color);
    border-left: 1px solid transparent;
    border-right: 1px solid transparent;
}

.response-panel-tabs .response-panel-tab-active {
    border-bottom: 1px solid transparent;
    border-right: 1px solid var(--default-border-color);
}

.response-panel-tabs .response-panel-tab-active:not(:first-child) {
    border-left: 1px solid var(--default-border-color);
}

.response-panel-tabs .response-panel-tab-fill {
    width: 100%;
    border-bottom: 1px solid var(--default-border-color);
}

.response-panel-tabs .response-panel-tab-actions {
    display: flex;
    border-bottom: 1px solid var(--default-border-color);
}

.response-panel-tabs .response-panel-tab-actions i {
    height: 100%;
    display: grid;
    place-items: center;
    cursor: pointer;
    font-size: 1rem;
    padding-right: 1rem;
}

.response-panel-tabs-context {
    overflow-y: auto;
}

.response-panel-tabs-context .content-box {
    padding: 1rem;
}

.response-panel-tabs-context table {
    border-collapse: collapse;
    width: 100%;
}

.response-panel-tabs-context table th, .response-panel-tabs-context table td {
    border: 1px solid var(--default-border-color);
    padding: 0.5rem;
}
</style>
