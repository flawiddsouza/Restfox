<template>
    <section class="request-response-panels" :class="{ 'top-bottom': requestResponseLayoutTopBottom, 'left-right': !requestResponseLayoutTopBottom }" v-resizable.top-bottom="requestResponseLayoutTopBottom" v-show="collectionItem && (collectionItem._type === 'request' || collectionItem._type === 'grpc') && (!isMobile || activeMobilePanel !== 'collections')" :key="'request-panel-layout-' + requestResponseLayoutTopBottom" @resized="requestPanelResized">
        <section
            class="request-panel" :data-min-width-px="!requestResponseLayoutTopBottom ? 250 : 100" :style="{
                'flexGrow': requestPanelRatio,
                'minWidth': !requestResponseLayoutTopBottom ? '250px' : null,
                'minHeight': requestResponseLayoutTopBottom ? '100px' : null
            }"
            v-show="!isMobile || activeMobilePanel === 'content'"
        >
            <KeepAlive>
                <GrpcRequestPanel
                    v-if="collectionItem?._type === 'grpc'"
                    :active-tab="collectionItem"
                    :key="'grpc-request-panel-' + collectionItem._id"
                />
                <RequestPanel
                    v-else
                    :active-tab="collectionItem"
                    :key="'request-panel-' + collectionItem?._id"
                />
            </KeepAlive>
        </section>

        <section class="resizer" data-resizer v-show="!isMobile"></section>

        <section
            class="response-panel" :data-min-width-px="!requestResponseLayoutTopBottom ? 250 : 100" :style="{
                'flexGrow': responsePanelRatio,
                'minWidth': !requestResponseLayoutTopBottom ? '250px' : null,
                'minHeight': requestResponseLayoutTopBottom ? '100px' : null
            }"
            v-show="!isMobile || activeMobilePanel === 'response'"
        >
            <KeepAlive>
                <GrpcResponsePanel
                    v-if="collectionItem?._type === 'grpc'"
                    :active-tab="collectionItem"
                    :key="'grpc-response-panel-' + collectionItem._id"
                />
                <ResponsePanel
                    v-else
                    :active-tab="collectionItem"
                    :key="'response-panel-' + collectionItem?._id"
                />
            </KeepAlive>
        </section>
    </section>

    <section class="request-response-panels" v-if="collectionItem && collectionItem._type === 'socket' && (!isMobile || activeMobilePanel !== 'collections')">
        <KeepAlive>
            <SocketPanel :key="collectionItem._id" :active-tab="collectionItem" />
        </KeepAlive>
    </section>

    <section class="request-response-panels" v-show="collectionItem && collectionItem._type === 'request_group' && (!isMobile || activeMobilePanel !== 'collections')">
        <FolderPanel :collection-item="collectionItem" />
    </section>

    <section class="request-response-panels" v-if="collectionItem && !KNOWN_TYPES.includes(collectionItem._type) && (!isMobile || activeMobilePanel !== 'collections')">
        <div class="tab-unknown-type">This request was made with a newer version of Restfox. Update Restfox to open it.</div>
    </section>

    <section class="request-response-panels" v-if="!collectionItem && (!isMobile || activeMobilePanel !== 'collections')">
        <NewRequestShortcutPanel></NewRequestShortcutPanel>
    </section>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { CollectionItem } from '@/globals'
import RequestPanel from '@/components/RequestPanel.vue'
import ResponsePanel from '@/components/ResponsePanel.vue'
import SocketPanel from '@/components/SocketPanel.vue'
import GrpcRequestPanel from '@/components/GrpcRequestPanel.vue'
import GrpcResponsePanel from '@/components/GrpcResponsePanel.vue'
import { vResizable } from '@/directives/vResizable'
import { Store, useStore } from 'vuex'
import { findItemInTreeById } from '@/helpers'
import { State } from '@/global'
import FolderPanel from '@/components/FolderPanel.vue'
import NewRequestShortcutPanel from '@/components/NewRequestShortcutPanel.vue'
import { useMobile } from '@/composables/useMobile'

const props = defineProps<{
    collectionItem: CollectionItem | null;
    requestResponseLayoutTopBottom: boolean;
    requestPanelRatio?: string | number;
    responsePanelRatio?: string | number;
    requestPanelResized: (width: number) => void;
}>()

// computed
const store: Store<State> = useStore()
const { isMobile } = useMobile()
const activeMobilePanel = computed(() => store.state.activeMobilePanel)
// the item types this version has a panel for
const KNOWN_TYPES = ['request', 'socket', 'grpc', 'request_group']

// watch
watch(() => props.collectionItem, (newValue, oldValue) => {
    // don't commit change when collectionItem is set for the first time
    // and when collectionItem is changed from one tab to another,
    // having same id in oldValue & newValue means same object
    // has changed, so we need to save the object
    if(oldValue && newValue && oldValue._id === newValue._id) {
        // all request_group changes are persisted in a different way
        // they don't need to go through here
        if (newValue._type === 'request_group') {
            return
        }

        store.commit('persistCollectionItem', newValue)

        // keep sidebarItem properties in sync with collectionItem
        const sidebarItem = findItemInTreeById(store.state.collectionTree, props.collectionItem._id)
        if(sidebarItem) {
            Object.assign(sidebarItem, props.collectionItem)
        }

        // keep state.collection item properties in sync with collectionItem
        const collectionItem = store.state.collection.find(item => item._id === props.collectionItem._id)
        if(collectionItem) {
            Object.assign(collectionItem, props.collectionItem)
        }

        // keep tab properties in tabs in sync with collectionItem
        const tab = store.state.tabs.find(tab => tab._id === props.collectionItem._id)
        if(tab) {
            Object.assign(tab, props.collectionItem)
        }
    }
}, {
    deep: true
})
</script>

<style scoped>
.tab-unknown-type {
    padding: 1rem;
    color: var(--tip-text-color);
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

@media (max-width: 768px) {
    .request-response-panels.left-right > .request-panel,
    .request-response-panels.left-right > .response-panel {
        flex: 1 1 100%;
        min-width: unset;
    }
}
</style>
