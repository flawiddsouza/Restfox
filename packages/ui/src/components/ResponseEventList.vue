<template>
    <div class="response-event-list">
        <div class="response-event-list-extracted" v-if="extractPath !== ''">
            <div class="response-event-list-pane-header">
                <span>Extracted text</span>
                <button class="button" @click="copyExtractedText" :disabled="extracted.matched === 0">Copy</button>
            </div>
            <pre class="response-event-list-extracted-text" ref="extractedText" v-if="extracted.matched > 0" @scroll="onExtractedScroll">{{ extracted.text }}</pre>
            <div class="response-event-list-hint response-event-list-no-match" v-else>No {{ noun }}s matched</div>
        </div>
        <div class="response-event-list-columns" :style="{ gridTemplateColumns: columnTemplate }">
            <span>#</span>
            <span v-if="times">Time</span>
            <span v-if="showEventColumn">Event</span>
            <span v-if="showIdColumn">ID</span>
            <span>Data</span>
        </div>
        <div class="response-event-list-body">
            <div class="response-event-list-scroller" ref="scroller" @scroll="onScroll">
                <div class="response-event-list-spacer" :style="{ height: `${spacerHeight}px` }">
                    <div
                        v-for="row in visibleRows"
                        :key="row.item.index"
                        class="response-event-list-row"
                        :class="{
                            'response-event-list-row-comment': row.item.comment,
                            'response-event-list-row-pending': row.pending,
                            'response-event-list-row-selected': selectedIndex === row.item.index,
                        }"
                        :style="{ top: `${rowTop(row.position)}px`, height: `${ROW_HEIGHT}px`, gridTemplateColumns: columnTemplate }"
                        @click="toggleSelected(row.item.index, row.position)"
                    >
                        <span>{{ row.item.index + 1 }}</span>
                        <span v-if="times">{{ row.pending ? '' : formatArrivalTime(times[row.position]) }}</span>
                        <span v-if="showEventColumn">{{ row.item.event }}</span>
                        <span v-if="showIdColumn">{{ row.item.id }}</span>
                        <span class="response-event-list-data">
                            <span class="response-event-list-state" v-for="label in rowLabels(row)" :title="label.title">{{ label.text + ' ' }}</span>{{ dataPreview(row.item.data) }}
                        </span>
                    </div>
                </div>
                <div class="response-event-list-hint response-event-list-empty" v-if="rowCount === 0">{{ view === 'events' ? 'No events' : 'No lines' }}{{ live ? ' yet' : '' }}</div>
            </div>
            <button class="button response-event-list-scroll-to-latest" v-if="live && !stickToBottom" @click="scrollToLatest">Scroll to latest</button>
        </div>
        <div class="response-event-list-detail" v-if="selectedItem">
            <div class="response-event-list-pane-header">
                <span>{{ selectedItemTitle }}</span>
                <i class="fa fa-times" @click="selectedIndex = null" title="Close"></i>
            </div>
            <!-- the viewer the response panel shows JSON in, highlighted and foldable -->
            <div class="response-event-list-detail-text">
                <CodeMirrorResponsePanelPreview :model-value="selectedItemText" />
            </div>
        </div>
        <div class="response-event-list-path">
            <input
                type="text"
                class="full-width-input"
                :title="`JSONPath of the text to join from each ${noun}, such as $.choices[0].delta.content`"
                placeholder="$.choices[0].delta.content"
                :value="extractPath"
                @input="onExtractPathInput"
            >
        </div>
    </div>
</template>

<script lang="ts">
import { nextTick, type PropType } from 'vue'
import type { EventListViewState, EventStreamItem } from '@/global'
import { INFER_EXTRACT_PATH_ITEM_LIMIT, extractText, inferExtractPath } from '@/utils/event-stream'
import { jsonStringify } from '@/helpers'
import CodeMirrorResponsePanelPreview from './CodeMirrorResponsePanelPreview.vue'

const ROW_HEIGHT = 26
// rows rendered above and below the visible ones, so a fast scroll shows no gap
const OVERSCAN = 10
// used until the list has been measured
const FALLBACK_VIEWPORT_HEIGHT = 600
// Browsers stop an element's height at a limit, Firefox at about 17.9 million px, which 26 px rows pass at about
// 690,000 events. Past this height the spacer stays this tall and scrolling it moves through the rows faster
const MAX_SPACER_HEIGHT = 10000000
// only the start of a long data line is drawn in its row, the detail pane shows all of it
const DATA_PREVIEW_LENGTH = 500
// scrolled this close to the end counts as at the end
const BOTTOM_TOLERANCE = 4

type Row = { item: EventStreamItem, position: number, pending: boolean }

export default {
    components: {
        CodeMirrorResponsePanelPreview,
    },
    props: {
        items: {
            type: Array as PropType<EventStreamItem[]>,
            required: true,
        },
        // the event still being received, shown last
        pending: {
            type: Object as PropType<EventStreamItem | null>,
            default: null,
        },
        // the response is still arriving, the list follows the newest event
        live: {
            type: Boolean,
            default: false,
        },
        view: {
            type: String as PropType<'events' | 'lines'>,
            default: 'events',
        },
        // ms since the send started when each item arrived, null when not known
        times: {
            type: Array as PropType<number[] | null>,
            default: null,
        },
        // kept by the parent, so a list that replaces this one for the same response, such as the finished list
        // after the live one, starts where the user left this one
        viewState: {
            type: Object as PropType<EventListViewState | null>,
            default: null,
        },
    },
    data() {
        const viewState = this.viewState as EventListViewState | null
        return {
            ROW_HEIGHT,
            scrollTop: viewState?.scrollTop ?? 0,
            viewportHeight: 0,
            // a live list starts at the newest event, a finished one at the first
            stickToBottom: viewState?.stickToBottom ?? this.live as boolean,
            selectedIndex: viewState?.selectedIndex ?? null as number | null,
            // what the user typed, null until they type
            extractPathInput: viewState?.extractPathInput ?? null as string | null,
            inferredExtractPath: null as string | null,
            extracted: { text: '', matched: 0 },
            // the extracted text follows new text while the user leaves it at the end, and keeps its place otherwise
            extractedStickToBottom: true,
            extractedScrollTop: 0,
        }
    },
    computed: {
        rowCount(): number {
            return this.items.length + (this.pending ? 1 : 0)
        },
        rowsHeight(): number {
            return this.rowCount * ROW_HEIGHT
        },
        spacerHeight(): number {
            return Math.min(this.rowsHeight, MAX_SPACER_HEIGHT)
        },
        // how far into the rows the view starts, the scroll position itself until the rows outgrow the spacer
        rowsScrollTop(): number {
            return this.toRowsScrollTop(this.scrollTop)
        },
        visibleRows(): Row[] {
            const height = this.viewportHeight || FALLBACK_VIEWPORT_HEIGHT
            const first = Math.max(0, Math.floor(this.rowsScrollTop / ROW_HEIGHT) - OVERSCAN)
            const last = Math.min(this.rowCount, Math.ceil((this.rowsScrollTop + height) / ROW_HEIGHT) + OVERSCAN)
            const rows: Row[] = []
            for(let position = first; position < last; position++) {
                if(position < this.items.length) {
                    rows.push({ item: this.items[position], position, pending: false })
                } else if(this.pending) {
                    rows.push({ item: this.pending, position, pending: true })
                }
            }
            return rows
        },
        columnTemplate(): string {
            const columns = ['3.5rem']
            if(this.times) {
                columns.push('4.5rem')
            }
            if(this.showEventColumn) {
                columns.push('minmax(3rem, 1fr)')
            }
            if(this.showIdColumn) {
                columns.push('minmax(2.5rem, 0.7fr)')
            }
            columns.push('minmax(0, 5fr)')
            return columns.join(' ')
        },
        // The columns follow the first event, so they never change while events arrive. A stream names its events
        // and gives ids from the first one or not at all, and a later one is marked in its row and in the detail pane
        firstEvent(): EventStreamItem | null {
            const item = this.items.find(listItem => !listItem.comment) ?? this.pending
            return item && !item.comment ? item : null
        },
        showEventColumn(): boolean {
            return this.view === 'events' && this.firstEvent?.event !== undefined
        },
        showIdColumn(): boolean {
            return this.view === 'events' && this.firstEvent?.id !== undefined
        },
        noun(): string {
            return this.view === 'events' ? 'event' : 'line'
        },
        extractPath(): string {
            return this.extractPathInput ?? this.inferredExtractPath ?? ''
        },
        selectedItem(): EventStreamItem | null {
            if(this.selectedIndex === null) {
                return null
            }
            const item = this.items[this.selectedIndex]
            if(item && item.index === this.selectedIndex) {
                return item
            }
            if(this.pending && this.pending.index === this.selectedIndex) {
                return this.pending
            }
            return this.items.find(listItem => listItem.index === this.selectedIndex) ?? null
        },
        selectedItemTitle(): string {
            const item = this.selectedItem
            if(!item) {
                return ''
            }
            // a comment carries no event, the number is its row's
            let title = `${item.comment ? 'Comment' : this.view === 'events' ? 'Event' : 'Line'} ${item.index + 1}`
            if(item.event !== undefined) {
                title += `, ${item.event}`
            }
            if(item.id !== undefined) {
                title += `, ID ${item.id}`
            }
            return title
        },
        selectedItemText(): string {
            const data = this.selectedItem?.data ?? ''
            try {
                const json = JSON.parse(data)
                if(json !== null && typeof json === 'object') {
                    return jsonStringify(json)
                }
            } catch {}
            return data
        },
    },
    watch: {
        items() {
            this.itemsChanged()
        },
        pending() {
            this.followNewest()
        },
        extractPath() {
            this.updateExtractedText()
        },
        // with nothing matched the pane is gone, and the one made for the next match starts at the newest text
        'extracted.matched'(matched: number) {
            if(matched === 0) {
                this.extractedStickToBottom = true
                this.extractedScrollTop = 0
            }
        },
        selectedIndex(selectedIndex: number | null) {
            this.saveViewState({ selectedIndex })
        },
        extractPathInput(extractPathInput: string | null) {
            this.saveViewState({ extractPathInput })
        },
    },
    created() {
        // kept out of data(), since they only track how far the items were read
        this.inferScan = { count: 0, lastItem: null }
        this.extractScan = { path: '', count: 0, lastItem: null }
        this.updateInferredExtractPath()
        this.updateExtractedText()
    },
    mounted() {
        // before anything measures the new scroller, which starts at the top
        this.restoreScrollPosition()
        if(typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.measure())
            this.resizeObserver.observe(this.$refs.scroller)
        }
    },
    // a list kept alive while its tab is not shown loses its scroll position when it is taken out of the page
    activated() {
        this.restoreScrollPosition()
        const extractedText = this.$refs.extractedText as HTMLElement | undefined
        if(extractedText) {
            extractedText.scrollTop = this.live && this.extractedStickToBottom ? extractedText.scrollHeight : this.extractedScrollTop
        }
    },
    beforeUnmount() {
        this.resizeObserver?.disconnect()
    },
    methods: {
        saveViewState(change: Partial<EventListViewState>) {
            if(this.viewState) {
                Object.assign(this.viewState, change)
            }
        },
        // where the rows are scrolled to for a scroll position of the scroller, the same until the rows outgrow the spacer
        toRowsScrollTop(scrollTop: number): number {
            if(this.rowsHeight <= this.spacerHeight) {
                return scrollTop
            }
            const height = this.viewportHeight || FALLBACK_VIEWPORT_HEIGHT
            const scrollRange = this.spacerHeight - height
            return scrollRange > 0 ? scrollTop * (this.rowsHeight - height) / scrollRange : 0
        },
        toScrollTop(rowsScrollTop: number): number {
            if(this.rowsHeight <= this.spacerHeight) {
                return rowsScrollTop
            }
            const height = this.viewportHeight || FALLBACK_VIEWPORT_HEIGHT
            const rowsRange = this.rowsHeight - height
            return rowsRange > 0 ? rowsScrollTop * (this.spacerHeight - height) / rowsRange : 0
        },
        // a row's place in the spacer, next to the scroll position once the rows outgrow it
        rowTop(position: number): number {
            return position * ROW_HEIGHT - this.rowsScrollTop + this.scrollTop
        },
        // true when the items only grew since they were read up to count, so reading can go on from there
        itemsGrewFrom(scan: { count: number, lastItem: EventStreamItem | null }) {
            return this.items.length >= scan.count && (scan.count === 0 || this.items[scan.count - 1] === scan.lastItem)
        },
        itemsChanged() {
            if(!this.itemsGrewFrom(this.inferScan)) {
                this.inferredExtractPath = null
                this.inferScan = { count: 0, lastItem: null }
            }
            this.updateInferredExtractPath()
            this.updateExtractedText()
            this.followNewest()
        },
        updateInferredExtractPath() {
            if(this.inferredExtractPath !== null || this.inferScan.count >= INFER_EXTRACT_PATH_ITEM_LIMIT || this.inferScan.count === this.items.length) {
                return
            }
            const end = Math.min(this.items.length, INFER_EXTRACT_PATH_ITEM_LIMIT)
            this.inferredExtractPath = inferExtractPath(this.items.slice(this.inferScan.count, end))
            this.inferScan = { count: end, lastItem: this.items[end - 1] }
        },
        updateExtractedText() {
            const path = this.extractPath
            if(path === '') {
                this.extracted = { text: '', matched: 0 }
                this.extractScan = { path, count: 0, lastItem: null }
                return
            }

            let { text, matched } = this.extracted
            if(path !== this.extractScan.path || !this.itemsGrewFrom(this.extractScan)) {
                text = ''
                matched = 0
                this.extractScan = { path, count: 0, lastItem: null }
            }

            if(this.extractScan.count === this.items.length) {
                if(text !== this.extracted.text || matched !== this.extracted.matched) {
                    this.extracted = { text, matched }
                }
                return
            }

            const added = extractText(this.items.slice(this.extractScan.count), path)
            this.extracted = { text: text + added.text, matched: matched + added.matched }
            this.extractScan = { path, count: this.items.length, lastItem: this.items[this.items.length - 1] ?? null }

            if(this.live && this.extractedStickToBottom) {
                nextTick(() => {
                    const extractedText = this.$refs.extractedText as HTMLElement | undefined
                    if(extractedText) {
                        extractedText.scrollTop = extractedText.scrollHeight
                    }
                })
            }
        },
        isAtBottom(element: HTMLElement) {
            return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_TOLERANCE
        },
        // a scroller taken out of the page reads as scrolled to the top, which is not where the user left it
        measure() {
            const scroller = this.$refs.scroller as HTMLElement | undefined
            if(scroller && scroller.isConnected) {
                this.viewportHeight = scroller.clientHeight
                this.scrollTop = scroller.scrollTop
            }
        },
        restoreScrollPosition() {
            if(this.stickToBottom) {
                this.scrollScrollerToEnd()
                return
            }
            const scroller = this.$refs.scroller as HTMLElement | undefined
            if(scroller) {
                scroller.scrollTop = this.scrollTop
                this.measure()
            }
        },
        // the element from the event, since a scroll can arrive after the list is gone and its ref cleared
        onScroll(event: Event) {
            const scroller = event.currentTarget as HTMLElement
            if(!scroller.isConnected) {
                return
            }
            this.scrollTop = scroller.scrollTop
            this.viewportHeight = scroller.clientHeight
            this.stickToBottom = this.isAtBottom(scroller)
            this.saveViewState({ scrollTop: this.scrollTop, stickToBottom: this.stickToBottom })
        },
        onExtractedScroll(event: Event) {
            const extractedText = event.currentTarget as HTMLElement
            if(!extractedText.isConnected) {
                return
            }
            this.extractedScrollTop = extractedText.scrollTop
            this.extractedStickToBottom = this.isAtBottom(extractedText)
        },
        onExtractPathInput(event: Event) {
            this.extractPathInput = (event.target as HTMLInputElement).value
        },
        followNewest() {
            if(!this.live || !this.stickToBottom) {
                return
            }
            nextTick(() => {
                if(this.live && this.stickToBottom) {
                    this.scrollScrollerToEnd()
                }
            })
        },
        scrollScrollerToEnd() {
            const scroller = this.$refs.scroller as HTMLElement | undefined
            if(!scroller) {
                return
            }
            scroller.scrollTop = scroller.scrollHeight
            this.scrollTop = scroller.scrollTop
            this.viewportHeight = scroller.clientHeight
            this.saveViewState({ scrollTop: this.scrollTop, stickToBottom: this.stickToBottom })
        },
        scrollToLatest() {
            this.stickToBottom = true
            nextTick(() => this.scrollScrollerToEnd())
        },
        toggleSelected(index: number, position: number) {
            this.selectedIndex = this.selectedIndex === index ? null : index
            if(this.selectedIndex !== null) {
                // the detail pane opens below the list and takes its lower part, where the row may sit
                nextTick(() => this.scrollRowIntoView(position))
            }
        },
        scrollRowIntoView(position: number) {
            const scroller = this.$refs.scroller as HTMLElement | undefined
            if(!scroller) {
                return
            }
            this.measure()
            const rowTop = position * ROW_HEIGHT
            const rowBottom = rowTop + ROW_HEIGHT
            const height = this.viewportHeight || FALLBACK_VIEWPORT_HEIGHT
            let rowsScrollTop = this.rowsScrollTop
            if(rowBottom > rowsScrollTop + height) {
                rowsScrollTop = rowBottom - height
            } else if(rowTop < rowsScrollTop) {
                rowsScrollTop = rowTop
            } else {
                return
            }
            scroller.scrollTop = Math.ceil(this.toScrollTop(rowsScrollTop))
            this.measure()
            if(this.live) {
                this.stickToBottom = this.isAtBottom(scroller)
            }
            this.saveViewState({ scrollTop: this.scrollTop, stickToBottom: this.stickToBottom })
        },
        // what a row has no column for, and its state
        rowLabels(row: Row): { text: string, title: string }[] {
            const labels: { text: string, title: string }[] = []
            if(row.item.comment) {
                labels.push({ text: 'comment', title: 'A comment line, which carries no event' })
            } else if(!this.showEventColumn && row.item.event !== undefined) {
                labels.push({ text: row.item.event, title: 'The event name' })
            }
            if(row.pending) {
                labels.push({ text: 'receiving', title: `This ${this.noun} is still arriving` })
            } else if(row.item.incomplete) {
                labels.push({ text: 'incomplete', title: `The response ended before this ${this.noun} was closed` })
            }
            return labels
        },
        dataPreview(data: string) {
            const start = data.length > DATA_PREVIEW_LENGTH ? data.slice(0, DATA_PREVIEW_LENGTH) : data
            return start.replace(/[\r\n]+/g, ' ')
        },
        formatArrivalTime(milliseconds: number | undefined) {
            if(milliseconds === undefined) {
                return ''
            }
            return `+${(milliseconds / 1000).toFixed(2)} s`
        },
        async copyExtractedText() {
            if(!window.isSecureContext) {
                this.$toast.error('Copy to clipboard needs Restfox running under a https url')
                return
            }
            await navigator.clipboard.writeText(this.extracted.text)
            this.$toast.success('Copied to clipboard')
        },
    },
}
</script>

<style scoped>
.response-event-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}

.response-event-list-pane-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.3rem 0.5rem;
    background-color: var(--sidebar-item-active-color);
    border-bottom: 1px solid var(--default-border-color);
    user-select: none;
}

.response-event-list-pane-header i {
    cursor: pointer;
    padding: 0.2rem 0.3rem;
}

/* a fixed height, so the rows below do not move down as the text grows */
.response-event-list-extracted {
    display: flex;
    flex-direction: column;
    flex: 0 0 30%;
    min-height: 4rem;
    border-bottom: 1px solid var(--default-border-color);
}

.response-event-list-detail-text {
    flex: 1;
    min-height: 0;
}

.response-event-list-extracted-text {
    margin: 0;
    padding: 0.5rem;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-monospace);
    min-height: 0;
}

.response-event-list-hint {
    padding: 0.5rem;
    color: var(--tip-text-color);
}

.response-event-list-columns {
    display: grid;
    padding: 0 0.5rem;
    column-gap: 0.75rem;
    border-bottom: 1px solid var(--default-border-color);
    line-height: 26px;
    font-weight: 500;
    user-select: none;
}

.response-event-list-body {
    position: relative;
    flex: 1 1 0;
    min-height: 4rem;
}

.response-event-list-scroller {
    position: absolute;
    inset: 0;
    overflow: auto;
}

.response-event-list-spacer {
    position: relative;
}

.response-event-list-row {
    position: absolute;
    left: 0;
    right: 0;
    display: grid;
    align-items: center;
    padding: 0 0.5rem;
    column-gap: 0.75rem;
    border-bottom: 1px solid var(--border-color-lighter);
    font-family: var(--font-monospace);
    white-space: nowrap;
    cursor: pointer;
}

.response-event-list-row > span {
    overflow: hidden;
    text-overflow: ellipsis;
}

.response-event-list-row:hover {
    background-color: var(--response-panel-history-select-hover-color);
}

.response-event-list-row.response-event-list-row-selected {
    background-color: var(--sidebar-item-active-color);
}

.response-event-list-row-comment,
.response-event-list-row-pending {
    color: var(--tip-text-color);
}

/* each label ends in a space, so copied text keeps them apart */
.response-event-list-state {
    font-family: var(--font-default);
    font-style: italic;
    margin-right: 0.15rem;
}

.response-event-list-scroll-to-latest {
    position: absolute;
    bottom: 0.6rem;
    left: 50%;
    transform: translateX(-50%);
    box-shadow: 0 2px 4px var(--box-shadow-color);
}

/* a fixed height, so picking another row moves nothing */
.response-event-list-detail {
    display: flex;
    flex-direction: column;
    flex: 0 0 35%;
    min-height: 4rem;
    border-top: 1px solid var(--default-border-color);
}

.response-event-list-path {
    display: flex;
    align-items: center;
    padding: 5px;
    border-top: 1px solid var(--default-border-color);
}
</style>
