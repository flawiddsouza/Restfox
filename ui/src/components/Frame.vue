<script setup>
import TabBar from '@/components/TabBar.vue'
import Sidebar from '@/components/Sidebar.vue'
import RequestPanel from '@/components/RequestPanel.vue'
import ResponsePanel from '@/components/ResponsePanel.vue'
</script>

<template>
    <div class="container">
        <header>
            <h3 class="heading">
                <!-- <a href="#">Dashboard</a> > <span>My Collection</span> -->
                Restfox
            </h3>
        </header>
        <section class="tab-bar">
            <TabBar />
        </section>

        <aside class="sidebar">
            <Sidebar />
        </aside>

        <section class="request-panel">
            <RequestPanel />
        </section>

        <section class="response-panel">
            <ResponsePanel />
        </section>
    </div>
</template>

<style scoped>
.container {
    display: grid;

    grid-template-areas:
      "header header header"
      "sidebar tab-bar tab-bar"
      "sidebar request-panel response-panel";

    grid-template-columns: 300px 1fr 1fr;
    grid-template-rows: auto auto 1fr;

    height: 100%;
}

header {
    grid-area: header;
    padding-top: 0.5em;
    padding-bottom: 0.5em;
    padding-left: 1em;
    border-bottom: 1px solid var(--default-border-color);
}

.tab-bar {
    grid-area: tab-bar;
    display: flex;
    user-select: none;
    border-bottom: 1px solid var(--default-border-color);
}

.sidebar {
    grid-area: sidebar;
    overflow: auto;
    user-select: none;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--default-border-color);
}

.request-panel {
    grid-area: request-panel;
    overflow: auto;
    border-right: 1px solid var(--default-border-color);
    display: grid;
    grid-template-rows: auto auto 1fr;
}

.response-panel {
    grid-area: response-panel;
    overflow: auto;
    position: relative;
}

.heading {
    font-weight: 500;
}

.heading a:not(:hover) {
    text-decoration: none;
}
</style>
