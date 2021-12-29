<script>
export default {
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
        }
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
        >
            <span :class="`request-method--${tab.method}`">{{ tab.method }}</span> {{ tab.name }}
            <span style="margin-left: 0.5rem" @click.prevent="closeTab(tab)">x</span>
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
