<template>
    <div class="client-container" ref="componentRoot">
        <div class="client-component">
            <div v-if="isMobile" class="mobile-client-tabs">
                <div
                    v-for="(client, index) in activeTab.clients"
                    :key="client.id"
                    class="mobile-client-tab"
                    :class="{ active: mobileActiveClientId === client.id }"
                    @click="mobileActiveClientId = client.id"
                >
                    <span class="mobile-client-dot" :class="{ connected: isClientConnected(client) }"></span>
                    Client {{ index + 1 }}
                    <span class="mobile-client-close" @click.stop="removeClient(client)">×</span>
                </div>
                <div class="mobile-client-add" @click="addClient">+ Add</div>
            </div>
            <div v-else class="d-f flex-jc-sb mb-0_5rem ml-1rem mr-0_5rem mt-0_5rem">
                <div>
                    <div style="display: inline-flex">
                        <div v-for="(client, index) in activeTab.clients">
                            <button
                                :style="{ 'margin-left': index !== 0 ? '0.6rem' : '' }"
                                :class="{
                                    disabled: client.visibility === 'hidden',
                                    'c-p-i': client.visibility === 'hidden'
                                }"
                                @click="toggleClientVisibility(client)"
                            >
                                Client #{{ index + 1 }}
                            </button>
                        </div>
                    </div>
                </div>
                <div>
                    <button @click="addClient">Add Client</button>
                </div>
            </div>
            <div class="clients">
                <template v-for="client in activeTab.clients">
                    <div
                        class="client"
                        v-if="isMobile ? client.id === mobileActiveClientId : (!client.visibility || client.visibility === 'shown')"
                    >
                        <div class="d-f flex-ai-c p-0_5rem bc-primary" style="min-width: 0;">
                            <select
                                v-model="client.type"
                                class="h-100p"
                                :disabled="isClientConnected(client) ? true : false"
                            >
                                <option :value="undefined">WS</option>
                                <option value="Socket.IO">IO v4</option>
                                <option value="Socket.IO-v3">IO v3</option>
                                <option value="Socket.IO-v2">IO v2</option>
                            </select>
                            <CodeMirrorSingleLine
                                v-model="client.url"
                                :placeholder="`${client.type === undefined ? 'WebSocket URL' : 'Socket.IO URL'}`"
                                :env-variables="collectionItemEnvironmentResolved"
                                :input-text-compatible="true"
                                :disabled="isClientConnected(client)"
                                class="input ml-0_5rem w-100p o-a"
                            />
                            <div class="ml-0_5rem">
                                <button
                                    @click="isRepeatClick($event) || connect(client)"
                                    v-if="!isClientConnected(client)"
                                >
                                    Connect
                                </button>
                                <button @click="isRepeatClick($event) || disconnect(client)" v-else>
                                    Disconnect
                                </button>
                            </div>
                            <div class="ml-0_5rem">
                                <button class="icon" @click="removeClient(client)">
                                    <svg
                                        stroke="currentColor"
                                        fill="currentColor"
                                        stroke-width="0"
                                        viewBox="0 0 1024 1024"
                                        height="1em"
                                        width="1em"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path
                                            d="M360 184h-8c4.4 0 8-3.6 8-8v8h304v-8c0 4.4 3.6 8 8 8h-8v72h72v-80c0-35.3-28.7-64-64-64H352c-35.3 0-64 28.7-64 64v80h72v-72zm504 72H160c-17.7 0-32 14.3-32 32v32c0 4.4 3.6 8 8 8h60.4l24.7 523c1.6 34.1 29.8 61 63.9 61h454c34.2 0 62.3-26.8 63.9-61l24.7-523H888c4.4 0 8-3.6 8-8v-32c0-17.7-14.3-32-32-32zM731.3 840H292.7l-24.2-512h487l-24.2 512z"
                                        ></path>
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div class="p-0_5rem o-a">
                            <tabs
                                :tabs="client.payloads"
                                :current-tab-id="client.currentPayloadId"
                                @change-tab="changePayloadTab(client, $event)"
                                @close-tab="closePayloadTab(client, $event)"
                            >
                                <button @click="addNewPayload(client)" style="white-space: nowrap" title="Add New Payload">+</button>
                            </tabs>
                            <div class="d-f mt-0_5rem">
                                <input
                                    type="text"
                                    placeholder="Payload Name"
                                    class="w-100p"
                                    :value="getCurrentPayloadValue(client, 'name')"
                                    @input="updateCurrentPayload(client, 'name', ($event as any).target.value)"
                                />
                                <input
                                    type="text"
                                    placeholder="Event Name"
                                    class="w-100p ml-0_5rem"
                                    :value="getCurrentPayloadValue(client, 'event')"
                                    @input="updateCurrentPayload(client, 'event', ($event as any).target.value)"
                                    v-if="client.type && client.type.startsWith('Socket.IO')"
                                />
                            </div>
                            <CodeMirrorSingleLine
                                v-model="client.message"
                                @update:modelValue="updateCurrentPayload(client, 'payload', $event)"
                                :placeholder="`Payload`"
                                :env-variables="collectionItemEnvironmentResolved"
                                :input-text-compatible="true"
                                :allow-multiple-lines="true"
                                lang="json"
                                class="w-100p mt-0_5rem input o-a"
                                style="resize: vertical; margin-bottom: 0.2rem;"
                                v-initial-height
                            />
                            <div class="d-f flex-jc-sb">
                                <button
                                    @click="beautifyJSON(client)"
                                >
                                    Beautify JSON
                                </button>
                                <button
                                    @click="sendMessage(client)"
                                    :disabled="!isClientConnected(client)"
                                >
                                    Send
                                </button>
                            </div>
                        </div>

                        <div class="p-0_5rem bc-primary">
                            <div class="d-f flex-jc-sb flex-ai-c">
                                <div>Messages</div>
                                <div class="d-f flex-ai-c">
                                    <i class="fas fa-code" @mousedown.prevent="setSelectedTextAsEnvironmentVariable" title="Set selected text as environment variable" style="cursor: pointer;"></i>
                                    <button class="icon" @click="clearMessages(client)">
                                        <svg
                                            stroke="currentColor"
                                            fill="currentColor"
                                            stroke-width="0"
                                            viewBox="0 0 1024 1024"
                                            height="1em"
                                            width="1em"
                                            xmlns="http://www.w3.org/2000/svg"
                                        >
                                            <path
                                                d="M360 184h-8c4.4 0 8-3.6 8-8v8h304v-8c0 4.4 3.6 8 8 8h-8v72h72v-80c0-35.3-28.7-64-64-64H352c-35.3 0-64 28.7-64 64v80h72v-72zm504 72H160c-17.7 0-32 14.3-32 32v32c0 4.4 3.6 8 8 8h60.4l24.7 523c1.6 34.1 29.8 61 63.9 61h454c34.2 0 62.3-26.8 63.9-61l24.7-523H888c4.4 0 8-3.6 8-8v-32c0-17.7-14.3-32-32-32zM731.3 840H292.7l-24.2-512h487l-24.2 512z"
                                            ></path>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div class="oy-a">
                            <table
                                :ref="
                                    (element) =>
                                        handleMessageContainerRef(
                                            element,
                                            client.id
                                        )
                                "
                            >
                                <tbody>
                                    <tr
                                        v-for="message in client.messages"
                                        :class="{
                                            'green-row': message.type === 'SEND',
                                            'red-row': message.type === 'RECEIVE'
                                        }"
                                    >
                                        <td style="width: 1px; white-space: nowrap">
                                            <div
                                                v-if="message.type === 'INFO'"
                                            >
                                                <svg viewBox="0 0 24 24" width="1.2em" height="1.2em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4m0-4h.01"></path></g></svg>
                                            </div>
                                            <div
                                                v-if="message.type === 'SEND'"
                                                style="color: green"
                                            >
                                                <svg
                                                    class="d-b"
                                                    stroke="currentColor"
                                                    fill="currentColor"
                                                    stroke-width="0"
                                                    viewBox="0 0 448 512"
                                                    height="1em"
                                                    width="1em"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                >
                                                    <title>Sent payload</title>
                                                    <path
                                                        d="M34.9 289.5l-22.2-22.2c-9.4-9.4-9.4-24.6 0-33.9L207 39c9.4-9.4 24.6-9.4 33.9 0l194.3 194.3c9.4 9.4 9.4 24.6 0 33.9L413 289.4c-9.5 9.5-25 9.3-34.3-.4L264 168.6V456c0 13.3-10.7 24-24 24h-32c-13.3 0-24-10.7-24-24V168.6L69.2 289.1c-9.3 9.8-24.8 10-34.3.4z"
                                                    ></path>
                                                </svg>
                                            </div>
                                            <div
                                                v-if="message.type === 'RECEIVE'"
                                                style="color: #cb3737"
                                            >
                                                <svg
                                                    class="d-b"
                                                    stroke="currentColor"
                                                    fill="currentColor"
                                                    stroke-width="0"
                                                    viewBox="0 0 448 512"
                                                    height="1em"
                                                    width="1em"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                >
                                                    <title>Received payload</title>
                                                    <path
                                                        d="M413.1 222.5l22.2 22.2c9.4 9.4 9.4 24.6 0 33.9L241 473c-9.4 9.4-24.6 9.4-33.9 0L12.7 278.6c-9.4-9.4-9.4-24.6 0-33.9l22.2-22.2c9.5-9.5 25-9.3 34.3.4L184 343.4V56c0-13.3 10.7-24 24-24h32c13.3 0 24 10.7 24 24v287.4l114.8-120.5c9.3-9.8 24.8-10 34.3-.4z"
                                                    ></path>
                                                </svg>
                                            </div>
                                        </td>
                                        <td style="width: 100%; white-space: pre-wrap; word-break: break-all;">
                                            {{
                                                parseAndFormatMessage(
                                                    message.message
                                                )
                                            }}
                                        </td>
                                        <td style="width: 1px; white-space: nowrap">
                                            {{ formatTimestamp(message.timestamp) }}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeMount, reactive, computed, inject, ref, toRaw } from 'vue'
import { useMobile } from '@/composables/useMobile'
import { Client, ClientPayload, ClientMessage } from './SocketPanel.types'
import {
    formatTimestamp,
    generateId,
    getSocketConnectionUrl,
    getAlertConfirmPromptContainer,
    setEnvironmentVariable,
    jsonStringify,
    substituteEnvironmentVariables,
    registerCACertificates,
} from '@/helpers'
import Tabs from './Tabs.vue'
import ioV2 from 'socket.io-client-v2'
import { io as ioV3 } from 'socket.io-client-v3'
import { io as ioV4 } from 'socket.io-client-v4'
import { useStore } from 'vuex'
import CodeMirrorSingleLine from './CodeMirrorSingleLine.vue'

// Props
const props = defineProps<{
    activeTab: any
}>()

// Data Variables

const { isMobile } = useMobile()
const mobileActiveClientId = ref<string | null>(null)
const componentRoot = ref<HTMLElement | null>(null)

const messageContainerRefs: any = reactive({})

function handleMessageContainerRef(ref: any, clientId: string) {
    // ref can suddenly become null when tab is switched to a request tab and switched back to a socket tab
    if(ref === null) {
        return
    }
    messageContainerRefs[clientId] = ref
}

const disconnectTriggered: { [key: string]: boolean } = reactive({})

const clientUrlsEnvSubstituted: { [key: string]: string } = reactive({})

// the client type and url of each connection attempt still waiting for its first answer. Connect shows until a socket
// is connected, so a second click for the same attempt, such as a double click, is ignored instead of opening a second socket
const pendingConnections: { [key: string]: string } = {}

// Computed
const store = useStore()
const activeWorkspace = computed(() => store.state.activeWorkspace)
const activeTab = computed(() => props.activeTab)
const collectionItemEnvironmentResolved = computed(() => store.state.tabEnvironmentResolved[activeTab.value._id])
const sockets = store.state.sockets
const flags = computed(() => store.state.flags)
const $toast: { success: (message: string) => void, error: (message: string) => void } = inject('$toast')

// Methods

function addClient() {
    const payloadId = generateId()
    const newId = generateId()

    activeTab.value.clients.push({
        id: newId,
        url: '',
        payloads: [
            {
                id: payloadId,
                name: 'Payload 1',
                payload: ''
            }
        ],
        currentPayloadId: payloadId,
        message: '',
        messages: [],
        visibility: 'shown'
    })
    mobileActiveClientId.value = newId
}

async function removeClient(client: Client) {
    const container = getAlertConfirmPromptContainer(componentRoot.value!)
    if (!await container.createConfirm('Are you sure you want to remove this client?')) {
        return
    }
    sockets[activeTab.value._id + '-' + client.id]?.close()
    activeTab.value.clients = activeTab.value.clients.filter(
        (clientItem: Client) => clientItem.id !== client.id
    )
    if (mobileActiveClientId.value === client.id) {
        mobileActiveClientId.value = activeTab.value.clients[0]?.id ?? null
    }
}

function toggleClientVisibility(client: Client) {
    client.visibility =
        !client.visibility || client.visibility === 'shown' ? 'hidden' : 'shown'
}

// Connect and Disconnect share a spot, so the second click of a double click lands on whichever replaced the first and
// would disconnect a socket that connected in between. The browser counts clicks at one spot in detail
function isRepeatClick(event: MouseEvent) {
    return event.detail > 1
}

async function connect(client: Client) {
    if (client.url === '') {
        return
    }

    const socketKey = activeTab.value._id + '-' + client.id
    const connectionTarget = `${client.type ?? 'WebSocket'} ${client.url}`

    if (pendingConnections[socketKey] === connectionTarget) {
        return
    }

    pendingConnections[socketKey] = connectionTarget

    const { environment } = await store.dispatch('getEnvironmentForRequest', { collectionItem: activeTab.value })
    const clientUrlWithEnvironmentVariablesSubtituted = await substituteEnvironmentVariables(environment, client.url)

    // web-standalone's server connects a secure socket for the browser when CA certificates are set, and needs them
    // registered first
    let caCertificatesId: string | null = null

    if (flags.value.isWebStandalone && flags.value.caCertificates && !flags.value.disableSSLVerification && /^(wss|https):/i.test(clientUrlWithEnvironmentVariablesSubtituted)) {
        try {
            caCertificatesId = await registerCACertificates(flags.value.caCertificates.certificates)
        } catch (error: any) {
            delete pendingConnections[socketKey]

            addClientMessage(client, {
                timestamp: new Date().getTime(),
                message: `Could not connect to ${clientUrlWithEnvironmentVariablesSubtituted}: ${error.message}`,
                type: 'INFO'
            })

            return
        }
    }

    clientUrlsEnvSubstituted[activeTab.value._id + '-' + client.id] = clientUrlWithEnvironmentVariablesSubtituted

    // a socket Connect is still showing for has failed or is still trying, such as a Socket.IO v2 client that
    // reconnects on its own, it would otherwise stay open next to the new one with no way to disconnect it
    const previousSocket = sockets[socketKey]

    if (previousSocket) {
        previousSocket.close()
        sockets[socketKey] = null
    }

    try {
        if (client.type === undefined) {
            sockets[activeTab.value._id + '-' + client.id] = new WebSocket(getSocketConnectionUrl(clientUrlWithEnvironmentVariablesSubtituted, { ...flags.value, caCertificatesId }))
        } else if (client.type.startsWith('Socket.IO')) {
            const targetUrl = new URL(clientUrlWithEnvironmentVariablesSubtituted)

            if(targetUrl.pathname === '/') {
                targetUrl.pathname = '/socket.io/'
            }

            const parsedUrl = new URL(getSocketConnectionUrl(targetUrl.href, { ...flags.value, caCertificatesId }))

            let mainUrl = parsedUrl.origin

            if(parsedUrl.search) {
                mainUrl += parsedUrl.search
            }

            if (client.type === 'Socket.IO-v2') {
                sockets[activeTab.value._id + '-' + client.id] = ioV2(mainUrl, {
                    path: parsedUrl.pathname,
                })
            }

            if (client.type === 'Socket.IO-v3') {
                sockets[activeTab.value._id + '-' + client.id] = ioV3(mainUrl, {
                    path: parsedUrl.pathname,
                    reconnection: false,
                })
            }

            if (client.type === 'Socket.IO') {
                sockets[activeTab.value._id + '-' + client.id] = ioV4(mainUrl, {
                    path: parsedUrl.pathname,
                    reconnection: false,
                })
            }
        }
    } catch(e) {
        console.log(e)
        delete pendingConnections[socketKey]
        $toast.error(`Invalid WebSocket URL: ${clientUrlWithEnvironmentVariablesSubtituted}`)
        return
    }

    addClientMessage(client, {
        timestamp: new Date().getTime(),
        message: `Connecting to ${clientUrlWithEnvironmentVariablesSubtituted}`,
        type: 'INFO'
    })

    const socket = sockets[activeTab.value._id + '-' + client.id]

    // a later Connect replaced this socket and closed it, anything it still reports, such as the close of a socket that
    // was connecting, is ignored so it cannot disconnect the socket that replaced it. Read from the store, which outlives
    // this panel, and null after a Disconnect, when this socket still reports its own close
    const isReplaced = () => {
        const currentSocket = sockets[socketKey]
        return currentSocket !== null && currentSocket !== undefined && toRaw(currentSocket) !== toRaw(socket)
    }

    // the attempt got its first answer, a Connect for the same client and url starts a new attempt from here on
    function settleConnectionAttempt() {
        if (pendingConnections[socketKey] === connectionTarget) {
            delete pendingConnections[socketKey]
        }
    }

    // says a connection failed, and why when the client knows, once per run of failed attempts
    let connectionFailureReported = false

    function reportConnectionFailure(reason?: string) {
        settleConnectionAttempt()

        if (connectionFailureReported) {
            return
        }

        connectionFailureReported = true

        let message = `Could not connect to ${clientUrlWithEnvironmentVariablesSubtituted}${reason ? `: ${reason}` : ''}`

        // browsers do not say why a connection failed, a rejected certificate looks like any other failure
        if ((flags.value.isElectron || flags.value.isWebStandalone) && !flags.value.disableSSLVerification && /^(wss|https):/i.test(clientUrlWithEnvironmentVariablesSubtituted)) {
            message += '. If the server uses a self-signed certificate or one from your own CA, add it in Settings > Request / Response > CA Certificates or tick Disable SSL Verification there'
        }

        addClientMessage(client, {
            timestamp: new Date().getTime(),
            message,
            type: 'INFO'
        })
    }

    if (socket instanceof WebSocket) {
        let opened = false

        socket.addEventListener('open', async() => {
            opened = true
            settleConnectionAttempt()

            addClientMessage(client, {
                timestamp: new Date().getTime(),
                message: `Connected to ${clientUrlWithEnvironmentVariablesSubtituted}`,
                type: 'INFO'
            })
        })

        socket.addEventListener('error', () => {
            if (!opened && !isReplaced()) {
                reportConnectionFailure()
            }
        })

        socket.addEventListener('message', async(e) => {
            let receivedMessage = e.data

            clientMessageHandler(client, receivedMessage)
        })

        socket.addEventListener('close', async() => {
            if (isReplaced()) {
                return
            }

            disconnect(client)

            addClientMessage(client, {
                timestamp: new Date().getTime(),
                message: `Disconnected from ${clientUrlWithEnvironmentVariablesSubtituted}`,
                type: 'INFO'
            })
        })
    }

    if (socket.constructor.name.startsWith('Socket')) {
        socket.on('connect', async() => {
            // v2 reconnects on its own, a later failure is reported again
            connectionFailureReported = false
            settleConnectionAttempt()

            addClientMessage(client, {
                timestamp: new Date().getTime(),
                message: `Connected to ${clientUrlWithEnvironmentVariablesSubtituted}`,
                type: 'INFO'
            })
        })

        // v3 and v4 stop after this, v2 keeps retrying and reports the first failure of each run of retries
        socket.on('connect_error', (error: Error) => {
            if (!isReplaced()) {
                reportConnectionFailure(error.message)
            }
        })

        if (client.type === 'Socket.IO-v2') {
            // a v2 server refusing the connection, such as from a middleware, sends its reason as an error
            socket.on('error', (error: unknown) => {
                if (!isReplaced()) {
                    reportConnectionFailure(error instanceof Error ? error.message : String(error))
                }
            })

            const originalOnevent = socket.onevent

            socket.onevent = function(packet) {
                const event = packet.data[0]
                const args = packet.data.slice(1)
                const receivedMessage = `[${event}] ${typeof args[0] === 'object' ? jsonStringify(args[0]) : args[0]}`
                clientMessageHandler(client, receivedMessage)
                originalOnevent.call(this, packet)
            }
        }

        if (client.type === 'Socket.IO-v3' || client.type === 'Socket.IO') {
            socket.onAny(async(event, ...args) => {
                const receivedMessage = `[${event}] ${typeof args[0] === 'object' ? jsonStringify(args[0]) : args[0]}`
                clientMessageHandler(client, receivedMessage)
            })
        }

        socket.on('disconnect', async() => {
            if (disconnectTriggered[client.id] || isReplaced()) {
                return
            }

            disconnect(client)
        })
    }
}

async function clientMessageHandler(client: Client, receivedMessage: string) {
    const clientMessage: ClientMessage = {
        timestamp: new Date().getTime(),
        message: receivedMessage,
        type: 'RECEIVE'
    }

    addClientMessage(client, clientMessage)
}

function addClientMessage(client: Client, clientMessage: ClientMessage) {
    if (!Array.isArray(client.messages)) {
        client.messages = []
    }

    client.messages.push(clientMessage)

    // keep only last 100 messages to avoid crashing the application
    client.messages = client.messages.slice(-100)

    if (client.visibility !== 'hidden') {
        scrollToBottomClientMessages(client.id)
    }
}

function beautifyJSON(client: Client) {
    try {
        const parsedMessage = JSON.parse(client.message)
        client.message = jsonStringify(parsedMessage)
        client.payloads.find(payload => payload.id === client.currentPayloadId)!.payload = client.message
    } catch {
        $toast.error('Invalid JSON')
    }
}

async function sendMessage(client: Client) {
    if (client.message === '') {
        return
    }

    const socket = sockets[activeTab.value._id + '-' + client.id]

    if (socket.constructor.name.startsWith('Socket') && (client.event === undefined || client.event === '')) {
        return
    }

    const { environment } = await store.dispatch('getEnvironmentForRequest', { collectionItem: activeTab.value })
    const messageToSend = await substituteEnvironmentVariables(environment, client.message)

    if (socket instanceof WebSocket) {
        socket.send(messageToSend)
    }

    if (socket.constructor.name.startsWith('Socket') && client.event !== undefined) {
        socket.emit(client.event, messageToSend)
    }

    let clientMessageToSave = messageToSend

    if (socket.constructor.name.startsWith('Socket')) {
        clientMessageToSave = `[${client.event}] ${clientMessageToSave}`
    }

    const clientMessage: ClientMessage = {
        timestamp: new Date().getTime(),
        message: clientMessageToSave,
        type: 'SEND'
    }

    addClientMessage(client, clientMessage)
}

function clearMessages(client: Client) {
    client.messages = []
}

function disconnect(client: Client) {
    const socket = sockets[activeTab.value._id + '-' + client.id]

    if(socket === undefined || socket === null || disconnectTriggered[client.id]) {
        return false
    }

    disconnectTriggered[client.id] = true
    delete pendingConnections[activeTab.value._id + '-' + client.id]

    if(socket instanceof WebSocket) {
        socket.close()
    }

    if(socket.constructor.name.startsWith('Socket')) {
        socket.disconnect()

        addClientMessage(client, {
            timestamp: new Date().getTime(),
            message: `Disconnected from ${clientUrlsEnvSubstituted[activeTab.value._id + '-' + client.id]}`,
            type: 'INFO'
        })
    }

    sockets[activeTab.value._id + '-' + client.id] = null

    nextTick(() => {
        disconnectTriggered[client.id] = false
    })
}

function parseAndFormatMessage(message: string) {
    let parsedMessage = null
    try {
        parsedMessage = jsonStringify(JSON.parse(message))
    } catch {}
    if (parsedMessage) {
        return parsedMessage
    }
    return message
}

function scrollToBottomClientMessages(clientId: string) {
    nextTick(() => {
        messageContainerRefs[clientId].scrollIntoView({
            behavior: 'auto',
            block: 'end'
        })
    })
}

function loadSavedClients() {
    const savedClients = activeTab.value.clients
    if (savedClients) {
        mobileActiveClientId.value = savedClients[0]?.id ?? null
        activeTab.value.clients.forEach((client) => {
            if (client.visibility !== 'hidden') {
                scrollToBottomClientMessages(client.id)
            }
        })
    } else {
        const firstPayloadId = generateId()

        const initialClient: Client = {
            id: generateId(),
            url: '',
            payloads: [
                {
                    id: firstPayloadId,
                    name: 'Payload 1',
                    payload: ''
                }
            ],
            currentPayloadId: firstPayloadId,
            message: '',
            messages: [],
            visibility: 'shown'
        }

        activeTab.value.clients = [initialClient]
        mobileActiveClientId.value = initialClient.id
    }
}

function addNewPayload(client: Client) {
    const payloadId = generateId()

    client.payloads.push({
        id: payloadId,
        name: `Payload ${client.payloads.length + 1}`,
        payload: ''
    })

    client.currentPayloadId = payloadId
    client.message = ''
}

function updateCurrentPayload(client: Client, field: 'name' | 'event' | 'payload', value: string) {
    const payloadToUpdate: ClientPayload | undefined = client.payloads.find(payload => payload.id === client.currentPayloadId)
    if(payloadToUpdate) {
        payloadToUpdate[field] = value
        if (field === 'event') {
            client.event = value
        }
    }
}

function changePayloadTab(client: Client, tab: ClientPayload) {
    client.currentPayloadId = tab.id
    client.message = tab.payload
    client.event = tab.event
}

async function closePayloadTab(client: Client, event: { tabToClose: ClientPayload, tabToOpen: ClientPayload }) {
    if(client.payloads.length === 1) {
        $toast.error('Cannot delete payload as there\'s only one payload left')
        return
    }

    const container = getAlertConfirmPromptContainer(componentRoot.value!)

    if(!await container.createConfirm(`Are you sure you want to remove "${event.tabToClose.name}?"`)) {
        return
    }

    client.payloads = client.payloads.filter(clientPayload => clientPayload.id !== event.tabToClose.id)

    if(event.tabToOpen) {
        client.currentPayloadId = event.tabToOpen.id
        client.message = event.tabToOpen.payload
    }
}

function getCurrentPayloadValue(client: Client, field: 'name' | 'event' | 'payload') {
    const currentPayload: ClientPayload | undefined = client.payloads.find(payload => payload.id === client.currentPayloadId)

    if (currentPayload !== undefined) {
        return currentPayload[field]
    }

    return undefined
}

function isClientConnected(client: Client) {
    const socket = sockets[activeTab.value._id + '-' + client.id]

    if(socket === undefined || socket === null) {
        return false
    }

    if(socket instanceof WebSocket) {
        return socket.readyState === WebSocket.OPEN
    }

    if(socket.constructor.name.startsWith('Socket')) {
        return socket.connected
    }

    return false
}

function getSelectedText() {
    const selection = window.getSelection()

    if (!selection.rangeCount) {
        return ''
    }

    return selection.getRangeAt(0).toString()
}

async function setSelectedTextAsEnvironmentVariable() {
    const currentlySelectedText = getSelectedText()

    if(currentlySelectedText === '') {
        return
    }

    const environment = activeWorkspace.value.environment ?? {}
    const currentlyDefinedEnvironmentVariables = Object.keys(environment)

    const container = getAlertConfirmPromptContainer(componentRoot.value!)

    const environmentVariableName = await container.createPrompt('Select / Enter environment variable name', '', currentlyDefinedEnvironmentVariables)

    if(environmentVariableName === null || environmentVariableName === '') {
        return
    }

    setEnvironmentVariable(store, environmentVariableName, currentlySelectedText)

    $toast.success(`Environment variable set: ${environmentVariableName}`)
}

const vInitialHeight = {
    mounted(el: HTMLElement) {
        if(!el.style.height) {
            el.style.height = '5.8rem'
        }
    }
}

// Lifecycle Events

onBeforeMount(async() => {
    loadSavedClients()
})
</script>

<style scoped>
.mobile-client-tabs {
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
    border-bottom: 1px solid var(--default-border-color);
    background: var(--background-color);
    flex-shrink: 0;
}

.mobile-client-tabs::-webkit-scrollbar { display: none; }

.mobile-client-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 8px 12px;
    font-size: 12px;
    color: var(--text-color);
    border-right: 1px solid var(--default-border-color);
    white-space: nowrap;
    cursor: pointer;
    flex-shrink: 0;
}

.mobile-client-tab.active {
    background: var(--background-color);
    border-top: 2px solid var(--primary-background-color);
    color: var(--text-color);
}

.mobile-client-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--default-border-color);
    display: inline-block;
    flex-shrink: 0;
}

.mobile-client-dot.connected {
    background: #75ba24;
}

.mobile-client-close {
    color: var(--tip-text-color);
    font-size: 14px;
    line-height: 1;
    margin-left: 2px;
}

.mobile-client-add {
    padding: 8px 12px;
    color: var(--primary-background-color);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
}

.client-container {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
}

.client-component {
    display: grid;
    height: 100%;
    overflow-y: auto;
    grid-template-rows: auto 1fr;
}

.clients {
    display: flex;
    gap: 0.5rem;
    height: 100%;
    overflow-y: auto;
}

.client {
    flex: 1;
    display: grid;
    grid-template-rows: auto auto auto 1fr;
    border: 1px solid var(--default-border-color);
    border-radius: 5px;
}

@media (max-width: 768px) {
    .client {
        flex: 0 0 100%;
        border-radius: 0;
        border-left: none;
        border-right: none;
    }
}

.client:first-child {
    border-left: 0;
}

table tr > td:first-child {
    border-left: 0;
}

table tr > td:last-child {
    border-right: 0;
}

table tr.green-row > td {
    background-color: var(--socket-green-row-background-color);
}

table svg {
    font-size: 0.9rem;
}

/* table tr.red-row > td {
    background-color: #ffb6b6;
} */

.code-editor {
    height: calc(100% - 1.2rem);
    overflow-y: auto;
    border: 1px solid var(--default-border-color);
}

.context-menu {
    position: absolute;
    top: 0;
    left: 0;
    background-color: white;
    border-radius: 5px;
    box-shadow: 1px 1px 8px -4px black;
}

.context-menu > div {
    padding: 0.3rem 0.5rem;
    cursor: pointer;
}

.context-menu > div:hover {
    background-color: slateblue;
    color: white;
}

/* functional classes */

.d-b {
    display: block;
}

.d-f {
    display: flex;
}

.flex-jc-sb {
    justify-content: space-between;
}

.flex-ai-c {
    align-items: center;
}

.ml-0_5rem {
    margin-left: 0.5rem;
}

.mr-0_5rem {
    margin-right: 0.5rem;
}

.mb-0_5rem {
    margin-bottom: 0.5rem;
}

.mt-0_5rem {
    margin-top: 0.5rem;
}

.mt-1rem {
    margin-top: 1rem;
}

.ml-1rem {
    margin-left: 1rem;
}

.p-0_5rem {
    padding: 0.5rem;
}

.align-right {
    display: grid;
    place-items: end;
}

.bc-primary {
    background-color: var(--socket-header-background-color);
}

.w-100p {
    width: 100%;
}

.h-100p {
    height: 100%;
}

.oy-a {
    overflow-y: auto;
}

.o-a {
    overflow: auto;
}

.c-p-i {
    cursor: pointer !important;
}

/* base styles */

table {
    width: 100%;
    border-collapse: collapse;
}

table td {
    border: 1px solid var(--default-border-color);
    vertical-align: top;
    padding: 0.3rem;
}

button {
    cursor: pointer;
    background-color: var(--socket-button-background-color);
    border: 1px solid rgb(64, 107, 109);
    border-radius: 0.25rem;
    padding: 0.3rem 0.6rem;
    color: white;
    outline: 0;
}

button:hover {
    filter: brightness(1.1);
}

button:active {
    filter: brightness(1.15);
}

button:disabled,
button.disabled {
    filter: grayscale(1);
    cursor: default;
}

button.icon {
    background-color: transparent;
    border: 0;
    color: var(--text-color);
}

button.icon:hover {
    background-color: transparent;
    border: 0;
    color: #fd4343;
}

button.icon > svg {
    display: block;
}

input,
select,
.input {
    outline: 0;
    border: 1px solid var(--default-border-color);
    border-radius: 0.25rem;
    padding: 0.5rem;
    font: inherit;
    background-color: var(--background-color);
}

input:disabled, .input.disabled {
    background-color: var(--socket-input-disabled-background-color);
}

select {
    padding: 0.2rem 0.6rem;
}
</style>
