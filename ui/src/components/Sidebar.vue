<template>
    <div class="sidebar-filter">
        <input type="search" placeholder="Filter" spellcheck="false">
    </div>
    <div class="sidebar-list-container">
        <div class="sidebar-list">
            <template v-for="i in 100">
                <div class="sidebar-item">Sidebar Item {{ i }}</div>
                <template v-if="i % 3 === 0">
                    <div class="sidebar-list">
                        <template v-for="j in 5">
                            <div class="sidebar-item">Sidebar Item {{ j }}</div>
                            <template v-if="j % 2 === 0">
                                <div class="sidebar-list">
                                    <template v-for="k in 5">
                                        <div class="sidebar-item">Sidebar Item {{ k }}</div>
                                    </template>
                                </div>
                            </template>
                        </template>
                    </div>
                </template>
            </template>
        </div>
    </div>
</template>

<style scoped>
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
    padding-bottom: 1rem;
}

.sidebar .sidebar-item {
    padding-top: 0.4rem;
    padding-bottom: 0.4rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.sidebar .sidebar-list > .sidebar-item {
    padding-left: calc(1rem * 0.6);
}

/* handle nested sidebar lists */
.sidebar .sidebar-list > .sidebar-list {
    padding-left: calc(1rem * 1.2);
}
</style>
