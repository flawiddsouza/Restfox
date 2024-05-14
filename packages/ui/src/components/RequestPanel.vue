<template>
    <template v-if="activeTab && activeTab._type === 'request'">
        <div class="request-panel-address-bar">
            <div class="custom-dropdown" @click="toggleDropdown" ref="dropdown">
                <div class="row">
                    <div :class="'selected-option request-method--' + activeTab.method">{{ activeTab.method }}</div>
                    <i class="fa fa-caret-down space-right"></i>
                </div>
                <ul v-show="dropdownVisible">
                    <li v-for="method in methods" :key="method" @click="selectMethod(method)" :class="'request-method--' + method">{{ method }}</li>
                </ul>
            </div>
            <div class="code-mirror-input-container">
                <CodeMirrorSingleLine
                    v-model="activeTab.url"
                    placeholder="Enter request URL"
                    :key="'address-bar-' + activeTab._id"
                    @keydown="handleAddressBarKeyDown"
                    @update:modelValue="handleUrlChange"
                    :paste-handler="handleAddressBarPaste"
                    :env-variables="collectionItemEnvironmentResolved"
                    data-testid="request-panel-address-bar"
                />
            </div>
            <button @click="sendRequest">Send</button>
        </div>
        <div class="request-panel-tabs" v-show="tabView === 'full'">
            <div class="request-panel-tab" :class="{ 'request-panel-tab-active': activeRequestPanelTab === requestPanelTab.name }" @click="activeRequestPanelTab = requestPanelTab.name" v-for="requestPanelTab in requestPanelTabs" :data-testid="`request-panel-tab-${requestPanelTab.name}`">
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
                    <table style="table-layout: fixed">
                        <tr v-for="(param, index) in activeTab.body.params">
                            <td>
                                <CodeMirrorSingleLine
                                    v-model="param.name"
                                    placeholder="name"
                                    :env-variables="collectionItemEnvironmentResolved"
                                    :input-text-compatible="true"
                                    :disabled="param.disabled"
                                    :key="'body-param-name-' + index"
                                />
                            </td>
                            <td>
                                <CodeMirrorSingleLine
                                    v-model="param.value"
                                    placeholder="value"
                                    :env-variables="collectionItemEnvironmentResolved"
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
                    <table style="table-layout: fixed">
                        <tr v-for="(param, index) in activeTab.body.params">
                            <td>
                                <CodeMirrorSingleLine
                                    v-model="param.name"
                                    placeholder="name"
                                    :env-variables="collectionItemEnvironmentResolved"
                                    :input-text-compatible="true"
                                    :disabled="param.disabled"
                                    :key="'body-param-name-' + index"
                                />
                            </td>
                            <td>
                                <div style="display: flex; align-items: center;">
                                    <template v-if="param.type === 'text'">
                                        <CodeMirrorSingleLine
                                            v-model="param.value"
                                            placeholder="value"
                                            :env-variables="collectionItemEnvironmentResolved"
                                            :input-text-compatible="true"
                                            :disabled="param.disabled"
                                            :key="'body-param-value-' + index"
                                            style="flex: 1; overflow: auto;"
                                        />
                                    </template>
                                    <template v-else>
                                        <label style="width: 100%; display: flex; align-items: center;">
                                            <div :style="{ filter: !param.disabled ? undefined : 'opacity(0.4)' }" style="display: flex; align-items: center; width: 100%;">
                                                <span style="border: 1px solid lightgrey; padding: 3px; white-space: nowrap;">Choose Files</span>
                                                <span style="margin-left: 0.5rem">
                                                    <template v-if="param.files && param.files.length > 0">{{ param.files.length === 1 ? param.files[0].name : `${param.files.length} files selected` }}</template>
                                                    <template v-else>No File Selected</template>
                                                </span>
                                                <span style="border: 1px solid lightgrey; padding: 1px 5px; white-space: nowrap; margin-left: auto;" @click.prevent="setFilesForParam([], param)" v-show="param.files && param.files.length > 0">x</span>
                                            </div>
                                            <input type="file" @change="setFilesForParam($event.target.files, param)" multiple :disabled="param.disabled" style="display: none;">
                                        </label>
                                    </template>
                                    <select v-model="param.type" style="padding: 1px 0px; margin-left: 0.5rem;" :disabled="param.disabled">
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
                        :env-variables="collectionItemEnvironmentResolved"
                        class="code-editor"
                        :key="'code-mirror-editor-' + activeTab._id + '-' + refreshCodeMirrorEditors"
                    ></CodeMirrorEditor>
                </div>
                <div v-if="activeTab.body.mimeType === 'application/json'" class="oy-a">
                    <CodeMirrorEditor
                        v-model="activeTab.body.text"
                        lang="json"
                        :env-variables="collectionItemEnvironmentResolved"
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
                            :env-variables="collectionItemEnvironmentResolved"
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
                                :env-variables="collectionItemEnvironmentResolved"
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
                        <div style="display: flex; align-items: center; width: 100%;">
                            <span style="border: 1px solid lightgrey; padding: 3px; white-space: nowrap;">Choose File</span>
                            <span style="margin-left: 0.5rem">
                                <template v-if="activeTab.body.fileName">{{ activeTab.body.fileName.name }}</template>
                                <template v-else>No File Selected</template>
                            </span>
                            <span style="border: 1px solid lightgrey; padding: 1px 5px; white-space: nowrap; margin-left: auto;" @click.prevent="activeTab.body.fileName = null" v-show="activeTab.body.fileName">x</span>
                        </div>
                        <input type="file" @change="activeTab.body.fileName = $event.target.files[0]" style="display: none;">
                    </label>
                </div>
            </div>
            <template v-if="activeRequestPanelTab === 'Query'">
                <table style="table-layout: fixed">
                    <tr v-for="(param, index) in activeTab.parameters">
                        <td>
                            <CodeMirrorSingleLine
                                v-model="param.name"
                                placeholder="name"
                                :env-variables="collectionItemEnvironmentResolved"
                                :input-text-compatible="true"
                                :disabled="param.disabled"
                                :key="'query-param-name-' + index"
                                @update:modelValue="handleQueryParametersChange()"
                            />
                        </td>
                        <td>
                            <CodeMirrorSingleLine
                                v-model="param.value"
                                placeholder="value"
                                :env-variables="collectionItemEnvironmentResolved"
                                :input-text-compatible="true"
                                :disabled="param.disabled"
                                :key="'query-param-value-' + index"
                                @update:modelValue="handleQueryParametersChange()"
                            />
                        </td>
                        <td>
                            <input type="checkbox" :checked="param.disabled === undefined || param.disabled === false" @change="param.disabled = $event.target.checked ? false : true; handleQueryParametersChange();">
                        </td>
                        <td @click="activeTab.parameters.splice(index, 1); handleQueryParametersChange();">
                            <i class="fa fa-trash"></i>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="4" style="text-align: center; user-select: none" @click="pushItem(activeTab, 'parameters', { name: '', value: '' }); handleQueryParametersChange();">
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
                <table style="table-layout: fixed">
                    <tr v-for="(param, index) in activeTab.pathParameters">
                        <td>
                            <CodeMirrorSingleLine
                                v-model="param.name"
                                placeholder="name"
                                :env-variables="collectionItemEnvironmentResolved"
                                :input-text-compatible="true"
                                :disabled="param.disabled"
                                :key="'path-param-name-' + index"
                            />
                        </td>
                        <td>
                            <CodeMirrorSingleLine
                                v-model="param.value"
                                placeholder="value"
                                :env-variables="collectionItemEnvironmentResolved"
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
                <div style="margin-top: 1rem; margin-bottom: 0.5rem;">
                    URL Preview
                </div>
                <div style="border: 1px solid var(--default-border-color); border-radius: var(--default-border-radius); padding: 0.5rem; overflow-wrap: break-word;">
                    {{ urlPreview }}
                </div>
            </template>
            <template v-if="activeRequestPanelTab === 'Header'">
                <RequestPanelHeaders :collection-item="activeTab" :collection-item-environment-resolved="collectionItemEnvironmentResolved"></RequestPanelHeaders>
            </template>
            <template v-if="activeRequestPanelTab === 'Auth'">
                <RequestPanelAuth :collection-item="activeTab" :collection-item-environment-resolved="collectionItemEnvironmentResolved"></RequestPanelAuth>
            </template>
            <template v-if="activeRequestPanelTab === 'Script'">
                <div style="height: 100%; display: grid; grid-template-rows: auto 1fr auto 1fr;">
                    <div style="margin-bottom: var(--label-margin-bottom); display: flex; justify-content: space-between; align-items: flex-end;">
                        <div>Pre Request</div>
                        <div>
                            <ReferencesButton />
                        </div>
                    </div>
                    <CodeMirrorEditor
                        v-model="script.pre_request"
                        lang="javascript"
                        class="code-editor"
                        :autocompletions="preRequestAutocompletions"
                        :key="`pre-request-script-editor-${activeTab._id}`"
                    ></CodeMirrorEditor>

                    <div style="margin-top: 1rem; margin-bottom: var(--label-margin-bottom);">Post Request</div>
                    <CodeMirrorEditor
                        v-model="script.post_request"
                        lang="javascript"
                        class="code-editor"
                        :autocompletions="postRequestAutocompletions"
                        :key="`post-request-script-editor-${activeTab._id}`"
                    ></CodeMirrorEditor>
                </div>
            </template>
            <div style="height: 100%; display: grid; grid-template-rows: auto 1fr; overflow: auto;" v-if="activeRequestPanelTab === 'Docs'">
                <template v-if="editDescription">
                    <div>
                        <button class="button" @click="editDescription = false" style="margin-bottom: 1rem">Preview</button>
                    </div>
                    <textarea v-model="activeTab.description" style="width: 100%; height: 100%; padding: 0.5rem;" spellcheck="false"></textarea>
                </template>
                <template v-else>
                    <div>
                        <button class="button" @click="editDescription = true" style="margin-bottom: 1rem">Edit</button>
                    </div>
                    <div v-html="renderMarkdown(activeTab.description ?? '')" style="overflow: auto;"></div>
                </template>
            </div>
        </div>
    </template>
</template>

<script>
import CodeMirrorSingleLine from './CodeMirrorSingleLine.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import RequestPanelTabTitle from '@/components/RequestPanelTabTitle.vue'
import RequestPanelHeaders from '@/components/RequestPanelHeaders.vue'
import RequestPanelAuth from '@/components/RequestPanelAuth.vue'
import ReferencesButton from '@/components/ReferencesButton.vue'
import { emitter } from '@/event-bus'
import { jsonPrettify } from '../utils/prettify-json'
import { convertCurlCommandToRestfoxCollection, debounce, substituteEnvironmentVariables } from '@/helpers'
import * as queryParamsSync from '@/utils/query-params-sync'
import constants from '@/constants'
import { marked } from 'marked'

const renderer = new marked.Renderer()

renderer.link = (...args) => {
    const link = marked.Renderer.prototype.link.apply(this, args)
    return link.replace('<a', `<a target="_blank" rel="noopener noreferrer"`)
}

marked.setOptions({
    renderer: renderer
})

export default {
    components: {
        CodeMirrorSingleLine,
        CodeMirrorEditor,
        RequestPanelTabTitle,
        RequestPanelHeaders,
        RequestPanelAuth,
        ReferencesButton,
    },
    props: {
        activeTab: Object,
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
                    name: 'Script'
                },
                {
                    name: 'Docs'
                },
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
            tabView: 'full',
            script: {
                pre_request: constants.CODE_EXAMPLE.SCRIPT.PRE_REQUEST,
                post_request: constants.CODE_EXAMPLE.SCRIPT.POST_REQUEST,
            },
            skipScriptUpdate: false,
            editDescription: false,
            dropdownVisible: false,
        }
    },
    computed: {
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        },
        collectionItemEnvironmentResolved() {
            return this.$store.state.tabEnvironmentResolved[this.activeTab._id]
        },
        scriptPlugin() {
            if(this.activeTab === null) {
                return undefined
            }

            return this.$store.state.plugins.workspace.find(plugin => plugin.collectionId === this.activeTab._id && plugin.type === 'script')
        },
        preRequestAutocompletions() {
            return [
                ...constants.AUTOCOMPLETIONS.PLUGIN.GENERAL_METHODS,
                ...constants.AUTOCOMPLETIONS.PLUGIN.REQUEST_METHODS
            ]
        },
        postRequestAutocompletions() {
            return [
                ...constants.AUTOCOMPLETIONS.PLUGIN.GENERAL_METHODS,
                ...constants.AUTOCOMPLETIONS.PLUGIN.RESPONSE_METHODS
            ]
        },
        urlPreview() {
            let url = this.activeTab.url ?? ''

            url = substituteEnvironmentVariables(this.collectionItemEnvironmentResolved, url)

            if(this.activeTab.pathParameters) {
                this.activeTab.pathParameters.filter(item => !item.disabled).forEach(pathParameter => {
                    url = url.replaceAll(
                        `:${substituteEnvironmentVariables(this.collectionItemEnvironmentResolved, pathParameter.name)}`, substituteEnvironmentVariables(this.collectionItemEnvironmentResolved, pathParameter.value)
                    ).replaceAll(
                        `{${substituteEnvironmentVariables(this.collectionItemEnvironmentResolved, pathParameter.name)}}`, substituteEnvironmentVariables(this.collectionItemEnvironmentResolved, pathParameter.value)
                    )
                })
            }

            return url !== '' && url.trim() !== '' ? url : 'No URL'
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
            if(this.activeTab && this.activeTab.body && this.activeTab.body.mimeType === constants.MIME_TYPE.FORM_DATA) {
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
        },
        scriptPlugin: {
            handler() {
                if(this.scriptPlugin) {
                    if (this.script.pre_request !== this.scriptPlugin.code.pre_request) {
                        this.skipScriptUpdate = true
                        this.script.pre_request = this.scriptPlugin.code.pre_request
                    }

                    if (this.script.post_request !== this.scriptPlugin.code.post_request) {
                        this.skipScriptUpdate = true
                        this.script.post_request = this.scriptPlugin.code.post_request
                    }
                } else {
                    if (this.script.pre_request !== constants.CODE_EXAMPLE.SCRIPT.PRE_REQUEST) {
                        this.skipScriptUpdate = true
                        this.script.pre_request = constants.CODE_EXAMPLE.SCRIPT.PRE_REQUEST
                    }

                    if (this.script.post_request !== constants.CODE_EXAMPLE.SCRIPT.POST_REQUEST) {
                        this.skipScriptUpdate = true
                        this.script.post_request = constants.CODE_EXAMPLE.SCRIPT.POST_REQUEST
                    }
                }
            },
            immediate: true
        },
        script: {
            handler() {
                if(this.skipScriptUpdate) {
                    this.skipScriptUpdate = false
                    return
                }
                this.handleScriptSave(this)
            },
            deep: true
        },
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
        bodyMimeTypeChanged(newMimeType) {
            let mimeType = null

            if(newMimeType === constants.MIME_TYPE.FORM_URL_ENCODED) {
                mimeType = constants.MIME_TYPE.FORM_URL_ENCODED
            }

            if(newMimeType === constants.MIME_TYPE.FORM_DATA) {
                mimeType = constants.MIME_TYPE.FORM_DATA
            }

            if(newMimeType === constants.MIME_TYPE.TEXT_PLAIN) {
                mimeType = constants.MIME_TYPE.TEXT_PLAIN
            }

            if(newMimeType === constants.MIME_TYPE.JSON || newMimeType === constants.MIME_TYPE.GRAPHQL) {
                mimeType = constants.MIME_TYPE.JSON
            }

            if(newMimeType === constants.MIME_TYPE.OCTET_STREAM) {
                mimeType = constants.MIME_TYPE.OCTET_STREAM
            }

            if(mimeType === null) {
                for (let i = 0; i < this.activeTab.headers.length; i++) {
                    if (this.activeTab.headers[i].name === 'Content-Type') {
                        this.activeTab.headers.splice(i, 1)
                    }
                }
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
        async handleAddressBarPaste(content) {
            if (content.startsWith('curl')) {
                if(!await window.createConfirm(`We've detected that you've pasted a curl command. Do you want to import the curl command into the current request?`)) {
                    return false
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

                return true
            }

            return false
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
        },
        handleUrlChange() {
            queryParamsSync.onUrlChange(this.activeTab)
        },
        handleQueryParametersChange() {
            queryParamsSync.onParametersChange(this.activeTab)
        },
        renderMarkdown(markdown) {
            return marked.parse(markdown)
        },
        handleScriptSave: debounce((_this) => {
            if(_this.scriptPlugin) {
                _this.$store.commit('updatePlugin', {
                    _id: _this.scriptPlugin._id,
                    name: null,
                    code: {
                        pre_request: _this.script.pre_request,
                        post_request: _this.script.post_request,
                    },
                })
            } else {
                _this.$store.commit('addPlugin', {
                    name: null,
                    code: {
                        pre_request: _this.script.pre_request,
                        post_request: _this.script.post_request,
                    },
                    workspaceId: null,
                    collectionId: _this.activeTab._id,
                    type: 'script',
                })
            }
            console.log('Script saved')
        }, 500),
        toggleDropdown() {
            this.dropdownVisible = !this.dropdownVisible
            if (this.dropdownVisible) {
                document.addEventListener('click', this.closeDropdownOnOutsideClick)
            } else {
                document.removeEventListener('click', this.closeDropdownOnOutsideClick)
            }
        },
        selectMethod(method) {
            this.activeTab.method = method
        },
        closeDropdownOnOutsideClick(event) {
            if (!this.$refs.dropdown.contains(event.target)) {
                this.dropdownVisible = false
                document.removeEventListener('click', this.closeDropdownOnOutsideClick)
            }
        },
    },
    mounted() {
        emitter.on('response_panel', this.handleResponsePanelEmitter)

        this.attachRootElementResizeObserver()

        this.loadGraphql()
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
    cursor: pointer;
}

.request-panel-address-bar button:hover {
    background-color: #673ab7;
}

.request-panel-tabs {
    display: flex;
    user-select: none;
    background-color: var(--sidebar-item-active-color);
}

.request-panel-tabs .request-panel-tab {
    padding: 10px 15px;
    border-bottom: 1px solid var(--default-border-color);
    border-left: 1px solid transparent;
    border-right: 1px solid transparent;
    white-space: nowrap;
    cursor: pointer;
}

.request-panel-tabs .request-panel-tab-active {
    border-bottom: 1px solid transparent;
    border-right: 1px solid var(--default-border-color);
    background: var(--background-color);
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

i {
    cursor: pointer;
    padding-left: 4px;
}

li {
    padding: 8px 12px;
    cursor: pointer;
}

li:hover {
    background: var(--button-hover-background-color);
}
.selected-option {
    cursor: pointer;
    background: var(--background-color);
}

.custom-dropdown {
    padding-left: 0.8rem;
    position: relative;
    background-color: var(--modal-background-color);
}

.custom-dropdown ul {
    list-style-type: none;
    padding: 0;
    margin: 0;
    position: absolute;
    background-color: var(--modal-background-color);
    z-index: 1;
    border: 1px solid var(--menu-border-color);
    box-shadow: 0 0 1rem 0 var(--box-shadow-color);
    border-radius: var(--default-border-radius);
    background: var(--background-color);
    left: 0;
}

.row {
    display: flex;
    align-items: center;
    padding-bottom: 1px;
    padding-right: 5px;
}

</style>
