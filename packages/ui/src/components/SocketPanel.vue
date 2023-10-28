<template>
    <template v-if="activeTab && activeTab._type === 'socket'">
        <div>
            Socket {{ activeTab }}
        </div>
    </template>
</template>

<script>
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import { jsonPrettify } from '../utils/prettify-json'

export default {
    components: {
        CodeMirrorEditor,
    },
    data() {
        return {
        }
    },
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        },
    },
    watch: {
    },
    methods: {
    },
}
</script>

<style scoped>
</style>
