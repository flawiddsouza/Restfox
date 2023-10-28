<template>
    <div class="client-container">
        <div class="client-component">
            <div class="d-f flex-jc-sb mb-0_5rem ml-1rem mr-0_5rem mt-0_5rem">
                <div>
                    <div style="display: inline-flex">
                        <div v-for="(client, index) in clients">
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
                <template v-for="client in clients">
                    <div
                        class="client"
                        v-if="!client.visibility || client.visibility === 'shown'"
                    >
                        <div class="d-f flex-ai-c p-0_5rem bc-primary">
                            <select
                                v-model="client.type"
                                class="h-100p"
                                :disabled="isClientConnected(client) ? true : false"
                            >
                                <option :value="undefined">WS</option>
                                <option value="Socket.IO">IO</option>
                            </select>
                            <input
                                type="text"
                                v-model="client.url"
                                :placeholder="`${client.type === undefined ? 'WebSocket URL' : 'Socket.IO URL'}`"
                                class="ml-0_5rem w-100p"
                                :disabled="isClientConnected(client)"
                            />
                            <div class="ml-0_5rem">
                                <button
                                    @click="connect(client)"
                                    v-if="!isClientConnected(client)"
                                >
                                    Connect
                                </button>
                                <button @click="disconnect(client)" v-else>
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
                                    v-if="client.type === 'Socket.IO'"
                                />
                            </div>
                            <textarea
                                class="w-100p mt-0_5rem"
                                rows="5"
                                placeholder="Payload"
                                v-model="client.message"
                                @input="updateCurrentPayload(client, 'payload', ($event as any).target.value)"
                            ></textarea>
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
import { Ref, ref, nextTick, onBeforeMount, reactive, computed } from 'vue'
import { Client, ClientPayload, ClientMessage } from './SocketPanel.types'
import { formatTimestamp, generateId, getObjectPaths } from '@/helpers'
import getObjectPathValue from 'lodash.get'
import Tabs from './Tabs.vue'
import { Socket, io } from 'socket.io-client'
import { useStore } from 'vuex'

// Data Variables

const messageContainerRefs: any = reactive({})

function handleMessageContainerRef(ref: any, clientId: string) {
    messageContainerRefs[clientId] = ref
}

const clients: Ref<Client[]> = ref([])

// Computed
const store = useStore()
const activeTab = computed(() => store.state.activeTab)

// Methods

function addClient() {
    const payloadId = generateId()

    clients.value.push({
        id: generateId(),
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
        ws: null,
        visibility: 'shown'
    })
}

function removeClient(client: Client) {
    if (!confirm('Are you sure you want to remove this client?')) {
        return
    }
    client.ws?.close()
    clients.value = clients.value.filter(
        (clientItem) => clientItem.id !== client.id
    )
}

function toggleClientVisibility(client: Client) {
    client.visibility =
        !client.visibility || client.visibility === 'shown' ? 'hidden' : 'shown'
}

async function connect(client: Client) {
    if (client.url === '') {
        return
    }

    let clientUrlWithEnvironmentVariablesSubtituted = client.url
    const { environment } = await store.dispatch('getEnvironmentForRequest', activeTab)
    const possibleEnvironmentObjectPaths: string[] = getObjectPaths(environment)

    possibleEnvironmentObjectPaths.forEach(objectPath => {
        const objectPathValue = getObjectPathValue(environment, objectPath)
        clientUrlWithEnvironmentVariablesSubtituted = clientUrlWithEnvironmentVariablesSubtituted.replace(`{{ _.${objectPath} }}`, objectPathValue)
        clientUrlWithEnvironmentVariablesSubtituted = clientUrlWithEnvironmentVariablesSubtituted.replace(`{{${objectPath}}}`, objectPathValue)
    })

    try {
        if (client.type === undefined) {
            client.ws = new WebSocket(clientUrlWithEnvironmentVariablesSubtituted)
        } else if (client.type === 'Socket.IO') {
            client.ws = io(clientUrlWithEnvironmentVariablesSubtituted)
        }
    } catch {
        alert(`Invalid WebSocket URL: ${clientUrlWithEnvironmentVariablesSubtituted}`)
        return
    }

    if (client.ws instanceof WebSocket) {
        client.ws.addEventListener('message', async(e) => {
            let receivedMessage = e.data

            clientMessageHandler(client, receivedMessage)
        })

        client.ws.addEventListener('close', async() => {
            disconnect(client)
        })
    }

    if (client.ws instanceof Socket) {
        client.ws.onAny(async(event, ...args) => {
            const receivedMessage = `[${event}] ${args[0]}`
            clientMessageHandler(client, receivedMessage)
        })

        client.ws.on('disconnect', async() => {
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
        client.message = JSON.stringify(parsedMessage, null, 4)
        client.payloads.find(payload => payload.id === client.currentPayloadId)!.payload = client.message
    } catch {
        alert('Invalid JSON')
    }
}

async function sendMessage(client: Client) {
    if (client.message === '') {
        return
    }

    if (client.ws instanceof Socket && (client.event === undefined || client.event === '')) {
        return
    }

    let messageToSend = client.message

    const { environment } = await store.dispatch('getEnvironmentForRequest', activeTab)
    const possibleEnvironmentObjectPaths: string[] = getObjectPaths(environment)

    possibleEnvironmentObjectPaths.forEach(objectPath => {
        const objectPathValue = getObjectPathValue(environment, objectPath)
        messageToSend = messageToSend.replace(`{{ _.${objectPath} }}`, objectPathValue)
        messageToSend = messageToSend.replace(`{{${objectPath}}}`, objectPathValue)
    })

    if (client.ws instanceof WebSocket) {
        client.ws.send(messageToSend)
    }

    if (client.ws instanceof Socket && client.event !== undefined) {
        client.ws.emit(client.event, messageToSend)
    }

    let clientMessageToSave = messageToSend

    if (client.ws instanceof Socket) {
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
    client.ws?.close()
    client.ws = null
}

function parseAndFormatMessage(message: string) {
    let parsedMessage = null
    try {
        parsedMessage = JSON.stringify(JSON.parse(message), null, 4)
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
    const savedClients = getItem('clients')
    if (savedClients) {
        clients.value = savedClients
        clients.value.forEach((client) => {
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
            ws: null,
            visibility: 'shown'
        }

        clients.value = [initialClient]
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

function closePayloadTab(client: Client, event: { tabToClose: ClientPayload, tabToOpen: ClientPayload }) {
    if(client.payloads.length === 1) {
        alert('Cannot delete payload as there\'s only one payload left')
        return
    }

    if(!confirm(`Are you sure you want to remove "${event.tabToClose.name}?"`)) {
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

function getItem(key: string) {
    return activeTab.value[key]
}

function isClientConnected(client: Client) {
    if(client.ws instanceof WebSocket) {
        return true
    }

    if(client.ws instanceof Socket) {
        return true
    }

    return false
}

// Lifecycle Events

onBeforeMount(async() => {
    loadSavedClients()
})
</script>

<style scoped>
.client-container {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
}

.client-sidebar {
    height: 100%;
    overflow-y: auto;
    border: 1px solid var(--default-border-color);
    width: 10rem;
    padding: 0.5rem;
}

.client-sidebar > .client-sidebar-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
    padding-left: 0.5rem;
    padding-right: 0.1rem;
    cursor: pointer;
}

.client-sidebar > .client-sidebar-item.client-sidebar-item-selected {
    background-color: cadetblue;
    color: white;
}

.client-sidebar > .client-sidebar-item > .client-sidebar-item-menu {
    visibility: hidden;
    border-radius: 10px;
}

.client-sidebar > .client-sidebar-item:hover > .client-sidebar-item-menu,
.client-sidebar > .client-sidebar-item > .client-sidebar-item-menu.client-sidebar-item-menu-disable-hide {
    visibility: visible;
}

.client-sidebar > .client-sidebar-item.client-sidebar-item-selected > .client-sidebar-item-menu svg {
    fill: white;
}

.client-sidebar > .client-sidebar-item > .client-sidebar-item-menu:hover,
.client-sidebar > .client-sidebar-item > .client-sidebar-item-menu.client-sidebar-item-menu-disable-hide {
    background-color: rgba(240, 248, 255, 0.233);
}

.client-sidebar > .client-sidebar-item:not(.client-sidebar-item-selected) > .client-sidebar-item-menu:hover,
.client-sidebar > .client-sidebar-item:not(.client-sidebar-item-selected) > .client-sidebar-item-menu.client-sidebar-item-menu-disable-hide {
    background-color: rgb(108 194 197 / 20%);
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
    background-color: #ddffb6;
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
    background-color: #edf2f7;
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
    background-color: cadetblue;
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
    color: black;
}

button.icon:hover {
    background-color: transparent;
    border: 0;
    color: blue;
}

button.icon > svg {
    display: block;
}

textarea,
input,
select {
    outline: 0;
    border: 1px solid var(--default-border-color);
    border-radius: 0.25rem;
    padding: 0.5rem;
    font: inherit;
    background-color: white;
}

textarea {
    resize: vertical;
}

input:disabled {
    background-color: #f4f4f4;
}

select {
    padding: 0.2rem 0.6rem;
}
</style>
