<script setup>
import NavBar from '@/components/NavBar.vue'
import TabBar from '@/components/TabBar.vue'
import Sidebar from '@/components/Sidebar.vue'
import WindowPortal from '@/components/WindowPortal.vue'
import Tab from '@/components/Tab.vue'
import ImportModal from '@/components/ImportModal.vue'
import BottomNav from '@/components/BottomNav.vue'
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useStore } from 'vuex'
import constants from '../constants'
import { useMobile } from '@/composables/useMobile'

const store = useStore()
const { isMobile } = useMobile()
const activeMobilePanel = computed(() => store.state.activeMobilePanel)
const activeTab = computed(() => store.state.activeTab)
const showTabs = computed(() => store.state.flags.showTabs)
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
    if(isMobile.value) {
        return
    }
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

function handePortalClose(detachedTab) {
    store.commit('closeDetachedTab', detachedTab)
}

let resizeObserverSidebar

onMounted(() => {
    const sidebar = document.querySelector('.sidebar')

    const savedSidebarWidth = localStorage.getItem(constants.LOCAL_STORAGE_KEY.SIDEBAR_WIDTH)
    const savedRequestPanelRatio = localStorage.getItem(constants.LOCAL_STORAGE_KEY.REQUEST_PANEL_RATIO)
    const savedResponsePanelRatio = localStorage.getItem(constants.LOCAL_STORAGE_KEY.RESPONSE_PANEL_RATIO)
    const savedRequestResponseLayout = localStorage.getItem(constants.LOCAL_STORAGE_KEY.REQUEST_RESPONSE_LAYOUT)

    if(savedSidebarWidth && !isMobile.value) {
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

        <section class="tab-bar" v-if="activeTab && showTabs">
            <TabBar />
        </section>

        <aside class="sidebar" :class="{ 'sidebar-open': isMobile && activeMobilePanel === 'collections' }">
            <Sidebar />
        </aside>

        <BottomNav />

        <Tab
            :collection-item="activeTab"
            :request-response-layout-top-bottom="requestResponseLayoutTopBottom"
            :request-panel-ratio="requestPanelRatio"
            :response-panel-ratio="responsePanelRatio"
            :request-panel-resized="requestPanelResized"
        />

        <template v-for="detachedTab in detachedTabs" :key="'detached-tab' + detachedTab._id">
            <WindowPortal :open="true" :title="(detachedTab._type === 'socket' ? 'SOCK' : detachedTab._type === 'grpc' ? 'gRPC' : detachedTab.method ?? '') + ' ' + detachedTab.name + ' — Restfox'" @close="handePortalClose(detachedTab)">
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
    background: var(--sidebar-item-active-color);
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

@media (max-width: 768px) {
    .container {
        grid-template-areas:
            "tab-bar"
            "request-response-panels"
            "bottom-nav";
        grid-template-columns: 1fr;
        grid-template-rows: auto 1fr auto;
    }

    header {
        display: none;
    }

    .sidebar {
        grid-row: 2;
        grid-column: 1;
        position: relative;
        width: 100%;
        height: 100%;
        max-width: 100%;
        min-width: unset;
        border-right: none;
        transform: none;
        transition: none;
        resize: none;
        overflow-y: auto;
        display: none;
    }

    .sidebar.sidebar-open {
        display: flex;
        z-index: 1;
    }
}
</style>
