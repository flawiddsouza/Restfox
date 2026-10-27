<template>
    <template v-if="activeTab && activeTab._type === 'grpc'">
        <div class="request-panel-address-bar grpc-request-panel-address-bar" :class="`grpc-request-panel-address-bar-${addressBarFit}`" ref="addressBar">
            <div class="code-mirror-input-container" :title="running ? 'Stop the call before changing the address' : undefined">
                <CodeMirrorSingleLine
                    v-model="activeTab.url"
                    :disabled="running"
                    placeholder="localhost:50051"
                    :key="'grpc-address-bar-' + activeTab._id"
                    @keydown="handleAddressBarKeyDown"
                    :env-variables="collectionItemEnvironmentResolved"
                    :autocompletions="tagAutocompletions"
                    @tagClick="(parsedFunc: any, updateFunc: any) => !running && onTagClick(parsedFunc, updateFunc)"
                    data-testid="grpc-request-panel-address-bar"
                />
            </div>
            <div
                class="tag grpc-request-panel-target-tag"
                :class="{ red: targetPreview !== null && 'error' in targetPreview }"
                v-if="targetPreview !== null"
                :title="targetTagTitle"
            >
                <i :class="targetTagIcon" aria-hidden="true"></i><span class="grpc-request-panel-target-tag-label">{{ targetTagLabel }}</span>
            </div>
            <GrpcMethodPicker
                :disabled-reason="running ? 'Stop the call before changing the method' : null"
                :service="activeTab.grpc?.service ?? ''"
                :method="activeTab.grpc?.method ?? ''"
                :kind="kind"
                :schema-entry="schemaEntry"
                :source="protoFilesCount > 0 ? 'proto' : 'reflection'"
                :unavailable-reason="pickerUnavailableReason"
                :fit="addressBarFit"
                @select="selectMethod"
                @open="loadSchema(false, true)"
                @retry="loadSchema(true)"
                @use-proto-files="useProtoFiles"
            />
            <button
                type="button"
                class="grpc-request-panel-action"
                :disabled="actionDisabledReason !== null"
                :title="actionDisabledReason ?? actionTitle"
                @click="runAction"
                data-testid="grpc-request-panel-action-button"
            >
                {{ actionLabel }}
            </button>
        </div>
        <!-- one row of the panel's grid: the tabs, or a list of them where they do not fit, as HTTP's panel does -->
        <div class="grpc-request-panel-tabs-row" ref="tabsRow">
            <div class="request-panel-tabs" ref="fullTabs" :class="{ 'grpc-request-panel-tabs-measured': tabView === 'portable' }" :aria-hidden="tabView === 'portable' ? 'true' : undefined">
                <div
                    class="request-panel-tab"
                    :class="{ 'request-panel-tab-active': activeRequestPanelTab === requestPanelTab.name }"
                    @click="activeRequestPanelTab = requestPanelTab.name"
                    v-for="requestPanelTab in requestPanelTabs"
                    :data-testid="`grpc-request-panel-tab-${requestPanelTab.name}`"
                >
                    <RequestPanelTabTitle :request-panel-tab="requestPanelTab" :active-tab="activeTab" :doc-indicator="!!activeTab.description"></RequestPanelTabTitle>
                    <span>{{ tabCountLabels[requestPanelTab.name] ?? '' }}</span>
                </div>
                <div class="request-panel-tab-fill"></div>
            </div>
            <div class="request-panel-tabs" v-if="tabView === 'portable'">
                <div class="request-panel-tab grpc-request-panel-tab-select">
                    <select v-model="activeRequestPanelTab" data-testid="grpc-request-panel-tab-select">
                        <option v-for="requestPanelTab in requestPanelTabs" :value="requestPanelTab.name">{{ requestPanelTab.name }}{{ tabCountLabels[requestPanelTab.name] ?? '' }}</option>
                    </select>
                </div>
            </div>
            <!-- a touch screen shows no title, so the reason Send is off is written here -->
            <div class="grpc-request-panel-notice" v-if="!available && isMobile">{{ unavailableMessage }}</div>
        </div>
        <div class="request-panel-tabs-context">
            <div v-if="activeRequestPanelTab === 'Message'" class="grpc-request-panel-message">
                <div class="grpc-request-panel-editor">
                    <CodeMirrorEditor
                        v-model="message"
                        lang="json"
                        :env-variables="collectionItemEnvironmentResolved"
                        :autocompletions="tagAutocompletions"
                        @tagClick="onTagClick"
                        class="code-editor"
                        :key="'grpc-message-editor-' + activeTab._id"
                        ref="messageEditor"
                    ></CodeMirrorEditor>
                </div>
                <!-- until the stream ends, so a message clicked before End stream that fails after it still says so -->
                <div class="grpc-request-panel-send-error" v-if="call && call.sendError && running && isClientStreaming(kind)">Message not sent: {{ call.sendError }}</div>
                <div class="grpc-request-panel-send-error" v-if="call && call.endError && running && isClientStreaming(kind)">Stream not ended: {{ call.endError }}</div>
                <div class="request-panel-body-footer">
                    <button type="button" class="button" @click="beautifyJSON">Beautify JSON</button>
                    <button
                        type="button"
                        class="button"
                        :disabled="generateExampleDisabledReason !== null"
                        :title="generateExampleDisabledReason ?? `Fill in every field of ${schemaMethod?.inputType}`"
                        @click="generateExample"
                    >
                        Generate example
                    </button>
                    <div class="grpc-request-panel-footer-fill"></div>
                    <!-- there for a method that streams its requests, and disabled while the stream takes no message, so
                         the footer does not change as the call opens and ends -->
                    <template v-if="isClientStreaming(kind)">
                        <button type="button" class="button" @click="endStream" :disabled="!acceptingMessages" :title="streamButtonsDisabledReason ?? 'Tell the server you sent your last message'">End stream</button>
                        <button type="button" class="button" @click="sendMessage" :disabled="!acceptingMessages" :title="streamButtonsDisabledReason ?? `Send this message on the open stream (${sendRequestHotkey})`">Send message</button>
                    </template>
                </div>
            </div>
            <template v-if="activeRequestPanelTab === 'Metadata'">
                <RequestPanelHeaders
                    :collection-item="activeTab"
                    :collection-item-environment-resolved="collectionItemEnvironmentResolved"
                    @tagClick="onTagClick"
                />
            </template>
            <template v-if="activeRequestPanelTab === 'Auth'">
                <RequestPanelAuth
                    :collection-item="activeTab"
                    :collection-item-environment-resolved="collectionItemEnvironmentResolved"
                    :flags="flags"
                    @tagClick="onTagClick"
                />
            </template>
            <div v-if="activeRequestPanelTab === 'Proto'" class="grpc-request-panel-proto">
                <div class="grpc-request-panel-segmented" role="radiogroup" aria-label="Where the methods come from">
                    <button
                        type="button"
                        role="radio"
                        :aria-checked="protoMode === 'reflection' ? 'true' : 'false'"
                        :class="{ 'grpc-request-panel-segment-pressed': protoMode === 'reflection' }"
                        @click="setProtoMode('reflection')"
                    >
                        Server reflection
                    </button>
                    <button
                        type="button"
                        role="radio"
                        :aria-checked="protoMode === 'proto' ? 'true' : 'false'"
                        :class="{ 'grpc-request-panel-segment-pressed': protoMode === 'proto' }"
                        @click="setProtoMode('proto')"
                    >
                        .proto files
                    </button>
                </div>
                <template v-if="protoMode === 'reflection'">
                    <p class="grpc-request-panel-hint">Restfox asks the server which services it offers. The server must offer server reflection.</p>
                </template>
                <template v-else>
                    <div v-if="protoFilesCount === 0" class="grpc-request-panel-proto-empty">
                        <p class="grpc-request-panel-hint">Add the .proto files that define the service. Imports resolve against the paths of the files you add. Add a folder to keep its paths.</p>
                        <div class="grpc-request-panel-proto-buttons">
                            <button type="button" class="button" @click="pickProtoFiles(false)">Add files</button>
                            <button type="button" class="button" @click="pickProtoFiles(true)">Add folder</button>
                        </div>
                    </div>
                    <template v-else>
                        <table class="grpc-request-panel-proto-files">
                            <tr v-for="protoFile in activeTab.grpc?.protoFiles ?? []" :key="protoFile.path">
                                <td class="grpc-request-panel-proto-path" :title="protoFile.path">{{ protoFile.path }}</td>
                                <td class="grpc-request-panel-proto-size">{{ protoFileSize(protoFile) }}</td>
                                <td class="grpc-request-panel-proto-remove" @click="removeProtoFile(protoFile.path)" :title="`Remove ${protoFile.path}`">
                                    <i class="fa fa-trash"></i>
                                </td>
                            </tr>
                        </table>
                        <div class="grpc-request-panel-proto-buttons">
                            <button type="button" class="button" @click="pickProtoFiles(false)">Add files</button>
                            <button type="button" class="button" @click="pickProtoFiles(true)">Add folder</button>
                        </div>
                    </template>
                </template>
                <input type="file" ref="protoFileInput" accept=".proto" multiple style="display: none" @change="addProtoFiles($event, false)">
                <input type="file" ref="protoFolderInput" webkitdirectory multiple style="display: none" @change="addProtoFiles($event, true)">
                <div class="grpc-request-panel-proto-status" v-if="protoMode === 'reflection' || protoFilesCount > 0">
                    <span :class="{ 'grpc-request-panel-proto-status-failed': schemaStatus.failed }">{{ schemaStatus.text }}</span>
                    <!-- disabled rather than removed while the methods load, so the line keeps its layout -->
                    <button type="button" class="button" v-if="schemaStatus.showReload" :disabled="schemaStatus.loading" :title="schemaStatus.loading ? 'The methods are loading' : undefined" @click="loadSchema(true)">Reload</button>
                </div>
            </div>
            <RequestPanelDocs v-if="activeRequestPanelTab === 'Docs'" :collection-item="activeTab" v-model:editing="editDescription" />
        </div>
    </template>
    <EditTagModal
        v-if="editTagModalShow"
        v-model:showModal="editTagModalShow"
        :parsed-func="editTagParsedFunc"
        :update-func="editTagUpdateFunc"
        :active-tab="activeTab"
    />
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch, type PropType } from 'vue'
import { Store, useStore } from 'vuex'
import dayjs from 'dayjs'
import type { CollectionItem, GrpcCallKind, GrpcProtoFile, State } from '@/global'
import CodeMirrorSingleLine from '@/components/CodeMirrorSingleLine.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import RequestPanelTabTitle from '@/components/RequestPanelTabTitle.vue'
import RequestPanelHeaders from '@/components/RequestPanelHeaders.vue'
import RequestPanelAuth from '@/components/RequestPanelAuth.vue'
import RequestPanelDocs from '@/components/RequestPanelDocs.vue'
import EditTagModal from '@/components/modals/EditTagModal.vue'
import GrpcMethodPicker from '@/components/GrpcMethodPicker.vue'
import { useMobile } from '@/composables/useMobile'
import constants from '@/constants'
import { checkHotkeyAgainstKeyEvent, getAlertConfirmPromptContainer, getEditorConfig, getSpaces, humanFriendlySize, jsonStringify } from '@/helpers'
import { jsonPrettify } from '@/utils/prettify-json'
import {
    GRPC_UNAVAILABLE_MESSAGE,
    describeGrpcSchema,
    findGrpcMethod,
    getGrpcCallKind,
    getGrpcProtoFilesSize,
    getGrpcStopLabel,
    getGrpcMethodShortName,
    isClientStreaming,
    mergeGrpcProtoFiles,
    readGrpcProtoFiles,
    type GrpcSchemaMethod,
    type GrpcTarget,
} from '@/utils/grpc'
import {
    cancelGrpcCallForItem,
    endGrpcCallStream,
    getGrpcItemKey,
    getGrpcProtoFiles,
    getGrpcSchemaKey,
    grpcCalls,
    grpcItemSchemaKeys,
    grpcItemSchemaPreparations,
    grpcSchemas,
    isGrpcCallAcceptingMessages,
    isGrpcCallRunning,
    loadGrpcSchemaForItem,
    previewGrpcTarget,
    sendGrpcCallMessage,
    startGrpcCallForItem,
    type GrpcLiveCall,
    type GrpcSchemaEntry,
} from '@/utils/grpc-calls'
import { isGrpcAvailable } from '@/utils/grpc-transport'
import { clearSkipPersistingActiveTabAfterUpdate } from '@/utils/skip-persisting-active-tab'

// how long the address stays unchanged before its methods load
const AUTOMATIC_LOAD_AFTER_MS = 800
// the loading line waits this long, so a quick load shows no flash
const LOADING_SHOWN_AFTER_MS = 250
// the address bar's widths below which its parts give up details, so the address keeps room for a host and port
const ADDRESS_BAR_NARROW_BELOW_PX = 640
const ADDRESS_BAR_COMPACT_BELOW_PX = 460

type TabView = 'full' | 'portable'

type AddressBarFit = 'full' | 'narrow' | 'compact'

const props = defineProps({
    activeTab: {
        type: Object as PropType<CollectionItem>,
        required: true,
    },
})

const store: Store<State> = useStore()
const $toast: { success: (message: string) => void, error: (message: string) => void } = inject('$toast')!
const { isMobile } = useMobile()
// the panel's first node, which is in the window the panel shows in
const instance = getCurrentInstance()!
const rootNode = () => instance.proxy!.$el as Node

// template refs
const addressBar = ref<HTMLElement>()
const tabsRow = ref<HTMLElement>()
const fullTabs = ref<HTMLElement>()
const messageEditor = ref<{ $el?: HTMLElement, setValue(value: string): void }>()
const protoFileInput = ref<HTMLInputElement>()
const protoFolderInput = ref<HTMLInputElement>()

// data

const requestPanelTabs = [
    { name: 'Message' },
    { name: 'Metadata' },
    { name: 'Auth' },
    { name: 'Proto' },
    { name: 'Docs' },
]
const activeRequestPanelTab = ref('Message')
// the tabs side by side, or a list of them where they do not fit
const tabView = ref<TabView>('full')
// how much of its parts the address bar has room for
const addressBarFit = ref<AddressBarFit>('full')
// .proto files with none added yet is a choice shown here only, the item stores no files as reflection. An item
// with files is .proto files, set by the watch on protoFilesCount
const protoMode = ref<'reflection' | 'proto'>('reflection')
const editDescription = ref(false)
const targetPreview = ref<GrpcTarget | { error: string } | null>(null)
let targetPreviewLoad = 0
const schemaLoadingShown = ref(false)
const editTagModalShow = ref(false)
const editTagParsedFunc = ref<any>(null)
const editTagUpdateFunc = ref<any>(null)
const sendRequestHotkey = constants.HOTKEYS.SEND_REQUEST
const unavailableMessage = GRPC_UNAVAILABLE_MESSAGE

let automaticLoadTimer: ReturnType<typeof setTimeout> | undefined = undefined
let schemaLoadingTimer: ReturnType<typeof setTimeout> | undefined = undefined
let listeningForKeys = false
// the window whose keys the panel takes, which for a tab moved to a window of its own is that window
let keyWindow: Window | null = null
let tabsResizeObserver: ResizeObserver | null = null
let addressBarResizeObserver: ResizeObserver | null = null

// computed

const collectionItemEnvironmentResolved = computed<Record<string, any>>(() => {
    return store.state.tabEnvironmentResolved[props.activeTab._id] ?? {}
})

const flags = computed(() => {
    return store.state.flags
})

const tagAutocompletions = computed(() => {
    return constants.AUTOCOMPLETIONS.TAGS
})

const available = computed<boolean>(() => {
    return isGrpcAvailable()
})

const call = computed<GrpcLiveCall | null>(() => {
    return grpcCalls[getGrpcItemKey(props.activeTab)] ?? null
})

const running = computed<boolean>(() => {
    return isGrpcCallRunning(call.value)
})

const acceptingMessages = computed<boolean>(() => {
    return isGrpcCallAcceptingMessages(call.value)
})

// why End stream and Send message cannot be used now, null when they can
const streamButtonsDisabledReason = computed<string | null>(() => {
    if(acceptingMessages.value) {
        return null
    }
    if(running.value && call.value?.halfClosed) {
        return 'You ended the stream'
    }
    if(running.value) {
        return 'The stream opens once the server answers'
    }
    return `${actionLabel.value} opens the stream`
})

const schemaEntry = computed<GrpcSchemaEntry | null>(() => {
    const itemKey = getGrpcItemKey(props.activeTab)
    const key = grpcItemSchemaKeys[itemKey]
    const entry = key ? grpcSchemas[key] ?? null : null
    const preparation = grpcItemSchemaPreparations[itemKey]
    const preparationFailed = preparation?.error != null && preparation.failedAt !== null
        && (entry?.loadedAt == null || preparation.failedAt > entry.loadedAt)
        && (entry?.failedAt == null || preparation.failedAt > entry.failedAt)
    if(!preparation || (!preparation.loading && !preparationFailed)) {
        return entry
    }
    return {
        schema: null, loadedAt: null, error: null, errorCode: null, failedAt: null,
        ...entry,
        loading: entry?.loading ?? preparation.loading,
        ...(preparationFailed ? { error: preparation.error, failedAt: preparation.failedAt } : {}),
    }
})

const schemaMethod = computed<GrpcSchemaMethod | null>(() => {
    return findGrpcMethod(schemaEntry.value?.schema, props.activeTab.grpc?.service, props.activeTab.grpc?.method)
})

const kind = computed<GrpcCallKind | null>(() => {
    if(running.value && call.value?.kind) {
        return call.value.kind
    }
    return schemaMethod.value ? getGrpcCallKind(schemaMethod.value) : null
})

const actionLabel = computed<string>(() => {
    if(running.value) {
        return getGrpcStopLabel(kind.value)
    }
    return isClientStreaming(kind.value) ? 'Start' : 'Send'
})

const actionTitle = computed<string>(() => {
    const label = actionLabel.value
    if(label === 'Start') {
        return `Open the stream, then send each message from the Message tab (${sendRequestHotkey})`
    }
    return `${label} (${sendRequestHotkey})`
})

const actionDisabledReason = computed<string | null>(() => {
    if(running.value) {
        return null
    }
    if(!available.value) {
        return GRPC_UNAVAILABLE_MESSAGE
    }
    if(!props.activeTab.grpc?.service || !props.activeTab.grpc?.method) {
        return 'Choose a method first'
    }
    return null
})

const generateExampleDisabledReason = computed<string | null>(() => {
    if(schemaMethod.value !== null) {
        return null
    }
    if(!available.value) {
        return 'An example is made from the method, whose fields load in the Restfox desktop app or a self-hosted Restfox'
    }
    if(!props.activeTab.grpc?.service || !props.activeTab.grpc?.method) {
        return 'Choose a method first'
    }
    return 'Load the methods first'
})

const protoFilesCount = computed<number>(() => {
    return props.activeTab.grpc?.protoFiles?.length ?? 0
})

// what an automatic load depends on besides the address: the files' whole text, so an edit of the same length
// loads again too
const protoFilesSignature = computed<string | null>(() => {
    return getGrpcSchemaKey(null, getGrpcProtoFiles(props.activeTab))
})

const enabledMetadataCount = computed<number>(() => {
    return (props.activeTab.headers ?? []).filter(header => !header.disabled).length
})

const tabCountLabels = computed<Record<string, string>>(() => {
    return {
        Metadata: enabledMetadataCount.value > 0 ? ` (${enabledMetadataCount.value})` : '',
        Proto: protoFilesCount.value > 0 ? ` (${protoFilesCount.value} ${protoFilesCount.value === 1 ? 'file' : 'files'})` : '',
    }
})

const message = computed<string>({
    get() {
        return props.activeTab.body?.text ?? '{}'
    },
    set(text: string) {
        if(props.activeTab.body) {
            props.activeTab.body.text = text
        } else {
            props.activeTab.body = { mimeType: 'application/json', text }
        }
    },
})

const targetTagLabel = computed<string>(() => {
    if(targetPreview.value === null) {
        return ''
    }
    if('error' in targetPreview.value) {
        return 'Invalid'
    }
    return targetPreview.value.tls ? 'TLS' : 'Plaintext'
})

// shown instead of the label where the address bar is narrow or compact
const targetTagIcon = computed<string>(() => {
    if(targetPreview.value === null || 'error' in targetPreview.value) {
        return 'fa fa-exclamation-triangle grpc-request-panel-target-tag-icon'
    }
    return `fa ${targetPreview.value.tls ? 'fa-lock' : 'fa-lock-open'} grpc-request-panel-target-tag-icon`
})

const targetTagTitle = computed<string>(() => {
    if(targetPreview.value === null) {
        return ''
    }
    if('error' in targetPreview.value) {
        return targetPreview.value.error
    }
    return targetPreview.value.tls
        ? `Encrypted with TLS, to ${targetPreview.value.address}. grpc:// connects without it`
        : `Not encrypted, to ${targetPreview.value.address}. grpcs:// connects with TLS`
})

// why no methods can be loaded from the address, null when they can
const targetUnusableReason = computed<string | null>(() => {
    if(targetPreview.value === null) {
        return 'Enter the server address to load its methods.'
    }
    if('error' in targetPreview.value) {
        return targetPreview.value.error
    }
    return null
})

const pickerUnavailableReason = computed<string | null>(() => {
    if(!available.value) {
        return 'Loading methods needs the Restfox desktop app or a self-hosted Restfox. Browsers cannot make gRPC calls.'
    }
    if(protoFilesCount.value > 0 || schemaEntry.value !== null) {
        return null
    }
    return targetUnusableReason.value
})

// the Proto tab's line: what is loaded and when, or why not
const schemaStatus = computed<{ text: string, failed: boolean, showReload: boolean, loading: boolean }>(() => {
    if(!available.value) {
        return { text: 'Loading methods needs the Restfox desktop app or a self-hosted Restfox.', failed: false, showReload: false, loading: false }
    }
    const entry = schemaEntry.value
    if(entry === null) {
        if(protoFilesCount.value === 0 && targetUnusableReason.value !== null) {
            return { text: targetUnusableReason.value, failed: targetPreview.value !== null, showReload: false, loading: false }
        }
        return { text: 'Methods not loaded yet.', failed: false, showReload: true, loading: false }
    }
    if(entry.loading && schemaLoadingShown.value) {
        return { text: protoFilesCount.value > 0 ? 'Loading methods from the .proto files...' : 'Loading methods from the server...', failed: false, showReload: true, loading: true }
    }
    const lastAttemptFailed = entry.failedAt !== null && (entry.loadedAt === null || entry.failedAt > entry.loadedAt)
    if(lastAttemptFailed) {
        const loadedBefore = entry.schema && entry.loadedAt ? ` Last loaded at ${formatClock(entry.loadedAt)}: ${describeGrpcSchema(entry.schema)}.` : ''
        return { text: `Could not load methods at ${formatClock(entry.failedAt!)}: ${entry.error}.${loadedBefore}`, failed: true, showReload: true, loading: entry.loading }
    }
    if(entry.schema && entry.loadedAt) {
        return { text: `${describeGrpcSchema(entry.schema)}, ${formatClock(entry.loadedAt)}`, failed: false, showReload: true, loading: entry.loading }
    }
    return { text: entry.loading ? '' : 'Methods not loaded yet.', failed: false, showReload: true, loading: entry.loading }
})

// methods

function formatClock(time: number) {
    return dayjs(time).format('hh:mm A')
}

function protoFileSize(protoFile: GrpcProtoFile) {
    return humanFriendlySize(getGrpcProtoFilesSize([protoFile]))
}

// A touch screen scrolls the tabs sideways, as HTTP's panel does there. Elsewhere the tabs that do not fit
// become a list: the tabs stay laid out, out of sight, so their width is known whichever shows
function updateTabView() {
    const tabsRowElement = tabsRow.value
    const fullTabsElement = fullTabs.value
    if(isMobile.value || !tabsRowElement || !fullTabsElement || !tabsRowElement.isConnected) {
        tabView.value = 'full'
        return
    }
    const tabsWidth = [...fullTabsElement.querySelectorAll<HTMLElement>('.request-panel-tab')].reduce((width, tab) => width + tab.offsetWidth, 0)
    // no layout, as in a test, says nothing about the width
    if(tabsRowElement.clientWidth === 0) {
        return
    }
    tabView.value = tabsWidth > tabsRowElement.clientWidth ? 'portable' : 'full'
}

// Narrow, the tag shows an icon and the method's button leaves out the service. Compact, the button shows the
// method's name alone and the address keeps less room. A container query would do it in CSS, but it makes the
// bar the containing block of the method list, which is fixed to the window
function updateAddressBarFit() {
    const addressBarElement = addressBar.value
    if(addressBarElement && addressBarElement.isConnected && addressBarElement.clientWidth > 0) {
        const width = addressBarElement.clientWidth
        addressBarFit.value = width < ADDRESS_BAR_COMPACT_BELOW_PX ? 'compact' : width < ADDRESS_BAR_NARROW_BELOW_PX ? 'narrow' : 'full'
    }
}

async function updateTargetPreview() {
    const load = ++targetPreviewLoad
    const url = props.activeTab.url ?? ''
    if(url.trim() === '') {
        targetPreview.value = null
        return
    }
    const newTargetPreview = await previewGrpcTarget(props.activeTab, collectionItemEnvironmentResolved.value)
    // a newer address answers for itself
    if(targetPreviewLoad === load && (props.activeTab.url ?? '') === url) {
        targetPreview.value = newTargetPreview
    }
}

function scheduleAutomaticLoad() {
    clearTimeout(automaticLoadTimer)
    automaticLoadTimer = setTimeout(() => loadSchema(false, true), AUTOMATIC_LOAD_AFTER_MS)
}

// An automatic load, such as on opening the item or the method list, reuses what loaded or failed before and
// never asks a prompt. Load methods, Retry and Reload load again
function loadSchema(force: boolean, automatic = false) {
    if(!available.value) {
        return
    }
    loadGrpcSchemaForItem(store, props.activeTab, { force, automatic, mode: automatic ? 'display' : 'send' })
}

function listenForKeys() {
    if(!listeningForKeys) {
        keyWindow = rootNode().ownerDocument?.defaultView ?? window
        // before the app's own Ctrl+Enter, which sends HTTP requests
        keyWindow.addEventListener('keydown', handleWindowKeydown, true)
        listeningForKeys = true
    }
}

function stopListeningForKeys() {
    keyWindow?.removeEventListener('keydown', handleWindowKeydown, true)
    keyWindow = null
    listeningForKeys = false
}

function handleWindowKeydown(event: KeyboardEvent) {
    // in the main window, only the active tab's panel takes them. A window of its own shows one panel
    if(keyWindow === window && store.state.activeTab?._id !== props.activeTab._id) {
        return
    }
    // in the method search, Enter with or without Ctrl picks the method
    if((event.target as Element | null)?.closest?.('.grpc-method-picker-dropdown')) {
        return
    }
    const isSendHotkey = checkHotkeyAgainstKeyEvent(constants.HOTKEYS.SEND_REQUEST, event)
        || (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === 'Enter')
    if(!isSendHotkey) {
        return
    }
    event.preventDefault()
    event.stopPropagation()
    if((event.target as Element | null)?.closest?.('.grpc-request-panel-message') && running.value && isClientStreaming(kind.value)) {
        // in the Message tab of an open stream, its editor or a button such as Send message just clicked, the
        // key sends the message, and while the stream connects or after End stream it does nothing, rather
        // than Stop, which would lose what the server still sends
        if(acceptingMessages.value) {
            sendMessage()
        }
        return
    }
    runAction()
}

function handleAddressBarKeyDown(event: KeyboardEvent) {
    if(!event.defaultPrevented && !event.ctrlKey && !event.metaKey && event.key === 'Enter' && !running.value && (props.activeTab.url ?? '') !== '') {
        runAction()
    }
}

function runAction() {
    if(running.value) {
        cancelGrpcCallForItem(store, props.activeTab)
        return
    }
    if(actionDisabledReason.value !== null) {
        return
    }
    const callKind = kind.value
    startGrpcCallForItem(store, props.activeTab)
    // a stream the user writes to keeps the Message tab in view, where its messages are sent
    if(isMobile.value && !isClientStreaming(callKind)) {
        store.commit('setActiveMobilePanel', 'response')
    }
}

function sendMessage() {
    sendGrpcCallMessage(props.activeTab, message.value)
}

function endStream() {
    endGrpcCallStream(props.activeTab)
    // the button turns disabled, so focus goes back to the message rather than to the page, where Ctrl+Enter
    // would stop the stream and lose what the server still sends
    nextTick(() => (messageEditor.value?.$el?.querySelector('.cm-content') as HTMLElement | null)?.focus())
}

function beautifyJSON() {
    try {
        // read on each click, so a change in Settings applies at once
        const formattedJSON = jsonPrettify(message.value, getSpaces(getEditorConfig().indentSize))
        messageEditor.value?.setValue(formattedJSON)
    } catch {} // a message that is not JSON yet stays as typed
}

// a method's example indented as Settings indent the editor, as Beautify JSON does
function formatExample(method: GrpcSchemaMethod) {
    try {
        return jsonStringify(JSON.parse(method.example))
    } catch {
        return method.example
    }
}

// the message is still a method's example as it was put in, or the engine's text of it
function isUntouchedExample(text: string, method: GrpcSchemaMethod | null) {
    return method !== null && (text === method.example.trim() || text === formatExample(method).trim())
}

async function generateExample() {
    const currentSchemaMethod = schemaMethod.value
    if(!currentSchemaMethod) {
        return
    }
    const text = message.value.trim()
    if(text !== '' && text !== '{}' && !isUntouchedExample(text, currentSchemaMethod)) {
        if(!await getAlertConfirmPromptContainer(rootNode() as HTMLElement).createConfirm(`Replace the message with an example ${currentSchemaMethod.inputType}? What you wrote in it will be lost.`, 'Replace')) {
            return
        }
    }
    message.value = formatExample(currentSchemaMethod)
}

// a message still empty or the previous method's untouched example becomes the new method's example, and an
// item still named New gRPC Request, or still named after the previous method, takes the method's name
async function selectMethod({ service, method }: { service: string, method: GrpcSchemaMethod }) {
    if(running.value) {
        return
    }
    const item = props.activeTab
    const previousMethod = schemaMethod.value
    const text = message.value.trim()
    const untouched = text === '' || text === '{}' || isUntouchedExample(text, previousMethod)
    const previousMethodName = item.grpc?.service && item.grpc.method ? getGrpcMethodShortName(item.grpc.service, item.grpc.method) : null
    const nameFollowsMethod = item.name === constants.GRPC_REQUEST_DEFAULT_NAME || item.name === previousMethodName

    if(!item.grpc) {
        item.grpc = {}
    }
    item.grpc.service = service
    item.grpc.method = method.name
    if(untouched) {
        message.value = formatExample(method)
    }

    const name = getGrpcMethodShortName(service, method.name)
    if(nameFollowsMethod && item.name !== name) {
        // a name another item in the folder has is not taken, the item keeps the name it has
        const nameTaken = (store.state.collection ?? []).some((other: CollectionItem) => other._id !== item._id && (other.parentId ?? null) === (item.parentId ?? null) && other.name.toLowerCase() === name.toLowerCase())
        if(nameTaken) {
            return
        }
        // after the change above is saved, the rename saves the name alone, as the sidebar's rename does
        await nextTick()
        const result = await store.dispatch('updateCollectionItemName', { _id: item._id, _type: item._type, name })
        if(!result?.error) {
            if(store.state.activeTab === item) {
                store.state.skipPersistingActiveTab = true
            }
            item.name = name
            clearSkipPersistingActiveTabAfterUpdate(store.state)
        }
    }
}

function useProtoFiles() {
    activeRequestPanelTab.value = 'Proto'
    protoMode.value = 'proto'
}

async function setProtoMode(mode: 'reflection' | 'proto') {
    if(mode === protoMode.value) {
        return
    }
    if(mode === 'reflection' && protoFilesCount.value > 0) {
        const count = protoFilesCount.value
        if(!await getAlertConfirmPromptContainer(rootNode() as HTMLElement).createConfirm(`Remove the ${count} .proto ${count === 1 ? 'file' : 'files'} from this request and load its methods from server reflection? Other requests keep their files.`, count === 1 ? 'Remove file' : 'Remove files')) {
            return
        }
        props.activeTab.grpc!.protoFiles = []
    }
    protoMode.value = mode
}

function pickProtoFiles(folder: boolean) {
    const input = (folder ? protoFolderInput.value : protoFileInput.value) as HTMLInputElement
    input.value = ''
    input.click()
}

async function addProtoFiles(event: Event, fromFolder: boolean) {
    const input = event.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    const added = await readGrpcProtoFiles(files, fromFolder)
    input.value = ''
    if(added.length === 0) {
        if(files.length > 0) {
            $toast.error(fromFolder ? 'The folder has no .proto files' : 'Only .proto files can be added')
        }
        return
    }
    if(!props.activeTab.grpc) {
        props.activeTab.grpc = {}
    }
    props.activeTab.grpc.protoFiles = mergeGrpcProtoFiles(props.activeTab.grpc.protoFiles ?? [], added)
}

async function removeProtoFile(path: string) {
    if(!await getAlertConfirmPromptContainer(rootNode() as HTMLElement).createConfirm(`Remove ${path} from this request? Other requests keep their files.`, 'Remove')) {
        return
    }
    const currentProtoFiles = props.activeTab.grpc?.protoFiles ?? []
    props.activeTab.grpc!.protoFiles = currentProtoFiles.filter(protoFile => protoFile.path !== path)
}

function onTagClick(parsedFunc: any, updateFunc: any) {
    editTagParsedFunc.value = parsedFunc
    editTagUpdateFunc.value = updateFunc
    editTagModalShow.value = true
}

// watch

watch(() => props.activeTab.url, () => {
    updateTargetPreview()
    scheduleAutomaticLoad()
})

watch(collectionItemEnvironmentResolved, () => {
    updateTargetPreview()
    scheduleAutomaticLoad()
})

// files the item gets from outside the panel, such as a file workspace reloaded from disk or the item a kept
// panel is given, show as .proto files, where they can be removed
watch(protoFilesCount, (count: number) => {
    if(count > 0) {
        protoMode.value = 'proto'
    }
}, {
    immediate: true,
})

watch(protoFilesSignature, () => {
    clearTimeout(automaticLoadTimer)
    loadSchema(false, true)
})

// null while the item has no entry
watch(() => schemaEntry.value && schemaEntry.value.loading, (loading: boolean | null | undefined) => {
    clearTimeout(schemaLoadingTimer)
    schemaLoadingShown.value = false
    if(loading) {
        schemaLoadingTimer = setTimeout(() => {
            schemaLoadingShown.value = true
        }, LOADING_SHOWN_AFTER_MS)
    }
}, {
    immediate: true,
})

// a label that grows, such as a count, may make the tabs no longer fit
watch(tabCountLabels, () => {
    nextTick(() => updateTabView())
})

watch(isMobile, () => {
    nextTick(() => updateTabView())
})

// lifecycle

onMounted(() => {
    updateTargetPreview()
    // the methods load when the item opens
    loadSchema(false, true)
    listenForKeys()
    updateTabView()
    if(typeof ResizeObserver !== 'undefined' && tabsRow.value) {
        tabsResizeObserver = new ResizeObserver(() => updateTabView())
        tabsResizeObserver.observe(tabsRow.value)
    }
    if(typeof ResizeObserver !== 'undefined' && addressBar.value) {
        addressBarResizeObserver = new ResizeObserver(() => updateAddressBarFit())
        addressBarResizeObserver.observe(addressBar.value)
    }
})

onActivated(() => {
    listenForKeys()
    updateTabView()
})

onDeactivated(() => {
    stopListeningForKeys()
})

onBeforeUnmount(() => {
    stopListeningForKeys()
    tabsResizeObserver?.disconnect()
    addressBarResizeObserver?.disconnect()
    clearTimeout(automaticLoadTimer)
    clearTimeout(schemaLoadingTimer)
})
</script>

<style scoped>
.request-panel-address-bar {
    display: flex;
    border-bottom: 1px solid var(--default-border-color);
    height: 2rem;
    align-items: center;
    min-width: 0;
}

.request-panel-address-bar > .code-mirror-input-container {
    flex: 1;
    min-width: 6rem;
    padding-left: 0.5rem;
}

/* a fixed width, so the address does not move as the tag changes while typing */
.grpc-request-panel-target-tag {
    width: 4.5rem;
    padding: 0.2rem 0.5rem;
    margin: 0 0.5rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
    user-select: none;
    font-size: 0.8rem;
    flex-shrink: 0;
}

.grpc-request-panel-target-tag-icon {
    display: none;
}

/* the width of Cancel, the longest label, so a quick call moves nothing */
.grpc-request-panel-action {
    border: 0;
    background-color: var(--send-request-button-color);
    color: var(--primary-text-color);
    min-width: 6.5rem;
    padding-left: 1.5rem;
    padding-right: 1.5rem;
    height: 100%;
    cursor: pointer;
    flex-shrink: 0;
}

.grpc-request-panel-action:hover:not(:disabled) {
    background-color: var(--send-request-button-hover-color);
}

.grpc-request-panel-action:disabled {
    opacity: 0.5;
    cursor: default;
}

.grpc-request-panel-address-bar-compact > .code-mirror-input-container {
    min-width: 4rem;
}

.grpc-request-panel-address-bar-narrow .grpc-request-panel-target-tag,
.grpc-request-panel-address-bar-compact .grpc-request-panel-target-tag {
    width: auto;
    margin: 0 0.4rem;
    padding: 0.2rem 0.4rem;
}

.grpc-request-panel-address-bar-narrow .grpc-request-panel-target-tag-icon,
.grpc-request-panel-address-bar-compact .grpc-request-panel-target-tag-icon {
    display: inline;
}

.grpc-request-panel-address-bar-narrow .grpc-request-panel-target-tag-label,
.grpc-request-panel-address-bar-compact .grpc-request-panel-target-tag-label {
    display: none;
}

/* the lock gives its room to the address, its title says the same as the address's scheme. An invalid address keeps
its warning */
.grpc-request-panel-address-bar-compact .grpc-request-panel-target-tag:not(.red) {
    display: none;
}

.grpc-request-panel-address-bar-compact .grpc-request-panel-action {
    min-width: 5rem;
    padding-left: 0.8rem;
    padding-right: 0.8rem;
}

.grpc-request-panel-tabs-row {
    position: relative;
    min-width: 0;
    overflow: hidden;
}

.request-panel-tabs {
    display: flex;
    user-select: none;
    background-color: var(--sidebar-item-active-color);
}

/* the tabs kept laid out out of sight while the list shows, so their width is known */
.request-panel-tabs.grpc-request-panel-tabs-measured {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
    visibility: hidden;
    pointer-events: none;
}

.request-panel-tabs .request-panel-tab {
    padding: 10px 15px;
    border-bottom: 1px solid var(--default-border-color);
    border-left: 1px solid transparent;
    border-right: 1px solid transparent;
    white-space: nowrap;
    cursor: pointer;
}

.request-panel-tabs .request-panel-tab-active {
    border-bottom: 1px solid transparent;
    border-right: 1px solid var(--default-border-color);
    background: var(--background-color);
}

.request-panel-tabs .request-panel-tab-active:not(:first-child) {
    border-left: 1px solid var(--default-border-color);
}

.request-panel-tabs .request-panel-tab-fill {
    width: 100%;
    border-bottom: 1px solid var(--default-border-color);
}

.request-panel-tabs .request-panel-tab.grpc-request-panel-tab-select {
    width: 100%;
    border-color: transparent;
    cursor: default;
}

.grpc-request-panel-tab-select select {
    border: 1px solid var(--default-border-color);
    outline: 0;
    padding: 0.3rem;
    background-color: var(--background-color);
    color: var(--text-color);
}

.grpc-request-panel-notice {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--default-border-color);
    color: var(--tip-text-color);
}

.request-panel-tabs-context {
    padding: 1rem;
    overflow-y: auto;
    min-height: 0;
}

.grpc-request-panel-message {
    display: grid;
    grid-template-rows: 1fr auto auto;
    height: 100%;
}

.grpc-request-panel-editor {
    overflow-y: auto;
    min-height: 0;
}

.code-editor {
    border: 1px solid var(--default-border-color);
    height: 100%;
    overflow-y: auto;
}

.request-panel-body-footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
}

.grpc-request-panel-footer-fill {
    flex: 1;
}

.grpc-request-panel-send-error {
    margin-top: 0.5rem;
    color: var(--base-color-error);
    word-break: break-word;
}

.grpc-request-panel-hint {
    margin: 0.75rem 0;
    color: var(--tip-text-color);
}

/* two choices side by side, the pressed one in the send button's color */
.grpc-request-panel-segmented {
    display: inline-flex;
    border: 1px solid var(--button-border-color);
    border-radius: 3px;
    overflow: hidden;
}

.grpc-request-panel-segmented button {
    border: 0;
    padding: 3px 10px;
    background-color: var(--button-background-color);
    color: var(--button-text-color);
    cursor: pointer;
}

.grpc-request-panel-segmented button + button {
    border-left: 1px solid var(--button-border-color);
}

.grpc-request-panel-segmented button:hover {
    background-color: var(--button-hover-background-color);
}

.grpc-request-panel-segmented button.grpc-request-panel-segment-pressed,
.grpc-request-panel-segmented button.grpc-request-panel-segment-pressed:hover {
    background-color: var(--send-request-button-color);
    color: var(--primary-text-color);
    cursor: default;
}

.grpc-request-panel-proto-buttons {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
}

.grpc-request-panel-proto-files {
    margin-top: 0.75rem;
    table-layout: fixed;
}

.grpc-request-panel-proto-files td {
    cursor: default;
}

.grpc-request-panel-proto-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-monospace);
}

/* main.css gives the last two cells of a table in this panel the width of an icon, which the size is not */
.request-panel-tabs-context table:not(.auth) td.grpc-request-panel-proto-size {
    width: 5.5rem;
    white-space: nowrap;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--tip-text-color);
}

.request-panel-tabs-context table:not(.auth) td.grpc-request-panel-proto-remove {
    width: 29px;
    cursor: pointer;
}

.grpc-request-panel-proto-status {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--default-border-color);
    word-break: break-word;
}

.grpc-request-panel-proto-status span {
    flex: 1;
}

.grpc-request-panel-proto-status-failed {
    color: var(--base-color-error);
}

@media (max-width: 768px) {
    .request-panel-tabs {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
    }

    .request-panel-tabs::-webkit-scrollbar {
        display: none;
    }
}
</style>
