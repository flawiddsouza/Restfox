<template>
    <template v-if="activeTab">
        <div class="request-panel-address-bar">
            <select v-model="activeTab.method">
                <option v-for="method in methods">{{ method }}</option>
            </select>
            <div class="code-mirror-input-container">
                <CodeMirrorSingleLine v-model="activeTab.url" />
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
            </div>
            <div class="request-panel-tab-fill"></div>
        </div>
        <div class="request-panel-tabs-context">
            <div v-if="activeRequestPanelTab === 'Body'" class="request-panel-tabs-context-container">
                <select v-model="activeTab.body.mimeType" style="margin-bottom: 0.5rem">
                    <option value="No Body">No Body</option>
                    <option value="application/x-www-form-urlencoded">Form URL Encoded</option>
                    <option value="text/plain">Plain Text</option>
                    <option value="application/json">JSON</option>
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
                    <textarea v-model="activeTab.body.text" style="width: 100%" spellcheck="false"></textarea>
                </div>
                <div v-if="activeTab.body.mimeType === 'application/json'" class="oy-a">
                    <CodeMirrorEditor v-model="activeTab.body.text" lang="json" class="code-editor" :key="'code-mirror-editor-' + activeTab._id" ref="jsonEditor"></CodeMirrorEditor>
                </div>
                <div class="request-panel-body-footer" v-if="activeTab.body.mimeType === 'application/json'">
                    <button @click="beautifyJSON">Beautify JSON</button>
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
        </div>
    </template>
</template>

<script>
import CodeMirrorSingleLine from './CodeMirrorSingleLine.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'

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
            ]
        }
    },
    computed: {
        activeTab() {
            return this.$store.state.activeTab
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

.request-panel-tabs-context-container > div, .request-panel-tabs-context-container > div > textarea {
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
    margin-bottom: -0.5rem
}
</style>
