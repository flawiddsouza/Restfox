<script>
import ContextMenu from './ContextMenu.vue'
import { arrayMove } from '@/helpers'

export default {
    components: {
        ContextMenu
    },
    data() {
        return {
            draggedTabElement: null,
            indexOfDraggedTab: null,
            tabContextMenuElement: null,
            tabContextMenuTab: null,
            showTabContextMenu: false,
            tabsContextMenuList: [
                {
                    'type': 'option',
                    'label': 'Move to New Window',
                    'value': 'Move to New Window'
                },
                {
                    'type': 'separator'
                },
                {
                    'type': 'option',
                    'label': 'Close',
                    'value': 'Close'
                },
                {
                    'type': 'option',
                    'label': 'Close All',
                    'value': 'Close All'
                },
            ]
        }
    },
    computed: {
        tabs() {
            return this.$store.state.tabs
        },
        activeTab() {
            return this.$store.state.activeTab
        },
        sidebarItemTemporaryName() {
            return this.$store.state.sidebarItemTemporaryName
        },
        tabContextMenuOptions() {
            if (this.tabs.length === 1) {
                return this.tabsContextMenuList
            } else {
                return [
                    {
                        'type': 'option',
                        'label': 'Move to New Window',
                        'value': 'Move to New Window'
                    },
                    {
                        'type': 'separator'
                    },
                    {
                        'type': 'option',
                        'label': 'Close',
                        'value': 'Close'
                    },
                    {
                        'type': 'option',
                        'label': 'Close Others',
                        'value': 'Close Others',
                    },
                    {
                        'type': 'option',
                        'label': 'Close All',
                        'value': 'Close All'
                    },
                ]
            }
        }
    },
    methods: {
        setActiveTab(tab) {
            this.$store.dispatch('setActiveTab', tab)
        },
        closeTab(tab, persist = true) {
            this.$store.commit('closeTab', tab._id)

            if(persist) {
                this.$store.commit('persistActiveWorkspaceTabs')
            }
        },
        dragStart(event) {
            this.draggedTabElement = event.target.closest('.tab')
            if(!this.draggedTabElement) {
                return
            }
            this.indexOfDraggedTab = this.tabs.findIndex(item => item._id === this.draggedTabElement.dataset.id)
            this.setActiveTab(this.tabs[this.indexOfDraggedTab])
            this.draggedTabElement.style.background = 'var(--background-color)'
            this.draggedTabElement.style.opacity = '0.5'
        },
        dragEnd() {
            if(!this.draggedTabElement) {
                return
            }
            this.draggedTabElement.style.background = ''
            this.draggedTabElement.style.opacity = ''
        },
        dragOver(event) {
            if(!this.draggedTabElement) {
                return
            }
            event.preventDefault()
        },
        dragEnter(event) {
            if(!this.draggedTabElement) {
                return
            }
            const tabToDropOn = event.target.closest('.tab')
            if(tabToDropOn) {
                tabToDropOn.classList.add('disable-pointer-events')
                tabToDropOn.style.background = 'var(--drop-target-background-color)'
            }
        },
        dragLeave(event) {
            if(!this.draggedTabElement) {
                return
            }
            const tabToDropOn = event.target.closest('.tab')
            if(tabToDropOn) {
                tabToDropOn.classList.remove('disable-pointer-events')
                tabToDropOn.style.background = ''
            }
        },
        drop(event) {
            if(!this.draggedTabElement) {
                return
            }
            event.preventDefault()
            const tabToDropOn = event.target.closest('.tab')
            if(tabToDropOn) {
                tabToDropOn.style.background = ''
                const indexOfTabToDropOn = this.tabs.findIndex(item => item._id === tabToDropOn.dataset.id)
                arrayMove(this.tabs, this.indexOfDraggedTab, indexOfTabToDropOn)
                this.$store.commit('persistActiveWorkspaceTabs')
            }
        },
        handleTabContextMenu(event, tab) {
            this.tabContextMenuElement = event.target
            this.tabContextMenuTab = tab
            this.showTabContextMenu = true
        },
        handleTabContextMenuItemClick(clickedContextMenuitem) {
            if(clickedContextMenuitem === 'Move to New Window') {
                this.$store.commit('detachTab', this.tabContextMenuTab)
                this.closeTab(this.tabContextMenuTab, true)
            }

            if(clickedContextMenuitem === 'Close') {
                this.closeTab(this.tabContextMenuTab)
            }

            if(clickedContextMenuitem === 'Close Others') {
                this.tabs.filter(tab => tab._id !== this.tabContextMenuTab._id).forEach(tab => {
                    this.closeTab(tab, false)
                })
                this.$store.commit('persistActiveWorkspaceTabs')
            }

            if(clickedContextMenuitem === 'Close All') {
                this.$store.commit('closeAllTabs')
            }
        },
        getTabMethodName(tab) {
            if(tab._type === 'request') {
                return tab.method
            }

            if(tab._type === 'socket') {
                return 'SOCK'
            }
        },
        scrollTabs(event) {
            this.$refs.tabContainer.scrollLeft += event.deltaY
        },
    },
    mounted() {
        document.addEventListener('dragstart', this.dragStart)
        document.addEventListener('dragend', this.dragEnd)
        document.addEventListener('dragover', this.dragOver)
        document.addEventListener('dragenter', this.dragEnter)
        document.addEventListener('dragleave', this.dragLeave)
        document.addEventListener('drop', this.drop)
    },
    unmounted() {
        document.removeEventListener('dragstart', this.dragStart)
        document.removeEventListener('dragend', this.dragEnd)
        document.removeEventListener('dragover', this.dragOver)
        document.removeEventListener('dragenter', this.dragEnter)
        document.removeEventListener('dragleave', this.dragLeave)
        document.removeEventListener('drop', this.drop)
    }
}
</script>

<template>
    <div
        class="tabs-container"
        ref="tabContainer"
        @wheel.prevent="scrollTabs"
    >
        <div
            class="tab"
            :class="{ 'tab-active': activeTab && activeTab._id === tab._id }"
            v-for="tab in tabs"
            @click="setActiveTab(tab)"
            @mousedown.middle.prevent="closeTab(tab)"
            :data-id="tab._id"
            draggable="true"
            @contextmenu.prevent="handleTabContextMenu($event, tab)"
        >
            <span :class="`request-method--${getTabMethodName(tab)}`">{{ getTabMethodName(tab) }}</span> <template v-if="tab._id in sidebarItemTemporaryName">{{ sidebarItemTemporaryName[tab._id] }}</template><template v-else>{{ tab.name }}</template>
            <span style="margin-left: 0.5rem" @click.stop="closeTab(tab)" class="tab-close"><i class="fas fa-times"></i></span>
        </div>
    </div>
    <!-- <div class="tab-add" @click="addTab" style="visibility: hidden">+</div> -->
    <ContextMenu :options="tabContextMenuOptions" :element="tabContextMenuElement" v-model:show="showTabContextMenu" @click="handleTabContextMenuItemClick" />
</template>

<style scoped>
.tab-bar .tabs-container {
    display: flex;
    flex-basis: fit-content;
    overflow-y: auto;
    cursor: pointer;
}

.tab-bar .tab {
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
    padding-left: 0.7rem;
    padding-right: 0.7rem;
    border-right: 1px solid var(--default-border-color);
    border-top: 1px solid transparent;
    border-bottom: 1px solid transparent;
    white-space: nowrap;
}

.tab-bar .tab.disable-pointer-events * {
    pointer-events: none;
}

.tab-bar .tab-active {
    border-top: 1px solid red;
    border-bottom: 1px solid transparent;
}

.tab-bar .tab-add {
    display: flex;
    justify-content: center;
    align-items: center;
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
    padding-left: 1rem;
    padding-right: 1rem;
    border-top: 1px solid transparent;
    border-bottom: 1px solid transparent;
}
</style>
