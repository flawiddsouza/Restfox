<template>
    <div class="request-panel-docs">
        <template v-if="editing">
            <div>
                <button class="button" @click="$emit('update:editing', false)" style="margin-bottom: 1rem">Preview</button>
            </div>
            <textarea v-model="collectionItem.description" style="width: 100%; height: 100%; padding: 0.5rem;" spellcheck="false"></textarea>
        </template>
        <template v-else>
            <div>
                <button class="button" @click="$emit('update:editing', true)" style="margin-bottom: 1rem">Edit</button>
            </div>
            <div v-html="renderMarkdown(collectionItem.description ?? '')" style="overflow: auto;"></div>
        </template>
    </div>
</template>

<script lang="ts">
import { marked } from 'marked'

// links in an item's docs open outside the app
const renderer = new marked.Renderer()

renderer.link = function(...args) {
    const link = marked.Renderer.prototype.link.apply(this, args)
    return link.replace('<a', '<a target="_blank" rel="noopener noreferrer"')
}

marked.setOptions({
    renderer: renderer
})
</script>

<script setup lang="ts">
import type { PropType } from 'vue'
import type { CollectionItem } from '@/global'

// The Docs tab of a request or gRPC item: its description, written as Markdown. Whether it is being edited is the
// panel's, so it stays as it was when the user comes back to the tab
defineProps({
    // only the description, which is all the tab reads and edits
    collectionItem: {
        type: Object as PropType<Pick<CollectionItem, 'description'>>,
        required: true,
    },
    editing: {
        type: Boolean,
        default: false,
    },
})

defineEmits(['update:editing'])

function renderMarkdown(markdown: string) {
    return marked.parse(markdown)
}
</script>

<style scoped>
.request-panel-docs {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr;
    overflow: auto;
}

.request-panel-docs textarea {
    border: 1px solid var(--default-border-color);
    outline: 0;
    resize: none;
}
</style>
