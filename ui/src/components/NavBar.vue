<template>
    <div class="navbar">
        <div>
            <!-- <a href="#">Dashboard</a> > <span>My Collection</span> -->
            <h3 class="heading">Restfox</h3>
        </div>
        <div>
            <a href="#" @click.prevent="this.$store.commit('showImportModal', true)">Import</a>
            <span class="spacer"></span>
            <a href="#" @click.prevent="clearCollection">Clear Collection</a>
        </div>
    </div>
</template>

<script>
export default {
    methods: {
        clearCollection() {
            if(confirm('Are you sure?')) {
                this.$store.commit('clearCollection')
            }
        }
    }
}
</script>

<style scoped>
.navbar {
    padding-top: 0.5em;
    padding-bottom: 0.5em;
    padding-left: 1em;
    padding-right: 1em;
    display: flex;
    justify-content: space-between;
}

.spacer {
    margin-left: 1rem;
}
</style>
