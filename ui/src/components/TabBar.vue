<template>
    <div class="tab" :class="{ 'tab-active': i === 1 }" v-for="i in 20">Tab {{ i }}</div>
    <div class="tab-add">+</div>
    <div class="tab-fill"></div>
</template>

<style scoped>
.tab-bar .tab {
    padding-top: 0.3em;
    padding-bottom: 0.3em;
    padding-left: 0.7em;
    padding-right: 0.7em;
    border-right: 1px solid lightgrey;
    border-top: 1px solid transparent;
    border-bottom: 1px solid lightgrey;
    white-space: nowrap;
}

.tab-bar .tab-active {
    border-top: 1px solid red;
    border-bottom: 1px solid transparent;
}

.tab-bar .tab-add {
    padding-top: 0.3em;
    padding-bottom: 0.3em;
    padding-left: 0.7em;
    padding-right: 0.7em;
    border-bottom: 1px solid lightgrey;
}

.tab-bar .tab-fill {
    width: 100%;
    border-bottom: 1px solid lightgrey;
}
</style>
