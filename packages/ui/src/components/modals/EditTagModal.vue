<template>
    <form @submit.prevent="updateTag" v-if="showModalComp">
        <modal title="Edit Tag" v-model="showModalComp">
            <div>
                <label>
                    <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Function</div>
                    <select class="full-width-input" v-model="parsedFuncForEdit.functionName" required>
                        <option v-for="availableFunction in availableFunctions" :value="availableFunction.value">{{ availableFunction.label }}</option>
                    </select>
                </label>
            </div>

            <div v-if="formConfig[parsedFuncForEdit.functionName as keyof typeof formConfig]">
                <template v-for="field in formConfig[parsedFuncForEdit.functionName as keyof typeof formConfig]">
                    <div :style="{ marginTop: '1rem' }" v-if="shouldShowField(field)">
                        <label>
                            <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">{{ field.label }}</div>

                            <select
                                v-if="field.type === 'select'"
                                class="full-width-input"
                                v-model="parsedFuncForEdit.parameters[field.property]"
                                :required="field.required"
                            >
                                <option v-for="option in options[field.options]" :value="option[field.optionValue]">{{ option[field.optionLabel] }}</option>
                            </select>

                            <input
                                v-if="field.type === 'number'"
                                type="number"
                                class="full-width-input"
                                v-model="parsedFuncForEdit.parameters[field.property]"
                                :required="field.required"
                                min="1"
                            >

                            <input
                                v-if="field.type === 'base64'"
                                type="text"
                                class="full-width-input"
                                :value="decodeBase64(parsedFuncForEdit.parameters[field.property])"
                                @input="encodeBase64Input($event, field.property)"
                                :required="field.required"
                            >
                        </label>
                    </div>
                </template>
            </div>

            <div style="margin-top: 1rem">
                <label>
                    <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Live Preview</div>
                    <textarea class="full-width-input" :value="preview" readonly></textarea>
                </label>
            </div>

            <template #footer>
                <button class="button">Save</button>
            </template>
        </modal>
    </form>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, PropType, Ref, ref, watch } from 'vue'
import Modal from '@/components/Modal.vue'
import type { ParsedResult } from '@/parsers/tag'
import { toFunctionString } from '@/parsers/tag'
import { getCollectionForWorkspace } from '@/db'
import { useStore } from 'vuex'
import { flattenTree, prependParentTitleToChildTitle, sortTree, substituteEnvironmentVariables, toTree } from '@/helpers'
import { CollectionItem } from '@/global'
import { Base64 } from 'js-base64'

const props = defineProps({
    showModal: {
        type: Boolean,
        required: true
    },
    parsedFunc: {
        type: Object as PropType<ParsedResult>,
        required: true
    },
    updateFunc: {
        type: Function as PropType<(updatedTag: string) => void>,
        required: true
    },
    activeTab: {
        type: Object as PropType<CollectionItem>,
        required: true
    },
})

const emit = defineEmits(['update:showModal'])

const store = useStore()

const availableFunctions = [
    {
        label: `Response – reference values from other request's responses`,
        value: 'response',
    },
]

const availableAttributes = [
    {
        label: 'Body – value of response body',
        value: 'body',
    },
    {
        label: 'Raw Body – entire response body',
        value: 'raw',
    },
    {
        label: 'Header – value of response header',
        value: 'header',
    }
]

const availableTriggerBehaviors = [
    {
        label: 'Never – never send request',
        value: 'never',
    },
    {
        label: 'No History – send once if there are no available responses',
        value: 'no-history',
    },
    {
        label: 'When Expired – send the request if current response is older than Max Age seconds',
        value: 'when-expired',
    },
    {
        label: 'Always – always send the request',
        value: 'always',
    },
]

const formConfig = {
    response: [
        {
            type: 'select',
            label: 'Request',
            property: 'request',
            options: 'collectionItems',
            optionLabel: 'name',
            optionValue: '_id',
            required: true,
        },
        {
            type: 'select',
            label: 'Attribute',
            property: 'attribute',
            options: 'availableAttributes',
            optionLabel: 'label',
            optionValue: 'value',
            required: true,
            default: 'body',
        },
        {
            type: 'base64',
            label: 'JSONPath or XPath',
            property: 'path',
            required: true,
            condition: 'attribute == "body"',
        },
        {
            type: 'base64',
            label: 'Header Name',
            property: 'path',
            required: true,
            condition: 'attribute == "header"',
        },
        {
            type: 'select',
            label: 'Trigger Behavior',
            property: 'behavior',
            options: 'availableTriggerBehaviors',
            optionLabel: 'label',
            optionValue: 'value',
            required: true,
            default: 'never',
        },
        {
            type: 'number',
            label: 'Max Age (seconds)',
            property: 'maxAge',
            condition: 'behavior == "when-expired"',
            required: true,
            default: 60,
        }
    ]
}

const showModalComp = ref(props.showModal)

const collectionItems: Ref<CollectionItem[]> = ref([])

const preview = ref('')

const parsedFuncForEdit = ref(JSON.parse(JSON.stringify(props.parsedFunc)))
fillDefaultValues()
generatePreview()

const options = computed(() => {
    return {
        collectionItems: collectionItems.value,
        availableFunctions: availableFunctions,
        availableAttributes: availableAttributes,
        availableTriggerBehaviors: availableTriggerBehaviors,
    }
})

watch(() => props.showModal, (newVal) => {
    showModalComp.value = newVal
    if (newVal) {
        parsedFuncForEdit.value = JSON.parse(JSON.stringify(props.parsedFunc))
        fillDefaultValues()
        generatePreview()
        getAllRequests()
    }
})

watch(() => parsedFuncForEdit.value, () => {
    generatePreview()
}, { deep: true })

watch(showModalComp, (newVal) => {
    emit('update:showModal', newVal)
})

function updateTag() {
    props.updateFunc(toFunctionString(parsedFuncForEdit.value))
    showModalComp.value = false
}

async function getAllRequests() {
    let { collection } = await getCollectionForWorkspace(store.state.activeWorkspace._id)
    collection = toTree(collection)
    sortTree(collection)
    prependParentTitleToChildTitle(collection)
    collection = flattenTree(collection)

    collection = collection.filter((item) => item._type === 'request' && item._id !== props.activeTab._id)

    collectionItems.value = collection
}

function decodeBase64(input: string) {
    if (input === undefined) {
        return ''
    }

    if (input.startsWith('b64::')) {
        return Base64.decode(input.slice(5))
    }

    return input
}

function encodeBase64Input(event: InputEvent, key: string) {
    const target = event.target as HTMLInputElement
    parsedFuncForEdit.value.parameters[key] = 'b64::' + Base64.encode(target.value, true)
}

function shouldShowField(field: any) {
    if (!field.condition) {
        return true
    }

    const condition = field.condition
    const [property, operator, value] = condition.split(' ')

    if (operator === '==') {
        const isString = value.startsWith('"') && value.endsWith('"')

        if (isString) {
            return parsedFuncForEdit.value.parameters[property] === value.slice(1, -1)
        } else {
            return parsedFuncForEdit.value.parameters[property] === value
        }
    }

    return true
}

function fillDefaultValues() {
    for (const field of formConfig[parsedFuncForEdit.value.functionName as keyof typeof formConfig]) {
        if (field.default && !parsedFuncForEdit.value.parameters[field.property]) {
            parsedFuncForEdit.value.parameters[field.property] = field.default
        }
    }
}

async function generatePreview() {
    preview.value = await substituteEnvironmentVariables({}, `{% ${toFunctionString(parsedFuncForEdit.value)} %}`, {
        tagTrigger: false,
        noError: true,
    })
}

onBeforeMount(() => {
    getAllRequests()
})
</script>
