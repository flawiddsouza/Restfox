<script setup>
import NavBar from '@/components/NavBar.vue'
import TabBar from '@/components/TabBar.vue'
import Sidebar from '@/components/Sidebar.vue'
import WindowPortal from '@/components/WindowPortal.vue'
import Tab from '@/components/Tab.vue'
import ImportModal from '@/components/ImportModal.vue'
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useStore } from 'vuex'
import constants from '../constants'

const store = useStore()
const activeTab = computed(() => store.state.activeTab)
const requestResponseLayoutTopBottom = computed(() => store.state.requestResponseLayout === 'top-bottom')
const detachedTabs = computed(() => store.state.detachedTabs)
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

        <Tab
            :collection-item="activeTab"
            :request-response-layout-top-bottom="requestResponseLayoutTopBottom"
            :request-panel-ratio="requestPanelRatio"
            :response-panel-ratio="responsePanelRatio"
            :request-panel-resized="requestPanelResized"
        />

        <template v-for="detachedTab in detachedTabs" :key="'detached-tab' + detachedTab._id">
            <WindowPortal :open="true">
                <Tab
                    :collection-item="detachedTab"
                    :request-response-layout-top-bottom="requestResponseLayoutTopBottom"
                    :request-panel-ratio="requestPanelRatio"
                    :response-panel-ratio="responsePanelRatio"
                    :request-panel-resized="requestPanelResized"
                />
            </WindowPortal>
        </template>

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
</style>
