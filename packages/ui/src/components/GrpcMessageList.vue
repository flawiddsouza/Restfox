<template>
    <div class="grpc-message-list">
        <div class="grpc-message-list-columns">
            <span>#</span>
            <span>Time</span>
            <span></span>
            <span>Message</span>
        </div>
        <div class="grpc-message-list-body">
            <div class="grpc-message-list-scroller" ref="scroller" @scroll="onScroll">
                <div class="grpc-message-list-spacer" :style="{ height: `${spacerHeight}px` }">
                    <div
                        v-for="row in visibleRows"
                        :key="row.index"
                        class="grpc-message-list-row"
                        :class="{
                            'grpc-message-list-row-selected': selectedIndex === row.index,
                            'grpc-message-list-row-omitted': row.event.omitted,
                        }"
                        :style="{ top: `${rowTop(row.index)}px`, height: `${ROW_HEIGHT}px` }"
                        @click="toggleSelected(row.index)"
                    >
                        <span>{{ row.index + 1 }}</span>
                        <span>{{ formatTime(row.event.time) }}</span>
                        <span>
                            <i v-if="row.event.type === 'sent'" class="fa fa-arrow-up grpc-message-list-sent" title="Sent"></i>
                            <i v-else class="fa fa-arrow-down grpc-message-list-received" title="Received"></i>
                        </span>
                        <span class="grpc-message-list-preview">{{ preview(row.event) }}</span>
                    </div>
                </div>
                <div class="grpc-message-list-hint" v-if="eventCount === 0">No messages{{ live ? ' yet' : '' }}</div>
            </div>
            <button class="button grpc-message-list-scroll-to-latest" v-if="live && !stickToBottom" @click="scrollToLatest">Scroll to latest</button>
        </div>
        <div class="grpc-message-list-detail" v-if="selectedEvent">
            <div class="grpc-message-list-pane-header">
                <span>#{{ (selectedIndex ?? 0) + 1 }}, {{ selectedEvent.type === 'sent' ? 'sent' : 'received' }} at {{ formatTime(selectedEvent.time) }}</span>
                <div>
                    <i class="fas fa-code" @mousedown.prevent="emit('set-environment-variable', messagePreview.selectedText)" title="Set selected text as environment variable"></i>
                    <i class="fa fa-times" @click="selectedIndex = null" title="Close"></i>
                </div>
            </div>
            <div class="grpc-message-list-detail-text">
                <div class="grpc-message-list-hint" v-if="messagePreview.note">{{ messagePreview.note }}</div>
                <div class="grpc-message-list-hint" v-if="selectedEvent.decodeError">{{ selectedEvent.decodeError }}</div>
                <div class="grpc-message-list-hint" v-if="selectedEvent.omitted">This message took a masked prompt value, so it was left out.</div>
                <div class="content-box grpc-message-list-warning" v-else-if="messagePreview.shouldShowLargeResponseWarning">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Large Response Warning</h3>
                    <p>This response is {{ humanFriendlySize(messagePreview.responseSize) }} in size.</p>
                    <p>Loading large responses may slow down the interface.</p>
                    <button class="button" @click="messagePreview.largeResponseConfirmed = true">Load Response</button>
                </div>
                <template v-else>
                    <CodeMirrorResponsePanelPreview v-if="selectedEvent.json !== undefined" :model-value="messagePreview.json" @selection-changed="messagePreview.selectedText = $event" />
                    <template v-if="selectedEvent.bytes !== undefined">
                        <div class="grpc-message-list-hint">Bytes (base64)</div>
                        <CodeMirrorResponsePanelPreview :model-value="selectedEvent.bytes" @selection-changed="messagePreview.selectedText = $event" />
                    </template>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { GrpcCallResultEvent } from '@/global'
import { getGrpcMessagePreview, useGrpcMessagePreview, type GrpcMessageListViewState } from '@/utils/grpc'
import { humanFriendlySize } from '@/helpers'
import CodeMirrorResponsePanelPreview from './CodeMirrorResponsePanelPreview.vue'

const ROW_HEIGHT = 26
// rows rendered above and below the visible ones, so a fast scroll shows no gap
const OVERSCAN = 10
// used until the list has been measured
const FALLBACK_VIEWPORT_HEIGHT = 600
// Browsers stop an element's height at a limit, Firefox at about 17.9 million px, which 26 px rows pass at about
// 690,000 messages. Past this height the spacer stays this tall and scrolling it moves through the rows faster
const MAX_SPACER_HEIGHT = 10000000
// scrolled this close to the end counts as at the end
const BOTTOM_TOLERANCE = 4

type Row = { event: GrpcCallResultEvent, index: number }
const emit = defineEmits<{
    (event: 'set-environment-variable', text: string): void
}>()

const props = withDefaults(defineProps<{
    // grows in place while the call runs, revision says it did
    events: GrpcCallResultEvent[]
    revision?: number
    // the call is still running, the list follows the newest message
    live?: boolean
    viewState?: GrpcMessageListViewState | null
}>(), {
    revision: 0,
    live: false,
    viewState: null,
})

const scroller = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | undefined

const eventCount = ref(props.events.length)
const scrollTop = ref(props.viewState?.scrollTop ?? 0)
const viewportHeight = ref(0)
// a live list starts at the newest message, a finished one at the first
const stickToBottom = ref(props.viewState?.stickToBottom ?? props.live)
const selectedIndex = ref<number | null>(props.viewState?.selectedIndex ?? null)

const rowsHeight = computed(() => eventCount.value * ROW_HEIGHT)

const spacerHeight = computed(() => Math.min(rowsHeight.value, MAX_SPACER_HEIGHT))

const rowsScrollTop = computed(() => toRowsScrollTop(scrollTop.value))

const visibleRows = computed(() => {
    const height = viewportHeight.value || FALLBACK_VIEWPORT_HEIGHT
    const first = Math.max(0, Math.floor(rowsScrollTop.value / ROW_HEIGHT) - OVERSCAN)
    const last = Math.min(eventCount.value, Math.ceil((rowsScrollTop.value + height) / ROW_HEIGHT) + OVERSCAN)
    const rows: Row[] = []
    for(let index = first; index < last; index++) {
        rows.push({ event: props.events[index], index })
    }
    return rows
})

const selectedEvent = computed((): GrpcCallResultEvent | null => {
    // eventCount, so a message selected by number shows once it arrives
    return selectedIndex.value !== null && selectedIndex.value < eventCount.value ? props.events[selectedIndex.value] : null
})

const messagePreview = reactive(useGrpcMessagePreview(() => selectedEvent.value))

watch(() => props.revision, () => {
    eventsChanged()
})

watch(() => props.events, () => {
    eventsChanged()
})

watch(selectedIndex, (selectedIndex: number | null) => {
    saveViewState({ selectedIndex })
})

onMounted(() => {
    restoreScrollPosition()
    if(typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => onResize())
        resizeObserver.observe(scroller.value as HTMLElement)
    }
})

// a list kept alive while its tab is not shown loses its scroll position when it is taken out of the page
onActivated(() => {
    restoreScrollPosition()
})

onBeforeUnmount(() => {
    resizeObserver?.disconnect()
})

function saveViewState(change: Partial<GrpcMessageListViewState>) {
    if(props.viewState) {
        Object.assign(props.viewState, change)
    }
}

function eventsChanged() {
    eventCount.value = props.events.length
    followNewest()
}

function toRowsScrollTop(scrollTop: number): number {
    if(rowsHeight.value <= spacerHeight.value) {
        return scrollTop
    }
    const height = viewportHeight.value || FALLBACK_VIEWPORT_HEIGHT
    const scrollRange = spacerHeight.value - height
    return scrollRange > 0 ? scrollTop * (rowsHeight.value - height) / scrollRange : 0
}

function toScrollTop(rowsScrollTop: number): number {
    if(rowsHeight.value <= spacerHeight.value) {
        return rowsScrollTop
    }
    const height = viewportHeight.value || FALLBACK_VIEWPORT_HEIGHT
    const rowsRange = rowsHeight.value - height
    return rowsRange > 0 ? rowsScrollTop * (spacerHeight.value - height) / rowsRange : 0
}

// a row's place in the spacer, next to the scroll position once the rows outgrow it
function rowTop(index: number): number {
    return index * ROW_HEIGHT - rowsScrollTop.value + scrollTop.value
}

function isAtBottom(element: HTMLElement) {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_TOLERANCE
}

// a scroller taken out of the page reads as scrolled to the top, which is not where the user left it
function measure() {
    const scrollerElement = scroller.value
    if(scrollerElement && scrollerElement.isConnected) {
        viewportHeight.value = scrollerElement.clientHeight
        scrollTop.value = scrollerElement.scrollTop
    }
}

// a list at its end stays there when it gets shorter, such as when the banner of an ended call shows above it
function onResize() {
    measure()
    if(stickToBottom.value) {
        scrollScrollerToEnd()
    }
}

function restoreScrollPosition() {
    if(stickToBottom.value) {
        scrollScrollerToEnd()
        return
    }
    const scrollerElement = scroller.value
    if(scrollerElement) {
        scrollerElement.scrollTop = scrollTop.value
        measure()
    }
}

function onScroll(event: Event) {
    const scrollerElement = event.currentTarget as HTMLElement
    if(!scrollerElement.isConnected) {
        return
    }
    scrollTop.value = scrollerElement.scrollTop
    viewportHeight.value = scrollerElement.clientHeight
    stickToBottom.value = isAtBottom(scrollerElement)
    saveViewState({ scrollTop: scrollTop.value, stickToBottom: stickToBottom.value })
}

// The list at its end follows the newest message, the last ones too, which arrive in the same update that ends
// the call
function followNewest() {
    if(!stickToBottom.value) {
        return
    }
    nextTick(() => {
        if(stickToBottom.value) {
            scrollScrollerToEnd()
        }
    })
}

function scrollScrollerToEnd() {
    const scrollerElement = scroller.value
    if(!scrollerElement) {
        return
    }
    scrollerElement.scrollTop = scrollerElement.scrollHeight
    scrollTop.value = scrollerElement.scrollTop
    viewportHeight.value = scrollerElement.clientHeight
    saveViewState({ scrollTop: scrollTop.value, stickToBottom: stickToBottom.value })
}

function scrollToLatest() {
    stickToBottom.value = true
    nextTick(() => scrollScrollerToEnd())
}

function toggleSelected(index: number) {
    selectedIndex.value = selectedIndex.value === index ? null : index
    if(selectedIndex.value !== null) {
        // the detail pane opens below the list and takes its lower part, where the row may sit
        nextTick(() => scrollRowIntoView(index))
    }
}

function scrollRowIntoView(index: number) {
    const scrollerElement = scroller.value
    if(!scrollerElement) {
        return
    }
    measure()
    // a list at its end goes back to it on its next resize, which would take the row out of view again, so the row
    // is checked against where that leaves it
    if(stickToBottom.value) {
        scrollScrollerToEnd()
    }
    const rowTop = index * ROW_HEIGHT
    const rowBottom = rowTop + ROW_HEIGHT
    const height = viewportHeight.value || FALLBACK_VIEWPORT_HEIGHT
    let newRowsScrollTop = rowsScrollTop.value
    if(rowBottom > newRowsScrollTop + height) {
        newRowsScrollTop = rowBottom - height
    } else if(rowTop < newRowsScrollTop) {
        newRowsScrollTop = rowTop
    } else {
        return
    }
    scrollerElement.scrollTop = Math.ceil(toScrollTop(newRowsScrollTop))
    measure()
    stickToBottom.value = isAtBottom(scrollerElement)
    saveViewState({ scrollTop: scrollTop.value, stickToBottom: stickToBottom.value })
}

function preview(event: GrpcCallResultEvent) {
    if(event.decodeError) {
        return 'Could not be decoded'
    }
    if(event.unknownFields?.length) {
        return `Has fields the .proto files do not describe: ${event.unknownFields.join(', ')}`
    }
    return getGrpcMessagePreview(event)
}

function formatTime(milliseconds: number | undefined) {
    if(milliseconds === undefined) {
        return ''
    }
    return `+${(milliseconds / 1000).toFixed(2)} s`
}
</script>

<style scoped>
.grpc-message-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}

.grpc-message-list-columns,
.grpc-message-list-row {
    display: grid;
    /* the time fits "+99999.99 s", about 27 hours, in each monospace font of the stack */
    grid-template-columns: 3.5rem 6rem 1rem minmax(0, 1fr);
    column-gap: 0.75rem;
    padding: 0 0.5rem;
}

.grpc-message-list-columns {
    border-bottom: 1px solid var(--default-border-color);
    line-height: 26px;
    font-weight: 500;
    user-select: none;
}

.grpc-message-list-body {
    position: relative;
    flex: 1 1 0;
    min-height: 4rem;
}

.grpc-message-list-scroller {
    position: absolute;
    inset: 0;
    overflow: auto;
}

.grpc-message-list-spacer {
    position: relative;
}

.grpc-message-list-row {
    position: absolute;
    left: 0;
    right: 0;
    align-items: center;
    border-bottom: 1px solid var(--border-color-lighter);
    font-family: var(--font-monospace);
    white-space: nowrap;
    cursor: pointer;
}

.grpc-message-list-row > span {
    overflow: hidden;
    text-overflow: ellipsis;
}

.grpc-message-list-row:hover {
    background-color: var(--response-panel-history-select-hover-color);
}

.grpc-message-list-row.grpc-message-list-row-selected {
    background-color: var(--sidebar-item-active-color);
}

.grpc-message-list-row-omitted .grpc-message-list-preview {
    color: var(--tip-text-color);
    font-family: var(--font-default);
    font-style: italic;
}

.grpc-message-list-sent {
    color: var(--base-color-info);
}

.grpc-message-list-received {
    color: var(--base-color-success);
}

.grpc-message-list-hint {
    padding: 0.5rem;
    color: var(--tip-text-color);
}

.grpc-message-list-scroll-to-latest {
    position: absolute;
    bottom: 0.6rem;
    left: 50%;
    transform: translateX(-50%);
    box-shadow: 0 2px 4px var(--box-shadow-color);
}

.grpc-message-list-pane-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.3rem 0.5rem;
    background-color: var(--sidebar-item-active-color);
    border-bottom: 1px solid var(--default-border-color);
    user-select: none;
}

.grpc-message-list-pane-header i {
    cursor: pointer;
    padding: 0.2rem 0.3rem;
}

/* a fixed height, so picking another row moves nothing */
.grpc-message-list-detail {
    display: flex;
    flex-direction: column;
    flex: 0 0 35%;
    min-height: 4rem;
    border-top: 1px solid var(--default-border-color);
}

.grpc-message-list-detail-text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}

.grpc-message-list-detail-text > .code-mirror-response-panel-preview {
    flex: 1 1 0;
    min-height: 0;
}

.grpc-message-list-warning {
    text-align: center;
    padding: 2rem;
    overflow: auto;
}

.grpc-message-list-warning > .fas {
    font-size: 3rem;
    color: var(--base-color-warning);
    margin-bottom: 1rem;
}
</style>
