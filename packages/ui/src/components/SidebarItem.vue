<template>
    <div
        class="sidebar-item"
        :class="{ 'sidebar-item-active': activeTab && sidebarItem._id === activeTab._id }"
        @click="handleSidebarItemClick($event, sidebarItem)"
        @dblclick="handleSidebarItemDoubleClick(sidebarItem)"
        @contextmenu.prevent="handleContextMenu(sidebarItem, $event)"
        :draggable="collectionFilter === '' && !showInputToRenameRequest ? true : false"
        :data-parent-id="sidebarItem.parentId"
        :data-id="sidebarItem._id"
        :data-type="sidebarItem._type"
        :title="!showInputToRenameRequest ? sidebarItem.name : 'Press Enter to save, Esc to cancel'"
    >
        <template v-if="sidebarItem._type === 'request_group'">
            <div style="margin-right: 0.3rem" class="request-group-toggle">
                <i class="fa space-right fa-folder-open" v-if="getSidebarItemExpandedState(sidebarItem)"></i>
                <i class="fa space-right fa-folder" v-else></i>
            </div>
        </template>
        <template v-if="sidebarItem._type === 'request'">
            <div class="sidebar-item-method" :class="`request-method--${isGqlRequest(sidebarItem) ? 'GQL' : sidebarItem.method}`">{{ getMethodShortName(isGqlRequest(sidebarItem) ? 'GQL' : sidebarItem.method) }}</div>
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
                ref="updateSidebarItemNameInput"
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
                'GRAPHQL': 'GQL'
            }

            return methods[method] || method
        },
        handleSidebarItemClick(event, sidebarItem) {
            if(sidebarItem._type === 'request' || sidebarItem._type === 'socket') {
                this.$store.dispatch('addTab', sidebarItem)
            }

            if(sidebarItem._type === 'request_group') {
                sidebarItem.collapsed = !(sidebarItem.collapsed)
                this.$store.dispatch('saveCollectionItemCollapsedState', { _id: sidebarItem._id, collapsed: sidebarItem.collapsed })

                if(event.target.closest('.request-group-toggle')) {
                    return
                }

                this.$store.dispatch('addTab', sidebarItem)
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
        async saveSidebarItemName(sidebarItem) {
            if(!this.showInputToRenameRequest) {
                return
            }

            if(this.newSidebarItemName.trim() === '') {
                this.$toast.error('Name cannot be empty')
                this.$refs.updateSidebarItemNameInput.focus()
                return
            }

            const result = await this.$store.dispatch('updateCollectionItemName', {
                _id: sidebarItem._id,
                _type: sidebarItem._type,
                name: this.newSidebarItemName
            })

            if(!result.error) {
                const sidebarItemToUpdate = findItemInTreeById(this.$store.state.collectionTree, sidebarItem._id)
                if(sidebarItemToUpdate) {
                    sidebarItemToUpdate.name = this.newSidebarItemName
                }

                const tab = this.$store.state.tabs.find(tab => tab._id === sidebarItem._id)
                if(tab) {
                    if(tab === this.activeTab) {
                        this.$store.state.skipPersistingActiveTab = true
                    }
                    tab.name = this.newSidebarItemName
                }
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
        },
        isGqlRequest(request) {
            return request.body.mimeType === 'application/graphql'
        }
    }
}
</script>
