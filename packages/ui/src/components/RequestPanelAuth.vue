<template>
    <div class="custom-select" style="display: inline-flex; width: 6.8rem;" @click="handleRequestAuthMenu">
        {{ collectionItem.authentication ? requestAuthList.find(item => item.value === collectionItem.authentication?.type)?.label : 'No Auth' }}
        <i class="fa fa-caret-down space-right"></i>
    </div>
    <div v-if="collectionItem.authentication && collectionItem.authentication.type !== 'No Auth'">
        <table class="auth table-layout-fixed">
            <tr>
                <td class="user-select-none">
                    <label for="auth-enabled">Enabled</label>
                </td>
                <td class="full-width">
                    <input
                        type="checkbox"
                        :checked="!collectionItem.authentication.disabled"
                        @change="toggleAuthEnabled"
                        id="auth-enabled"
                    />
                </td>
            </tr>
            <template v-if="collectionItem.authentication.type === 'basic'">
                <tr>
                    <td class="user-select-none">
                        <label for="basic-auth-username" :class="{ disabled: collectionItem.authentication.disabled }">
                            Username
                        </label>
                    </td>
                    <td class="full-width">
                        <CodeMirrorSingleLine
                            v-model="collectionItem.authentication.username"
                            :env-variables="collectionItemEnvironmentResolved"
                            :input-text-compatible="true"
                            :disabled="collectionItem.authentication.disabled"
                            :key="'basic-auth-username'"
                        />
                    </td>
                </tr>
                <tr>
                    <td class="user-select-none">
                        <label for="basic-auth-password" :class="{ disabled: collectionItem.authentication.disabled }">
                            Password
                        </label>
                    </td>
                    <td class="full-width">
                        <CodeMirrorSingleLine
                            v-model="collectionItem.authentication.password"
                            :env-variables="collectionItemEnvironmentResolved"
                            :input-text-compatible="true"
                            :disabled="collectionItem.authentication.disabled"
                            :key="'basic-auth-password'"
                        />
                    </td>
                </tr>
            </template>
            <template v-if="collectionItem.authentication.type === 'bearer'">
                <tr>
                    <td class="user-select-none">
                        <label for="bearer-auth-token" :class="{ disabled: collectionItem.authentication.disabled }">
                            Token
                        </label>
                    </td>
                    <td class="full-width">
                        <CodeMirrorSingleLine
                            v-model="collectionItem.authentication.token"
                            :env-variables="collectionItemEnvironmentResolved"
                            :input-text-compatible="true"
                            :disabled="collectionItem.authentication.disabled"
                            :key="'bearer-auth-token'"
                        />
                    </td>
                </tr>
                <tr>
                    <td class="user-select-none">
                        <label for="bearer-auth-prefix" :class="{ disabled: collectionItem.authentication.disabled }">
                            Prefix
                        </label>
                    </td>
                    <td class="full-width">
                        <CodeMirrorSingleLine
                            v-model="collectionItem.authentication.prefix"
                            :env-variables="collectionItemEnvironmentResolved"
                            :input-text-compatible="true"
                            :disabled="collectionItem.authentication.disabled"
                            :key="'bearer-auth-prefix'"
                        />
                    </td>
                </tr>
            </template>
        </table>
    </div>
    <ContextMenu
        :options="requestAuthList"
        v-model:show="showRequestAuthMenu"
        :x="requestAuthMenuX"
        :y="requestAuthMenuY"
        :selected-option="collectionItem.authentication?.type ?? 'No Auth'"
        @click="handleCollectionItemAuthenticationTypeChange"
    />
</template>

<script setup lang="ts">
import { PropType, ref } from 'vue'
import CodeMirrorSingleLine from './CodeMirrorSingleLine.vue'
import { CollectionItem } from '@/global'
import ContextMenu from '@/components/ContextMenu.vue'

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

const requestAuthList = ref([
    {
        'type': 'option',
        'label': 'Auth Types',
        'disabled': true,
        'class': 'text-with-line'
    },
    {
        'type': 'option',
        'label': 'Basic Auth',
        'value': 'basic',
        'class': 'context-menu-item-with-left-padding'
    },
    {
        'type': 'option',
        'label': 'Bearer Token',
        'value': 'bearer',
        'class': 'context-menu-item-with-left-padding'
    },
    {
        'type': 'option',
        'label': 'Other',
        'disabled': true,
        'class': 'text-with-line'
    },
    {
        'type': 'option',
        'label': 'No Auth',
        'value': 'No Auth',
        'class': 'context-menu-item-with-left-padding'
    },
])

const showRequestAuthMenu = ref(false)
const requestAuthMenuX = ref<number | null>(null)
const requestAuthMenuY = ref<number | null>(null)

function handleRequestAuthMenu(event: any) {
    const containerElement = event.target.closest('.custom-select')
    requestAuthMenuX.value = containerElement.getBoundingClientRect().left
    requestAuthMenuY.value = containerElement.getBoundingClientRect().top + containerElement.getBoundingClientRect().height
    showRequestAuthMenu.value = true
}

function handleCollectionItemAuthenticationTypeChange(event: string) {
    if (!props.collectionItem.authentication) {
        props.collectionItem.authentication = {}
    }
    props.collectionItem.authentication.type = event
}

function toggleAuthEnabled(event: Event) {
    const target = event.target as HTMLInputElement
    if (props.collectionItem && props.collectionItem.authentication) {
        props.collectionItem.authentication.disabled = !target.checked
    }
}
</script>

<style scoped>
.table-layout-fixed {
    table-layout: fixed;
}

.user-select-none {
    user-select: none;
}

.full-width {
    width: 100% !important;
}
</style>
