<template>
    <template v-if="activeTab">
        <div class="request-panel-address-bar">
            <select v-model="activeTab.method">
                <option v-for="method in methods">{{ method }}</option>
            </select>
            <div class="code-mirror-input-container">
                <CodeMirrorSingleLine v-model="activeTab.url" placeholder="Enter request URL" :key="'address-bar-' + activeTab._id" @keydown="handleAddressBarKeyDown" />
            </div>
            <button @click="sendRequest">Send</button>
        </div>
        <div class="request-panel-tabs">
            <div class="request-panel-tab" :class="{ 'request-panel-tab-active': activeRequestPanelTab === requestPanelTab.name }" @click="activeRequestPanelTab = requestPanelTab.name" v-for="requestPanelTab in requestPanelTabs">
                <span>{{ requestPanelTab.name }}</span>
                <template v-if="requestPanelTab.name === 'Body'">
                    <template v-if="activeTab.body.mimeType === 'application/x-www-form-urlencoded'">
                        <template v-if="'params' in activeTab.body && activeTab.body.params.filter(item => item.disabled === undefined || item.disabled === false).length > 0">
                            <span> ({{ activeTab.body.params.filter(item => item.disabled === undefined || item.disabled === false).length }})</span>
                        </template>
                    </template>
                    <template v-if="activeTab.body.mimeType === 'text/plain'"> (Plain)</template>
                    <template v-if="activeTab.body.mimeType === 'application/json'"> (JSON)</template>
                    <template v-if="activeTab.body.mimeType === 'application/graphql'"> (GraphQL)</template>
                    <template v-if="activeTab.body.mimeType === 'application/octet-stream'"> (File)</template>
                </template>
                <template v-if="requestPanelTab.name === 'Query'">
                    <template v-if="'parameters' in activeTab && activeTab.parameters.filter(item => item.disabled === undefined || item.disabled === false).length > 0">
                        <span> ({{ activeTab.parameters.filter(item => item.disabled === undefined || item.disabled === false).length }})</span>
                    </template>
                </template>
                <template v-if="requestPanelTab.name === 'Header'">
                    <template v-if="'headers' in activeTab && activeTab.headers.filter(item => item.disabled === undefined || item.disabled === false).length > 0">
                        <span> ({{ activeTab.headers.filter(item => item.disabled === undefined || item.disabled === false).length }})</span>
                    </template>
                </template>
                <template v-if="requestPanelTab.name === 'Auth'">
                    <template v-if="'authentication' in activeTab && activeTab.authentication.type !== 'No Auth'">
                        <span> ({{ getAuthenticationTypeLabel(activeTab.authentication.type) }})</span>
                    </template>
                </template>
            </div>
            <div class="request-panel-tab-fill"></div>
        </div>
        <div class="request-panel-tabs-context">
            <div v-if="activeRequestPanelTab === 'Body'" class="request-panel-tabs-context-container">
                <select v-model="activeTab.body.mimeType" style="margin-bottom: 0.5rem" @change="bodyMimeTypeChanged($event.target.value)">
                    <option value="No Body">No Body</option>
                    <option value="application/x-www-form-urlencoded">Form URL Encoded</option>
                    <option value="text/plain">Plain Text</option>
                    <option value="application/json">JSON</option>
                    <option value="application/graphql">GraphQL</option>
                    <option value="application/octet-stream">Binary File</option>
                </select>
                <div v-if="activeTab.body.mimeType === 'application/x-www-form-urlencoded'">
                    <table>
                        <tr v-for="(param, index) in activeTab.body.params">
                            <td>
                                <input type="text" v-model="param.name" spellcheck="false" placeholder="name" :disabled="param.disabled">
                            </td>
                            <td>
                                <input type="text" v-model="param.value" spellcheck="false" placeholder="value" :disabled="param.disabled">
                            </td>
                            <td>
                                <input type="checkbox" :checked="param.disabled === undefined || param.disabled === false" @change="param.disabled = $event.target.checked ? false : true">
                            </td>
                            <td @click="activeTab.body.params.splice(index, 1)">
                                <i class="fa fa-trash"></i>
                            </td>
                        </tr>
                        <tr>
                            <td colspan="4" style="text-align: center; user-select: none" @click="pushItem(activeTab.body, 'params', { name: '', value: '' })">
                                + Add Item
                            </td>
                        </tr>
                    </table>
                </div>
                <div v-if="activeTab.body.mimeType === 'text/plain'">
                    <textarea v-model="activeTab.body.text" style="width: 100%; padding: 0.5rem;" spellcheck="false"></textarea>
                </div>
                <div v-if="activeTab.body.mimeType === 'application/json'" class="oy-a">
                    <CodeMirrorEditor v-model="activeTab.body.text" lang="json" class="code-editor" :key="'code-mirror-editor-' + activeTab._id + '-' + refreshCodeMirrorEditors" ref="jsonEditor"></CodeMirrorEditor>
                </div>
                <div class="request-panel-body-footer" v-if="activeTab.body.mimeType === 'application/json'">
                    <button @click="beautifyJSON">Beautify JSON</button>
                </div>
                <div style="display: grid; grid-template-rows: 1fr 130px auto; height: 100%; overflow: auto;" v-if="activeTab.body.mimeType === 'application/graphql'">
                    <div class="oy-a" style="min-height: 130px;">
                        <CodeMirrorEditor v-model="graphql.query" lang="graphql" class="code-editor" :key="'code-mirror-editor1-' + activeTab._id + '-' + refreshCodeMirrorEditors" ref="graphqlEditor"></CodeMirrorEditor>
                    </div>
                    <div style="margin-top: 0.5rem;display: grid; grid-template-rows: auto 1fr;">
                        <div style="margin-bottom: 0.3rem; user-select: none;">Query Variables</div>
                        <div class="oy-a">
                            <CodeMirrorEditor v-model="graphql.variables" lang="json" class="code-editor" :key="'code-mirror-editor2-' + activeTab._id + '-' + refreshCodeMirrorEditors" ref="jsonEditor"></CodeMirrorEditor>
                        </div>
                    </div>
                    <div class="request-panel-body-footer">
                        <button @click="beautifyGraphQL">Beautify</button>
                    </div>
                </div>
                <div v-if="activeTab.body.mimeType === 'application/octet-stream'">
                    <input type="file" @change="activeTab.body.fileName = $event.target.files[0]" style="width: 100%;  padding: 0.5rem; border: 1px solid var(--default-border-color);">
                </div>
            </div>
            <template v-if="activeRequestPanelTab === 'Query'">
                <table>
                    <tr v-for="(param, index) in activeTab.parameters">
                        <td>
                            <input type="text" v-model="param.name" spellcheck="false" placeholder="name" :disabled="param.disabled">
                        </td>
                        <td>
                            <input type="text" v-model="param.value" spellcheck="false" placeholder="value" :disabled="param.disabled">
                        </td>
                        <td>
                            <input type="checkbox" :checked="param.disabled === undefined || param.disabled === false" @change="param.disabled = $event.target.checked ? false : true">
                        </td>
                        <td @click="activeTab.parameters.splice(index, 1)">
                            <i class="fa fa-trash"></i>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="4" style="text-align: center; user-select: none" @click="pushItem(activeTab, 'parameters', { name: '', value: '' })">
                            + Add Item
                        </td>
                    </tr>
                </table>
            </template>
            <template v-if="activeRequestPanelTab === 'Header'">
                <table>
                    <tr v-for="(header, index) in activeTab.headers">
                        <td>
                            <input type="text" v-model="header.name" spellcheck="false" placeholder="name" :disabled="header.disabled">
                        </td>
                        <td>
                            <input type="text" v-model="header.value" spellcheck="false" placeholder="value" :disabled="header.disabled">
                        </td>
                        <td>
                            <input type="checkbox" :checked="header.disabled === undefined || header.disabled === false" @change="header.disabled = $event.target.checked ? false : true">
                        </td>
                        <td @click="activeTab.headers.splice(index, 1)">
                            <i class="fa fa-trash"></i>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="4" style="text-align: center; user-select: none" @click="pushItem(activeTab, 'headers', { name: '', value: '' })">
                            + Add Item
                        </td>
                    </tr>
                </table>
            </template>
            <template v-if="activeRequestPanelTab === 'Auth'">
                <select :value="activeTab.authentication?.type ?? 'No Auth'" @change="handleActiveTabAuthenticationTypeChange" style="margin-bottom: 0.5rem">
                    <option value="No Auth">No Auth</option>
                    <option value="basic">Basic Auth</option>
                    <option value="bearer">Bearer Token</option>
                </select>
                <div v-if="activeTab.authentication && activeTab.authentication.type !== 'No Auth'">
                    <table>
                        <tr>
                            <td style="min-width: 6rem; user-select: none;">
                                <label for="basic-auth-enabled">Enabled</label>
                            </td>
                            <td style="width: 100%">
                                <input type="checkbox" :checked="activeTab.authentication.disabled === undefined || activeTab.authentication.disabled === false" @change="activeTab.authentication.disabled = $event.target.checked ? false : true" id="basic-auth-enabled">
                            </td>
                        </tr>
                        <template v-if="activeTab.authentication.type === 'basic'">
                            <tr>
                                <td style="user-select: none;">
                                    <label for="basic-auth-username" :class="{ disabled: activeTab.authentication.disabled }">Username</label>
                                </td>
                                <td style="width: 100%">
                                    <input type="text" v-model="activeTab.authentication.username" id="basic-auth-username" :disabled="activeTab.authentication.disabled">
                                </td>
                            </tr>
                            <tr>
                                <td style="user-select: none;">
                                    <label for="basic-auth-password" :class="{ disabled: activeTab.authentication.disabled }">Password</label>
                                </td>
                                <td style="width: 100%">
                                    <input type="text" v-model="activeTab.authentication.password" id="basic-auth-password" :disabled="activeTab.authentication.disabled">
                                </td>
                            </tr>
                        </template>
                        <template v-if="activeTab.authentication.type === 'bearer'">
                            <tr>
                                <td style="user-select: none;">
                                    <label for="basic-auth-token" :class="{ disabled: activeTab.authentication.disabled }">Token</label>
                                </td>
                                <td style="width: 100%">
                                    <input type="text" v-model="activeTab.authentication.token" id="basic-auth-token" :disabled="activeTab.authentication.disabled">
                                </td>
                            </tr>
                            <tr>
                                <td style="user-select: none;">
                                    <label for="basic-auth-prefix" :class="{ disabled: activeTab.authentication.disabled }">Prefix</label>
                                </td>
                                <td style="width: 100%">
                                    <input type="text" v-model="activeTab.authentication.prefix" id="basic-auth-prefix" :disabled="activeTab.authentication.disabled">
                                </td>
                            </tr>
                        </template>
                    </table>
                </div>
            </template>
            <template v-if="activeRequestPanelTab === 'Description'">
                <div style="height: 100%">
                    <textarea v-model="activeTab.description" style="width: 100%; height: 100%; padding: 0.5rem;" spellcheck="false"></textarea>
                </div>
            </template>
        </div>
    </template>
</template>

<script>
import CodeMirrorSingleLine from './CodeMirrorSingleLine.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import { emitter } from '@/event-bus'

export default {
    components: {
        CodeMirrorSingleLine,
        CodeMirrorEditor
    },
    data() {
        return {
            requestPanelTabs: [
                {
                    name: 'Body'
                },
                {
                    name: 'Query'
                },
                {
                    name: 'Header'
                },
                {
                    name: 'Auth'
                },
                {
                    name: 'Description'
                }
            ],
            activeRequestPanelTab: 'Body',
            methods: [
                'GET',
                'POST',
                'PUT',
                'PATCH',
                'DELETE',
                'OPTIONS',
                'HEAD'
            ],
            graphql: {
                query: '',
                variables: '{}'
            },
            disableGraphqlWatch: false,
            refreshCodeMirrorEditors: 1
        }
    },
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        }
    },
    watch: {
        'activeTab.body.mimeType'() {
            this.loadGraphql()
        },
        graphql: {
            handler() {
                if(this.disableGraphqlWatch) {
                    this.disableGraphqlWatch = false
                    return
                }
                let graphqlVariables = {}
                try {
                    graphqlVariables = JSON.parse(this.graphql.variables)
                } catch {}
                this.activeTab.body.text = JSON.stringify({
                    query: this.graphql.query,
                    variables: graphqlVariables
                }, null, 4)
            },
            deep: true
        }
    },
    methods: {
        sendRequest() {
            this.$store.dispatch('sendRequest', this.activeTab)
        },
        pushItem(object, key, itemToPush) {
            if(key in object === false) {
                object[key] = []
            }

            object[key].push(itemToPush)
        },
        beautifyJSON() {
            try {
                this.$refs.jsonEditor.setValue(JSON.stringify(JSON.parse(this.activeTab.body.text), null, 4))
            } catch {} // catch all json parsing errors and ignore them
        },
        beautifyGraphQL() {
            try {
                this.$refs.jsonEditor.setValue(JSON.stringify(JSON.parse(this.graphql.variables), null, 4))
            } catch {} // catch all json parsing errors and ignore them
        },
        handleActiveTabAuthenticationTypeChange(event) {
            if('authentication' in this.activeTab === false) {
                this.activeTab.authentication = {}
            }

            this.activeTab.authentication.type = event.target.value
        },
        getAuthenticationTypeLabel(authenticationType) {
            switch(authenticationType) {
                case 'basic':
                    return 'Basic'
                case 'bearer':
                    return 'Bearer'
            }
        },
        bodyMimeTypeChanged(newMimeType) {
            let mimeType = null

            if(newMimeType === 'application/x-www-form-urlencoded') {
                mimeType = 'application/x-www-form-urlencoded'
            }

            if(newMimeType === 'text/plain') {
                mimeType = 'text/plain'
            }

            if(newMimeType === 'application/json' || newMimeType === 'application/graphql') {
                mimeType = 'application/json'
            }

            if(newMimeType === 'application/octet-stream') {
                mimeType = 'application/octet-stream'
            }

            if(mimeType === null) {
                return
            }

            let contentTypeHeader = 'headers' in this.activeTab && this.activeTab.headers.find(header => header.name.toLowerCase() === 'content-type')

            if(contentTypeHeader) {
                contentTypeHeader.value = mimeType
            } else {
                if('headers' in this.activeTab == false) {
                    this.activeTab.headers = []
                }

                this.activeTab.headers.push({
                    name: 'Content-Type',
                    value: mimeType
                })
            }
        },
        handleAddressBarKeyDown(e) {
            if(e.ctrlKey === false && e.key === 'Enter') {
                if(this.activeTab.url === '') {
                    return
                }
                this.sendRequest()
            }
        },
        loadGraphql() {
            if(this.activeTab && this.activeTab.body.mimeType === 'application/graphql') {
                this.disableGraphqlWatch = true
                try {
                    const parsedBodyText = JSON.parse(this.activeTab.body.text)
                    this.graphql = {
                        query: parsedBodyText.query ?? '',
                        variables: JSON.stringify(parsedBodyText.variables ?? '{}', null, 4)
                    }
                } catch {
                    this.graphql = {
                        query: '',
                        variables: '{}'
                    }
                }
            }
        },
        handleResponsePanelEmitter(event) {
            if(event === 'request restored') {
                this.loadGraphql()
                this.refreshCodeMirrorEditors++
            }
        }
    },
    mounted() {
        emitter.on('response_panel', this.handleResponsePanelEmitter)
    },
    beforeUnmount() {
        emitter.off('response_panel', this.handleResponsePanelEmitter)
    }
}
</script>

<style scoped>
.request-panel-address-bar {
    display: flex;
    border-bottom: 1px solid var(--default-border-color);
    height: 2rem;
    align-items: center;
    min-width: 0;
}

.request-panel-address-bar > select {
    text-align: center;
}

.request-panel-address-bar > .code-mirror-input-container {
    flex: 1;
    min-width: 0;
}

.request-panel-address-bar > select, .request-panel-address-bar > button {
    border: 0;
}

.request-panel-address-bar select {
    padding: 5px;
    outline: 0;
    background: inherit;
}

.request-panel-address-bar button {
    background-color: #7f4fd5;
    color: white;
    padding-left: 1.5rem;
    padding-right: 1.5rem;
    height: 100%;
}

.request-panel-address-bar button:hover {
    background-color: #673ab7;
}

.request-panel-tabs {
    display: flex;
    user-select: none;
}

.request-panel-tabs .request-panel-tab {
    padding: 10px 15px;
    border-bottom: 1px solid var(--default-border-color);
    border-left: 1px solid transparent;
    border-right: 1px solid transparent;
    white-space: nowrap;
}

.request-panel-tabs .request-panel-tab-active {
    border-bottom: 1px solid transparent;
    border-right: 1px solid var(--default-border-color);
}

.request-panel-tabs .request-panel-tab-active:not(:first-child) {
    border-left: 1px solid var(--default-border-color);
}

.request-panel-tabs .request-panel-tab-fill {
    width: 100%;
    border-bottom: 1px solid var(--default-border-color);
}

.request-panel-tabs-context {
    padding: 1rem;
    overflow-y: auto;
}

.request-panel-tabs-context select {
    border: 1px solid var(--default-border-color);
    outline: 0;
    padding: 0.3rem;
    background: inherit;
}

.request-panel-tabs-context table {
    border-collapse: collapse;
    width: 100%;
}

.request-panel-tabs-context table th, .request-panel-tabs-context table td {
    border: 1px solid var(--default-border-color);
    padding: 0.5rem;
}

.request-panel-tabs-context table td:nth-last-child(-n+2) {
    width: 1px;
}

.request-panel-tabs-context table input {
    border: 0;
    outline: 0;
    width: 100%;
}

.request-panel-tabs-context table input[type="checkbox"] {
    width: auto;
    vertical-align: middle;
}

.request-panel-tabs-context table input:disabled {
    opacity: 0.5;
}

.request-panel-tabs-context table .disabled {
    opacity: 0.5;
}

.request-panel-tabs-context textarea {
    border: 1px solid var(--default-border-color);
    outline: 0;
    resize: none;
}

.request-panel-tabs-context-container {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
}

.request-panel-tabs-context-container > div > textarea {
    height: 100%;
}

.oy-a {
    overflow-y: auto;
}

.code-editor {
    border: 1px solid var(--default-border-color);
    height: 100%;
    overflow-y: auto;
}

.request-panel-body-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    margin-top: 0.5rem;
}
</style>
