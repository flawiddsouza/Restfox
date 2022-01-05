<script>
import { arrayMove } from '@/helpers'

export default {
    data() {
        return {
            draggedTabElement: null,
            indexOfDraggedTab: null
        }
    },
    computed: {
        tabs() {
            return this.$store.state.tabs
        },
        activeTab() {
            return this.$store.state.activeTab
        }
    },
    methods: {
        setActiveTab(tab) {
            this.$store.commit('setActiveTab', tab)
        },
        closeTab(tab) {
            this.$store.commit('closeTab', tab._id)
        },
        dragStart(event) {
            this.draggedTabElement = event.target.closest('.tab')
            if(!this.draggedTabElement) {
                return
            }
            this.indexOfDraggedTab = this.tabs.findIndex(item => item._id === this.draggedTabElement.dataset.id)
            this.setActiveTab(this.tabs[this.indexOfDraggedTab])
            this.draggedTabElement.style.background = 'white'
            this.draggedTabElement.style.opacity = '0.5'
        },
        dragEnd(event) {
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
                tabToDropOn.style.background = '#ffc0cb1f'
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
            }
        }
    },
    mounted() {
        document.addEventListener('dragstart', this.dragStart)
        document.addEventListener('dragend', this.dragEnd)
        document.addEventListener('dragover', this.dragOver)
        document.addEventListener('dragenter', this.dragEnter)
        document.addEventListener('dragleave', this.dragLeave)
        document.addEventListener('drop', this.drop)
    },
    onUnmounted() {
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
    <div class="tabs-container">
        <div
            class="tab"
            :class="{ 'tab-active': activeTab && activeTab._id === tab._id }"
            v-for="tab in tabs"
            @click="setActiveTab(tab)"
            @mousedown.middle.prevent="closeTab(tab)"
            :data-id="tab._id"
            draggable="true"
        >
            <span :class="`request-method--${tab.method}`">{{ tab.method }}</span> {{ tab.name }}
            <span style="margin-left: 0.5rem" @click.stop="closeTab(tab)" class="tab-close">x</span>
        </div>
    </div>
    <div class="tab-add" @click="addTab" style="visibility: hidden">+</div>
</template>

<style scoped>
.tab-bar .tabs-container {
    display: flex;
    flex-basis: fit-content;
    overflow-y: auto;
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
