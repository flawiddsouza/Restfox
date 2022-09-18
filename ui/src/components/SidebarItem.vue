<script setup>
import SidebarItem from './SidebarItem.vue'

defineProps({
    sidebarItem: Object
})
</script>

<template>
    <div class="sidebar-item" :class="{ 'sidebar-item-active': activeTab && sidebarItem._id === activeTab._id  }" @click="handleSidebarItemClick(sidebarItem)" @contextmenu.prevent="handleContextMenu(sidebarItem, $event)" :draggable="collectionFilter === '' ? true : false" :data-parent-id="sidebarItem.parentId" :data-id="sidebarItem._id" :data-type="sidebarItem._type">
        <template v-if="sidebarItem._type === 'request_group'">
            <div style="margin-right: 0.3rem">
                <i class="fa space-right fa-folder-open" v-if="getSidebarItemExpandedState(sidebarItem)"></i>
                <i class="fa space-right fa-folder" v-else></i>
            </div>
        </template>
        <template v-if="sidebarItem._type === 'request'">
            <div class="sidebar-item-method" :class="`request-method--${sidebarItem.method}`">{{ sidebarItem.method.slice(0, 4) }}</div>
        </template>
        <div>{{ sidebarItem.name }}</div>
    </div>
    <div class="sidebar-list" v-if="'children' in sidebarItem && sidebarItem.children.length && getSidebarItemExpandedState(sidebarItem)">
        <template v-for="sidebarItem1 in sidebarItem.children">
            <sidebar-item :sidebar-item="sidebarItem1" />
        </template>
    </div>
</template>

<script>
export default {
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        },
        collectionFilter() {
            return this.$store.state.collectionFilter
        }
    },
    methods: {
        handleSidebarItemClick(sidebarItem) {
            if(sidebarItem._type === 'request') {
                this.$store.commit('addTab', sidebarItem)
            }

            if(sidebarItem._type === 'request_group') {
                sidebarItem.collapsed = !(sidebarItem.collapsed)
                this.$store.dispatch('saveCollectionItemCollapsedState', { _id: sidebarItem._id, collapsed: sidebarItem.collapsed })
            }
        },
        handleContextMenu(sidebarItem, event) {
            this.$store.commit('setActiveSidebarItemForContextMenu', { sidebarItem, element: event.target.closest('.sidebar-item') })
        },
        getSidebarItemExpandedState(sidebarItem) {
            // always keep sidebar item expanded if search filter is active
            if(this.collectionFilter !== '') {
                return true
            }

            return sidebarItem.collapsed === undefined || sidebarItem.collapsed === false
        }
    }
}
</script>
