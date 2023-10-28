<script setup>
import NavBar from '@/components/NavBar.vue'
import TabBar from '@/components/TabBar.vue'
import Sidebar from '@/components/Sidebar.vue'
import RequestPanel from '@/components/RequestPanel.vue'
import ResponsePanel from '@/components/ResponsePanel.vue'
import SocketPanel from '@/components/SocketPanel.vue'
import ImportModal from '@/components/ImportModal.vue'
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useStore } from 'vuex'
import constants from '../constants'
import { vResizable } from '@/directives/vResizable'

const store = useStore()
const activeTab = computed(() => store.state.activeTab)
const requestResponseLayoutTopBottom = computed(() => store.state.requestResponseLayout === 'top-bottom')
const requestPanelRatio = ref(undefined)
const responsePanelRatio = ref(undefined)

function setContainerGridColumnWidths(sidebarWidth) {
    const container = document.querySelector('.container')
    let containerStyle = 'auto 1fr'
    if(container.style.gridTemplateColumns) {
        containerStyle = container.style.gridTemplateColumns
    }
    let containerValueSplit = containerStyle.split(' ')
    containerValueSplit[0] = sidebarWidth ?? containerValueSplit[0]
    container.style.gridTemplateColumns = containerValueSplit.join(' ')
}

function onSidebarResize(e) {
    const sidebar = e[0].target
    if(sidebar.style.width) {
        const sidebarWidth = getComputedStyle(sidebar).width
        localStorage.setItem(constants.LOCAL_STORAGE_KEY.SIDEBAR_WIDTH, sidebarWidth)
        setContainerGridColumnWidths(sidebarWidth)
    }
}

function requestPanelResized(e) {
    requestPanelRatio.value = e.detail.leftPanel
    localStorage.setItem(constants.LOCAL_STORAGE_KEY.REQUEST_PANEL_RATIO, e.detail.leftPanel)
    responsePanelRatio.value = e.detail.rightPanel
    localStorage.setItem(constants.LOCAL_STORAGE_KEY.RESPONSE_PANEL_RATIO, e.detail.rightPanel)
}

let resizeObserverSidebar

onMounted(() => {
    const sidebar = document.querySelector('.sidebar')

    const savedSidebarWidth = localStorage.getItem(constants.LOCAL_STORAGE_KEY.SIDEBAR_WIDTH)
    const savedRequestPanelRatio = localStorage.getItem(constants.LOCAL_STORAGE_KEY.REQUEST_PANEL_RATIO)
    const savedResponsePanelRatio = localStorage.getItem(constants.LOCAL_STORAGE_KEY.RESPONSE_PANEL_RATIO)
    const savedRequestResponseLayout = localStorage.getItem(constants.LOCAL_STORAGE_KEY.REQUEST_RESPONSE_LAYOUT)

    if(savedSidebarWidth) {
        sidebar.style.width = savedSidebarWidth
        setContainerGridColumnWidths(savedSidebarWidth)
    }

    if(savedRequestPanelRatio && savedResponsePanelRatio) {
        requestPanelRatio.value = savedRequestPanelRatio
        responsePanelRatio.value = savedResponsePanelRatio
    }

    if(savedRequestResponseLayout) {
        store.state.requestResponseLayout = savedRequestResponseLayout
    }

    resizeObserverSidebar = new ResizeObserver(onSidebarResize)
    resizeObserverSidebar.observe(sidebar)
})

onBeforeUnmount(() => {
    resizeObserverSidebar.disconnect()
})
</script>

<template>
    <div class="container">
        <header>
            <NavBar nav="collection" />
        </header>

        <section class="tab-bar" v-if="activeTab">
            <TabBar />
        </section>

        <aside class="sidebar">
            <Sidebar />
        </aside>

        <section class="request-response-panels" :class="{ 'top-bottom': requestResponseLayoutTopBottom, 'left-right': !requestResponseLayoutTopBottom }" v-resizable.top-bottom="requestResponseLayoutTopBottom" v-show="activeTab && activeTab._type === 'request'" :key="'request-panel-layout-' + requestResponseLayoutTopBottom" @resized="requestPanelResized">
            <section
                class="request-panel" :data-min-width-px="!requestResponseLayoutTopBottom ? 250 : 100" :style="{
                    'flexGrow': requestPanelRatio,
                    'minWidth': !requestResponseLayoutTopBottom ? '250px' : null,
                    'minHeight': requestResponseLayoutTopBottom ? '100px' : null
                }"
            >
                <RequestPanel />
            </section>

            <section class="resizer" data-resizer></section>

            <section
                class="response-panel" :data-min-width-px="!requestResponseLayoutTopBottom ? 250 : 100" :style="{
                    'flexGrow': responsePanelRatio,
                    'minWidth': !requestResponseLayoutTopBottom ? '250px' : null,
                    'minHeight': requestResponseLayoutTopBottom ? '100px' : null
                }"
            >
                <ResponsePanel />
            </section>
        </section>

        <section class="request-response-panels" v-if="activeTab && activeTab._type === 'socket'">
            <SocketPanel :key="activeTab._id" />
        </section>

        <ImportModal />
    </div>
</template>

<style scoped>
.container {
    display: grid;

    grid-template-areas:
      "header header"
      "sidebar tab-bar"
      "sidebar request-response-panels";

    grid-template-columns: 300px 1fr;
    grid-template-rows: auto auto 1fr;

    height: 100%;
}

header {
    grid-area: header;
    border-bottom: 1px solid var(--default-border-color);
}

.tab-bar {
    grid-area: tab-bar;
    display: flex;
    user-select: none;
    border-bottom: 1px solid var(--default-border-color);
    width: 100%;
    overflow: auto;
}

.sidebar {
    grid-area: sidebar;
    overflow: auto;
    user-select: none;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--default-border-color);
    resize: horizontal;
    min-width: 300px;
    width: 300px;
    max-width: 500px;
}

.request-panel {
    overflow: auto;
    display: grid;
    grid-template-rows: auto auto 1fr;
}

.response-panel {
    overflow: auto;
    position: relative;
    display: grid;
    grid-template-rows: auto auto 1fr;
}

.request-response-panels {
    grid-area: request-response-panels;
    display: flex;
    height: 100%;
    overflow: auto;
}

.request-response-panels.top-bottom {
    flex-direction: column;
}

.request-response-panels.top-bottom > .request-panel {
    border-bottom: 1px solid var(--default-border-color);
}

.request-response-panels.top-bottom > .request-panel,
.request-response-panels.top-bottom > .response-panel {
    flex: 0.5 1 0%;
}

.request-response-panels.left-right > .request-panel {
    border-right: 1px solid var(--default-border-color);
}

.request-response-panels.left-right > .request-panel,
.request-response-panels.left-right > .response-panel {
    flex: 0.5 1 0%;
}

.request-response-panels.left-right > .resizer {
    width: 4px;
    background-color: var(--resizer-background-color);
    cursor: ew-resize;
}

.request-response-panels.top-bottom > .resizer {
    height: 4px;
    background-color: var(--resizer-background-color);
    cursor: ns-resize;
}

.request-response-panels > .resizer:hover, .request-response-panels > .resizer[data-resizing] {
    background-color: darksalmon;
}
</style>
