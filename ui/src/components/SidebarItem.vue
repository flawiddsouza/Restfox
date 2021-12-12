<script setup>
import SidebarItem from './SidebarItem.vue'

defineProps({
    sidebarItem: Object
})
</script>

<template>
    <div class="sidebar-item" :class="{ 'sidebar-item-active': activeTab && sidebarItem._id === activeTab._id  }" @click="handleSidebarItemClick(sidebarItem)">
        <template v-if="sidebarItem._type === 'request_group'">
            <i class="fa space-right fa-folder-open" v-if="hideChildren === false"></i>
            <i class="fa space-right fa-folder" v-else></i>
        </template>
        <template v-if="sidebarItem._type === 'request'">
            <span style="font-size: 0.7rem; margin-right: 0.4rem">{{ sidebarItem.method }}</span>
        </template>
        {{ sidebarItem.name }}
    </div>
    <div class="sidebar-list" v-if="'children' in sidebarItem && sidebarItem.children.length && hideChildren === false">
        <template v-for="sidebarItem1 in sidebarItem.children">
            <sidebar-item :sidebar-item="sidebarItem1" />
        </template>
    </div>
</template>

<script>
export default {
    data() {
        return {
            hideChildren: false
        }
    },
    methods: {
        handleSidebarItemClick(sidebarItem) {
            if(sidebarItem._type === 'request') {
                this.$store.commit('addTab', sidebarItem)
            }

            if(sidebarItem._type === 'request_group') {
                this.hideChildren = !(this.hideChildren)
            }
        }
    },
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        }
    }
}
</script>
