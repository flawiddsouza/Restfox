<template>
    <div class="sidebar-filter">
        <input type="search" placeholder="Filter" spellcheck="false" v-model="collectionFilter">
    </div>
    <div class="sidebar-list-container">
        <div class="sidebar-list">
            <template v-for="sidebarItem in sidebarItems">
                <sidebar-item :sidebar-item="sidebarItem" />
            </template>
        </div>
    </div>
    <ContextMenu :options="options" :element="sidebarContextMenuElement" v-model:show="showContextMenu" @click="handleClick" />
</template>

<script>
import SidebarItem from './SidebarItem.vue'
import ContextMenu from './ContextMenu.vue'
import { mapState } from 'vuex'

export default {
    components: {
        SidebarItem,
        ContextMenu
    },
    data() {
        return {
            showContextMenu: false
        }
    },
    computed: {
        sidebarItems() {
            return this.$store.getters.collectionTreeFiltered
        },
        collectionFilter: {
            get() {
                return this.$store.state.collectionFilter
            },
            set(value) {
                this.$store.commit('setCollectionFilter', value)
            }
        },
        ...mapState(['activeSidebarItemForContextMenu', 'sidebarContextMenuElement']),
        options() {
            if(this.activeSidebarItemForContextMenu === null) {
                return []
            }

            if(this.activeSidebarItemForContextMenu._type === 'request') {
                return [
                    {
                        'type': 'option',
                        'label': 'Duplicate',
                        'value': 'Duplicate',
                        'icon': 'fa fa-copy',
                    },
                    {
                        'type': 'option',
                        'label': 'Delete',
                        'value': 'Delete',
                        'icon': 'fa fa-trash',
                    },
                    {
                        'type': 'separator'
                    },
                    {
                        'type': 'option',
                        'label': 'Settings',
                        'value': 'Settings',
                        'icon': 'fa fa-wrench',
                    }
                ]
            }

            if(this.activeSidebarItemForContextMenu._type === 'request_group') {
                return [
                    {
                        'type': 'option',
                        'label': 'New Request',
                        'value': 'New Request',
                        'icon': 'fa fa-plus-circle',
                    },
                    {
                        'type': 'option',
                        'label': 'New Folder',
                        'value': 'New Folder',
                        'icon': 'fa fa-folder',
                    },
                    {
                        'type': 'separator'
                    },
                    {
                        'type': 'option',
                        'label': 'Duplicate',
                        'value': 'Duplicate',
                        'icon': 'fa fa-copy',
                    },
                    {
                        'type': 'option',
                        'label': 'Environment',
                        'value': 'Environment',
                        'icon': 'fa fa-code',
                    },
                    {
                        'type': 'option',
                        'label': 'Delete',
                        'value': 'Delete',
                        'icon': 'fa fa-trash',
                    },
                    {
                        'type': 'separator'
                    },
                    {
                        'type': 'option',
                        'label': 'Settings',
                        'value': 'Settings',
                        'icon': 'fa fa-wrench',
                    }
                ]
            }
        }
    },
    watch: {
        activeSidebarItemForContextMenu() {
            if(this.activeSidebarItemForContextMenu) {
                this.showContextMenu = true
            }
        },
        showContextMenu() {
            if(this.showContextMenu === false) {
                this.$store.commit('clearActiveSidebarItemForContextMenu')
            }
        }
    },
    methods: {
        handleClick(clickedSidebarItem) {
            if(clickedSidebarItem === 'Delete') {
                if(confirm('Are you sure?')) {
                    this.$store.dispatch('deleteCollectionItem', this.activeSidebarItemForContextMenu)
                }
            }
            this.showContextMenu = false
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
    display: flex;
    align-items: center;
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

.sidebar .sidebar-item-method {
    width: 1.5rem;
    font-size: 0.7rem;
    margin-right: 0.4rem;
}
</style>
