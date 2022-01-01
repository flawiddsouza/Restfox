<template>
    <div class="sidebar-filter">
        <input type="search" placeholder="Filter" spellcheck="false" v-model="collectionFilter">
    </div>
    <div class="sidebar-list-container" @contextmenu.prevent="handleSidebarEmptyAreaContextMenu">
        <div class="sidebar-list">
            <template v-for="sidebarItem in sidebarItems">
                <sidebar-item :sidebar-item="sidebarItem" />
            </template>
        </div>
    </div>
    <ContextMenu :options="options" :element="sidebarContextMenuElement" v-model:show="showContextMenu" @click="handleClick" :x="contextMenuX" :y="contextMenuY" />
    <AddRequestModal v-model:showModal="addRequestModalShow" :parent-id="addRequestModalParentId" />
    <AddFolderModal v-model:showModal="addFolderModalShow" :parent-id="addFolderModalParentId" />
    <EnvironmentModal v-model:showModal="environmentModalShow" :collection-item="environmentModalCollectionItem" />
</template>

<script>
import SidebarItem from './SidebarItem.vue'
import ContextMenu from './ContextMenu.vue'
import AddRequestModal from './modals/AddRequestModal.vue'
import AddFolderModal from './modals/AddFolderModal.vue'
import EnvironmentModal from './modals/EnvironmentModal.vue'
import { mapState } from 'vuex'

export default {
    components: {
        SidebarItem,
        ContextMenu,
        AddRequestModal,
        AddFolderModal,
        EnvironmentModal
    },
    data() {
        return {
            showContextMenu: false,
            addRequestModalShow: false,
            addRequestModalParentId: null,
            addFolderModalShow: false,
            addFolderModalParentId: null,
            contextMenuX: null,
            contextMenuY: null,
            enableOptionsForEmptyContextMenu: false,
            environmentModalShow: false,
            environmentModalCollectionItem: null
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
            if(this.enableOptionsForEmptyContextMenu) {
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
                    }
                ]
            }

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
                this.contextMenuX = null
                this.contextMenuY = null
                this.enableOptionsForEmptyContextMenu = false
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

            if(clickedSidebarItem === 'Duplicate') {
                this.$store.dispatch('duplicateCollectionItem', this.activeSidebarItemForContextMenu)
            }

            if(clickedSidebarItem === 'New Request') {
                this.addRequestModalParentId = this.activeSidebarItemForContextMenu ? this.activeSidebarItemForContextMenu._id : null
                this.addRequestModalShow = true
            }

            if(clickedSidebarItem === 'New Folder') {
                this.addFolderModalParentId = this.activeSidebarItemForContextMenu ? this.activeSidebarItemForContextMenu._id : null
                this.addFolderModalShow = true
            }

            if(clickedSidebarItem === 'Environment') {
                this.environmentModalCollectionItem = this.activeSidebarItemForContextMenu
                this.environmentModalShow = true
            }

            this.showContextMenu = false
        },
        handleSidebarEmptyAreaContextMenu(event) {
            if(event.target.classList.contains('sidebar-list-container') === false) {
                return
            }
            this.contextMenuX = event.pageX
            this.contextMenuY = event.pageY
            this.enableOptionsForEmptyContextMenu = true
            this.showContextMenu = true
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
