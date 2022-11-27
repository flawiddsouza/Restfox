<template>
    <div class="sidebar-filter">
        <input type="search" placeholder="Filter" spellcheck="false" v-model="collectionFilter">
    </div>
    <div class="sidebar-list-container" @contextmenu.prevent="handleSidebarEmptyAreaContextMenu">
        <div class="sidebar-list">
            <template v-for="sidebarItem in sidebarItems" :key="sidebarItem._id">
                <sidebar-item :sidebar-item="sidebarItem" />
            </template>
        </div>
        <div v-if="sidebarItems.length === 0" class="sidebar-empty-message">
            <template v-if="collectionFilter === ''">
                You can right click here to create a new request or a new folder
            </template>
            <template v-else>
                No results found
            </template>
        </div>
    </div>
    <ContextMenu :options="options" :element="sidebarContextMenuElement" v-model:show="showContextMenu" @click="handleClick" :x="contextMenuX" :y="contextMenuY" :x-offset="20" />
    <AddRequestModal v-model:showModal="addRequestModalShow" :parent-id="addRequestModalParentId" />
    <AddFolderModal v-model:showModal="addFolderModalShow" :parent-id="addFolderModalParentId" />
    <EnvironmentModal v-model:showModal="environmentModalShow" :collection-item="environmentModalCollectionItem" />
    <PluginManagerModal v-model:showModal="pluginManagerShow" :collection-item="pluginManagerCollectionItem" />
    <SettingsModal v-model:showModal="settingsModalShow" :collection-item="settingsModalCollectionItem" />
    <DuplicateCollectionItemModal v-model:showModal="showDuplicateCollectionItemModal" :collection-item-to-duplicate="collectionItemToDuplicate" />
</template>

<script>
import SidebarItem from './SidebarItem.vue'
import ContextMenu from './ContextMenu.vue'
import AddRequestModal from './modals/AddRequestModal.vue'
import AddFolderModal from './modals/AddFolderModal.vue'
import EnvironmentModal from './modals/EnvironmentModal.vue'
import PluginManagerModal from './modals/PluginManagerModal.vue'
import SettingsModal from './modals/SidebarSettingsModal.vue'
import DuplicateCollectionItemModal from './modals/DuplicateCollectionItemModal.vue'
import { mapState } from 'vuex'
import { flattenTree, exportRestfoxCollection } from '@/helpers'

export default {
    components: {
        SidebarItem,
        ContextMenu,
        AddRequestModal,
        AddFolderModal,
        EnvironmentModal,
        PluginManagerModal,
        SettingsModal,
        DuplicateCollectionItemModal
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
            environmentModalCollectionItem: null,
            settingsModalShow: false,
            settingsModalCollectionItem: null,
            draggedSidebarElement: null,
            sidebarItemCursorPositition: 'below',
            showDuplicateCollectionItemModal: false,
            collectionItemToDuplicate: null,
            pluginManagerCollectionItem: null,
            pluginManagerShow: false,
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
                    },
                    {
                        'type': 'option',
                        'label': 'Import',
                        'value': 'Import Into',
                        'icon': 'fa fa-upload'
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
                        'label': 'Export',
                        'value': 'Export',
                        'icon': 'fa fa-download'
                    },
                    {
                        'type': 'option',
                        'label': 'Plugins',
                        'value': 'Plugins',
                        'icon': 'fa fa-plug',
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
                        'label': 'Properties',
                        'value': 'Properties',
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
                        'label': 'Export',
                        'value': 'Export',
                        'icon': 'fa fa-download'
                    },
                    {
                        'type': 'option',
                        'label': 'Environment',
                        'value': 'Environment',
                        'icon': 'fa fa-code',
                    },
                    {
                        'type': 'option',
                        'label': 'Plugins',
                        'value': 'Plugins',
                        'icon': 'fa fa-plug',
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
                        'label': 'Import Into',
                        'value': 'Import Into',
                        'icon': 'fa fa-upload'
                    },
                    {
                        'type': 'separator'
                    },
                    {
                        'type': 'option',
                        'label': 'Properties',
                        'value': 'Properties',
                        'icon': 'fa fa-wrench',
                    }
                ]
            }

            return []
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
        async handleClick(clickedSidebarItem) {
            if(clickedSidebarItem === 'Delete') {
                if(confirm('Are you sure?')) {
                    this.$store.dispatch('deleteCollectionItem', this.activeSidebarItemForContextMenu)
                }
            }

            if(clickedSidebarItem === 'Duplicate') {
                this.collectionItemToDuplicate = JSON.parse(JSON.stringify(this.activeSidebarItemForContextMenu))
                this.showDuplicateCollectionItemModal = true
            }

            if(clickedSidebarItem === 'Export') {
                const collectionItemToExport = JSON.parse(JSON.stringify(this.activeSidebarItemForContextMenu))
                collectionItemToExport.parentId = null
                exportRestfoxCollection(flattenTree([collectionItemToExport]))
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

            if(clickedSidebarItem === 'Plugins') {
                this.pluginManagerCollectionItem = JSON.parse(JSON.stringify(this.activeSidebarItemForContextMenu))
                this.pluginManagerShow = true
            }

            if(clickedSidebarItem === 'Import Into') {
                this.$store.commit('showImportModalSelectedRequestGroupId', this.activeSidebarItemForContextMenu ? this.activeSidebarItemForContextMenu._id : null)
                this.$store.commit('showImportModal', true)
            }

            if(clickedSidebarItem === 'Properties') {
                this.settingsModalCollectionItem = this.activeSidebarItemForContextMenu
                this.settingsModalShow = true
            }

            this.showContextMenu = false
        },
        handleSidebarEmptyAreaContextMenu(event) {
            if(this.collectionFilter !== '') {
                return
            }

            if(event.target.classList.contains('sidebar-list-container') === false && event.target.classList.contains('sidebar-empty-message') === false) {
                return
            }
            this.contextMenuX = event.pageX
            this.contextMenuY = event.pageY
            this.enableOptionsForEmptyContextMenu = true
            this.showContextMenu = true
        },
        dragStart(event) {
            if(this.collectionFilter) { // disable drag functionality if collection is being filtered
                return
            }
            this.draggedSidebarElement = event.target.closest('.sidebar-item')
            if(!this.draggedSidebarElement) {
                return
            }
            this.draggedSidebarElement.style.backgroundColor = 'var(--background-color)'
            this.draggedSidebarElement.style.opacity = '0.5'
        },
        dragEnd() {
            if(!this.draggedSidebarElement) {
                return
            }
            this.draggedSidebarElement.style.backgroundColor = ''
            this.draggedSidebarElement.style.opacity = ''
            this.draggedSidebarElement = null
        },
        dragOver(event) {
            if(!this.draggedSidebarElement) {
                return
            }
            const sidebarItemToDropOn = event.target.closest('.sidebar-item')
            if(!sidebarItemToDropOn) {
                return
            }
            const rect = sidebarItemToDropOn.getBoundingClientRect()
            const offset = rect.top + document.body.scrollTop
            const elementHeight = parseFloat(getComputedStyle(sidebarItemToDropOn, null).height.replace('px', ''))
            const y = event.pageY
            const location = Math.abs(offset - y)
            if (location < (elementHeight / 2)) {
                this.sidebarItemCursorPositition = 'top'
                sidebarItemToDropOn.style.borderTop = '1px dashed var(--text-color)'
                sidebarItemToDropOn.style.borderBottom = ''
                sidebarItemToDropOn.style.backgroundColor = ''
            } else {
                this.sidebarItemCursorPositition = 'bottom'
                if(sidebarItemToDropOn.dataset.type === 'request_group') {
                    sidebarItemToDropOn.style.borderTop = ''
                    sidebarItemToDropOn.style.borderBottom = ''
                    sidebarItemToDropOn.style.backgroundColor = 'var(--drop-target-background-color)'
                } else {
                    sidebarItemToDropOn.style.borderTop = ''
                    sidebarItemToDropOn.style.borderBottom = '1px dashed var(--text-color)'
                    sidebarItemToDropOn.style.backgroundColor = ''
                }
            }
            event.preventDefault()
        },
        dragLeave(event) {
            if(!this.draggedSidebarElement) {
                return
            }
            const sidebarItemToDropOn = event.target.closest('.sidebar-item')
            if(sidebarItemToDropOn) {
                sidebarItemToDropOn.style.borderBottom = ''
                sidebarItemToDropOn.style.borderTop = ''
                sidebarItemToDropOn.style.backgroundColor = ''
            }
        },
        drop(event) {
            if(!this.draggedSidebarElement) {
                return
            }
            event.preventDefault()
            const sidebarItemToDropOn = event.target.closest('.sidebar-item')
            if(sidebarItemToDropOn) {
                sidebarItemToDropOn.style.borderTop = ''
                sidebarItemToDropOn.style.borderBottom = ''
                sidebarItemToDropOn.style.backgroundColor = ''

                this.$store.dispatch('reorderCollectionItem', {
                    from: {
                        parentId: this.draggedSidebarElement.dataset.parentId,
                        id: this.draggedSidebarElement.dataset.id
                    },
                    to: {
                        parentId: sidebarItemToDropOn.dataset.parentId,
                        id: sidebarItemToDropOn.dataset.id,
                        type: sidebarItemToDropOn.dataset.type,
                        cursorPosition: this.sidebarItemCursorPositition
                    }
                })

                this.draggedSidebarElement.style.backgroundColor = ''
                this.draggedSidebarElement.style.opacity = ''
                this.draggedSidebarElement = null
            }
        }
    },
    mounted() {
        document.addEventListener('dragstart', this.dragStart)
        document.addEventListener('dragend', this.dragEnd)
        document.addEventListener('dragover', this.dragOver)
        document.addEventListener('dragleave', this.dragLeave)
        document.addEventListener('drop', this.drop)
    },
    unmounted() {
        document.removeEventListener('dragstart', this.dragStart)
        document.removeEventListener('dragend', this.dragEnd)
        document.removeEventListener('dragover', this.dragOver)
        document.removeEventListener('dragleave', this.dragLeave)
        document.removeEventListener('drop', this.drop)
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
    border-top: 1px solid transparent;
    border-bottom: 1px solid transparent;
}

.sidebar .sidebar-item-active {
    background-color: var(--sidebar-item-active-color);
}

.sidebar .sidebar-item:hover {
    background-color: var(--sidebar-item-active-color);
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

.sidebar .sidebar-item * {
    pointer-events: none;
}

.sidebar-empty-message {
    padding-left: 1rem;
    padding-right: 1rem;
    padding-top: 0.5rem;
}
</style>
