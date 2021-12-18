<script setup>
import Frame from '@/components/Frame.vue'
</script>

<template>
    <Frame />
</template>

<script>
import { db } from './db'

export default {
    async created() {
        const collections = await db.collections.toArray()

        if(collections.length > 0) {
            this.$store.commit('setCollection', collections)
        }
    }
}
</script>

<style lang="scss">
@import '@/styles/normalize.css';
@import '@/styles/reset.css';
@import '@/styles/main.css';
</style>
