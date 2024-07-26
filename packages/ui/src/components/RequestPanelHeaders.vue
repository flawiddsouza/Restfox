<template>
    <div>
        <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-bottom: 0.5rem;">
            <button class="button" @click="toggleBulkEdit">
                {{ isBulkEditMode ? 'Regular Edit' : 'Bulk Edit' }}
            </button>
            <button v-if="props.collectionItem.headers.length > 0 && !isBulkEditMode" :class="isConfirmingDelete ? 'confirm-delete' : 'button'"
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
                <button class="button" @click="applyBulkEdit">Apply Changes</button>
            </div>
        </div>

        <table v-else style="table-layout: fixed;">
            <tr v-for="(header, index) in collectionItem.headers" :key="'header-row-' + index">
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
import { ref } from 'vue'
import { PropType } from 'vue'
import CodeMirrorSingleLine from './CodeMirrorSingleLine.vue'
import { CollectionItem } from '@/global'

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

const isBulkEditMode = ref(false)
const bulkEditText = ref('')
const isConfirmingDelete = ref(false)
// eslint-disable-next-line no-undef
let confirmationTimeout: NodeJS.Timeout | null = null

const toggleBulkEdit = () => {
    isBulkEditMode.value = !isBulkEditMode.value
    if (isBulkEditMode.value) {
        // @ts-ignore
        bulkEditText.value = props.collectionItem.headers
            .filter(header => !header.disabled)
            .map(header => `${header.name}: ${header.value}`)
            .join('\n')
    }
}

const applyBulkEdit = () => {
    // Parse bulkEditText to update headers
    const headers = bulkEditText.value.split('\n').map(line => {
        const [name, ...valueParts] = line.split(':')
        return {
            name: name.trim(),
            value: valueParts.join(':').trim(),
            disabled: false
        }
    })

    // @ts-ignore
    const disabledHeaders = props.collectionItem.headers.filter(header => header.disabled)
    const updatedHeaders = [...headers, ...disabledHeaders]

    // @ts-ignore
    props.collectionItem.headers.splice(0, props.collectionItem.headers.length, ...updatedHeaders)
    isBulkEditMode.value = false // Switch back to single edit mode
}

// Handles the delete all headers button click
const handleDeleteAllHeadersClick = () => {
    if (isConfirmingDelete.value) {
        // If already confirming, delete all headers
        deleteAllHeaders()
    } else {
        // Start confirmation process
        isConfirmingDelete.value = true
        // Set timeout to revert button after 1.5 seconds
        confirmationTimeout = setTimeout(() => {
            isConfirmingDelete.value = false
        }, 1500)
    }
}

// Deletes all headers
const deleteAllHeaders = () => {
    // @ts-ignore
    props.collectionItem.headers.splice(0, props.collectionItem.headers.length)
    isConfirmingDelete.value = false
    if (confirmationTimeout) {
        clearTimeout(confirmationTimeout)
        confirmationTimeout = null
    }
}

// Adds a new header to the collection
function pushItem(object: any, key: string, itemToPush: any) {
    if (!(key in object)) {
        object[key] = []
    }
    object[key].push(itemToPush)
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
