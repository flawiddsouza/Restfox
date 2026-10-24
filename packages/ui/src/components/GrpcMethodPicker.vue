<template>
    <div class="grpc-method-picker" :class="`grpc-method-picker-${fit}`">
        <button
            type="button"
            class="grpc-method-picker-button"
            ref="button"
            :title="buttonTitle"
            :disabled="disabledReason !== null"
            :aria-expanded="open ? 'true' : 'false'"
            @click="toggle"
            data-testid="grpc-method-picker-button"
        >
            <template v-if="service && method">
                <span class="grpc-method-picker-button-name"><span class="grpc-method-picker-button-service">{{ shortServiceName }} ▸ </span>{{ method }}</span>
                <span class="grpc-method-picker-kind" v-if="kind">{{ kindLabels[kind] }}</span>
            </template>
            <span class="grpc-method-picker-button-name grpc-method-picker-placeholder" v-else>Choose a method</span>
            <i class="fa fa-caret-down"></i>
        </button>
        <div class="grpc-method-picker-background" v-if="open" @click="close(false)"></div>
        <div
            class="grpc-method-picker-dropdown"
            v-if="open"
            :style="dropdownStyle"
            data-testid="grpc-method-picker-dropdown"
        >
            <div class="grpc-method-picker-search" v-if="schema">
                <input
                    type="text"
                    class="full-width-input"
                    ref="search"
                    placeholder="Search methods"
                    spellcheck="false"
                    :value="query"
                    @input="onQueryInput"
                    @keydown="onSearchKeydown"
                >
            </div>
            <div class="grpc-method-picker-list" ref="list">
                <div class="grpc-method-picker-note grpc-method-picker-failed" v-if="schema && schemaEntry && schemaEntry.error && isLastAttemptFailed">
                    <span>Reload failed: {{ schemaEntry.error }}</span>
                    <button type="button" class="button" @click="$emit('retry')">Retry</button>
                </div>
                <template v-if="schema">
                    <div class="grpc-method-picker-note" v-if="schema.services.length === 0">
                        {{ schema.source === 'reflection' ? 'The server offers no services.' : 'The .proto files define no services.' }}
                    </div>
                    <div class="grpc-method-picker-note" v-else-if="results.length === 0">No methods match "{{ query }}"</div>
                    <template v-for="(row, rowIndex) in rows" :key="row.key">
                        <div class="grpc-method-picker-group" v-if="row.type === 'group'" :title="row.service">{{ row.service }}</div>
                        <button
                            v-else
                            type="button"
                            class="grpc-method-picker-option"
                            :class="{ 'grpc-method-picker-option-highlighted': row.resultIndex === highlightedIndex }"
                            :data-result-index="row.resultIndex"
                            :data-row-index="rowIndex"
                            :title="`${row.service}/${row.method.name}`"
                            @mousemove="highlightedIndex = row.resultIndex"
                            @click="choose(row.resultIndex)"
                        >
                            <i class="fa fa-check grpc-method-picker-option-check" :class="{ 'grpc-method-picker-option-check-shown': row.service === service && row.method.name === method }"></i>
                            <span class="grpc-method-picker-option-name">{{ row.method.name }}</span>
                            <span class="grpc-method-picker-option-service" v-if="query.trim() !== ''">{{ shortName(row.service) }}</span>
                            <span class="grpc-method-picker-kind">{{ kindLabels[callKind(row.method)] }}</span>
                        </button>
                    </template>
                    <div class="grpc-method-picker-note" v-if="schema.missingServices && schema.missingServices.length > 0">
                        The server lists {{ schema.missingServices.join(', ') }} but did not describe {{ schema.missingServices.length === 1 ? 'it' : 'them' }}, so {{ schema.missingServices.length === 1 ? 'it is' : 'they are' }} not shown.
                    </div>
                </template>
                <template v-else-if="unavailableReason">
                    <div class="grpc-method-picker-note">{{ unavailableReason }}</div>
                </template>
                <template v-else-if="schemaEntry && schemaEntry.loading">
                    <div class="grpc-method-picker-note" v-if="loadingShown">
                        <i class="fas fa-sync fa-spin"></i> Loading methods {{ source === 'reflection' ? 'from the server' : 'from the .proto files' }}
                    </div>
                </template>
                <template v-else-if="schemaEntry && schemaEntry.error">
                    <div class="grpc-method-picker-note grpc-method-picker-failed">{{ schemaEntry.error }}</div>
                    <div class="grpc-method-picker-actions">
                        <button type="button" class="button" @click="$emit('retry')">Retry</button>
                        <button type="button" class="button" v-if="offersProtoFiles" @click="useProtoFiles">Use .proto files</button>
                    </div>
                </template>
                <template v-else>
                    <div class="grpc-method-picker-note">The methods have not been loaded.</div>
                    <div class="grpc-method-picker-actions">
                        <button type="button" class="button" @click="$emit('retry')">Load methods</button>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import type { GrpcCallKind } from '@/global'
import type { GrpcSchemaEntry } from '@/utils/grpc-calls'
import {
    GRPC_CALL_KIND_LABELS,
    getGrpcCallKind,
    getShortServiceName,
    searchGrpcMethods,
    type GrpcMethodSearchResult,
    type GrpcSchema,
    type GrpcSchemaMethod,
} from '@/utils/grpc'

// the loading line waits this long, so a quick load shows no flash
const LOADING_SHOWN_AFTER_MS = 250
// space kept between the list and the window's edges
const VIEWPORT_MARGIN = 8

type Row = { type: 'group', key: string, service: string } | { type: 'method', key: string, service: string, method: GrpcSchemaMethod, resultIndex: number }

const props = withDefaults(defineProps<{
    service?: string
    method?: string
    // the chosen method's, null while not known
    kind?: GrpcCallKind | null
    schemaEntry?: GrpcSchemaEntry | null
    source?: 'reflection' | 'proto'
    // why no methods can be loaded, such as in a browser
    unavailableReason?: string | null
    // how much room the address bar has: narrow leaves the service out of the button, compact shows the method's
    // name alone. The rest is in its title
    fit?: 'full' | 'narrow' | 'compact'
    disabledReason?: string | null
}>(), {
    service: '',
    method: '',
    kind: null,
    schemaEntry: null,
    source: 'reflection',
    unavailableReason: null,
    fit: 'full',
    disabledReason: null,
})

const emit = defineEmits(['select', 'open', 'retry', 'use-proto-files'])

const open = ref(false)
const query = ref('')
const highlightedIndex = ref(0)
const loadingShown = ref(false)
const dropdownStyle = ref<Record<string, string>>({})
const kindLabels = GRPC_CALL_KIND_LABELS

const button = ref<HTMLButtonElement | null>(null)
const search = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)

let loadingTimer: ReturnType<typeof setTimeout> | undefined = undefined
// the window the open list listens to, which for a tab moved to a window of its own is that window
let listenerWindow: Window | null = null

const shortName = getShortServiceName
const callKind = getGrpcCallKind

const shortServiceName = computed(() => getShortServiceName(props.service))

const buttonTitle = computed(() => {
    if(props.disabledReason !== null) {
        return props.disabledReason
    }
    if(props.service && props.method) {
        return props.kind ? `${props.service}/${props.method}, ${kindLabels[props.kind]}` : `${props.service}/${props.method}`
    }
    return 'Choose the method to call'
})

const schema = computed<GrpcSchema | null>(() => props.schemaEntry?.schema ?? null)

// .proto files can stand in for server reflection that failed, not for a connection that did
const offersProtoFiles = computed(() => {
    const errorCode = props.schemaEntry?.errorCode
    return props.source === 'reflection' && (errorCode === 'REFLECTION_UNIMPLEMENTED' || errorCode === 'REFLECTION_FAILED')
})

const isLastAttemptFailed = computed(() => {
    const entry = props.schemaEntry
    return !!entry && entry.failedAt !== null && (entry.loadedAt === null || entry.failedAt > entry.loadedAt)
})

const results = computed<GrpcMethodSearchResult[]>(() => schema.value ? searchGrpcMethods(schema.value, query.value) : [])

// grouped by service while nothing is typed, one list best match first while searching
const rows = computed(() => {
    const rows: Row[] = []
    const grouped = query.value.trim() === ''
    let lastService: string | null = null
    results.value.forEach((result, resultIndex) => {
        if(grouped && result.service.name !== lastService) {
            rows.push({ type: 'group', key: `group:${result.service.name}`, service: result.service.name })
            lastService = result.service.name
        }
        rows.push({ type: 'method', key: `method:${result.service.name}/${result.method.name}`, service: result.service.name, method: result.method, resultIndex })
    })
    return rows
})

watch(() => props.schemaEntry?.loading, (loading: boolean | undefined) => {
    clearTimeout(loadingTimer)
    loadingShown.value = false
    if(loading) {
        loadingTimer = setTimeout(() => {
            loadingShown.value = true
        }, LOADING_SHOWN_AFTER_MS)
    }
}, { immediate: true })

// Methods that arrive while the list is open keep the highlighted method when they still have it, else
// highlight the best match of the search, or the chosen method with no search. The first ones to arrive bring
// the search box, which takes focus, as it does when the list opens with them
watch(schema, (schema: GrpcSchema | null, oldSchema: GrpcSchema | null) => {
    if(!open.value) {
        return
    }
    const highlighted = oldSchema && query.value !== '' ? searchGrpcMethods(oldSchema, query.value)[highlightedIndex.value] : undefined
    const keptIndex = highlighted ? results.value.findIndex(result => result.service.name === highlighted.service.name && result.method.name === highlighted.method.name) : -1
    if(keptIndex !== -1) {
        highlightedIndex.value = keptIndex
    } else if(query.value !== '') {
        highlightedIndex.value = 0
    } else {
        highlightCurrent()
    }
    nextTick(() => {
        position()
        if(oldSchema === null) {
            search.value?.focus()
        }
        scrollHighlightedIntoView()
    })
})

onBeforeUnmount(() => {
    clearTimeout(loadingTimer)
    stopListening()
})

onDeactivated(() => {
    close(false)
})

watch(() => props.disabledReason, reason => {
    if(reason !== null) {
        close(false)
    }
})

function toggle() {
    if(props.disabledReason !== null) {
        return
    }
    if(open.value) {
        close(false)
    } else {
        show()
    }
}

function show() {
    open.value = true
    query.value = ''
    highlightCurrent()
    emit('open')
    stopListening()
    listenerWindow = ownWindow()
    listenerWindow.addEventListener('resize', position)
    // wherever focus is, such as on the page after a click on a heading, as the app's menus close
    listenerWindow.addEventListener('keydown', onWindowKeydown, true)
    nextTick(() => {
        position()
        search.value?.focus()
        scrollHighlightedIntoView()
    })
}

function close(returnFocus: boolean) {
    if(!open.value) {
        return
    }
    open.value = false
    stopListening()
    if(returnFocus) {
        button.value?.focus()
    }
}

// the button is always rendered, so its document is the component's
function ownWindow(): Window {
    return button.value?.ownerDocument?.defaultView ?? window
}

function stopListening() {
    listenerWindow?.removeEventListener('resize', position)
    listenerWindow?.removeEventListener('keydown', onWindowKeydown, true)
    listenerWindow = null
}

function onWindowKeydown(event: KeyboardEvent) {
    if(event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close(true)
    }
}

function highlightCurrent() {
    const currentIndex = results.value.findIndex(result => result.service.name === props.service && result.method.name === props.method)
    highlightedIndex.value = currentIndex === -1 ? 0 : currentIndex
}

// Against the window, so no panel clips it: under the button, or above it when there is more room there
function position() {
    if(!button.value) {
        return
    }
    const rect = button.value.getBoundingClientRect()
    const { innerHeight, innerWidth } = ownWindow()
    const spaceBelow = innerHeight - rect.bottom - VIEWPORT_MARGIN
    const spaceAbove = rect.top - VIEWPORT_MARGIN
    const opensUp = spaceBelow < 240 && spaceAbove > spaceBelow
    const width = Math.min(Math.max(rect.width, 352), innerWidth - VIEWPORT_MARGIN * 2)
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.right - width, innerWidth - width - VIEWPORT_MARGIN))
    dropdownStyle.value = {
        left: `${left}px`,
        width: `${width}px`,
        maxHeight: `${Math.max(120, opensUp ? spaceAbove : spaceBelow)}px`,
        ...(opensUp ? { bottom: `${innerHeight - rect.top}px` } : { top: `${rect.bottom}px` }),
    }
}

function onQueryInput(event: Event) {
    query.value = (event.target as HTMLInputElement).value
    // the best match is the one Enter takes
    highlightedIndex.value = 0
    nextTick(() => scrollHighlightedIntoView())
}

function onSearchKeydown(event: KeyboardEvent) {
    if(event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if(results.value.length === 0) {
            return
        }
        const step = event.key === 'ArrowDown' ? 1 : -1
        highlightedIndex.value = (highlightedIndex.value + step + results.value.length) % results.value.length
        nextTick(() => scrollHighlightedIntoView())
        return
    }
    if(event.key === 'Enter') {
        event.preventDefault()
        if(results.value.length > 0) {
            choose(highlightedIndex.value)
        }
    }
}

function scrollHighlightedIntoView() {
    const listElement = list.value
    const option = listElement?.querySelector(`[data-result-index="${highlightedIndex.value}"]`) as HTMLElement | null
    if(!listElement || !option) {
        return
    }
    // the service heading above the first method of a group comes into view with it
    const previous = option.previousElementSibling as HTMLElement | null
    const top = previous?.classList.contains('grpc-method-picker-group') ? previous.offsetTop : option.offsetTop
    if(top < listElement.scrollTop) {
        listElement.scrollTop = top
    } else if(option.offsetTop + option.offsetHeight > listElement.scrollTop + listElement.clientHeight) {
        listElement.scrollTop = option.offsetTop + option.offsetHeight - listElement.clientHeight
    }
}

function choose(resultIndex: number) {
    const result = results.value[resultIndex]
    if(!result || props.disabledReason !== null) {
        return
    }
    emit('select', { service: result.service.name, method: result.method })
    close(true)
}

function useProtoFiles() {
    close(false)
    emit('use-proto-files')
}
</script>

<style scoped>
/* the address gives up its width before the method's name does */
.grpc-method-picker {
    height: 100%;
    min-width: 7rem;
    flex-shrink: 1;
    display: flex;
}

.grpc-method-picker-button {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    height: 100%;
    min-width: 0;
    max-width: 22rem;
    padding: 0 0.6rem;
    border: 0;
    border-left: 1px solid var(--default-border-color);
    background: inherit;
    color: var(--text-color);
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
    outline: 0;
}

/* the app's focus look for inputs, inside the bar so it is not cut off, and only for keyboard focus */
.grpc-method-picker-button:focus-visible {
    outline: 1px solid var(--input-highlight-outline-color);
    outline-offset: -1px;
}

.grpc-method-picker-button:hover:not(:disabled) {
    background-color: var(--response-panel-history-select-hover-color);
}

.grpc-method-picker-button:disabled {
    opacity: 0.5;
    cursor: default;
}

.grpc-method-picker-button-name {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 3rem;
}

.grpc-method-picker-placeholder {
    color: var(--tip-text-color);
}

.grpc-method-picker-kind {
    color: var(--tip-text-color);
    font-size: 0.8em;
    white-space: nowrap;
}

/* where the address bar is narrow the button keeps the method's name, the full name and kind are in its title */
.grpc-method-picker.grpc-method-picker-compact {
    min-width: 5rem;
}

.grpc-method-picker-compact .grpc-method-picker-button .grpc-method-picker-kind,
.grpc-method-picker-narrow .grpc-method-picker-button-service,
.grpc-method-picker-compact .grpc-method-picker-button-service {
    display: none;
}

/* catches a press outside the list, as the context menus do */
.grpc-method-picker-background {
    position: fixed;
    inset: 0;
    z-index: 10;
}

.grpc-method-picker-dropdown {
    position: fixed;
    z-index: 11;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--menu-border-color);
    box-shadow: 0 0 1rem 0 var(--box-shadow-color);
    border-radius: 0.3rem;
    background: var(--background-color);
    color: var(--text-color);
    font-weight: normal;
}

/* the app's text size, which buttons and inputs do not take on their own */
.grpc-method-picker-dropdown button,
.grpc-method-picker-dropdown input {
    font: inherit;
}

.grpc-method-picker-search {
    padding: 0.5rem;
    border-bottom: 1px solid var(--default-border-color);
}

.grpc-method-picker-search input {
    background: var(--background-color);
}

.grpc-method-picker-list {
    /* the rows' offsetTop, which keeps the highlighted one in view, is measured from the list */
    position: relative;
    overflow-y: auto;
    min-height: 0;
    padding: 0.3rem 0;
}

.grpc-method-picker-group {
    padding: 0.5rem 0.6rem 0.2rem;
    font-size: 0.75rem;
    color: var(--tip-text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    user-select: none;
}

.grpc-method-picker-option {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    padding: 0.4rem 0.6rem;
    border: 0;
    background: var(--background-color);
    color: var(--text-color);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
}

.grpc-method-picker-option-highlighted {
    background: var(--response-panel-history-select-hover-color);
}

/* the chosen method is ticked, as in the other menus, so the highlight keeps the background to itself */
.grpc-method-picker-option-check {
    font-size: 0.6rem;
    visibility: hidden;
}

.grpc-method-picker-option-check.grpc-method-picker-option-check-shown {
    visibility: visible;
}

.grpc-method-picker-option-name {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
}

.grpc-method-picker-option-service {
    color: var(--tip-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
}

.grpc-method-picker-option .grpc-method-picker-kind {
    margin-left: auto;
}

.grpc-method-picker-note {
    padding: 0.5rem 0.6rem;
    color: var(--tip-text-color);
    word-break: break-word;
}

.grpc-method-picker-note.grpc-method-picker-failed {
    color: var(--base-color-error);
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.grpc-method-picker-note.grpc-method-picker-failed span {
    flex: 1;
}

.grpc-method-picker-actions {
    display: flex;
    gap: 0.5rem;
    padding: 0 0.6rem 0.5rem;
}
</style>
