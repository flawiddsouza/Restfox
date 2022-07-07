<script setup>
import NavBar from '@/components/NavBar.vue'
import TabBar from '@/components/TabBar.vue'
import Sidebar from '@/components/Sidebar.vue'
import RequestPanel from '@/components/RequestPanel.vue'
import ResponsePanel from '@/components/ResponsePanel.vue'
import ImportModal from '@/components/ImportModal.vue'
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useStore } from 'vuex'
import constants from '../constants'

const store = useStore()
const activeTab = computed(() => store.state.activeTab)

function setContainerGridColumnWidths(sidebarWidth, requestPanelWidth, responsePanelWidth) {
    const container = document.querySelector('.container')
    let containerStyle = 'auto 1.2fr 1fr'
    if(container.style.gridTemplateColumns) {
        containerStyle = container.style.gridTemplateColumns
    }
    let containerValueSplit = containerStyle.split(' ')
    containerValueSplit[0] = sidebarWidth ?? containerValueSplit[0]
    containerValueSplit[1] = requestPanelWidth ?? containerValueSplit[1]
    containerValueSplit[2] = responsePanelWidth ?? containerValueSplit[2]
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

function onRequestPanelResize(e) {
    const requestPanel = e[0].target
    if(requestPanel.style.width) {
        const requestPanelWidth = getComputedStyle(requestPanel).width
        localStorage.setItem(constants.LOCAL_STORAGE_KEY.REQUEST_PANEL_WIDTH, requestPanelWidth)
        setContainerGridColumnWidths(undefined, requestPanelWidth)
    }
}

let resizeObserverSidebar
let resizeObserverRequestPanel

onMounted(() => {
    const sidebar = document.querySelector('.sidebar')
    const requestPanel = document.querySelector('.request-panel')

    const savedSidebarWidth = localStorage.getItem(constants.LOCAL_STORAGE_KEY.SIDEBAR_WIDTH)
    const savedRequestPanelWidth = localStorage.getItem(constants.LOCAL_STORAGE_KEY.REQUEST_PANEL_WIDTH)

    if(savedSidebarWidth) {
        sidebar.style.width = savedSidebarWidth
    }

    if(savedRequestPanelWidth) {
        requestPanel.style.width = savedRequestPanelWidth
    }

    setContainerGridColumnWidths(savedSidebarWidth, savedRequestPanelWidth)

    resizeObserverSidebar = new ResizeObserver(onSidebarResize)
    resizeObserverSidebar.observe(sidebar)

    resizeObserverRequestPanel = new ResizeObserver(onRequestPanelResize)
    resizeObserverRequestPanel.observe(requestPanel)
})

onBeforeUnmount(() => {
    resizeObserverSidebar.disconnect()
    resizeObserverRequestPanel.disconnect()
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

        <section class="request-panel" v-show="activeTab">
            <RequestPanel />
        </section>

        <section class="response-panel" v-if="activeTab">
            <ResponsePanel />
        </section>

        <ImportModal />
    </div>
</template>

<style scoped>
.container {
    display: grid;

    grid-template-areas:
      "header header header"
      "sidebar tab-bar tab-bar"
      "sidebar request-panel response-panel";

    grid-template-columns: 300px 1.2fr 1fr;
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
    max-width: 500px;
}

.request-panel {
    grid-area: request-panel;
    overflow: auto;
    border-right: 1px solid var(--default-border-color);
    display: grid;
    grid-template-rows: auto auto 1fr;
    resize: horizontal;
    min-width: calc(100vw / 3);
    max-width: 50vw;
}

.response-panel {
    grid-area: response-panel;
    overflow: auto;
    position: relative;
    display: grid;
    grid-template-rows: auto auto 1fr;
}
</style>
