<script setup>
import WorkspacesFrame from '@/components/WorkspacesFrame.vue'
import Frame from '@/components/Frame.vue'
import ReloadPrompt from '@/components/ReloadPrompt.vue'
import { nanoid } from 'nanoid'
</script>

<template>
    <WorkspacesFrame v-if="activeWorkspace === null" />
    <Frame v-if="activeWorkspace" />
    <ReloadPrompt />
</template>

<script>
import { db } from './db'
import constants from './constants'

export default {
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        }
    },
    watch: {
        activeTab: {
            handler() {
                this.$store.commit('persistActiveTab')
            },
            deep: true
        },
        async activeWorkspace() {
            if(this.activeWorkspace) {
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.ACTIVE_WORKSPACE_ID, this.activeWorkspace._id)
            } else {
                localStorage.removeItem(constants.LOCAL_STORAGE_KEY.ACTIVE_WORKSPACE_ID)
            }
            await this.fetchSetCollectionForWorkspace()
        }
    },
    methods: {
        async fetchSetCollectionForWorkspace() {
            if(!this.activeWorkspace) {
                this.$store.commit('setCollection', [])
                return
            }

            const collections = await db.collections.where({ workspaceId: this.activeWorkspace._id }).toArray()

            if(collections.length > 0) {
                this.$store.commit('setCollection', collections)
            }
        }
    },
    async created() {
        this.$store.dispatch('loadPlugins')
        await this.$store.dispatch('loadWorkspaces')
        await this.fetchSetCollectionForWorkspace()
    }
}
</script>

<style lang="scss">
@import '@/styles/normalize.css';
@import '@/styles/reset.css';
@import '@/styles/main.css';
</style>
