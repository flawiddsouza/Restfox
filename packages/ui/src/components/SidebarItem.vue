<template>
    <div
        class="sidebar-item"
        :class="{ 'sidebar-item-active': activeTab && sidebarItem._id === activeTab._id }"
        @click="handleSidebarItemClick(sidebarItem)"
        @dblclick="handleSidebarItemDoubleClick(sidebarItem)"
        @contextmenu.prevent="handleContextMenu(sidebarItem, $event)"
        :draggable="collectionFilter === '' ? true : false"
        :data-parent-id="sidebarItem.parentId"
        :data-id="sidebarItem._id"
        :data-type="sidebarItem._type"
    >
        <template v-if="sidebarItem._type === 'request_group'">
            <div style="margin-right: 0.3rem">
                <i class="fa space-right fa-folder-open" v-if="getSidebarItemExpandedState(sidebarItem)"></i>
                <i class="fa space-right fa-folder" v-else></i>
            </div>
        </template>
        <template v-if="sidebarItem._type === 'request'">
            <div class="sidebar-item-method" :class="`request-method--${sidebarItem.method}`">{{ getMethodShortName(sidebarItem.method) }}</div>
        </template>
        <template v-if="sidebarItem._type === 'socket'">
            <div class="sidebar-item-method" :class="`request-method--SOCK`">SOCK</div>
        </template>
        <div style="width: 100%; margin-right: 0.5rem">
            <div v-if="!showInputToRenameRequest">
                {{ sidebarItem.name }}
                <span v-if="sidebarItem.name === ''" style="visibility: hidden;">Empty Name</span>
            </div>
            <input
                type="text"
                v-model="newSidebarItemName"
                @input="updateTemporarySidebarItemName"
                style="pointer-events: auto; border: 0; outline: 0; width: 100%; padding: 0; background-color: inherit; font-style: italic;"
                spellcheck="false"
                @keydown.enter="saveSidebarItemName(sidebarItem); showInputToRenameRequest = false;"
                @keydown.esc="cancelSidebarItemNameRename()"
                @blur="saveSidebarItemName(sidebarItem)"
                @dblclick.stop
                v-focus
                v-else
            >
        </div>
        <div class="clickable-context-menu" v-if="!showInputToRenameRequest">
            <i class="fa fa-ellipsis-v" @click.stop="handleContextMenu(sidebarItem, $event)"></i>
        </div>
    </div>
    <div class="sidebar-list" v-if="'children' in sidebarItem && sidebarItem.children.length && getSidebarItemExpandedState(sidebarItem)">
        <template v-for="sidebarItem1 in sidebarItem.children" :key="sidebarItem1._id">
            <SidebarItem :sidebar-item="sidebarItem1" />
        </template>
    </div>
</template>

<script>
import { findItemInTreeById } from '../helpers'

export default {
    name: 'SidebarItem',
    directives: {
        focus: {
            mounted(element) {
                element.focus()
                element.select()
            }
        }
    },
    props: {
        sidebarItem: {
            type: Object,
            required: true
        }
    },
    data() {
        return {
            showInputToRenameRequest: false,
            newSidebarItemName: null
        }
    },
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        },
        collectionFilter() {
            return this.$store.state.collectionFilter
        }
    },
    methods: {
        getMethodShortName(method) {
            const methods = {
                'DELETE':  'DEL',
                'PATCH':   'PTCH',
                'OPTIONS': 'OPT',
            }

            return methods[method] || method
        },
        handleSidebarItemClick(sidebarItem) {
            if(sidebarItem._type === 'request' || sidebarItem._type === 'socket') {
                this.$store.commit('addTab', sidebarItem)
            }

            if(sidebarItem._type === 'request_group') {
                sidebarItem.collapsed = !(sidebarItem.collapsed)
                this.$store.dispatch('saveCollectionItemCollapsedState', { _id: sidebarItem._id, collapsed: sidebarItem.collapsed })
            }
        },
        handleSidebarItemDoubleClick(sidebarItem) {
            if(sidebarItem._type === 'request' || sidebarItem._type === 'socket') {
                this.newSidebarItemName = sidebarItem.name
                this.showInputToRenameRequest = true
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
        },
        saveSidebarItemName(sidebarItem) {
            if(!this.showInputToRenameRequest) {
                return
            }

            this.$store.commit('updateCollectionItemName', {
                _id: sidebarItem._id,
                _type: sidebarItem._type,
                name: this.newSidebarItemName
            })

            const sidebarItemToUpdate = findItemInTreeById(this.$store.state.collectionTree, sidebarItem._id)
            if(sidebarItemToUpdate) {
                sidebarItemToUpdate.name = this.newSidebarItemName
            }

            const tab = this.$store.state.tabs.find(tab => tab._id === sidebarItem._id)
            if(tab) {
                tab.name = this.newSidebarItemName
            }

            delete this.$store.state.sidebarItemTemporaryName[this.sidebarItem._id]
            this.newSidebarItemName = null
            this.showInputToRenameRequest = false
        },
        updateTemporarySidebarItemName() {
            this.$store.state.sidebarItemTemporaryName[this.sidebarItem._id] = this.newSidebarItemName
        },
        cancelSidebarItemNameRename() {
            delete this.$store.state.sidebarItemTemporaryName[this.sidebarItem._id]
            this.showInputToRenameRequest = false
        }
    }
}
</script>
