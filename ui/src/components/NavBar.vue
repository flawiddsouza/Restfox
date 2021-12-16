<template>
    <div class="navbar">
        <div>
            <!-- <a href="#">Dashboard</a> > <span>My Collection</span> -->
            <h3 class="heading">Restfox</h3>
        </div>
        <div>
            <a href="#" @click.prevent="this.$store.commit('showImportModal', true)">Import</a>
        </div>
    </div>
</template>

<style scoped>
.navbar {
    padding-top: 0.5em;
    padding-bottom: 0.5em;
    padding-left: 1em;
    padding-right: 1em;
    display: flex;
    justify-content: space-between;
}
</style>
