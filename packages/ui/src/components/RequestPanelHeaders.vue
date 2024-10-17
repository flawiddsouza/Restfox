<template>
    <div>
        <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-bottom: 0.5rem;">
            <button type="button" class="button" @click="toggleBulkEdit">
                {{ isBulkEditMode ? 'Cancel Bulk Edit' : 'Bulk Edit' }}
            </button>
            <button
                v-if="props.collectionItem.headers?.length > 0 && !isBulkEditMode"
                type="button"
                :class="isConfirmingDelete ? 'confirm-delete' : 'button'"
                @click="handleDeleteAllHeadersClick"
            >
                <i v-if="isConfirmingDelete" class="fa fa-exclamation-circle" aria-hidden="true"></i>
                {{ isConfirmingDelete ? 'Click to Confirm' : 'Delete All' }}
            </button>
        </div>

        <div v-if="isBulkEditMode">
            <p style="margin-bottom: 0.5rem;">
                Note: Add headers in the format <code>name: value</code>, one per line.
                Disabled headers are not shown here.
            </p>
            <textarea
                v-model="bulkEditText"
                placeholder="Enter headers in the format: name: value"
                rows="10"
                style="width: 100%;"
            ></textarea>
            <div style="text-align: right; margin-top: 0.5rem;">
                <button type="button" class="button" @click="applyBulkEdit">Apply Changes</button>
            </div>
        </div>

        <table v-else style="table-layout: fixed;">
            <tr v-for="(header, index) in collectionItem.headers" :key="'header-row-' + index">
                <td>
                    <CodeMirrorSingleLine
                        v-model="header.name"
                        placeholder="name"
                        :env-variables="collectionItemEnvironmentResolved"
                        :autocompletions="tagAutocompletions"
                        @tagClick="onTagClick"
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
                        :autocompletions="tagAutocompletions"
                        @tagClick="onTagClick"
                        :input-text-compatible="true"
                        :disabled="header.disabled"
                        :key="'header-value-' + index"
                    />
                </td>
                <td>
                    <input
                        type="checkbox"
                        :checked="!(header.disabled ?? false)"
                        @change="header.disabled = !($event.target as HTMLInputElement).checked"
                    />
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
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { PropType } from 'vue'
import CodeMirrorSingleLine from './CodeMirrorSingleLine.vue'
import { CollectionItem } from '@/global'
import constants from '@/constants'

const props = defineProps({
    collectionItem: {
        type: Object as PropType<CollectionItem>,
        required: true
    },
    collectionItemEnvironmentResolved: {
        type: Object as PropType<any>,
        required: true
    }
})

const emit = defineEmits(['tagClick'])

const isBulkEditMode = ref(false)
const bulkEditText = ref('')
const isConfirmingDelete = ref(false)
// eslint-disable-next-line no-undef
let confirmationTimeout: NodeJS.Timeout | null = null

const valueAutocompleteOptions = Object.values(constants.MIME_TYPE)

const tagAutocompletions = computed(() => {
    return [...constants.AUTOCOMPLETIONS.TAGS, ...valueAutocompleteOptions]
})

const toggleBulkEdit = () => {
    isBulkEditMode.value = !isBulkEditMode.value
    if (isBulkEditMode.value && props.collectionItem.headers) {
        bulkEditText.value = props.collectionItem.headers
            .filter(header => !header.disabled)
            .map(header => `${header.name}: ${header.value}`)
            .join('\n')
    }
}

const applyBulkEdit = () => {
    if(!props.collectionItem.headers) {
        props.collectionItem.headers = []
    }

    if(isBulkEditMode.value) {
        const headers = bulkEditText.value.split('\n').filter(item => item).map(line => {
            const [name, ...valueParts] = line.split(':')
            return {
                name: name.trim(),
                value: valueParts.join(':').trim(),
                disabled: false
            }
        })

        const disabledHeaders = props.collectionItem.headers.filter(header => header.disabled)
        const updatedHeaders = [...headers, ...disabledHeaders]

        props.collectionItem.headers.splice(0, props.collectionItem.headers.length, ...updatedHeaders)
    }
    isBulkEditMode.value = false
}

const handleDeleteAllHeadersClick = () => {
    if(isConfirmingDelete.value) {
        deleteAllHeaders()
    } else {
        isConfirmingDelete.value = true
        confirmationTimeout = setTimeout(() => {
            isConfirmingDelete.value = false
        }, 1500)
    }
}

const deleteAllHeaders = () => {
    if(props.collectionItem.headers) {
        props.collectionItem.headers.splice(0, props.collectionItem.headers.length)
        isConfirmingDelete.value = false
        if(confirmationTimeout) {
            clearTimeout(confirmationTimeout)
            confirmationTimeout = null
        }
    }
}

function pushItem(object: any, key: string, itemToPush: any) {
    if(!(key in object)) {
        object[key] = []
    }
    object[key].push(itemToPush)
}

function onTagClick(...args: any) {
    emit('tagClick', ...args)
}
</script>

<style scoped>
.confirm-delete {
    background: var(--background-color);
    color: orange;
    border: 1px solid var(--button-border-color);
    border-radius: 3px;
    cursor: pointer;
}
</style>
