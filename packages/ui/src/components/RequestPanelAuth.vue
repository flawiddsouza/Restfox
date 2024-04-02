<template>
    <select :value="collectionItem.authentication?.type ?? 'No Auth'" @change="handleCollectionItemAuthenticationTypeChange" style="margin-bottom: 0.5rem">
        <option value="No Auth">No Auth</option>
        <option value="basic">Basic Auth</option>
        <option value="bearer">Bearer Token</option>
    </select>
    <div v-if="collectionItem.authentication && collectionItem.authentication.type !== 'No Auth'">
        <table class="auth" style="table-layout: fixed;">
            <tr>
                <td style="min-width: 6rem; user-select: none;">
                    <label for="basic-auth-enabled">Enabled</label>
                </td>
                <td style="width: 100%">
                    <input type="checkbox" :checked="collectionItem.authentication.disabled === undefined || collectionItem.authentication.disabled === false" @change="collectionItem.authentication.disabled = ($event as any).target.checked ? false : true" id="basic-auth-enabled">
                </td>
            </tr>
            <template v-if="collectionItem.authentication.type === 'basic'">
                <tr>
                    <td style="user-select: none;">
                        <label for="basic-auth-username" :class="{ disabled: collectionItem.authentication.disabled }">Username</label>
                    </td>
                    <td style="width: 100%">
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
                    <td style="user-select: none;">
                        <label for="basic-auth-password" :class="{ disabled: collectionItem.authentication.disabled }">Password</label>
                    </td>
                    <td style="width: 100%">
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
                    <td style="user-select: none;">
                        <label for="bearer-auth-token" :class="{ disabled: collectionItem.authentication.disabled }">Token</label>
                    </td>
                    <td style="width: 100%">
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
                    <td style="user-select: none;">
                        <label for="basic-auth-prefix" :class="{ disabled: collectionItem.authentication.disabled }">Prefix</label>
                    </td>
                    <td style="width: 100%">
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
</template>

<script setup lang="ts">
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

function handleCollectionItemAuthenticationTypeChange(event: any) {
    if('authentication' in props.collectionItem === false) {
        props.collectionItem.authentication = {}
    }

    // @ts-expect-error - This is a valid assignment
    props.collectionItem.authentication.type = event.target.value
}
</script>
