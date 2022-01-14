<template>
    <div class="navbar">
        <div class="heading">
            <div v-if="activeWorkspace === null">Workspaces</div>
            <template v-else>
                <a href="#" @click.prevent="setActiveWorkspace(null)">Workspaces</a> > <span>{{ activeWorkspace.name }}</span>
            </template>
        </div>
        <div v-if="nav === 'collection'">
            <a href="#" @click.prevent="this.$store.commit('showImportModal', true)">Import</a>
            <span class="spacer"></span>
            <a href="#" @click.prevent="clearCollection">Clear Collection</a>
        </div>
    </div>
</template>

<script>
export default {
    props: {
        nav: String,
        required: false
    },
    computed: {
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        }
    },
    methods: {
        clearCollection() {
            if(confirm('Are you sure?')) {
                this.$store.commit('clearCollection')
            }
        },
        setActiveWorkspace(workspace) {
            this.$store.commit('setActiveWorkspace', workspace)
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

.heading {
    font-weight: 500;
}

.heading a:not(:hover) {
    text-decoration: none;
}
</style>
