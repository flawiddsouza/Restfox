<template>
    <div class="loading-overlay" v-if="status === 'loading'">
        <h2 style="font-variant-numeric: tabular-nums; font-weight: 500">Loading...</h2>
        <div class="pad">
            <i class="fas fa-sync fa-spin"></i>
        </div>
        <div class="pad">
            <button class="button" @click="cancelRequest">Cancel Request</button>
        </div>
    </div>
    <template v-if="status !== 'not loaded' && response !== null">
        <div class="response-panel-address-bar">
            <div class="response-panel-address-bar-tag-container">
                <div
                    class="tag"
                    :class="responseStatusColorMapping(response)"
                    style="max-width: 15rem; text-overflow: ellipsis; overflow: hidden;"
                    :title="response.statusText === '' ? getStatusText(response.status) : response.statusText"
                >
                    <span class="bold">{{ response.status }}</span>
                    {{ response.statusText === '' ? getStatusText(response.status) : response.statusText }}
                </div>
                <div class="tag ml-0_6rem" v-if="response.timeTaken">{{ humanFriendlyTime(response.timeTaken) }}</div>
                <div class="tag ml-0_6rem" v-if="responseSize">{{ humanFriendlySize(responseSize) }}</div>
            </div>
            <div class="response-panel-address-bar-select-container">
                <div v-if="response.createdAt" class="custom-dropdown" @click="handleResponseHistoryContextMenu" @contextmenu.prevent="handleResponseHistoryContextMenu">
                    <span class="custom-dropdown-content">{{ timeAgo(response.createdAt) }} | {{ dateFormat(response.createdAt, true) }} | {{ response.name ?? response.url }}</span>
                    <i class="fa fa-caret-down space-right"></i>
                </div>
            </div>
        </div>
        <div class="response-panel-tabs">
            <div class="response-panel-tab" :class="{ 'response-panel-tab-active': activeResponsePanelTab === responsePanelTab.name }" @click="activeResponsePanelTab = responsePanelTab.name" v-for="responsePanelTab in responsePanelTabs">
                {{ responsePanelTab.label }}
                <i :class="`fa fa-circle ${ allTestsPassed ? 'passed-tests' : 'failed-tests' }`" v-if="responsePanelTab.name === 'Tests' && response.testResults && response.testResults.length > 0" style="margin-left: 0.2rem"></i>
            </div>
            <div class="response-panel-tab-fill"></div>
            <div class="response-panel-tab-actions">
                <i class="fas fa-code" @click="setSelectedTextAsEnvironmentVariable" title="Set selected text as environment variable"></i>
                <i class="fas fa-download" @click="downloadResponse" title="Download response as a file"></i>
                <i class="fas fa-paste" @click="copyResponseToClipboard" title="Copy response to clipboard"></i>
            </div>
        </div>
        <div class="response-panel-tabs-context">
            <template v-if="activeResponsePanelTab === 'Preview'">
                <section style="height: 100%; overflow: auto;" ref="scrollableArea">
                    <template v-if="response.statusText !== 'Error'">
                        <div class="content-box" v-if="responseContentType.startsWith('image/svg')">
                            <ImageFromBuffer :buffer="response.buffer" :is-svg="true" style="max-width: 100%; max-height: 100%;" />
                        </div>
                        <div class="content-box" v-else-if="responseContentType.startsWith('image/')">
                            <ImageFromBuffer :buffer="response.buffer" style="max-width: 100%; max-height: 100%;" />
                        </div>
                        <div style="height: 100%; overflow: hidden;" v-else-if="responseContentType.startsWith('text/html')">
                            <IframeFromBuffer :buffer="response.buffer" style="width: 100%; height: 100%; border: none; background-color: white;" />
                        </div>
                        <template v-else-if="responseContentType.startsWith('application/xml')">
                            <CodeMirrorResponsePanelPreview :model-value="responseFilter === '' ? bufferToJSONString(response.buffer) : filterXmlResponse(response.buffer, responseFilter)" @selection-changed="codeMirrorSelectionChanged" />
                        </template>
                        <template v-else-if="responseContentType.startsWith('application/json')">
                            <CodeMirrorResponsePanelPreview :model-value="responseFilter === '' ? bufferToJSONString(response.buffer) : filterJSONResponse(response.buffer, responseFilter)" @selection-changed="codeMirrorSelectionChanged" />
                        </template>
                        <template v-else>
                            <CodeMirrorResponsePanelPreview :model-value="bufferToJSONString(response.buffer)" @selection-changed="codeMirrorSelectionChanged" />
                        </template>
                    </template>
                    <div class="content-box" v-else>
                        <div style="white-space: pre-line;">{{ response.error }}</div>
                        <div style="margin-top: 1.5rem; word-break: break-word;" v-if="response.error === 'Error: Request failed'">
                            <div style="margin-bottom: 0.5rem">Possible causes for this error:</div>
                            <div style="margin-left: 0.5rem; margin-bottom: 0.4rem; line-height: 1rem;">1) Given request URL is incorrect or invalid</div>
                            <div style="margin-left: 0.5rem; margin-bottom: 0.4rem; line-height: 1rem;">2) The server for the url isn't returning a valid response for the created request</div>
                            <div style="margin-left: 0.5rem; margin-bottom: 0.4rem; line-height: 1rem;">3) The server for the url has an expired or invalid ssl certificate</div>
                            <template v-if="flags.isBrowser">
                                <template v-if="!flags.hideBrowserRelatedResponsePanelErrors">
                                    <div style="margin-left: 0.5rem; margin-bottom: 0.4rem; line-height: 1rem;">4) No CORS headers present for the requested url and requested http method</div>
                                    <div style="margin-left: 0.5rem; margin-bottom: 0.4rem; line-height: 1rem;">5) On the browser version, only https urls and localhost can be loaded at the moment. So if you're hitting a http url, the request will fail because https doesn't like requesting http urls.</div>
                                </template>
                                <div v-show="!flags.browserExtensionEnabled" style="margin-top: 1.5rem; line-height: 1rem;">
                                    Points 4 & 5 can be bypassed using the <a href="https://chrome.google.com/webstore/detail/restfox-cors-helper/pgoncladmcclnmilkbnmmbldcihdgfnf" target="_blank">Chrome</a> or <a href="https://addons.mozilla.org/en-US/firefox/addon/restfox-cors-helper/" target="_blank">Firefox</a> extension for Restfox
                                </div>
                                <div v-show="flags.browserExtensionEnabled" style="margin-top: 1.5rem; line-height: 1rem;">
                                    Browser extension is active. CORS will be bypassed and http requests will also work now.
                                </div>
                            </template>
                        </div>
                        <div style="margin-top: 1.5rem; width: 30rem;" v-if="response.error === 'Error: Invalid URL'">
                            <div style="line-height: 1rem;">Please make sure the protocol (http/https) is present in the URL</div>
                        </div>
                    </div>
                </section>
                <section class="sticky-section">
                    <div class="row" v-if="responseContentType.startsWith('application/json')">
                        <input type="text" class="full-width-input" title="Filter response body" placeholder="$.store.books[*].author" v-model="responseFilter">
                        <a href="#" @click.prevent="showResFilteringHelpModal" class="help-link"><i class="fas fa-question-circle"></i></a>
                    </div>
                    <div class="row" v-else-if="responseContentType.startsWith('application/xml')">
                        <input type="text" class="full-width-input" title="Filter response body" placeholder="/store/books/author" v-model="responseFilter">
                        <a href="#" @click.prevent="showResFilteringHelpModal" class="help-link"><i class="fas fa-question-circle"></i></a>
                    </div>
                </section>
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
                    <button class="button" @click="restoreCurrentResponseRequest">Restore</button>
                </div>
            </div>
            <div class="content-box" v-if="activeResponsePanelTab === 'Tests'">
                <div v-if="response.testResults.length === 0">
                    <div style="margin-bottom: 1rem;">No tests found</div>
                    <div>Please refer <a href="https://docs.restfox.dev/plugins/testing-response-data.html" target="_blank">https://docs.restfox.dev/plugins/testing-response-data.html</a> for more info on how to write tests.</div>
                </div>
                <div v-else>
                    <div style="padding-bottom: 0.5rem">Tests: {{ response.testResults.length }}, Passed: {{ passedTestCases }}, Failed: {{ response.testResults.length - passedTestCases }}</div>
                    <div v-for="testResult in response.testResults" style="padding-bottom: 0.5rem">
                        <div :style="{ color: testResult.passed ? 'var(--base-color-success)' : 'var(--base-color-error)' }"><span v-if="testResult.passed">✔  </span><span v-else>✘  </span>{{ testResult.description }}</div>
                        <div v-if="!testResult.passed" style="margin-left: 1rem; margin-top: 0.15rem;">{{ testResult.error }}</div>
                    </div>
                </div>
            </div>
            <div class="content-box" v-if="activeResponsePanelTab === 'Timeline'">
                <ResponsePanelTimeline v-model:response="response"></ResponsePanelTimeline>
            </div>
        </div>
    </template>
    <template v-else>
        <div style="display: grid; place-items: center; height: 100%; grid-row: span 3;">
            <div>Send request to see response here</div>
        </div>
    </template>
    <ContextMenu
        :options="responseHistoryContextMenuOptions"
        :element="responseHistoryContextMenuElement"
        :x="responseHistoryContextMenuX"
        :y="responseHistoryContextMenuY"
        :width="responseHistoryContextMenuWidth"
        v-model:show="showResponseHistoryContextMenu"
        :selected-option="response"
        @click="handleResponseHistoryContextMenuItemClick"
    />
    <ResponseFilteringHelpModal v-model:showModal="showResponseFilteringHelpModal" v-model:is-xml="isXmlResponse"></ResponseFilteringHelpModal>
</template>

<script lang="ts">
import { nextTick, toRaw } from 'vue'
import CodeMirrorResponsePanelPreview from './CodeMirrorResponsePanelPreview.vue'
import ContextMenu from './ContextMenu.vue'
import ImageFromBuffer from './ImageFromBuffer.vue'
import IframeFromBuffer from './IframeFromBuffer.vue'
import ResponsePanelTimeline from './ResponsePanelTimeline.vue'
import {
    dateFormat,
    humanFriendlyTime,
    humanFriendlySize,
    parseContentDispositionHeaderAndGetFileName,
    setEnvironmentVariable,
    getAlertConfirmPromptContainer,
    getStatusText,
    timeAgo,
    responseStatusColorMapping,
} from '@/helpers'
import {
    bufferToJSONString,
    filterJSONResponse,
    filterXmlResponse,
    getResponseContentType,
} from '@/utils/response'
import { emitter } from '@/event-bus'
import ResponseFilteringHelpModal from '@/components/modals/ResponseFilteringHelpModal.vue'
import constants from '@/constants'

export default {
    components: {
        ResponseFilteringHelpModal,
        CodeMirrorResponsePanelPreview,
        ContextMenu,
        ImageFromBuffer,
        IframeFromBuffer,
        ResponsePanelTimeline,
    },
    props: {
        activeTab: Object
    },
    data() {
        return {
            activeResponsePanelTab: 'Preview',
            responseHistoryContextMenuElement: null,
            responseHistoryContextMenuX: null,
            responseHistoryContextMenuY: null,
            responseHistoryContextMenuWidth: null,
            responseHistoryContextMenuOptionsType: null,
            showResponseHistoryContextMenu: false,
            currentlySelectedText: '',
            isXmlResponse: false,
            showResponseFilteringHelpModal: false,
            responseFilter: '',
            scrollableAreaEventListenerAttached: false,
            scrollableAreaScrollTop: null,
        }
    },
    computed: {
        responsePanelTabs() {
            let tabs = [
                {
                    name: 'Preview',
                    label: 'Preview'
                },
                {
                    name: 'Header',
                    label: 'Header'
                }
            ]

            if(this.response && 'request' in this.response) {
                tabs.push({
                    name: 'Request',
                    label: 'Request'
                })
            }

            if(this.isTestResultsAvailable) {
                const tab = {
                    name: 'Tests',
                    label: 'Tests'
                }

                if(this.response.testResults.length > 0) {
                    tab.label += ` (${this.response.testResults.filter(item => item.passed).length}/${this.response.testResults.length})`
                }

                tabs.push(tab)
            }

            if(this.response && 'request' in this.response) {
                tabs.push({
                    name: 'Timeline',
                    label: 'Timeline'
                })
            }

            return tabs
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
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
            if(!this.response) {
                return []
            }

            const options = []

            if(this.responseHistoryContextMenuOptionsType === 'click') {
                options.push(...this.getHistoryResponses())
            }


            if(this.responseHistoryContextMenuOptionsType === 'contextmenu') {
                options.push(...[
                    {
                        'type': 'option',
                        'label': 'Rename Current Response',
                        'value': 'Rename Current Response',
                        'icon': 'fa fa-edit',
                        'disabled': '_id' in this.response === false
                    },
                    {
                        'type': 'option',
                        'label': 'Delete Current Response',
                        'value': 'Delete Current Response',
                        'icon': 'fa fa-trash',
                        'disabled': '_id' in this.response === false
                    },
                    {
                        'type': 'option',
                        'label': 'Clear History',
                        'value': 'Clear History',
                        'icon': 'fa fa-trash'
                    }
                ])
            }

            return options
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
            if(this.response.request.body === null && !this.response.request.original.body.params) {
                return null
            }

            if(this.response.request.method === 'GET') {
                return null
            }

            if(this.response.request.body instanceof File) {
                // prevent memory leak
                if('responseRequestBodyObjectUrls' in window) {
                    window.responseRequestBodyObjectUrls.forEach(objectUrl => {
                        URL.revokeObjectURL(objectUrl)
                    })
                } else {
                    window.responseRequestBodyObjectUrls = []
                }
                const downloadUrl = URL.createObjectURL(this.response.request.body)
                window.responseRequestBodyObjectUrls.push(downloadUrl)
                return `<div><a href="${downloadUrl}" download="${this.response.request.body.name}">${this.response.request.body.name}</a></div>`
            } else {
                if(this.response.request.original.body.mimeType === 'multipart/form-data' && this.response.request.original.body.params && this.response.request.original.body.params.length > 0) {
                    // prevent memory leak
                    if('responseRequestBodyObjectUrls' in window) {
                        window.responseRequestBodyObjectUrls.forEach(objectUrl => {
                            URL.revokeObjectURL(objectUrl)
                        })
                    } else {
                        window.responseRequestBodyObjectUrls = []
                    }
                    let html = '<table style="border-collapse: collapse; width: 100%;"><tbody>'
                    const tdStyle = 'border: 1px solid var(--default-border-color); padding: 0.5rem;'
                    html += this.response.request.original.body.params.map(param => {
                        const handleFile = item => {
                            const downloadUrl = URL.createObjectURL(item)
                            window.responseRequestBodyObjectUrls.push(downloadUrl)
                            return `<div><a href="${downloadUrl}" download="${item.name}">${item.name}</div>`
                        }
                        return `
                            <tr>
                                <td style="${tdStyle}">${param.name}</td>
                                <td style="${tdStyle}">${param.type === 'text' ? param.value : param.files.map(handleFile)}</td>
                            </tr>
                        `
                    }).join('')
                    html += '</tbody></table>'
                    return html
                }
                return `<div>${this.response.request.body}</div>`
            }
        },
        responseContentType() {
            return getResponseContentType(this.response)
        },
        passedTestCases() {
            if(this.isTestResultsAvailable) {
                return this.response.testResults.filter(item => item.passed).length
            }

            return 0
        },
        allTestsPassed() {
            if(this.isTestResultsAvailable) {
                return this.response.testResults.length === this.passedTestCases
            }
            return false
        },
        isTestResultsAvailable() {
            return this.response && 'testResults' in this.response
        },
    },
    watch: {
        response() {
            if(this.responsePanelTabs.length === 2 && (this.activeResponsePanelTab === 'Request' || this.activeResponsePanelTab === 'Tests' || this.activeResponsePanelTab === 'Timeline')) {
                this.activeResponsePanelTab = 'Preview'
            }

            if(this.response && this.response.statusText === 'Error') {
                this.activeResponsePanelTab = 'Preview'
            }

            this.isXmlResponse = this.responseContentType.startsWith(constants.MIME_TYPE.XML) ? true : false

            if(this.$refs.scrollableArea) {
                this.$refs.scrollableArea.scrollTop = 0
            }

            if(!this.scrollableAreaEventListenerAttached) {
                nextTick(() => {
                    this.$refs.scrollableArea.addEventListener('scroll', this.scrollableAreaOnScroll)
                    this.scrollableAreaEventListenerAttached = true
                })
            }
        }
    },
    methods: {
        timeAgo,
        cancelRequest() {
            this.requestAbortController.abort()
        },
        dateFormat,
        humanFriendlyTime,
        humanFriendlySize,
        handleResponseHistoryContextMenu(event) {
            if(event.type === 'click') {
                this.responseHistoryContextMenuOptionsType = 'click'
            } else {
                this.responseHistoryContextMenuOptionsType = 'contextmenu'
            }

            const containerElement = event.target.closest('.custom-dropdown')
            this.responseHistoryContextMenuX = containerElement.getBoundingClientRect().left
            this.responseHistoryContextMenuY = containerElement.getBoundingClientRect().top + containerElement.getBoundingClientRect().height
            this.responseHistoryContextMenuWidth = containerElement.getBoundingClientRect().width
            this.responseHistoryContextMenuElement = containerElement
            this.showResponseHistoryContextMenu = true
        },
        async handleResponseHistoryContextMenuItemClick(clickedContextMenuitem) {
            if(clickedContextMenuitem === 'Rename Current Response') {
                const newResponseName = await window.createPrompt('Enter new response name', this.response.name)
                if(newResponseName === null) {
                    return
                }
                this.$store.commit('renameCurrentlyActiveResponse', newResponseName)
                return
            }

            if(clickedContextMenuitem === 'Delete Current Response') {
                this.$store.commit('deleteCurrentlyActiveResponse')
                return
            }

            if(clickedContextMenuitem === 'Clear History') {
                this.$store.commit('clearResponseHistory')
                return
            }

            this.response = clickedContextMenuitem
        },
        async copyResponseToClipboard() {
            if(!window.isSecureContext) {
                this.$toast.error('Copy to clipboard needs Restfox running under a https url')
                return
            }
            await navigator.clipboard.writeText(this.bufferToJSONString(this.response.buffer))
            this.$toast.success('Copied to clipboard')
        },
        async downloadResponse() {
            const blob = new Blob([this.response.buffer], { type: this.responseContentType })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = this.response.name ?? 'response'
            const contentDispositionHeader = this.response.headers.find(header => header[0].toLowerCase() === 'content-disposition')
            if(contentDispositionHeader && contentDispositionHeader[1]) {
                a.download = parseContentDispositionHeaderAndGetFileName(contentDispositionHeader[1], a.download)
            }
            a.click()
            URL.revokeObjectURL(url)
        },
        async restoreCurrentResponseRequest() {
            const container = getAlertConfirmPromptContainer(this.$el)
            if(!await container.createConfirm('Are you sure? Restoring a request will reset your existing request and make it the same as the saved response\'s request.')) {
                return
            }

            this.activeTab.url = this.response.request.original.url

            const originalRequestBody = this.response.request.original.body

            this.activeTab.body = structuredClone(toRaw(originalRequestBody))

            if(originalRequestBody.mimeType === 'multipart/form-data' && 'params' in originalRequestBody) {
                let params = []
                for(const param of originalRequestBody.params) {
                    let paramExtracted = {...param}
                    if('files' in paramExtracted) {
                        paramExtracted.files = [...paramExtracted.files]
                    }
                    params.push(paramExtracted)
                }
                this.activeTab.body.params = params
            }

            if(originalRequestBody.mimeType === 'application/octet-stream') {
                this.activeTab.body.fileName = this.response.request.body
            }

            if(this.response.request.original.parameters) {
                this.activeTab.parameters = JSON.parse(JSON.stringify(this.response.request.original.parameters))
            }

            if(this.response.request.original.pathParameters) {
                this.activeTab.pathParameters = JSON.parse(JSON.stringify(this.response.request.original.pathParameters))
            }

            if(this.response.request.original.headers) {
                this.activeTab.headers = JSON.parse(JSON.stringify(this.response.request.original.headers))
            }

            if(this.response.request.original.authentication) {
                this.activeTab.authentication = JSON.parse(JSON.stringify(this.response.request.original.authentication))
            }

            emitter.emit('response_panel', 'request restored')
        },
        codeMirrorSelectionChanged(selectedText) {
            this.currentlySelectedText = selectedText
        },
        async setSelectedTextAsEnvironmentVariable() {
            if(this.currentlySelectedText === '') {
                return
            }

            const environment = this.activeWorkspace.environment ?? {}
            const currentlyDefinedEnvironmentVariables = Object.keys(environment)

            const container = getAlertConfirmPromptContainer(this.$el)
            const environmentVariableName = await container.createPrompt('Select / Enter environment variable name', '', currentlyDefinedEnvironmentVariables)

            if(environmentVariableName === null || environmentVariableName === '') {
                return
            }

            setEnvironmentVariable(this.$store, environmentVariableName, this.currentlySelectedText)

            this.$toast.success(`Environment variable set: ${environmentVariableName}`)
        },
        showResFilteringHelpModal() {
            this.showResponseFilteringHelpModal = true
        },
        getStatusText,
        scrollableAreaOnScroll(event) {
            this.scrollableAreaScrollTop = event.target.scrollTop
        },
        responseStatusColorMapping,
        getHistoryResponses() {
            return this.responses.map(item => {
                const color = responseStatusColorMapping(item)

                const requestMethod = item.request ? `<span class="request-method--${item.request.method}"> ${item.request.method} </span> ` : ''

                const label = `
                    <div style="display: flex; flex-wrap: wrap; align-items: center;">
                        <div>${dateFormat(item.createdAt, true)}</div> <div class="tag ${color}" style="padding: 2px 3px; margin-left: 0.5rem;">${item.status} ${this.getStatusText(item.status)}</div> <div class="tag" style="padding: 2px 3px; margin-left: 0.5rem;">${this.humanFriendlyTime(item.timeTaken)}</div>
                    </div>
                    <div style="margin-top: 0.2rem;">
                        ${requestMethod}${item.name ?? item.url}
                    </div>
                `

                return {
                    type: 'option',
                    label,
                    value: item
                }
            })
        },
        bufferToJSONString,
        filterJSONResponse,
        filterXmlResponse,
    },
    activated() {
        if(this.response && this.scrollableAreaEventListenerAttached && this.scrollableAreaScrollTop !== null) {
            nextTick(() => {
                this.$refs.scrollableArea.scrollTop = this.scrollableAreaScrollTop
            })
        }
    },
    beforeUnmount() {
        this.$refs.scrollableArea?.removeEventListener('scroll', this.scrollableAreaOnScroll)
        this.scrollableAreaEventListenerAttached = false
    },
}
</script>

<style scoped>
.loading-overlay {
    background-color: var(--response-panel-loader-background-color);
    color: var(--response-panel-loader-color);
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
    background: var(--sidebar-item-active-color);
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
    overflow: auto;
}

.response-panel-address-bar  .response-panel-address-bar-select-container .custom-dropdown {
    padding-right: 0.7rem;
}

.response-panel-address-bar  .response-panel-address-bar-select-container .custom-dropdown:hover {
    background-color: var(--response-panel-history-select-hover-color);
}

.response-panel-tabs {
    display: flex;
    user-select: none;
    background-color: var(--sidebar-item-active-color);
}

.response-panel-tabs .response-panel-tab {
    padding: 10px 15px;
    border-bottom: 1px solid var(--default-border-color);
    border-left: 1px solid transparent;
    border-right: 1px solid transparent;
    white-space: nowrap;
    cursor: pointer;
}

.response-panel-tabs .response-panel-tab-active {
    border-bottom: 1px solid transparent;
    border-right: 1px solid var(--default-border-color);
    background: var(--background-color);
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
    display: grid;
    grid-template-rows: 1fr auto;
}

.response-panel-tabs-context .content-box {
    padding: 1rem;
    word-break: break-all;
}

.response-panel-tabs-context table {
    border-collapse: collapse;
    width: 100%;
}

.response-panel-tabs-context table th, .response-panel-tabs-context table td {
    border: 1px solid var(--default-border-color);
    padding: 0.5rem;
}
.row {
    display: flex;
    align-items: center;
    padding: 5px;
    background: var(--background-color);
}

.help-link {
    text-decoration: none;
    margin-left: 5px;
    padding: 6px 10px;
    background-color: var(--background-color);
    color: var(--text-color);
    border: 1px solid var(--default-border-color);
}
.sticky-section {
    position: sticky;
    bottom: 0;
    background-color: var(--background-color);
}
</style>
