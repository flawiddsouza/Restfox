<script>
export default {
    data() {
        return {
            tabs: [],
            activeTabId: null
        }
    },
    methods: {
        addTab() {
            const tabId = this.tabs.length + 1
            this.tabs.push({
                id: tabId,
                title: 'Tab ' + tabId
            })
            this.setActiveTab(tabId)
        },
        setActiveTab(tabId) {
            this.activeTabId = tabId
        },
        closeTab(tabIndex) {
            this.tabs.splice(tabIndex, 1)
        }
    }
}
</script>

<template>
    <div class="tabs-container">
        <div
            class="tab"
            :class="{ 'tab-active': activeTabId === tab.id }"
            v-for="(tab, tabIndex) in tabs"
            @click="setActiveTab(tab.id)"
        >
            {{ tab.title }}
            <span style="margin-left: 0.5rem" @click="closeTab(tabIndex)">x</span>
        </div>
    </div>
    <div class="tab-add" @click="addTab">+</div>
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
