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
        <div
            v-if="shouldShowEnvironmentQuickSwitcher(sidebarItem) && !showInputToRenameRequest"
            class="folder-env-switcher"
            @click.stop="toggleFolderEnvSwitcher($event, sidebarItem)"
            :title="`Environment: ${currentEnvironment.name}`"
        >
            <i
                class="fa fa-circle"
                :style="{ color: currentEnvironment.color }"
            ></i>
        </div>
        <div class="clickable-context-menu" v-if="!showInputToRenameRequest">
            <i class="fa fa-ellipsis-v" @click.stop="handleContextMenu(sidebarItem, $event)"></i>
        </div>
    </div>
    <ContextMenu
        :options="environmentOptions"
        :element="envSwitcherTarget?.element"
        v-model:show="showEnvSwitcher"
        :selected-option="currentEnvironment.name"
        @click="selectFolderEnv"
    />
    <div class="sidebar-list" v-if="'children' in sidebarItem && sidebarItem.children.length && getSidebarItemExpandedState(sidebarItem)">
        <template v-for="sidebarItem1 in sidebarItem.children" :key="sidebarItem1._id">
            <SidebarItem :sidebar-item="sidebarItem1" />
        </template>
    </div>
</template>

<script>
import { findItemInTreeById } from '../helpers'
import ContextMenu from './ContextMenu.vue'
import constants from '@/constants'

export default {
    name: 'SidebarItem',
    components: {
        ContextMenu
    },
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
            newSidebarItemName: null,
            showEnvSwitcher: false,
            envSwitcherTarget: null
        }
    },
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        },
        collectionFilter() {
            return this.$store.state.collectionFilter
        },
        currentEnvironment() {
            const envName = this.sidebarItem.currentEnvironment || constants.DEFAULT_ENVIRONMENT.name
            return this.sidebarItem.environments?.find(env => env.name === envName) || constants.DEFAULT_ENVIRONMENT
        },
        environmentOptions() {
            if (!this.sidebarItem.environments?.length) {
                return []
            }

            return [
                {
                    type: 'option',
                    label: 'Environment',
                    icon: 'fa fa-globe',
                    disabled: true,
                    class: 'text-with-line'
                },
                ...this.sidebarItem.environments.map(env => ({
                    type: 'option',
                    label: `<i class="fa fa-circle" style="color:${env.color}"></i>&nbsp;&nbsp;${env.name}`,
                    value: env.name,
                    class: 'context-menu-item-with-left-padding'
                }))
            ]
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
        },
        shouldShowEnvironmentQuickSwitcher(sidebarItem) {
            return sidebarItem._type === 'request_group' && sidebarItem.environments?.length >= 2
        },
        toggleFolderEnvSwitcher(event, sidebarItem) {
            this.showEnvSwitcher = !this.showEnvSwitcher
            this.envSwitcherTarget = this.showEnvSwitcher
                ? { element: event.target.closest('.folder-env-switcher'), sidebarItem }
                : null
        },
        selectFolderEnv(envName) {
            if (!this.envSwitcherTarget) {
                return
            }

            const { sidebarItem } = this.envSwitcherTarget
            const selectedEnv = sidebarItem.environments.find(env => env.name === envName)

            // Update local state
            sidebarItem.currentEnvironment = envName
            if (selectedEnv) {
                sidebarItem.environment = selectedEnv.environment
            }

            // Update store
            this.$store.commit('updateCollectionItemCurrentEnvironment', {
                collectionId: sidebarItem._id,
                currentEnvironment: envName
            })

            if (selectedEnv) {
                this.$store.commit('updateCollectionItemEnvironment', {
                    collectionId: sidebarItem._id,
                    environment: selectedEnv.environment
                })
            }

            this.$store.dispatch('reloadTabEnvironmentResolved')

            // Reset state
            this.showEnvSwitcher = false
            this.envSwitcherTarget = null
        }
    }
}
</script>

<style scoped>
.folder-env-switcher {
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    right: 2.2rem;
    top: 50%;
    transform: translateY(-50%);
    cursor: pointer;
    padding: 0.2rem 0.3rem;
    border-radius: 3px;
    color: var(--text-color);
    font-size: 0.75rem;
    z-index: 2;
    background-color: transparent;
    transition: background-color 0.1s ease;
}

.folder-env-switcher:hover {
    background-color: var(--sidebar-item-active-color);
}

.sidebar-item .folder-env-switcher i {
    pointer-events: auto;
    line-height: 1;
}
</style>
