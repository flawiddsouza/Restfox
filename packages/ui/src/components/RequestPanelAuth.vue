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
                            :autocompletions="tagAutocompletions"
                            @tagClick="onTagClick"
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
                            :autocompletions="tagAutocompletions"
                            @tagClick="onTagClick"
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
                            :autocompletions="tagAutocompletions"
                            @tagClick="onTagClick"
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
                            :autocompletions="tagAutocompletions"
                            @tagClick="onTagClick"
                            :input-text-compatible="true"
                            :disabled="collectionItem.authentication.disabled"
                            :key="'bearer-auth-prefix'"
                        />
                    </td>
                </tr>
            </template>

            <template v-if="collectionItem.authentication.type === 'oauth2'">
                <tr>
                    <td class="user-select-none">
                        <label for="oauth-client-id" :class="{ disabled: collectionItem.authentication.disabled }">
                            Client ID
                        </label>
                    </td>
                    <td class="full-width">
                        <CodeMirrorSingleLine
                            v-model="collectionItem.authentication.clientId"
                            :env-variables="collectionItemEnvironmentResolved"
                            :autocompletions="tagAutocompletions"
                            @tagClick="onTagClick"
                            :input-text-compatible="true"
                            :disabled="collectionItem.authentication.disabled"
                            :key="'oauth-client-id'"
                        />
                    </td>
                </tr>
                <tr>
                    <td class="user-select-none">
                        <label for="oauth-client-secret" :class="{ disabled: collectionItem.authentication.disabled }">
                            Client Secret
                        </label>
                    </td>
                    <td class="full-width">
                        <CodeMirrorSingleLine
                            v-model="collectionItem.authentication.clientSecret"
                            :env-variables="collectionItemEnvironmentResolved"
                            :autocompletions="tagAutocompletions"
                            @tagClick="onTagClick"
                            :input-text-compatible="true"
                            :disabled="collectionItem.authentication.disabled"
                            :key="'oauth-client-secret'"
                        />
                    </td>
                </tr>
                <tr>
                    <td class="user-select-none">
                        <label for="oauth-token-url" :class="{ disabled: collectionItem.authentication.disabled }">
                            Access Token URL
                        </label>
                    </td>
                    <td class="full-width">
                        <CodeMirrorSingleLine
                            v-model="collectionItem.authentication.accessTokenUrl"
                            :env-variables="collectionItemEnvironmentResolved"
                            :autocompletions="tagAutocompletions"
                            @tagClick="onTagClick"
                            :input-text-compatible="true"
                            :disabled="collectionItem.authentication.disabled"
                            :key="'oauth-token-url'"
                        />
                    </td>
                </tr>
                <tr>
                    <td class="user-select-none">
                        <label for="oauth-scope" :class="{ disabled: collectionItem.authentication.disabled }">
                            Scope
                        </label>
                    </td>
                    <td class="full-width">
                        <CodeMirrorSingleLine
                            v-model="collectionItem.authentication.scope"
                            :env-variables="collectionItemEnvironmentResolved"
                            :autocompletions="tagAutocompletions"
                            @tagClick="onTagClick"
                            :input-text-compatible="true"
                            :disabled="collectionItem.authentication.disabled"
                            :key="'oauth-scope'"
                        />
                    </td>
                </tr>

                <tr>
                    <td class="user-select-none">
                        <label for="oauth-grant-type" :class="{ disabled: collectionItem.authentication.disabled }">
                            Grant Type
                        </label>
                    </td>
                    <td class="full-width">
                        <div class="custom-select" style="margin: 0;" @click="handleGrantTypeMenu">
                            {{ grantTypes.find(item => item.value === collectionItem.authentication?.grantType)?.label }}
                            <i class="fa fa-caret-down space-right"></i>
                        </div>
                    </td>
                </tr>

                <template v-if="collectionItem.authentication.grantType === 'password'">
                    <tr>
                        <td class="user-select-none">
                            <label for="oauth-username" :class="{ disabled: collectionItem.authentication.disabled }">
                                Username
                            </label>
                        </td>
                        <td class="full-width">
                            <CodeMirrorSingleLine
                                v-model="collectionItem.authentication.username"
                                :env-variables="collectionItemEnvironmentResolved"
                                :autocompletions="tagAutocompletions"
                                @tagClick="onTagClick"
                                :input-text-compatible="true"
                                :disabled="collectionItem.authentication.disabled"
                                :key="'oauth-username'"
                            />
                        </td>
                    </tr>
                    <tr>
                        <td class="user-select-none">
                            <label for="oauth-password" :class="{ disabled: collectionItem.authentication.disabled }">
                                Password
                            </label>
                        </td>
                        <td class="full-width">
                            <CodeMirrorSingleLine
                                v-model="collectionItem.authentication.password"
                                :env-variables="collectionItemEnvironmentResolved"
                                :autocompletions="tagAutocompletions"
                                @tagClick="onTagClick"
                                :input-text-compatible="true"
                                :disabled="collectionItem.authentication.disabled"
                                :key="'oauth-password'"
                            />
                        </td>
                    </tr>
                </template>
                <tr>
                    <td colspan="2">
                        <button type="button" class="button" @click="requestOAuthToken" :disabled="collectionItem.authentication.disabled">Get Token</button>
                        <button type="button" class="button" @click="refreshOAuthToken" :disabled="collectionItem.authentication.disabled" style="margin-left: 0.5rem">Refresh Token</button>
                    </td>
                </tr>
                <tr>
                    <td class="user-select-none">
                        <label for="access-token" :class="{ disabled: collectionItem.authentication.disabled }">
                            Access Token
                        </label>
                    </td>
                    <td class="user-select">
                        <label for="access-token" style="max-width: 100px; word-wrap: break-word">
                            {{ collectionItem.authentication.token || 'N/A' }}
                        </label>
                    </td>
                </tr>
                <tr>
                    <td class="user-select-none">
                        <label for="access-token" :class="{ disabled: collectionItem.authentication.disabled }">
                            Refresh Token
                        </label>
                    </td>
                    <td class="user-select">
                        <label for="access-token" style="max-width: 100px; word-wrap: break-word">
                            {{ collectionItem.authentication.refreshToken || 'N/A' }}
                        </label>
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

    <ContextMenu
        :options="grantTypes"
        v-model:show="showGrantTypeMenu"
        :x="grantTypeMenuX"
        :y="grantTypeMenuY"
        :selected-option="collectionItem.authentication?.grantType"
        @click="handleGrantTypeChange"
    />
</template>

<script setup lang="ts">
import { computed, PropType, ref } from 'vue'
import CodeMirrorSingleLine from './CodeMirrorSingleLine.vue'
import { CollectionItem } from '@/global'
import ContextMenu from '@/components/ContextMenu.vue'
import constants from '@/constants'
import { fetchWrapper, substituteEnvironmentVariables } from '@/helpers'
import { useToast } from 'vue-toast-notification'
import { bufferToString } from '@/utils/response'

const toast = useToast()

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
        'label': 'OAuth 2.0',
        'value': 'oauth2',
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

const grantTypes = ref([
    {
        'type': 'option',
        'label': 'Grant Types',
        'disabled': true,
        'class': 'text-with-line'
    },
    {
        'type': 'option',
        'label': 'Password Credentials',
        'value': constants.GRANT_TYPES.password_credentials,
        'class': 'context-menu-item-with-left-padding'
    },
    {
        'type': 'option',
        'label': 'Client Credentials',
        'value': constants.GRANT_TYPES.client_credentials,
        'class': 'context-menu-item-with-left-padding'
    },
])

const showRequestAuthMenu = ref(false)
const requestAuthMenuX = ref<number | null>(null)
const requestAuthMenuY = ref<number | null>(null)

const tagAutocompletions = computed(() => {
    return constants.AUTOCOMPLETIONS.TAGS
})

const showGrantTypeMenu = ref(false)
const grantTypeMenuX = ref<number | null>(null)
const grantTypeMenuY = ref<number | null>(null)

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

function handleGrantTypeMenu(event: any) {
    const containerElement = event.target.closest('.custom-select')
    grantTypeMenuX.value = containerElement.getBoundingClientRect().left
    grantTypeMenuY.value = containerElement.getBoundingClientRect().top + containerElement.getBoundingClientRect().height
    showGrantTypeMenu.value = true
}

function handleGrantTypeChange(event: string) {
    if (!props.collectionItem.authentication) {
        props.collectionItem.authentication = {}
    }
    props.collectionItem.authentication.grantType = event
}

function toggleAuthEnabled(event: Event) {
    const target = event.target as HTMLInputElement
    if (props.collectionItem && props.collectionItem.authentication) {
        props.collectionItem.authentication.disabled = !target.checked
    }
}

async function requestOAuthToken() {
    const auth = props.collectionItem?.authentication
    const env = props.collectionItemEnvironmentResolved

    if (auth) {
        const clientId: string = await substituteEnvironmentVariables(env, auth.clientId)
        const clientSecret: string = await substituteEnvironmentVariables(env, auth.clientSecret)
        const accessTokenUrl: any = await substituteEnvironmentVariables(env, auth.accessTokenUrl)
        const scope: string | null = auth.scope ? await substituteEnvironmentVariables(env, auth.scope) : null
        const username: string = await substituteEnvironmentVariables(env, auth.username)
        const password: string = await substituteEnvironmentVariables(env, auth.password)
        const grantType: string | any = auth.grantType

        oath2Precheck(clientId, clientSecret, accessTokenUrl)

        const bodyData = new URLSearchParams({
            grant_type: grantType,
            client_id: clientId,
            client_secret: clientSecret,
        })

        if (scope) {
            bodyData.append('scope', scope)
        }

        if (grantType === 'password') {
            bodyData.append('username', username)
            bodyData.append('password', password)
        }

        try {
            const abortController = new AbortController()

            const headers = {
                'Content-Type': constants.MIME_TYPE.FORM_URL_ENCODED
            }

            const response = await fetchWrapper(accessTokenUrl, 'POST', headers, bodyData.toString(), abortController.signal, {
                electronSwitchToChromiumFetch: false,
                disableSSLVerification: false,
            })

            if(response.status !== 200) {
                couldNotFetchTokenError(response)
                return
            }

            const res = JSON.parse(new TextDecoder().decode(response.buffer))
            if (auth && props.collectionItem && props.collectionItem.authentication) {
                props.collectionItem.authentication.token = res.access_token
                props.collectionItem.authentication.refreshToken = res.refresh_token
            }
            toast.success('OAuth token obtained successfully!')

        } catch (error) {
            couldNotFetchTokenError(error)
        }
    }
}

async function refreshOAuthToken() {
    const auth = props.collectionItem?.authentication
    const env = props.collectionItemEnvironmentResolved

    console.log(auth)
    if(auth) {
        if(props.collectionItem && props.collectionItem.authentication) {
            const clientId: string = await substituteEnvironmentVariables(env, auth.clientId)
            const clientSecret: string = await substituteEnvironmentVariables(env, auth.clientSecret)
            const accessTokenUrl: any = await substituteEnvironmentVariables(env, auth.accessTokenUrl)
            const refreshToken: string | any = props.collectionItem.authentication.refreshToken

            oath2Precheck(clientId, clientSecret, accessTokenUrl)

            const bodyData = new URLSearchParams({
                grant_type: constants.GRANT_TYPES.refresh_token,
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
            })

            try {
                const abortController = new AbortController()

                const headers = {
                    'Content-Type': constants.MIME_TYPE.FORM_URL_ENCODED
                }

                const response = await fetchWrapper(accessTokenUrl, 'POST', headers, bodyData.toString(), abortController.signal, {
                    electronSwitchToChromiumFetch: false,
                    disableSSLVerification: false,
                })

                if(response.status !== 200) {
                    couldNotFetchTokenError(response)
                    return
                }

                const res = JSON.parse(new TextDecoder().decode(response.buffer))
                if(props.collectionItem && props.collectionItem.authentication) {
                    props.collectionItem.authentication.token = res.access_token
                    props.collectionItem.authentication.refreshToken = res.refresh_token
                }
                toast.success('Refresh token obtained successfully!')

            } catch (error) {
                couldNotFetchTokenError(error)
            }
        }
    }
}

function couldNotFetchTokenError(error: any) {
    try {
        error.body = bufferToString(error.buffer)
        delete error.buffer
        error.body = JSON.parse(error.body)
        error.headers = Object.fromEntries(error.headers)
    } catch {}
    console.error('Error fetching OAuth token:', error)
    toast.error('Error fetching OAuth token. Please check the console for more details.')
}

function oath2Precheck(clientId: string, clientSecret: string, accessTokenUrl: string) {
    if (!clientId || !clientSecret || !accessTokenUrl) {
        toast.error('Please provide all OAuth credentials.')
        return
    }
}

function onTagClick(...args: any) {
    emit('tagClick', ...args)
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
