<template>
    <template v-if="activeTab">
        <div class="request-panel-address-bar">
            <select v-model="activeTab.method">
                <option v-for="method in methods">{{ method }}</option>
            </select>
            <input type="text" spellcheck="false" v-model="activeTab.url">
            <button>Send</button>
        </div>
        <div class="request-panel-tabs">
            <div class="request-panel-tab" :class="{ 'request-panel-tab-active': activeRequestPanelTab === requestPanelTab.name }" @click="activeRequestPanelTab = requestPanelTab.name" v-for="requestPanelTab in requestPanelTabs">
                {{ requestPanelTab.name }}
            </div>
            <div class="request-panel-tab-fill"></div>
        </div>
        <div class="request-panel-tabs-context">
            <template v-if="activeRequestPanelTab === 'Body'">
                {{ activeTab.body.mimeType }}
                <table>
                    <tr v-for="param in activeTab.body.params">
                        <td>
                            <input type="text" v-model="param.name">
                        </td>
                        <td>
                            <input type="text" v-model="param.value">
                        </td>
                    </tr>
                </table>
            </template>
            <template v-if="activeRequestPanelTab === 'Query'">
                <table>
                    <tr v-for="param in activeTab.parameters">
                        <td>
                            <input type="text" v-model="param.name">
                        </td>
                        <td>
                            <input type="text" v-model="param.value">
                        </td>
                    </tr>
                </table>
            </template>
            <template v-if="activeRequestPanelTab === 'Header'">
                <table>
                    <tr v-for="header in activeTab.headers">
                        <td>
                            <input type="text" v-model="header.name">
                        </td>
                        <td>
                            <input type="text" v-model="header.value">
                        </td>
                    </tr>
                </table>
            </template>
        </div>
    </template>
</template>

<script>
export default {
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
    }
}
</script>

<style scoped>
.request-panel-address-bar {
    display: flex;
    border-bottom: 1px solid var(--default-border-color);
    height: 2rem;
}

.request-panel-address-bar > select {
    text-align: center;
}

.request-panel-address-bar > input {
    width: 100%;
}

.request-panel-address-bar > input, .request-panel-address-bar > select, .request-panel-address-bar > button {
    border: 0;
}

.request-panel-address-bar input, .request-panel-address-bar select {
    padding: 5px;
    outline: 0;
    background: inherit;
}

.request-panel-address-bar button {
    background-color: #7f4fd5;
    color: white;
    padding-left: 1.5rem;
    padding-right: 1.5rem;
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
</style>
