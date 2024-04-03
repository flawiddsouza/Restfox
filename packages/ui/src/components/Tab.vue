<template>
    <section class="request-response-panels" :class="{ 'top-bottom': requestResponseLayoutTopBottom, 'left-right': !requestResponseLayoutTopBottom }" v-resizable.top-bottom="requestResponseLayoutTopBottom" v-show="collectionItem && collectionItem._type === 'request'" :key="'request-panel-layout-' + requestResponseLayoutTopBottom" @resized="requestPanelResized">
        <section
            class="request-panel" :data-min-width-px="!requestResponseLayoutTopBottom ? 250 : 100" :style="{
                'flexGrow': requestPanelRatio,
                'minWidth': !requestResponseLayoutTopBottom ? '250px' : null,
                'minHeight': requestResponseLayoutTopBottom ? '100px' : null
            }"
        >
            <RequestPanel :active-tab="collectionItem" />
        </section>

        <section class="resizer" data-resizer></section>

        <section
            class="response-panel" :data-min-width-px="!requestResponseLayoutTopBottom ? 250 : 100" :style="{
                'flexGrow': responsePanelRatio,
                'minWidth': !requestResponseLayoutTopBottom ? '250px' : null,
                'minHeight': requestResponseLayoutTopBottom ? '100px' : null
            }"
        >
            <ResponsePanel :active-tab="collectionItem" />
        </section>
    </section>

    <section class="request-response-panels" v-if="collectionItem && collectionItem._type === 'socket'">
        <SocketPanel :key="collectionItem._id" :active-tab="collectionItem" />
    </section>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { CollectionItem } from '@/globals'
import RequestPanel from '@/components/RequestPanel.vue'
import ResponsePanel from '@/components/ResponsePanel.vue'
import SocketPanel from '@/components/SocketPanel.vue'
import { vResizable } from '@/directives/vResizable'

const props = defineProps<{
    collectionItem: CollectionItem | null;
    requestResponseLayoutTopBottom: boolean;
    requestPanelRatio?: string;
    responsePanelRatio?: string;
    requestPanelResized: (width: number) => void;
}>()

watch(() => props.collectionItem, () => {
    // persist collection item
})
</script>

<style scoped>
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
