<script setup>
import SidebarItem from './SidebarItem.vue'
</script>

<template>
    <div class="sidebar-filter">
        <input type="search" placeholder="Filter" spellcheck="false">
    </div>
    <div class="sidebar-list-container">
        <div class="sidebar-list">
            <template v-for="sidebarItem in sidebarItems">
                <sidebar-item :sidebar-item="sidebarItem" />
            </template>
        </div>
    </div>
</template>

<script>
export default {
    computed: {
        sidebarItems() {
            return this.$store.state.collection
        }
    }
}
</script>

<style>
.sidebar .sidebar-filter > input  {
    width: 100%;
    padding: 5px;
    outline: 0;
    border: 0;
    border-bottom: 1px solid var(--default-border-color);
}

.sidebar .sidebar-list-container {
    height: 100%;
    overflow: auto;
    padding-top: 0.5rem;
    padding-bottom: 1rem;
}

.sidebar .sidebar-item {
    padding-top: 0.4rem;
    padding-bottom: 0.4rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.sidebar .sidebar-item-active {
    background-color: #f3f3f3;
}

.sidebar .sidebar-item:hover {
    background-color: #f3f3f3;
}

.sidebar .sidebar-list > .sidebar-item {
    padding-left: calc(1rem * 0.6);
}

/* handle nested sidebar lists */
.sidebar .sidebar-list > .sidebar-list {
    padding-left: calc(1rem * 1.2);
}
</style>
