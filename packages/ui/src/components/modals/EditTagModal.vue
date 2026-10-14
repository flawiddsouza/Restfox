<template>
    <form @submit.prevent="updateTag" v-if="showModalComp">
        <modal title="Edit Tag" v-model="showModalComp">
            <div>
                <label>
                    <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Function</div>
                    <select class="full-width-input" v-model="parsedFuncForEdit.functionName" @change="onFunctionChange" required>
                        <option v-for="availableFunction in availableFunctions" :value="availableFunction.value">{{ availableFunction.label }}</option>
                    </select>
                </label>
            </div>

            <div v-if="formConfig[parsedFuncForEdit.functionName as keyof typeof formConfig]">
                <template v-for="field in formConfig[parsedFuncForEdit.functionName as keyof typeof formConfig]">
                    <div :style="{ marginTop: '1rem' }" v-if="shouldShowField(field)">
                        <label style="display: flex;" v-if="field.type === 'checkbox'">
                            <input
                                type="checkbox"
                                :checked="isParameterChecked(parsedFuncForEdit.parameters[field.property])"
                                @change="parsedFuncForEdit.parameters[field.property] = ($event.target as HTMLInputElement).checked ? 1 : 0"
                            > <div style="margin-left: 0.5rem;">{{ field.label }}</div>
                        </label>
                        <label v-else>
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
                        <div v-if="field.hint" :style="{ marginTop: '0.3rem', marginLeft: field.type === 'checkbox' ? '1.3rem' : undefined }">{{ field.hint }}</div>
                    </div>
                </template>
            </div>

            <div style="margin-top: 1rem" v-if="parsedFuncForEdit.functionName === 'prompt' && rememberedPromptValueCount > 0">
                <button type="button" class="button" @click="forgetRememberedValues">Forget Remembered Values</button>
                <div style="margin-top: 0.3rem;">Clears the values kept by Ask, for all prompts.</div>
            </div>

            <div style="margin-top: 1rem">
                <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom); display: flex; align-items: flex-end; justify-content: space-between;">
                    Live Preview
                    <button type="button" class="button" @click="generatePreview(true)">Refresh</button>
                </div>
                <textarea class="full-width-input" :value="preview" readonly></textarea>
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
import { isParameterChecked, toFunctionString } from '@/parsers/tag'
import { getCollectionForWorkspace } from '@/db'
import { useStore } from 'vuex'
import { flattenTree, prependParentTitleToChildTitle, sortTree, substituteEnvironmentVariables, toTree } from '@/helpers'
import { CollectionItem } from '@/global'
import { Base64 } from 'js-base64'
import { countRememberedPromptValues, forgetPromptValues } from '@/utils/prompt-tag'
import { useToast } from 'vue-toast-notification'

const toast = useToast()

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
        default: { _id: '' } as CollectionItem,
    },
})

const emit = defineEmits(['update:showModal'])

const store = useStore()

const availableFunctions = [
    {
        label: `Response – reference values from other request's responses`,
        value: 'response',
    },
    {
        label: 'Prompt – ask for a value when sending',
        value: 'prompt',
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

type FormField = {
    type: 'select' | 'number' | 'base64' | 'checkbox'
    label: string
    property: string
    options?: string
    optionLabel?: string
    optionValue?: string
    required?: boolean
    default?: string | number
    condition?: string
    hint?: string
}

const availablePromptAskOptions = [
    {
        label: 'Every send',
        value: 'always',
    },
    {
        label: 'Every send, pre-filled with the last value',
        value: 'prefill',
    },
    {
        label: 'Once, until Restfox is closed or reloaded',
        value: 'once',
    },
]

const formConfig: Record<string, FormField[]> = {
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
    ],
    prompt: [
        {
            type: 'base64',
            label: 'Title',
            property: 'title',
            required: true,
            hint: 'Shown at the top of the box.',
        },
        {
            type: 'base64',
            label: 'Label',
            property: 'label',
            hint: 'Shown above the input.',
        },
        {
            type: 'base64',
            label: 'Default Value',
            property: 'defaultValue',
            hint: 'Filled into the box, and shown in previews.',
        },
        {
            type: 'select',
            label: 'Ask',
            property: 'ask',
            options: 'availablePromptAskOptions',
            optionLabel: 'label',
            optionValue: 'value',
            required: true,
            default: 'always',
            hint: 'Pre-filled and Once keep the value until Restfox is closed or reloaded. Requests that use the same environment variable share it.',
        },
        {
            type: 'checkbox',
            label: 'Mask Text',
            property: 'mask',
            hint: 'Hides what is typed, and keeps it out of the response history.',
        },
    ],
}

const showModalComp = ref(props.showModal)

const collectionItems: Ref<CollectionItem[]> = ref([])

const preview = ref('')

const parsedFuncForEdit = ref(JSON.parse(JSON.stringify(props.parsedFunc)))

// the values are kept outside Vue, so the count is read when the editor opens
const rememberedPromptValueCount = ref(countRememberedPromptValues())
fillDefaultValues()
generatePreview()

const options = computed(() => {
    return {
        collectionItems: collectionItems.value,
        availableFunctions: availableFunctions,
        availableAttributes: availableAttributes,
        availableTriggerBehaviors: availableTriggerBehaviors,
        availablePromptAskOptions: availablePromptAskOptions,
    }
})

watch(() => props.showModal, (newVal) => {
    showModalComp.value = newVal
    if (newVal) {
        parsedFuncForEdit.value = JSON.parse(JSON.stringify(props.parsedFunc))
        rememberedPromptValueCount.value = countRememberedPromptValues()
        fillDefaultValues()
        generatePreview()
        getAllRequests()
    }
})

watch(() => parsedFuncForEdit.value, () => {
    generatePreview()
}, { deep: true })

// another function's parameters mean nothing to this one
function onFunctionChange() {
    parsedFuncForEdit.value.parameters = {}
    fillDefaultValues()
}

watch(showModalComp, (newVal) => {
    emit('update:showModal', newVal)
})

// shown only while values are kept, the button then goes away
function forgetRememberedValues() {
    const forgottenCount = forgetPromptValues()
    rememberedPromptValueCount.value = 0
    generatePreview() // it showed the remembered value
    toast.success(`Forgot the values of all prompts (${forgottenCount})`)
}

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
    for (const field of formConfig[parsedFuncForEdit.value.functionName] ?? []) {
        if (field.default && !parsedFuncForEdit.value.parameters[field.property]) {
            parsedFuncForEdit.value.parameters[field.property] = field.default
        }
    }
}

async function generatePreview(tagTrigger = false) {
    if (tagTrigger === true) {
        preview.value = 'Loading...'
    }

    preview.value = await substituteEnvironmentVariables({}, `{% ${toFunctionString(parsedFuncForEdit.value)} %}`, {
        tagTrigger,
        noError: true,
        workspaceId: store.state.activeWorkspace._id,
    })
}

onBeforeMount(() => {
    getAllRequests()
})
</script>
