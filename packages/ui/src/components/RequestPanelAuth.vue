<template>
    <div>
        <div class="custom-select" @click="handleRequestAuthMenu">
            {{ requestAuthList.find(item => item.value === collectionItem.authentication?.type)?.label ?? 'No Auth' }}
            <i class="fa fa-caret-down space-right"></i>
            <ContextMenu
                :options="requestAuthList"
                :show="showRequestAuthMenu"
                :x="requestAuthMenuX"
                :y="requestAuthMenuY"
                :selected-option="collectionItem"
                @update:show="showRequestAuthMenu = $event"
                @click="handleCollectionItemAuthenticationTypeChange"
            />
        </div>
        <div v-if="collectionItem.authentication && collectionItem.authentication.type !== 'No Auth'">
            <table class="auth">
                <tr>
                    <td class="auth-label">
                        <label for="auth-enabled">Enabled</label>
                    </td>
                    <td class="auth-input">
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
                        <td class="auth-label">
                            <label for="basic-auth-username" :class="{ disabled: collectionItem.authentication.disabled }">
                                Username
                            </label>
                        </td>
                        <td class="auth-input">
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
                        <td class="auth-label">
                            <label for="basic-auth-password" :class="{ disabled: collectionItem.authentication.disabled }">
                                Password
                            </label>
                        </td>
                        <td class="auth-input">
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
                        <td class="auth-label">
                            <label for="bearer-auth-token" :class="{ disabled: collectionItem.authentication.disabled }">
                                Token
                            </label>
                        </td>
                        <td class="auth-input">
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
                        <td class="auth-label">
                            <label for="bearer-auth-prefix" :class="{ disabled: collectionItem.authentication.disabled }">
                                Prefix
                            </label>
                        </td>
                        <td class="auth-input">
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
    </div>
</template>

<script lang="ts">
import { PropType } from 'vue'
import CodeMirrorSingleLine from './CodeMirrorSingleLine.vue'
import { CollectionItem } from '@/global'
import ContextMenu from '@/components/ContextMenu.vue'

export default ({
    name: 'CustomDropdown',
    components: {
        ContextMenu,
        CodeMirrorSingleLine,
    },
    props: {
        collectionItem: {
            type: Object as PropType<CollectionItem> | null,
            required: true,
        },
        collectionItemEnvironmentResolved: {
            type: Object as PropType<any>,
            required: true,
        },
    },
    data() {
        return {
            requestAuthList: [
                {
                    'type': 'option',
                    'label': 'Auth Types',
                    'disabled': true,
                    'class': 'context-menu-header'
                },
                {
                    'type': 'option',
                    'label': 'Basic Auth',
                    'value': 'basic',
                    'showSelectedIcon': true
                },
                {
                    'type': 'option',
                    'label': 'Bearer Token',
                    'value': 'bearer',
                    'showSelectedIcon': true
                },
                {
                    'type': 'option',
                    'label': 'Other',
                    'disabled': true,
                    'class': 'context-menu-header'
                },
                {
                    'type': 'option',
                    'label': 'No Auth',
                    'value': 'No Auth',
                    'showSelectedIcon': true
                },
            ],
            showRequestAuthMenu: false,
            requestAuthMenuX: null,
            requestAuthMenuY: null,
        }
    },
    methods: {
        handleRequestAuthMenu(event: any) {
            this.requestAuthMenuX = event.clientX
            this.requestAuthMenuY = event.clientY
            this.showRequestAuthMenu = true
        },
        handleCollectionItemAuthenticationTypeChange(event: any) {
            this.collectionItem.authentication.type = event
        },
        toggleAuthEnabled(event: any) {
            const target = event.target as HTMLInputElement
            this.collectionItem.authentication.disabled = !target.checked
        },
    },
})
</script>

<style scoped>
.auth {
    table-layout: fixed;
    width: 100%;
}

.auth-label {
    min-width: 6rem;
    user-select: none;
}

.auth-input {
    width: 100%;
}

.disabled {
    opacity: 0.5;
}
</style>
