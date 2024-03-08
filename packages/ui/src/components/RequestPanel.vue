<template>
    <template v-if="activeTab && activeTab._type === 'request'">
        <div class="request-panel-address-bar">
            <select v-model="activeTab.method">
                <option v-for="method in methods">{{ method }}</option>
            </select>
            <div class="code-mirror-input-container">
                <CodeMirrorSingleLine v-model="activeTab.url" placeholder="Enter request URL" :key="'address-bar-' + activeTab._id" @keydown="handleAddressBarKeyDown" @paste="handleAdressBarPaste" :env-variables="activeTabEnvironmentResolved" />
            </div>
            <button @click="sendRequest">Send</button>
        </div>
        <div class="request-panel-tabs" v-show="tabView === 'full'">
            <div class="request-panel-tab" :class="{ 'request-panel-tab-active': activeRequestPanelTab === requestPanelTab.name }" @click="activeRequestPanelTab = requestPanelTab.name" v-for="requestPanelTab in requestPanelTabs">
                <RequestPanelTabTitle :request-panel-tab="requestPanelTab" :active-tab="activeTab"></RequestPanelTabTitle>
            </div>
            <div class="request-panel-tab-fill"></div>
        </div>
        <div class="request-panel-tabs" v-show="tabView === 'portable'">
            <div class="request-panel-tab" style="width: 100%; border-color: transparent; padding-bottom: 0;">
                <select v-model="activeRequestPanelTab" style="border: 1px solid var(--default-border-color); outline: 0px; padding: 0.3rem;">
                    <option v-for="requestPanelTab in requestPanelTabs" :value="requestPanelTab.name">
                        <RequestPanelTabTitle :request-panel-tab="requestPanelTab" :active-tab="activeTab"></RequestPanelTabTitle>
                    </option>
                </select>
            </div>
        </div>
        <div class="request-panel-tabs-context">
            <div v-if="activeRequestPanelTab === 'Body'" class="request-panel-tabs-context-container">
                <select v-model="activeTab.body.mimeType" style="margin-bottom: 0.5rem" @change="bodyMimeTypeChanged($event.target.value)">
                    <option value="No Body">No Body</option>
                    <option value="application/x-www-form-urlencoded">Form URL Encoded</option>
                    <option value="multipart/form-data">Multipart Form</option>
                    <option value="text/plain">Plain Text</option>
                    <option value="application/json">JSON</option>
                    <option value="application/graphql">GraphQL</option>
                    <option value="application/octet-stream">Binary File</option>
                </select>
                <div v-if="activeTab.body.mimeType === 'application/x-www-form-urlencoded'">
                    <table style="table-layout: fixed;">
                        <tr v-for="(param, index) in activeTab.body.params">
                            <td>
                                <CodeMirrorSingleLine
                                    v-model="param.name"
                                    placeholder="name"
                                    :env-variables="activeTabEnvironmentResolved"
                                    :input-text-compatible="true"
                                    :disabled="param.disabled"
                                    :key="'body-param-name-' + index"
                                />
                            </td>
                            <td>
                                <CodeMirrorSingleLine
                                    v-model="param.value"
                                    placeholder="value"
                                    :env-variables="activeTabEnvironmentResolved"
                                    :input-text-compatible="true"
                                    :disabled="param.disabled"
                                    :key="'body-param-value-' + index"
                                />
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
                <div v-if="activeTab.body.mimeType === 'multipart/form-data'">
                    <table style="table-layout: fixed;">
                        <tr v-for="(param, index) in activeTab.body.params">
                            <td>
                                <CodeMirrorSingleLine
                                    v-model="param.name"
                                    placeholder="name"
                                    :env-variables="activeTabEnvironmentResolved"
                                    :input-text-compatible="true"
                                    :disabled="param.disabled"
                                    :key="'body-param-name-' + index"
                                />
                            </td>
                            <td>
                                <div style="display: flex">
                                    <template v-if="param.type === 'text'">
                                        <CodeMirrorSingleLine
                                            v-model="param.value"
                                            placeholder="value"
                                            :env-variables="activeTabEnvironmentResolved"
                                            :input-text-compatible="true"
                                            :disabled="param.disabled"
                                            :key="'body-param-value-' + index"
                                            style="flex: 1; overflow: auto;"
                                        />
                                    </template>
                                    <template v-else>
                                        <label style="width: 100%; display: flex; align-items: center;">
                                            <div :style="{ filter: !param.disabled ? undefined : 'opacity(0.4)' }">
                                                <span style="border: 1px solid lightgrey; padding: 3px;">Choose Files</span>
                                                <span style="margin-left: 0.5rem">
                                                    <template v-if="param.files && param.files.length > 0">{{ param.files.length === 1 ? param.files[0].name : `${param.files.length} files selected` }}</template>
                                                    <template v-else>No File Selected</template>
                                                </span>
                                            </div>
                                            <input type="file" @change="setFilesForParam($event.target.files, param)" multiple :disabled="param.disabled" style="display: none;">
                                        </label>
                                    </template>
                                    <select v-model="param.type" style="padding: 0;" :disabled="param.disabled">
                                        <option value="text">Text</option>
                                        <option value="file">File</option>
                                    </select>
                                </div>
                            </td>
                            <td>
                                <input type="checkbox" :checked="param.disabled === undefined || param.disabled === false" @change="param.disabled = $event.target.checked ? false : true">
                            </td>
                            <td @click="activeTab.body.params.splice(index, 1)">
                                <i class="fa fa-trash"></i>
                            </td>
                        </tr>
                        <tr>
                            <td colspan="4" style="text-align: center; user-select: none" @click="pushItem(activeTab.body, 'params', { name: '', value: '', type: 'text' })">
                                + Add Item
                            </td>
                        </tr>
                    </table>
                </div>
                <div v-if="activeTab.body.mimeType === 'text/plain'" class="oy-a">
                    <CodeMirrorEditor
                        v-model="activeTab.body.text"
                        lang="text"
                        :env-variables="activeTabEnvironmentResolved"
                        class="code-editor"
                        :key="'code-mirror-editor-' + activeTab._id + '-' + refreshCodeMirrorEditors"
                    ></CodeMirrorEditor>
                </div>
                <div v-if="activeTab.body.mimeType === 'application/json'" class="oy-a">
                    <CodeMirrorEditor
                        v-model="activeTab.body.text"
                        lang="json"
                        :env-variables="activeTabEnvironmentResolved"
                        class="code-editor"
                        :key="'code-mirror-editor-' + activeTab._id + '-' + refreshCodeMirrorEditors"
                        ref="jsonEditor"
                    ></CodeMirrorEditor>
                </div>
                <div class="request-panel-body-footer" v-if="activeTab.body.mimeType === 'application/json'">
                    <button class="button" @click="beautifyJSON">Beautify JSON</button>
                </div>
                <div style="display: grid; grid-template-rows: 1fr 130px auto; height: 100%; overflow: auto;" v-if="activeTab.body.mimeType === 'application/graphql'">
                    <div class="oy-a" style="min-height: 130px;">
                        <CodeMirrorEditor
                            v-model="graphql.query"
                            lang="graphql"
                            :env-variables="activeTabEnvironmentResolved"
                            class="code-editor"
                            :key="'code-mirror-editor1-' + activeTab._id + '-' + refreshCodeMirrorEditors"
                            ref="graphqlEditor"
                        ></CodeMirrorEditor>
                    </div>
                    <div style="margin-top: 0.5rem;display: grid; grid-template-rows: auto 1fr;">
                        <div style="margin-bottom: 0.3rem; user-select: none;">Query Variables</div>
                        <div class="oy-a">
                            <CodeMirrorEditor
                                v-model="graphql.variables"
                                lang="json"
                                :env-variables="activeTabEnvironmentResolved"
                                class="code-editor"
                                :key="'code-mirror-editor2-' + activeTab._id + '-' + refreshCodeMirrorEditors"
                                ref="jsonEditor"
                            ></CodeMirrorEditor>
                        </div>
                    </div>
                    <div class="request-panel-body-footer">
                        <button class="button" @click="beautifyGraphQL">Beautify</button>
                    </div>
                </div>
                <div v-if="activeTab.body.mimeType === 'application/octet-stream'">
                    <label style="width: 100%; display: flex; align-items: center; border: 1px solid var(--default-border-color);  padding: 0.5rem;">
                        <div style="display: flex; align-items: center;">
                            <span style="border: 1px solid lightgrey; padding: 3px; white-space: nowrap;">Choose File</span>
                            <span style="margin-left: 0.5rem">
                                <template v-if="activeTab.body.fileName">{{ activeTab.body.fileName.name }}</template>
                                <template v-else>No File Selected</template>
                            </span>
                        </div>
                        <input type="file" @change="activeTab.body.fileName = $event.target.files[0]" style="display: none;">
                    </label>
                </div>
            </div>
            <template v-if="activeRequestPanelTab === 'Query'">
                <table style="table-layout: fixed;">
                    <tr v-for="(param, index) in activeTab.parameters">
                        <td>
                            <CodeMirrorSingleLine
                                v-model="param.name"
                                placeholder="name"
                                :env-variables="activeTabEnvironmentResolved"
                                :input-text-compatible="true"
                                :disabled="param.disabled"
                                :key="'query-param-name-' + index"
                            />
                        </td>
                        <td>
                            <CodeMirrorSingleLine
                                v-model="param.value"
                                placeholder="value"
                                :env-variables="activeTabEnvironmentResolved"
                                :input-text-compatible="true"
                                :disabled="param.disabled"
                                :key="'query-param-value-' + index"
                            />
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
                <div style="margin-top: 1rem; margin-bottom: 0.5rem;">
                    Path Parameters
                    <template v-if="'pathParameters' in activeTab && activeTab.pathParameters.filter(item => item.disabled === undefined || item.disabled === false).length > 0">
                        <span> ({{ activeTab.pathParameters.filter(item => item.disabled === undefined || item.disabled === false).length }})</span>
                    </template>
                </div>
                <table style="table-layout: fixed;">
                    <tr v-for="(param, index) in activeTab.pathParameters">
                        <td>
                            <CodeMirrorSingleLine
                                v-model="param.name"
                                placeholder="name"
                                :env-variables="activeTabEnvironmentResolved"
                                :input-text-compatible="true"
                                :disabled="param.disabled"
                                :key="'path-param-name-' + index"
                            />
                        </td>
                        <td>
                            <CodeMirrorSingleLine
                                v-model="param.value"
                                placeholder="value"
                                :env-variables="activeTabEnvironmentResolved"
                                :input-text-compatible="true"
                                :disabled="param.disabled"
                                :key="'path-param-value-' + index"
                            />
                        </td>
                        <td>
                            <input type="checkbox" :checked="param.disabled === undefined || param.disabled === false" @change="param.disabled = $event.target.checked ? false : true">
                        </td>
                        <td @click="activeTab.pathParameters.splice(index, 1)">
                            <i class="fa fa-trash"></i>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="4" style="text-align: center; user-select: none" @click="pushItem(activeTab, 'pathParameters', { name: '', value: '' })">
                            + Add Item
                        </td>
                    </tr>
                </table>
            </template>
            <template v-if="activeRequestPanelTab === 'Header'">
                <table style="table-layout: fixed;">
                    <tr v-for="(header, index) in activeTab.headers">
                        <td>
                            <CodeMirrorSingleLine
                                v-model="header.name"
                                placeholder="name"
                                :env-variables="activeTabEnvironmentResolved"
                                :input-text-compatible="true"
                                :disabled="header.disabled"
                                :key="'header-name-' + index"
                            />
                        </td>
                        <td>
                            <CodeMirrorSingleLine
                                v-model="header.value"
                                placeholder="value"
                                :env-variables="activeTabEnvironmentResolved"
                                :input-text-compatible="true"
                                :disabled="header.disabled"
                                :key="'header-value-' + index"
                            />
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
                    <table class="auth" style="table-layout: fixed;">
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
                                    <CodeMirrorSingleLine
                                        v-model="activeTab.authentication.username"
                                        :env-variables="activeTabEnvironmentResolved"
                                        :input-text-compatible="true"
                                        :disabled="activeTab.authentication.disabled"
                                        :key="'basic-auth-username'"
                                    />
                                </td>
                            </tr>
                            <tr>
                                <td style="user-select: none;">
                                    <label for="basic-auth-password" :class="{ disabled: activeTab.authentication.disabled }">Password</label>
                                </td>
                                <td style="width: 100%">
                                    <CodeMirrorSingleLine
                                        v-model="activeTab.authentication.password"
                                        :env-variables="activeTabEnvironmentResolved"
                                        :input-text-compatible="true"
                                        :disabled="activeTab.authentication.disabled"
                                        :key="'basic-auth-password'"
                                    />
                                </td>
                            </tr>
                        </template>
                        <template v-if="activeTab.authentication.type === 'bearer'">
                            <tr>
                                <td style="user-select: none;">
                                    <label for="bearer-auth-token" :class="{ disabled: activeTab.authentication.disabled }">Token</label>
                                </td>
                                <td style="width: 100%">
                                    <CodeMirrorSingleLine
                                        v-model="activeTab.authentication.token"
                                        :env-variables="activeTabEnvironmentResolved"
                                        :input-text-compatible="true"
                                        :disabled="activeTab.authentication.disabled"
                                        :key="'bearer-auth-token'"
                                    />
                                </td>
                            </tr>
                            <tr>
                                <td style="user-select: none;">
                                    <label for="basic-auth-prefix" :class="{ disabled: activeTab.authentication.disabled }">Prefix</label>
                                </td>
                                <td style="width: 100%">
                                    <CodeMirrorSingleLine
                                        v-model="activeTab.authentication.prefix"
                                        :env-variables="activeTabEnvironmentResolved"
                                        :input-text-compatible="true"
                                        :disabled="activeTab.authentication.disabled"
                                        :key="'bearer-auth-prefix'"
                                    />
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
import RequestPanelTabTitle from '@/components/RequestPanelTabTitle.vue'
import { emitter } from '@/event-bus'
import { jsonPrettify } from '../utils/prettify-json'
import { convertCurlCommandToRestfoxCollection } from '@/helpers'

export default {
    components: {
        CodeMirrorSingleLine,
        CodeMirrorEditor,
        RequestPanelTabTitle
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
            refreshCodeMirrorEditors: 1,
            rootElementResizeObserver: null,
            tabView: 'full'
        }
    },
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        },
        activeTabEnvironmentResolved() {
            return this.$store.state.activeTabEnvironmentResolved
        },
    },
    watch: {
        activeTab() {
            this.attachRootElementResizeObserver()
        },
        'activeTab._id'() {
            this.loadGraphql()
        },
        'activeTab.body.mimeType'() {
            if(this.activeTab && this.activeTab.body && this.activeTab.body.mimeType === 'multipart/form-data') {
                if('params' in this.activeTab.body) {
                    // set type to text by default if type does not exist int he params array
                    this.activeTab.body.params.forEach(param => {
                        if('type' in param === false) {
                            param.type = 'text'
                        }
                    })
                }
                return
            }
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
                const formattedJSON = jsonPrettify(this.activeTab.body.text, '    ')
                this.$refs.jsonEditor.setValue(formattedJSON)
            } catch {} // catch all json parsing errors and ignore them
        },
        beautifyGraphQL() {
            try {
                const formattedJSON = jsonPrettify(this.graphql.variables, '    ')
                this.$refs.jsonEditor.setValue(formattedJSON)
            } catch {} // catch all json parsing errors and ignore them
        },
        handleActiveTabAuthenticationTypeChange(event) {
            if('authentication' in this.activeTab === false) {
                this.activeTab.authentication = {}
            }

            this.activeTab.authentication.type = event.target.value
        },
        bodyMimeTypeChanged(newMimeType) {
            let mimeType = null

            if(newMimeType === 'application/x-www-form-urlencoded') {
                mimeType = 'application/x-www-form-urlencoded'
            }

            if(newMimeType === 'multipart/form-data') {
                mimeType = 'multipart/form-data'
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
        async handleAdressBarPaste(e) {
            e.preventDefault()
            e.stopPropagation()
            const content = e.clipboardData.getData('text/plain').trim()
            if (content.startsWith('curl')) {
                if(!await window.createConfirm(`We've detected that you've pasted a curl command. Do you want to import the curl command into the current request?`)) {
                    return
                }
                const result = await convertCurlCommandToRestfoxCollection(content, this.activeWorkspace._id)
                if(result.length) {
                    delete result[0].name
                    delete result[0]._id
                    delete result[0]._type
                    delete result[0].workspaceId
                    delete result[0].parentId
                    Object.assign(this.activeTab, result[0])
                }
            }
        },
        loadGraphql() {
            if(this.activeTab && this.activeTab.body && this.activeTab.body.mimeType === 'application/graphql') {
                this.disableGraphqlWatch = true
                try {
                    const parsedBodyText = JSON.parse(this.activeTab.body.text)
                    this.graphql = {
                        query: parsedBodyText.query ?? '',
                        variables: JSON.stringify(typeof parsedBodyText.variables === 'object' ? parsedBodyText.variables : {}, null, 4)
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
        },
        setFilesForParam(files, param) {
            param.files = Array.from(files)
        },
        onRootElementResize() {
            const scrollWidth = 'requestPanelTabViewSwitchedScrollWidth' in window ? window.requestPanelTabViewSwitchedScrollWidth : this.$el.parentElement.scrollWidth
            if(this.$el.parentElement.clientWidth < scrollWidth) {
                this.tabView = 'portable'
                if('requestPanelTabViewSwitchedScrollWidth' in window === false) {
                    window.requestPanelTabViewSwitchedScrollWidth = this.$el.parentElement.scrollWidth
                }
            } else {
                delete window.requestPanelTabViewSwitchedScrollWidth
                this.tabView = 'full'
            }
        },
        attachRootElementResizeObserver() {
            if(this.activeTab) {
                this.$nextTick(() => {
                    this.rootElementResizeObserver = new ResizeObserver(this.onRootElementResize)
                    this.rootElementResizeObserver.observe(this.$el.parentElement)
                })
            } else {
                if(this.rootElementResizeObserver) {
                    this.rootElementResizeObserver.disconnect()
                    this.rootElementResizeObserver = null
                }
            }
        }
    },
    mounted() {
        emitter.on('response_panel', this.handleResponsePanelEmitter)

        this.attachRootElementResizeObserver()
    },
    beforeUnmount() {
        emitter.off('response_panel', this.handleResponsePanelEmitter)
        if(this.rootElementResizeObserver) {
            this.rootElementResizeObserver.disconnect()
        }
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

.request-panel-tabs-context table:not(.auth) td:nth-last-child(-n+2) {
    width: 29px;
}

.request-panel-tabs-context table.auth td:nth-last-child(-n+2) {
    width: 96px;
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
