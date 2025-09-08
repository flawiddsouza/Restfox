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
                            v-if="!flags.hidePasswordFields"
                            v-model="collectionItem.authentication.password"
                            :env-variables="collectionItemEnvironmentResolved"
                            :autocompletions="tagAutocompletions"
                            @tagClick="onTagClick"
                            :input-text-compatible="true"
                            :disabled="collectionItem.authentication.disabled"
                            :key="'basic-auth-password'"
                        />
                        <input
                            v-else
                            type="password"
                            v-model="collectionItem.authentication.password"
                            :disabled="collectionItem.authentication.disabled"
                        >
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
                            v-if="!flags.hidePasswordFields"
                            v-model="collectionItem.authentication.clientSecret"
                            :env-variables="collectionItemEnvironmentResolved"
                            :autocompletions="tagAutocompletions"
                            @tagClick="onTagClick"
                            :input-text-compatible="true"
                            :disabled="collectionItem.authentication.disabled"
                            :key="'oauth-client-secret'"
                        />
                        <input
                            v-else
                            type="password"
                            v-model="collectionItem.authentication.clientSecret"
                            :disabled="collectionItem.authentication.disabled"
                        >
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

                <!-- Authorization Code Grant Type Fields -->
                <template v-if="collectionItem.authentication.grantType === 'authorization_code'">
                    <tr>
                        <td class="user-select-none">
                            <label for="oauth-auth-url" :class="{ disabled: collectionItem.authentication.disabled }">
                                Authorization URL
                            </label>
                        </td>
                        <td class="full-width">
                            <CodeMirrorSingleLine
                                v-model="collectionItem.authentication.authorizationUrl"
                                :env-variables="collectionItemEnvironmentResolved"
                                :autocompletions="tagAutocompletions"
                                @tagClick="onTagClick"
                                :input-text-compatible="true"
                                :disabled="collectionItem.authentication.disabled"
                                :key="'oauth-auth-url'"
                            />
                        </td>
                    </tr>
                    <tr>
                        <td class="user-select-none">
                            <label for="oauth-redirect-uri" :class="{ disabled: collectionItem.authentication.disabled }">
                                Redirect URI
                            </label>
                        </td>
                        <td class="full-width">
                            <CodeMirrorSingleLine
                                v-model="collectionItem.authentication.redirectUri"
                                :env-variables="collectionItemEnvironmentResolved"
                                :autocompletions="tagAutocompletions"
                                @tagClick="onTagClick"
                                :input-text-compatible="true"
                                :disabled="collectionItem.authentication.disabled"
                                :key="'oauth-redirect-uri'"
                            />
                        </td>
                    </tr>
                    <tr>
                        <td class="user-select-none">
                            <label for="oauth-state" :class="{ disabled: collectionItem.authentication.disabled }">
                                State (Optional)
                            </label>
                        </td>
                        <td class="full-width">
                            <CodeMirrorSingleLine
                                v-model="collectionItem.authentication.state"
                                :env-variables="collectionItemEnvironmentResolved"
                                :autocompletions="tagAutocompletions"
                                @tagClick="onTagClick"
                                :input-text-compatible="true"
                                :disabled="collectionItem.authentication.disabled"
                                :key="'oauth-state'"
                            />
                        </td>
                    </tr>
                    <tr>
                        <td class="user-select-none">
                            <label for="oauth-pkce" :class="{ disabled: collectionItem.authentication.disabled }">
                                Use PKCE
                            </label>
                        </td>
                        <td class="full-width">
                            <input
                                type="checkbox"
                                v-model="collectionItem.authentication.usePKCE"
                                :disabled="collectionItem.authentication.disabled"
                                id="oauth-pkce"
                            />
                        </td>
                    </tr>
                    <tr v-if="collectionItem.authentication.usePKCE">
                        <td class="user-select-none">
                            <label for="oauth-code-verifier" :class="{ disabled: collectionItem.authentication.disabled }">
                                Code Verifier
                            </label>
                        </td>
                        <td class="full-width">
                            <div style="display: flex; gap: 8px;">
                                <CodeMirrorSingleLine
                                    v-model="collectionItem.authentication.codeVerifier"
                                    :env-variables="collectionItemEnvironmentResolved"
                                    :autocompletions="tagAutocompletions"
                                    @tagClick="onTagClick"
                                    :input-text-compatible="true"
                                    :disabled="collectionItem.authentication.disabled"
                                    :key="'oauth-code-verifier'"
                                    style="flex: 1;"
                                />
                                <button type="button" class="button" @click="generateCodeVerifier" :disabled="collectionItem.authentication.disabled">Generate</button>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td class="user-select-none">
                            <label for="oauth-auth-code" :class="{ disabled: collectionItem.authentication.disabled }">
                                Authorization Code
                            </label>
                        </td>
                        <td class="full-width">
                            <CodeMirrorSingleLine
                                v-model="collectionItem.authentication.authorizationCode"
                                :env-variables="collectionItemEnvironmentResolved"
                                :autocompletions="tagAutocompletions"
                                @tagClick="onTagClick"
                                :input-text-compatible="true"
                                :disabled="collectionItem.authentication.disabled"
                                :key="'oauth-auth-code'"
                            />
                        </td>
                    </tr>
                </template>

                <!-- Common OAuth2 fields -->
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

                <!-- Password Grant Type Fields -->
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
                                v-if="!flags.hidePasswordFields"
                                v-model="collectionItem.authentication.password"
                                :env-variables="collectionItemEnvironmentResolved"
                                :autocompletions="tagAutocompletions"
                                @tagClick="onTagClick"
                                :input-text-compatible="true"
                                :disabled="collectionItem.authentication.disabled"
                                :key="'oauth-password'"
                            />
                            <input
                                v-else
                                type="password"
                                v-model="collectionItem.authentication.password"
                                :disabled="collectionItem.authentication.disabled"
                            >
                        </td>
                    </tr>
                </template>

                <!-- Action buttons -->
                <tr>
                    <td colspan="2">
                        <template v-if="collectionItem.authentication.grantType === 'authorization_code'">
                            <button type="button" class="button" @click="openAuthorizationUrl" :disabled="collectionItem.authentication.disabled">Get Authorization Code</button>
                            <button type="button" class="button" @click="requestOAuthToken" :disabled="collectionItem.authentication.disabled || !collectionItem.authentication.authorizationCode" style="margin-left: 8px;">Get Token</button>
                        </template>
                        <template v-else>
                            <button type="button" class="button" @click="requestOAuthToken" :disabled="collectionItem.authentication.disabled">Get Token</button>
                        </template>
                        <button type="button" class="button" @click="refreshOAuthToken" :disabled="collectionItem.authentication.disabled || !collectionItem.authentication.refreshToken" style="margin-left: 8px;">Refresh Token</button>
                    </td>
                </tr>

                <!-- Token display -->
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
                        <label for="refresh-token" :class="{ disabled: collectionItem.authentication.disabled }">
                            Refresh Token
                        </label>
                    </td>
                    <td class="user-select">
                        <label for="refresh-token" style="max-width: 100px; word-wrap: break-word">
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
import { CollectionItem, Flags } from '@/global'
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
    },
    flags: {
        type: Object as PropType<Flags>,
        required: true
    },
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
        'label': 'Authorization Code',
        'value': constants.GRANT_TYPES.authorization_code,
        'class': 'context-menu-item-with-left-padding'
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

// PKCE helper functions
function generateRandomString(length: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
    let result = ''
    for (let i = 0; i < length; i++) {
        result += charset.charAt(Math.floor(Math.random() * charset.length))
    }
    return result
}

async function sha256(plain: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(plain)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')
}

function generateCodeVerifier() {
    if (props.collectionItem.authentication) {
        props.collectionItem.authentication.codeVerifier = generateRandomString(50)
    }
}

function generateRandomState(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

async function openAuthorizationUrl() {
    const auth = props.collectionItem?.authentication
    const env = props.collectionItemEnvironmentResolved

    if (auth) {
        try {
            const clientId: string = await substituteEnvironmentVariables(env, auth.clientId)
            const authorizationUrl: string = await substituteEnvironmentVariables(env, auth.authorizationUrl)
            const redirectUri: string = await substituteEnvironmentVariables(env, auth.redirectUri)
            const scope: string = auth.scope ? await substituteEnvironmentVariables(env, auth.scope) : ''

            if (isMissing(clientId) || isMissing(authorizationUrl) || isMissing(redirectUri)) {
                toast.error('Please provide Client ID, Authorization URL, and Redirect URI.')
                return
            }

            // Generate a random state if not provided
            let state = auth.state || generateRandomState()
            if (!auth.state) {
                auth.state = state
            }
            state = await substituteEnvironmentVariables(env, state)

            // Build authorization URL
            const params = new URLSearchParams({
                response_type: 'code',
                client_id: clientId,
                redirect_uri: redirectUri,
                state: state,
            })

            if (scope) {
                params.append('scope', scope)
            }

            // Handle PKCE if enabled
            if (auth.usePKCE) {
                if (!auth.codeVerifier) {
                    generateCodeVerifier()
                }
                if (auth.codeVerifier) {
                    const codeChallenge = await sha256(auth.codeVerifier)
                    params.append('code_challenge', codeChallenge)
                    params.append('code_challenge_method', 'S256')
                }
            }

            const fullAuthUrl = `${authorizationUrl}?${params.toString()}`

            // Open authorization URL in browser
            if (typeof window !== 'undefined' && window.open) {
                window.open(fullAuthUrl, '_blank')
                toast.info('Authorization URL opened in browser. Copy the authorization code from the redirect URL.')
            } else {
                // Fallback: copy URL to clipboard or show it
                navigator.clipboard?.writeText(fullAuthUrl).then(() => {
                    toast.info('Authorization URL copied to clipboard. Open it in a browser.')
                }).catch(() => {
                    console.log('Authorization URL:', fullAuthUrl)
                    toast.info('Check console for authorization URL.')
                })
            }
        } catch (error) {
            console.error('Error opening authorization URL:', error)
            toast.error('Error opening authorization URL.')
        }
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
        const grantType: string | any = auth.grantType

        oath2Precheck(clientId, clientSecret, accessTokenUrl, grantType)

        const bodyData = new URLSearchParams({
            grant_type: grantType,
            client_id: clientId,
            client_secret: clientSecret,
        })

        if (scope) {
            bodyData.append('scope', scope)
        }

        // Handle different grant types
        if (grantType === 'password') {
            const username: string = await substituteEnvironmentVariables(env, auth.username)
            const password: string = await substituteEnvironmentVariables(env, auth.password)
            bodyData.append('username', username)
            bodyData.append('password', password)
        } else if (grantType === 'authorization_code') {
            const authorizationCode: string = await substituteEnvironmentVariables(env, auth.authorizationCode)
            const redirectUri: string = await substituteEnvironmentVariables(env, auth.redirectUri)

            if (isMissing(authorizationCode) || isMissing(redirectUri)) {
                toast.error('Please provide Authorization Code and Redirect URI.')
                return
            }

            bodyData.append('code', authorizationCode)
            bodyData.append('redirect_uri', redirectUri)

            // Add code verifier for PKCE
            if (auth.usePKCE && auth.codeVerifier) {
                bodyData.append('code_verifier', auth.codeVerifier)
            }
        }

        try {
            const abortController = new AbortController()

            const headers = {
                'Content-Type': constants.MIME_TYPE.FORM_URL_ENCODED
            }

            const response = await fetchWrapper(accessTokenUrl, 'POST', headers, bodyData.toString(), abortController.signal, {
                electronSwitchToChromiumFetch: props.flags.electronSwitchToChromiumFetch,
                disableSSLVerification: props.flags.disableSSLVerification,
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

    if(auth) {
        if(props.collectionItem && props.collectionItem.authentication) {
            const clientId: string = await substituteEnvironmentVariables(env, auth.clientId)
            const clientSecret: string = await substituteEnvironmentVariables(env, auth.clientSecret)
            const accessTokenUrl: any = await substituteEnvironmentVariables(env, auth.accessTokenUrl)
            const refreshToken: string | any = props.collectionItem.authentication.refreshToken

            oath2Precheck(clientId, clientSecret, accessTokenUrl, auth.grantType)

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
                    electronSwitchToChromiumFetch: props.flags.electronSwitchToChromiumFetch,
                    disableSSLVerification: props.flags.disableSSLVerification,
                })

                if(response.status !== 200) {
                    couldNotFetchTokenError(response)
                    return
                }

                const res = JSON.parse(new TextDecoder().decode(response.buffer))
                if(props.collectionItem && props.collectionItem.authentication) {
                    props.collectionItem.authentication.token = res.access_token
                    if('refresh_token' in res) {
                        props.collectionItem.authentication.refreshToken = res.refresh_token
                    }
                }
                toast.success('OAuth token refreshed successfully!')

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

function oath2Precheck(clientId: string, clientSecret: string, accessTokenUrl: string, grantType?: string) {
    if (grantType && grantType === 'authorization_code') {
        const auth = props.collectionItem?.authentication
        if (auth) {
            if (!auth.authorizationUrl || !auth.redirectUri || !auth.authorizationCode) {
                toast.error('Please provide Authorization URL, Redirect URI, and Authorization Code.')
                return
            }
            if (auth.usePKCE && !auth.codeVerifier) {
                toast.error('Please provide Code Verifier for PKCE.')
                return
            }
        }
    } else if (!clientId || !clientSecret || !accessTokenUrl) {
        toast.error('Please provide all OAuth credentials.')
        return
    }
}

function onTagClick(...args: any) {
    emit('tagClick', ...args)
}

function isMissing(value: any) {
    return value === undefined || value === null || value === '' || value === 'undefined'
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
