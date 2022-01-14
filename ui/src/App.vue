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
        let workspaces = await db.workspaces.toArray()

        if(workspaces.length > 0) {
            this.$store.commit('setWorkspaces', workspaces)
            this.$store.commit('setActiveWorkspace', workspaces[0])
        } else {
            await db.workspaces.put({
                _id: nanoid(),
                name: 'My Collection',
                createdAt: new Date().getTime(),
                updatedAt: new Date().getTime()
            })

            workspaces = await db.workspaces.toArray()

            this.$store.commit('setWorkspaces', workspaces)
            this.$store.commit('setActiveWorkspace', workspaces[0])

            // update pre-existing collections with a default workspaceId, so as to not break
            // collections created before the introduction of workspaces
            await db.collections.toCollection().modify({ workspaceId: this.activeWorkspace._id })
        }

        await this.fetchSetCollectionForWorkspace()
    }
}
</script>

<style lang="scss">
@import '@/styles/normalize.css';
@import '@/styles/reset.css';
@import '@/styles/main.css';
</style>
