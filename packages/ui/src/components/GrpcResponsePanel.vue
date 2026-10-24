<template>
    <div class="grpc-response-panel-waiting" v-if="call && running && !call.liveShown">
        <h2>{{ call.phase === 'connecting' ? 'Connecting...' : 'Waiting for the reply...' }}</h2>
        <div class="pad">
            <i class="fas fa-sync fa-spin"></i>
        </div>
        <div class="pad">
            <button class="button" @click="cancelCall">{{ stopLabel }}</button>
        </div>
    </div>
    <template v-if="shown !== null">
        <div class="response-panel-address-bar">
            <div class="response-panel-address-bar-tag-container">
                <div
                    class="tag"
                    :class="[statusTag.color, { 'grpc-response-panel-live-status': shown.live }]"
                    style="max-width: 15rem; text-overflow: ellipsis; overflow: hidden;"
                    :title="statusTag.title"
                    data-testid="grpc-response-panel-status"
                >
                    {{ statusTag.label }}
                </div>
                <div class="tag ml-0_6rem" :class="{ 'tag-running': shown.live }" :title="shown.live ? 'Running for' : 'Time taken'">{{ shown.live ? humanFriendlyRunningTime(timeTaken) : humanFriendlyTime(timeTaken) }}</div>
                <div class="tag ml-0_6rem" v-if="(shown.result.kind ?? 'unary') !== 'unary'">{{ counts.sent }} sent · {{ counts.received }} received</div>
            </div>
            <!-- where the request panel is out of sight, as on a phone, this is the way to stop -->
            <div class="grpc-response-panel-stream-actions" v-if="shown.live">
                <button class="button" @click="cancelCall" title="Stop the call. What arrived is kept." data-testid="grpc-response-panel-stop">{{ stopLabel }}</button>
            </div>
            <div class="response-panel-address-bar-select-container" v-if="!shown.live && shown.createdAt">
                <div class="custom-dropdown" @click="handleHistoryMenu" @contextmenu.prevent="handleHistoryMenu" title="Earlier calls of this request">
                    <span class="custom-dropdown-content">{{ timeAgo(shown.createdAt) }} | {{ dateFormat(shown.createdAt, true) }} | {{ shown.name ?? shownCallName }}</span>
                    <i class="fa fa-caret-down space-right"></i>
                </div>
            </div>
        </div>
        <div class="response-panel-tabs">
            <div class="response-panel-tab-strip">
                <div
                    class="response-panel-tab"
                    :class="{ 'response-panel-tab-active': activeResponsePanelTab === responsePanelTab.name }"
                    @click="activeResponsePanelTab = responsePanelTab.name"
                    v-for="responsePanelTab in responsePanelTabs"
                    :data-testid="`grpc-response-panel-tab-${responsePanelTab.name}`"
                >
                    {{ responsePanelTab.label }}
                </div>
            </div>
            <div class="response-panel-tab-fill"></div>
            <div class="response-panel-tab-actions" v-if="singleReply !== null && activeResponsePanelTab === 'Messages'">
                <i class="fas fa-code" @mousedown.prevent="setSelectedTextAsEnvironmentVariable(singleReplyPreview.selectedText)" title="Set selected text as environment variable"></i>
            </div>
        </div>
        <div class="response-panel-tabs-context grpc-response-panel-context">
            <template v-if="activeResponsePanelTab === 'Messages'">
                <div class="grpc-response-panel-banner" v-if="endedMessage" data-testid="grpc-response-panel-banner">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>{{ endedMessage }}</span>
                    <button type="button" class="button" v-if="errorDetails" @click="showErrorDetails = !showErrorDetails">{{ showErrorDetails ? 'Hide details' : 'Details' }}</button>
                </div>
                <div class="grpc-response-panel-error-details" v-if="errorDetails && showErrorDetails">
                    <CodeMirrorResponsePanelPreview :model-value="errorDetails" />
                </div>
                <div class="grpc-response-panel-messages">
                    <template v-if="singleReply !== null">
                        <div class="grpc-response-panel-banner" v-if="singleReplyPreview.note">{{ singleReplyPreview.note }}</div>
                        <div class="content-box" v-if="singleReply.decodeError">{{ singleReply.decodeError }}</div>
                        <div class="content-box grpc-response-panel-warning" v-if="singleReplyPreview.shouldShowLargeResponseWarning">
                            <i class="fas fa-exclamation-triangle"></i>
                            <h3>Large Response Warning</h3>
                            <p>This response is {{ humanFriendlySize(singleReplyPreview.responseSize) }} in size.</p>
                            <p>Loading large responses may slow down the interface.</p>
                            <button class="button" @click="singleReplyPreview.largeResponseConfirmed = true">Load Response</button>
                        </div>
                        <template v-else>
                            <CodeMirrorResponsePanelPreview v-if="singleReply.json !== undefined" :model-value="singleReplyPreview.json" @selection-changed="singleReplyPreview.selectedText = $event" />
                            <template v-if="singleReply.bytes !== undefined">
                                <div class="grpc-response-panel-banner">Bytes (base64)</div>
                                <CodeMirrorResponsePanelPreview :model-value="singleReply.bytes" @selection-changed="singleReplyPreview.selectedText = $event" />
                            </template>
                        </template>
                    </template>
                    <GrpcMessageList
                        v-else
                        :key="shown.id"
                        :events="shown.result.events"
                        :revision="shown.revision"
                        :live="shown.live"
                        :view-state="messageListViewStateFor(shown.id)"
                        @set-environment-variable="setSelectedTextAsEnvironmentVariable"
                    />
                </div>
            </template>
            <div class="content-box" v-if="activeResponsePanelTab === 'Metadata' || activeResponsePanelTab === 'Trailers'">
                <template v-if="activeResponsePanelTab === 'Metadata'">
                    <template v-if="shown.result.sentMetadata?.length">
                        <h4 class="grpc-response-panel-metadata-heading">Sent</h4>
                        <table>
                            <tr v-for="([name, value], index) in shown.result.sentMetadata" :key="index">
                                <td style="white-space: nowrap">{{ name }}</td>
                                <td style="word-break: break-word">{{ value }}</td>
                            </tr>
                        </table>
                    </template>
                    <h4 class="grpc-response-panel-metadata-heading">Received</h4>
                </template>
                <table v-if="shownMetadata.length > 0">
                    <tr v-for="([name, value], index) in shownMetadata" :key="index">
                        <td style="white-space: nowrap">{{ name }}</td>
                        <td style="word-break: break-word">{{ value }}</td>
                    </tr>
                </table>
                <div class="grpc-response-panel-hint" v-else>{{ shownMetadataEmptyText }}</div>
            </div>
        </div>
    </template>
    <template v-else>
        <div class="grpc-response-panel-empty">
            <div v-if="!available" class="grpc-response-panel-empty-note">
                <div>{{ unavailableMessage }}</div>
                <div><a href="https://github.com/flawiddsouza/Restfox/releases" target="_blank" rel="noopener noreferrer">Download the Restfox desktop app</a></div>
            </div>
            <div v-else-if="!running">{{ emptyText }}</div>
        </div>
    </template>
    <ContextMenu
        :options="historyMenuOptions"
        :element="historyMenuElement"
        :x="historyMenuX"
        :y="historyMenuY"
        :width="historyMenuWidth"
        v-model:show="showHistoryMenu"
        :selected-option="entry ?? undefined"
        @click="handleHistoryMenuClick"
    />
    <MobileBottomSheet
        v-if="isMobile"
        v-model:show="showHistorySheet"
        title="Call History"
        :items="mobileHistorySheetItems"
        @select="handleHistoryMenuClick"
    />
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, onActivated, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue'
import { Store, useStore } from 'vuex'
import type { CollectionItem, GrpcCallKind, GrpcCallResult, GrpcCallResultEvent, GrpcFinalResponse, GrpcMetadata, State } from '@/global'
import CodeMirrorResponsePanelPreview from './CodeMirrorResponsePanelPreview.vue'
import ContextMenu from './ContextMenu.vue'
import MobileBottomSheet from './MobileBottomSheet.vue'
import GrpcMessageList from './GrpcMessageList.vue'
import { useMobile } from '@/composables/useMobile'
import { dateFormat, getAlertConfirmPromptContainer, humanFriendlyRunningTime, humanFriendlySize, humanFriendlyTime, setEnvironmentVariable, timeAgo } from '@/helpers'
import { useToast } from 'vue-toast-notification'
import {
    GRPC_UNAVAILABLE_MESSAGE,
    type GrpcMessageListViewState,
    findGrpcMethod,
    formatGrpcJson,
    getGrpcCallKind,
    getGrpcEndedMessage,
    getGrpcStatusColor,
    getGrpcStatusLabel,
    getGrpcStopLabel,
    getGrpcMethodShortName,
    isClientStreaming,
    useGrpcMessagePreview,
} from '@/utils/grpc'
import { cancelGrpcCallForItem, getGrpcItemKey, grpcCalls, grpcItemSchemaKeys, grpcSchemas, isGrpcCallRunning, type GrpcLiveCall } from '@/utils/grpc-calls'
import { isGrpcAvailable } from '@/utils/grpc-transport'

// how often a running call's time is redrawn
const CLOCK_EVERY_MS = 100
// the history menu's narrowest width
const HISTORY_MENU_MIN_WIDTH_REM = 26

// a call on screen: the running one, or a finished one from history
interface ShownCall {
    id: string
    live: boolean
    createdAt: number | null
    name: string | null
    result: GrpcCallResult
    revision: number
}

function escapeHtml(text: string) {
    return text.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)
}

const props = defineProps<{
    activeTab: CollectionItem
}>()

const store: Store<State> = useStore()
const instance = getCurrentInstance()
const toast = useToast()
const { isMobile } = useMobile()

const activeResponsePanelTab = ref('Messages')
const showErrorDetails = ref(false)
const now = ref(Date.now())
const historyMenuElement = ref<HTMLElement | null>(null)
const historyMenuX = ref<number | null>(null)
const historyMenuY = ref<number | null>(null)
const historyMenuWidth = ref<number | null>(null)
const historyMenuType = ref<'click' | 'contextmenu'>('click')
const showHistoryMenu = ref(false)
const showHistorySheet = ref(false)
const mobileHistorySheetItems = ref<any[]>([])
const unavailableMessage = GRPC_UNAVAILABLE_MESSAGE

// only the lists of calls kept on screen, kept out of reactive state since nothing renders from it
const messageListViewStates = new Map<string, GrpcMessageListViewState>()
let clockTimer: ReturnType<typeof setInterval> | undefined = undefined
// false while KeepAlive keeps the panel out of sight, where its item's call can still start, as from a window of
// its own, and no clock runs
let active = true

const available = computed((): boolean => {
    return isGrpcAvailable()
})

const call = computed((): GrpcLiveCall | null => {
    return grpcCalls[getGrpcItemKey(props.activeTab)] ?? null
})

const running = computed((): boolean => {
    return isGrpcCallRunning(call.value)
})

// the request panel's button says the same while the call runs
const stopLabel = computed((): string => {
    return getGrpcStopLabel(call.value?.kind)
})

// what the item's chosen method is, when its methods have loaded
const itemKind = computed((): GrpcCallKind | null => {
    const key = grpcItemSchemaKeys[getGrpcItemKey(props.activeTab)]
    const method = key ? findGrpcMethod(grpcSchemas[key]?.schema, props.activeTab.grpc?.service, props.activeTab.grpc?.method) : null
    return method ? getGrpcCallKind(method) : null
})

const emptyText = computed((): string => {
    return isClientStreaming(itemKind.value) ? 'Start the stream to see its messages here' : 'Send the call to see its response here'
})

// the call picked in history, the newest one unless another was picked
const entry = computed((): GrpcFinalResponse | null => {
    const entry = store.state.requestResponses[props.activeTab._id]
    return entry && entry.grpc ? entry : null
})

const entries = computed((): GrpcFinalResponse[] => {
    return (store.state.responses[props.activeTab._id] ?? []).filter((entry: any) => entry && entry.grpc)
})

const shown = computed((): ShownCall | null => {
    const liveCall = call.value
    // a running stream shows its messages once it has run a moment, a reply that comes at once never shows live
    if(liveCall && running.value && liveCall.liveShown) {
        return {
            id: liveCall.id,
            live: true,
            createdAt: liveCall.createdAt,
            name: null,
            result: {
                url: liveCall.url,
                service: liveCall.service,
                method: liveCall.method,
                kind: liveCall.kind ?? 'unary',
                events: liveCall.events,
                sentMetadata: liveCall.sentMetadata,
                headers: liveCall.headers ?? [],
                trailers: liveCall.trailers ?? [],
                status: null,
                // the clock shows it while it runs
                timeTaken: 0,
                ended: 'completed',
            },
            revision: liveCall.revision,
        }
    }
    const shownEntry = entry.value
    if(shownEntry) {
        return {
            id: shownEntry._id,
            live: false,
            createdAt: shownEntry.createdAt,
            name: shownEntry.name ?? null,
            result: shownEntry.grpc,
            // the finished list of the call that was live keeps reading its messages
            revision: liveCall && liveCall.id === shownEntry._id ? liveCall.revision : 0,
        }
    }
    return null
})

const shownCallName = computed((): string => {
    const result = shown.value?.result
    return result ? getCallName(result) : ''
})

const timeTaken = computed((): number => {
    if(!shown.value) {
        return 0
    }
    if(shown.value.live && call.value) {
        return call.value.startedAt === null ? 0 : Math.max(0, now.value - call.value.startedAt)
    }
    return shown.value.result.timeTaken
})

const counts = computed((): { sent: number, received: number } => {
    if(shown.value?.live && call.value) {
        return { sent: call.value.sentCount, received: call.value.receivedCount }
    }
    const events = shown.value?.result.events ?? []
    let sent = 0
    for(const event of events) {
        if(event.type === 'sent') {
            sent++
        }
    }
    return { sent, received: events.length - sent }
})

const statusTag = computed((): { label: string, color: string, title: string } => {
    const shownCall = shown.value
    if(!shownCall) {
        return { label: '', color: '', title: '' }
    }
    const result = shownCall.result
    if(shownCall.live) {
        if(call.value?.phase === 'connecting') {
            return { label: 'Connecting', color: '', title: 'Connecting to the server' }
        }
        const receiving = result.kind === 'serverStream' || call.value?.halfClosed
        return {
            label: receiving ? 'Receiving' : 'Open',
            color: '',
            title: receiving ? 'The server is still sending' : 'The stream is open for your messages',
        }
    }
    if(result.status) {
        return {
            label: getGrpcStatusLabel(result.status),
            color: getGrpcStatusColor(result.status),
            title: result.status.details || getGrpcStatusLabel(result.status),
        }
    }
    if(result.ended === 'cancelled') {
        return { label: 'CANCELLED', color: '', title: 'Stopped before the server answered' }
    }
    return { label: 'Failed', color: 'red', title: result.error ?? 'The call failed' }
})

const endedMessage = computed((): string | null => {
    if(!shown.value || shown.value.live) {
        return null
    }
    return getGrpcEndedMessage(shown.value.result)
})

const errorDetails = computed((): string | null => {
    const text = shown.value?.result.status?.errorDetails
    return text === undefined ? null : formatGrpcJson(text, singleReplyPreview.indentSize)
})

// A unary call's reply reads best as a whole. Any other call is a list, a client stream's too, whose messages
// the user sent are in it
const singleReply = computed((): GrpcCallResultEvent | null => {
    const shownCall = shown.value
    if(!shownCall || shownCall.live || (shownCall.result.kind ?? 'unary') !== 'unary') {
        return null
    }
    const received = shownCall.result.events.filter(event => event.type === 'received')
    return received.length === 1 ? received[0] : null
})

const singleReplyPreview = reactive(useGrpcMessagePreview(() => singleReply.value))

async function setSelectedTextAsEnvironmentVariable(selectedText: string) {
    if(selectedText === '') {
        return
    }
    const environment = store.state.activeWorkspace?.environment ?? {}
    const container = getAlertConfirmPromptContainer(instance!.proxy!.$el as HTMLElement)
    const name = await container.createPrompt('Select / Enter environment variable name', '', Object.keys(environment))
    if(name === null || name === '') {
        return
    }
    setEnvironmentVariable(store as any, name, selectedText)
    toast.success(`Environment variable set: ${name}`)
}

const responsePanelTabs = computed((): { name: string, label: string }[] => {
    const headers = shown.value?.result.headers ?? []
    const trailers = shown.value?.result.trailers ?? []
    return [
        { name: 'Messages', label: 'Messages' },
        { name: 'Metadata', label: headers.length > 0 ? `Metadata (${headers.length})` : 'Metadata' },
        { name: 'Trailers', label: trailers.length > 0 ? `Trailers (${trailers.length})` : 'Trailers' },
    ]
})

const shownMetadata = computed((): GrpcMetadata => {
    if(!shown.value) {
        return []
    }
    return activeResponsePanelTab.value === 'Trailers' ? shown.value.result.trailers : shown.value.result.headers
})

const shownMetadataEmptyText = computed((): string => {
    const isTrailers = activeResponsePanelTab.value === 'Trailers'
    if(shown.value?.live) {
        return isTrailers ? 'Trailers arrive when the call ends' : 'No metadata received yet'
    }
    return isTrailers ? 'No trailers' : 'No metadata'
})

const historyMenuOptions = computed((): any[] => {
    if(historyMenuType.value === 'contextmenu') {
        return [
            { type: 'option', label: 'Rename Current Response', value: 'Rename Current Response', icon: 'fa fa-edit', disabled: entry.value === null },
            { type: 'option', label: 'Delete Current Response', value: 'Delete Current Response', icon: 'fa fa-trash', disabled: entry.value === null },
            { type: 'option', label: 'Clear History', value: 'Clear History', icon: 'fa fa-trash' },
        ]
    }
    return entries.value.map(entry => {
        const result = entry.grpc
        const tag = describeEntryStatus(result)
        const name = entry.name ?? getCallName(result)
        const label = `
                    <div style="display: flex; flex-wrap: wrap; align-items: center;">
                        <div>${dateFormat(entry.createdAt, true)}</div> <div class="tag ${tag.color}" style="padding: 2px 3px; margin-left: 0.5rem;">${escapeHtml(tag.label)}</div> <div class="tag" style="padding: 2px 3px; margin-left: 0.5rem;">${humanFriendlyTime(result.timeTaken)}</div>
                    </div>
                    <div style="margin-top: 0.2rem;">${escapeHtml(name)}</div>
                `
        return { type: 'option', label, value: entry }
    })
})

function updateClock(isRunning: boolean) {
    clearInterval(clockTimer)
    clockTimer = undefined
    now.value = Date.now()
    if(isRunning) {
        clockTimer = setInterval(() => {
            now.value = Date.now()
        }, CLOCK_EVERY_MS)
    }
}

function cancelCall() {
    cancelGrpcCallForItem(store, props.activeTab)
}

// the same object for as long as the list shows the same call, so its finished list starts where the live one was
function messageListViewStateFor(id: string): GrpcMessageListViewState {
    let viewState = messageListViewStates.get(id)
    if(!viewState) {
        // one call's place is all the panel shows at a time
        messageListViewStates.clear()
        viewState = { scrollTop: null, stickToBottom: null, selectedIndex: null }
        messageListViewStates.set(id, viewState)
    }
    return viewState
}

// its method, or its server for a call made before a method was chosen
function getCallName(result: GrpcCallResult) {
    return result.service ? getGrpcMethodShortName(result.service, result.method) : result.url
}

function describeEntryStatus(result: GrpcCallResult): { label: string, color: string } {
    if(result.status) {
        return { label: getGrpcStatusLabel(result.status), color: getGrpcStatusColor(result.status) }
    }
    if(result.ended === 'cancelled') {
        return { label: 'CANCELLED', color: '' }
    }
    return { label: 'Failed', color: 'red' }
}

function handleHistoryMenu(event: MouseEvent) {
    historyMenuType.value = event.type === 'click' ? 'click' : 'contextmenu'

    if(isMobile.value) {
        if(historyMenuType.value === 'click') {
            mobileHistorySheetItems.value = entries.value.map(entry => {
                const tag = describeEntryStatus(entry.grpc)
                return {
                    label: dateFormat(entry.createdAt, true),
                    tags: [
                        { text: tag.label, color: tag.color },
                        { text: humanFriendlyTime(entry.grpc.timeTaken) },
                    ],
                    sublabel: entry.name ?? getCallName(entry.grpc),
                    value: entry,
                }
            })
        } else {
            mobileHistorySheetItems.value = [
                { label: 'Rename Response', value: 'Rename Current Response', icon: 'fa-edit' },
                { label: 'Delete Response', value: 'Delete Current Response', icon: 'fa-trash', type: 'danger' },
                { label: 'Clear History', value: 'Clear History', icon: 'fa-trash', type: 'danger' },
            ]
        }
        showHistorySheet.value = true
        return
    }

    const containerElement = (event.target as HTMLElement).closest('.custom-dropdown') as HTMLElement
    const rect = containerElement.getBoundingClientRect()
    historyMenuX.value = rect.left
    historyMenuY.value = rect.top + rect.height
    // the list of calls is at least wide enough for a call's date, a long status such as DEADLINE_EXCEEDED (4) and its
    // time on one line
    const rowWidth = historyMenuType.value === 'click' ? HISTORY_MENU_MIN_WIDTH_REM * parseFloat(getComputedStyle(document.documentElement).fontSize) : 0
    historyMenuWidth.value = Math.min(Math.max(rect.width, rowWidth), window.innerWidth)
    historyMenuElement.value = containerElement
    showHistoryMenu.value = true
}

async function handleHistoryMenuClick(clicked: any) {
    if(clicked === 'Rename Current Response') {
        // the component's first node, which is in the window the panel is in
        const newName = await getAlertConfirmPromptContainer(instance!.proxy!.$el as HTMLElement).createPrompt('Enter new response name', entry.value?.name)
        if(newName === null) {
            return
        }
        store.commit('renameCurrentlyActiveResponse', { name: newName, collectionItem: props.activeTab })
        return
    }

    if(clicked === 'Delete Current Response') {
        store.commit('deleteCurrentlyActiveResponse', props.activeTab)
        return
    }

    if(clicked === 'Clear History') {
        store.commit('clearResponseHistory', props.activeTab)
        return
    }

    store.state.requestResponses[props.activeTab._id] = clicked
}

watch(running, (isRunning: boolean) => {
    updateClock(isRunning && active)
}, { immediate: true })

watch(() => shown.value?.id, () => {
    showErrorDetails.value = false
})

onActivated(() => {
    active = true
    updateClock(running.value)
})

onDeactivated(() => {
    active = false
    updateClock(false)
})

onBeforeUnmount(() => {
    updateClock(false)
})
</script>

<style scoped>
.grpc-response-panel-waiting {
    background-color: var(--response-panel-loader-background-color);
    color: var(--response-panel-loader-color);
    position: absolute;
    inset: 0;
    z-index: 9;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    text-align: center;
}

.grpc-response-panel-stream-actions {
    display: flex;
    align-items: center;
    height: 100%;
    margin-left: 1rem;
    padding-right: 0.5rem;
    flex-shrink: 0;
}

.grpc-response-panel-waiting h2 {
    font-weight: 500;
}

.grpc-response-panel-waiting .pad {
    padding: calc(1rem * 1.2);
}

.grpc-response-panel-waiting .fas {
    font-size: 4rem;
}

/* the banner and the details keep their height, the messages take the rest */
.response-panel-tabs-context.grpc-response-panel-context {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
}

.grpc-response-panel-context > .content-box {
    overflow: auto;
}

/* while the call runs, as wide as its longest label, Connecting, so the tags after it stay put as it changes */
.grpc-response-panel-live-status {
    box-sizing: content-box;
    min-width: 10ch;
    text-align: center;
}

.grpc-response-panel-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background-color: var(--sidebar-item-active-color);
    border-bottom: 1px solid var(--default-border-color);
    word-break: break-word;
}

.grpc-response-panel-banner span {
    flex: 1;
}

.grpc-response-panel-banner i {
    color: var(--base-color-warning);
}

.grpc-response-panel-error-details {
    flex: 0 0 35%;
    min-height: 4rem;
    border-bottom: 1px solid var(--default-border-color);
}

.grpc-response-panel-messages {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
}

.grpc-response-panel-messages > .code-mirror-response-panel-preview {
    flex: 1 1 0;
    min-height: 0;
}

.grpc-response-panel-warning {
    text-align: center;
    padding: 2rem;
    overflow: auto;
}

.grpc-response-panel-warning > .fas {
    font-size: 3rem;
    color: var(--base-color-warning);
    margin-bottom: 1rem;
}

.grpc-response-panel-hint {
    color: var(--tip-text-color);
}

.grpc-response-panel-metadata-heading {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--tip-text-color);
}

.grpc-response-panel-context table + .grpc-response-panel-metadata-heading {
    margin-top: 1rem;
}

.grpc-response-panel-empty {
    display: grid;
    place-items: center;
    height: 100%;
    grid-row: span 3;
    padding: 1rem;
    text-align: center;
}

.grpc-response-panel-empty-note {
    display: grid;
    gap: 0.75rem;
    max-width: 28rem;
    line-height: 1.4;
}
</style>
