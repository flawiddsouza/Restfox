<template>
    <button type="button" class="button" @click="handleContextMenuOpen">References ≡</button>
    <ContextMenu :options="contextMenuOptions" :element="contextMenuElement" v-model:show="showContextMenu" @click="handleClick" :x="contextMenuX" :y="contextMenuY" :x-offset="2000" />
</template>

<script setup lang="ts">
import { Ref, ref } from 'vue'
import ContextMenu from './ContextMenu.vue'
import Sidebar from '../../../../docs/.vitepress/sidebar'

const contextMenuOptions: Ref<{
    type: string,
    label: string,
    value: string,
    icon: string,
}[]> = ref([])

const pluginDocsItems = Sidebar.find((sidebarHeader: any) => sidebarHeader.text === 'Plugins').items.filter((pluginDocsItem: any) => pluginDocsItem.text !== 'Introduction')

pluginDocsItems.forEach((pluginDocsItem: any) => {
    contextMenuOptions.value.push({
        'type': 'option',
        'label': pluginDocsItem.text,
        'value': pluginDocsItem.link,
        'icon': 'fa fa-external-link-alt',
    })
})

const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuElement = ref(null)
const showContextMenu = ref(false)

function handleContextMenuOpen(event: any) {
    contextMenuX.value = event.target.getBoundingClientRect().left
    contextMenuY.value = event.target.getBoundingClientRect().top + event.target.getBoundingClientRect().height
    contextMenuElement.value = event.target
    showContextMenu.value = true
}

function handleClick(clickedSidebarItem: string) {
    window.open(`https://docs.restfox.dev${clickedSidebarItem}.html`, '_blank')
    showContextMenu.value = false
}
</script>
