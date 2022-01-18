<template>
    <div class="loading-overlay" v-if="status === 'loading'">
        <h2 style="font-variant-numeric: tabular-nums; font-weight: 500">Loading...</h2>
        <div class="pad">
            <i class="fas fa-sync fa-spin"></i>
        </div>
        <div class="pad">
            <button class="btn btn--clicky">Cancel Request</button>
        </div>
    </div>
    <template v-if="status !== 'not loaded' && response !== null">
        <div class="response-panel-address-bar">
            <div class="tag" :class="{
                'green': response.status >= 200 && response.status <= 299,
                'yellow': response.status >= 400 && response.status <= 499,
                'red': response.status >= 500 || response.statusText === 'Error'
            }">
                <span class="bold">{{ response.status }}</span>
                {{ response.statusText }}
            </div>
        </div>
        <div class="response-panel-tabs">
            <div class="response-panel-tab" :class="{ 'response-panel-tab-active': activeResponsePanelTab === responsePanelTab.name }" @click="activeResponsePanelTab = responsePanelTab.name" v-for="responsePanelTab in responsePanelTabs">
                {{ responsePanelTab.name }}
            </div>
            <div class="response-panel-tab-fill"></div>
        </div>
        <div class="response-panel-tabs-context">
            <template v-if="activeResponsePanelTab === 'Preview'">
                <template v-if="response.statusText !== 'Error'">
                    <CodeMirrorResponsePanelPreview v-model="response.responseParsed" />
                </template>
                <div class="content-box" v-else>{{ response.responseOriginal }}</div>
            </template>
            <template v-if="activeResponsePanelTab === 'Header'">
                <div class="content-box">
                    <table>
                        <tr v-for="header in response.headers">
                            <td>{{ header[0] }}</td>
                            <td>{{ header[1] }}</td>
                        </tr>
                    </table>
                </div>
            </template>
        </div>
    </template>
</template>

<script>
import CodeMirrorResponsePanelPreview from './CodeMirrorResponsePanelPreview.vue'

export default {
    components: {
        CodeMirrorResponsePanelPreview
    },
    data() {
        return {
            responsePanelTabs: [
                {
                    name: 'Preview'
                },
                {
                    name: 'Header'
                }
            ],
            activeResponsePanelTab: 'Preview'
        }
    },
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        },
        status() {
            if(this.activeTab && this.activeTab._id in this.$store.state.requestResponseStatus) {
                return this.$store.state.requestResponseStatus[this.activeTab._id]
            }

            return 'not loaded'
        },
        response() {
            if(this.activeTab && this.activeTab._id in this.$store.state.requestResponses) {
                return this.$store.state.requestResponses[this.activeTab._id]
            }

            return {
                status: null,
                statusText: null,
                response: null
            }
        }
    },
    methods: {
        cancelRequest() {
            // this.$store.commit('cancelRequest', this.activeTab)
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
    border-bottom: 1px solid var(--default-border-color);
    height: 2rem;
    align-items: center;
    min-width: 0;
    padding-left: 0.5rem;
}

.response-panel-address-bar .tag {
    padding: 0.2rem 0.6rem;
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
