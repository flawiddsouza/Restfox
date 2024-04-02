<template>
    <table style="table-layout: fixed;">
        <tr v-for="(header, index) in collectionItem.headers">
            <td>
                <CodeMirrorSingleLine
                    v-model="header.name"
                    placeholder="name"
                    :env-variables="collectionItemEnvironmentResolved"
                    :input-text-compatible="true"
                    :disabled="header.disabled"
                    :key="'header-name-' + index"
                />
            </td>
            <td>
                <CodeMirrorSingleLine
                    v-model="header.value"
                    placeholder="value"
                    :env-variables="collectionItemEnvironmentResolved"
                    :input-text-compatible="true"
                    :disabled="header.disabled"
                    :key="'header-value-' + index"
                />
            </td>
            <td>
                <input type="checkbox" :checked="header.disabled === undefined || header.disabled === false" @change="header.disabled = ($event as any).target.checked ? false : true">
            </td>
            <td @click="collectionItem.headers?.splice(index, 1)">
                <i class="fa fa-trash"></i>
            </td>
        </tr>
        <tr>
            <td colspan="4" style="text-align: center; user-select: none" @click="pushItem(collectionItem, 'headers', { name: '', value: '' })">
                + Add Item
            </td>
        </tr>
    </table>
</template>

<script setup lang="ts">
import { PropType } from 'vue'
import CodeMirrorSingleLine from './CodeMirrorSingleLine.vue'
import { CollectionItem } from '@/global'

defineProps({
    collectionItem: {
        type: Object as PropType<CollectionItem>,
        required: true
    },
    collectionItemEnvironmentResolved: {
        type: Object as PropType<any>,
        required: true
    }
})

function pushItem(object: any, key: string, itemToPush: any) {
    if(key in object === false) {
        object[key] = []
    }

    object[key].push(itemToPush)
}
</script>
