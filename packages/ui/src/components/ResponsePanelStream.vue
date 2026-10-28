<template>
    <template v-if="stream">
        <div class="response-panel-address-bar">
            <div class="response-panel-address-bar-tag-container">
                <div
                    class="tag"
                    :class="responseStatusColorMapping(stream.head)"
                    style="max-width: 15rem; text-overflow: ellipsis; overflow: hidden;"
                    :title="statusText"
                >
                    <span class="bold">{{ stream.head.status }}</span>
                    {{ statusText }}
                </div>
                <div class="tag ml-0_6rem" :class="{ 'tag-running': stream.endedAt === null }" title="Time since the request started">{{ stream.endedAt === null ? humanFriendlyRunningTime(elapsed) : humanFriendlyTime(elapsed) }}</div>
                <div class="tag ml-0_6rem" :class="{ 'tag-running': stream.endedAt === null }" :title="stream.endedAt === null ? 'Received so far' : 'Received'">{{ humanFriendlySize(stream.receivedBytes) }}</div>
                <div class="tag ml-0_6rem" v-if="itemCountLabel">{{ itemCountLabel }}</div>
            </div>
            <!-- once the body is over only scripts and the save are left, which Stop cannot stop -->
            <div class="response-panel-stream-actions" v-if="stream.endedAt === null">
                <button class="button" @click="stop" title="Stop receiving. What arrived is kept.">Stop</button>
            </div>
        </div>
        <div class="response-panel-tabs">
            <div
                v-for="tab in ['Preview', 'Header']"
                class="response-panel-tab"
                :class="{ 'response-panel-tab-active': activeStreamTab === tab }"
                @click="activeStreamTab = tab"
            >
                {{ tab }}
            </div>
            <div class="response-panel-tab-fill"></div>
        </div>
        <div class="response-panel-tabs-context">
            <template v-if="activeStreamTab === 'Preview'">
                <ResponseEventList
                    v-if="stream.view === 'events' || stream.view === 'lines'"
                    :key="stream.sendId"
                    :view-state="listViewState"
                    :items="shownItems"
                    :pending="stream.endedAt === null ? pending : null"
                    :live="true"
                    :view="stream.view"
                    :times="shownItemTimes"
                />
                <div class="response-panel-stream-text" v-else-if="stream.view === 'text'">
                    <div class="response-panel-stream-text-scroller" ref="textScroller" @scroll="onTextScroll">
                        <pre><span v-for="(segment, index) in textSegments" :key="index">{{ segment }}</span></pre>
                        <div class="response-panel-stream-hint" v-if="textCapped">{{ receivedHint }}</div>
                    </div>
                    <button class="button response-panel-stream-scroll-to-latest" v-if="!stickToBottom" @click="scrollTextToLatest">Scroll to latest</button>
                </div>
                <div class="content-box response-panel-stream-hint" v-else>{{ receivedHint }}</div>
            </template>
            <div class="content-box" v-if="activeStreamTab === 'Header'">
                <table>
                    <tr v-for="header in stream.head.headers">
                        <td style="white-space: nowrap">{{ header[0] }}</td>
                        <td style="word-break: break-word">{{ header[1] }}</td>
                    </tr>
                </table>
            </div>
        </div>
    </template>
</template>

<script lang="ts">
import { markRaw, nextTick, type PropType } from 'vue'
import type { EventListViewState, EventStreamItem, ResponseStream } from '@/global'
import ResponseEventList from './ResponseEventList.vue'
import {
    getStatusText,
    humanFriendlyRunningTime,
    humanFriendlySize,
    humanFriendlyTime,
    responseStatusColorMapping,
} from '@/helpers'
import { createEventStreamParser, createJsonLinesParser, type EventStreamParser } from '@/utils/event-stream'

// the same limit past which the response panel asks before showing a body
const TEXT_LIMIT_BYTES = 3 * 1024 * 1024
const BOTTOM_TOLERANCE = 4

export default {
    components: {
        ResponseEventList,
    },
    props: {
        tabId: {
            type: String,
            required: true,
        },
        // kept by the response panel, so the finished list starts where the user left the live one
        listViewState: {
            type: Object as PropType<EventListViewState | null>,
            default: null,
        },
    },
    data() {
        return {
            activeStreamTab: 'Preview',
            now: Date.now(),
            items: markRaw([]) as EventStreamItem[],
            itemTimes: null as number[] | null,
            pending: null as EventStreamItem | null,
            textSegments: [] as string[],
            textCapped: false,
            stickToBottom: true,
            textScrollTop: 0,
        }
    },
    computed: {
        stream(): ResponseStream | undefined {
            return this.$store.state.requestResponseStreams[this.tabId]
        },
        statusText(): string {
            const head = this.stream?.head
            if(!head) {
                return ''
            }
            if(head.statusText !== '') {
                return head.statusText
            }
            return getStatusText(head.status)
        },
        elapsed(): number {
            const stream = this.stream
            if(!stream) {
                return 0
            }
            return Math.max(0, (stream.endedAt ?? this.now) - stream.headAt) + stream.head.headTimeTaken
        },
        // once the body ended, an event still open stays as a row marked incomplete, as the finished list shows it
        shownItems(): EventStreamItem[] {
            if(this.stream?.endedAt === null || this.pending === null) {
                return this.items
            }
            return markRaw([...this.items, { ...this.pending, incomplete: true }])
        },
        shownItemTimes(): number[] | null {
            if(this.shownItems === this.items || this.itemTimes === null) {
                return this.itemTimes
            }
            return markRaw([...this.itemTimes, this.stream!.chunkTimes[this.stream!.chunkTimes.length - 1]])
        },
        itemCountLabel(): string {
            const view = this.stream?.view
            if(view !== 'events' && view !== 'lines') {
                return ''
            }
            // a comment line of an event stream carries no event
            const count = this.shownItems.filter(item => !item.comment).length
            const noun = view === 'events' ? 'event' : 'line'
            return `${count} ${noun}${count === 1 ? '' : 's'}`
        },
        receivedHint(): string {
            const size = humanFriendlySize(this.stream?.receivedBytes ?? 0)
            return this.stream?.endedAt === null ? `Receiving, ${size} so far` : `Received ${size}`
        },
    },
    watch: {
        'stream.sendId'() {
            this.reset()
            this.readChunks()
        },
        'stream.revision'() {
            this.readChunks()
        },
    },
    created() {
        this.reset()
        this.readChunks()
    },
    // a view kept alive while its tab is not shown loses its scroll position when it is taken out of the page
    activated() {
        const scroller = this.$refs.textScroller as HTMLElement | undefined
        if(scroller) {
            scroller.scrollTop = this.stickToBottom ? scroller.scrollHeight : this.textScrollTop
        }
    },
    mounted() {
        // often enough that the clock never lags the arrival times in the list
        this.clockTimer = setInterval(() => {
            this.now = Date.now()
        }, 100)
        this.scrollTextToLatest()
    },
    beforeUnmount() {
        clearInterval(this.clockTimer)
    },
    methods: {
        humanFriendlyRunningTime,
        humanFriendlySize,
        humanFriendlyTime,
        responseStatusColorMapping,
        reset() {
            const view = this.stream?.view
            // kept out of data(), they only track how far the chunks were read
            this.parser = (view === 'events' ? createEventStreamParser() : view === 'lines' ? createJsonLinesParser() : null) as EventStreamParser | null
            this.decoder = new TextDecoder()
            this.readChunkCount = 0
            this.decodedBytes = 0
            this.parsedItems = [] as EventStreamItem[]
            this.parsedTimes = [] as number[]
            this.items = markRaw([])
            this.itemTimes = null
            this.pending = null
            this.textSegments = []
            this.textCapped = false
        },
        // reads the chunks that arrived since the last call
        readChunks() {
            const stream = this.stream
            if(!stream) {
                return
            }

            const chunks = stream.chunks
            const chunkTimes = stream.chunkTimes
            const start = this.readChunkCount
            this.readChunkCount = chunks.length

            if(this.parser) {
                const itemCount = this.parsedItems.length
                for(let i = start; i < chunks.length; i++) {
                    for(const item of this.parser.push(chunks[i])) {
                        this.parsedItems.push(item)
                        this.parsedTimes.push(chunkTimes[i])
                    }
                }
                if(this.parsedItems.length !== itemCount || this.items.length !== this.parsedItems.length) {
                    this.items = markRaw(this.parsedItems.slice())
                    this.itemTimes = markRaw(this.parsedTimes.slice())
                }
                this.pending = this.parser.peek()
                return
            }

            if(stream.view !== 'text' || this.textCapped) {
                return
            }

            let text = ''
            for(let i = start; i < chunks.length; i++) {
                let chunk = chunks[i]
                const room = TEXT_LIMIT_BYTES - this.decodedBytes
                if(chunk.byteLength >= room) {
                    chunk = chunk.subarray(0, room)
                    this.textCapped = true
                }
                this.decodedBytes += chunk.byteLength
                text += this.decoder.decode(chunk, { stream: !this.textCapped })
                if(this.textCapped) {
                    break
                }
            }

            if(text === '') {
                return
            }

            const scroller = this.$refs.textScroller as HTMLElement | undefined
            this.textSegments.push(text)
            if(this.stickToBottom && scroller) {
                nextTick(() => {
                    scroller.scrollTop = scroller.scrollHeight
                })
            }
        },
        // the element from the event, since a scroll can arrive after the view is gone and its ref cleared
        onTextScroll(event: Event) {
            const scroller = event.currentTarget as HTMLElement
            if(!scroller.isConnected) {
                return
            }
            this.textScrollTop = scroller.scrollTop
            this.stickToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_TOLERANCE
            this.saveTextFollowing()
        },
        scrollTextToLatest() {
            this.stickToBottom = true
            this.saveTextFollowing()
            nextTick(() => {
                const scroller = this.$refs.textScroller as HTMLElement | undefined
                if(scroller) {
                    scroller.scrollTop = scroller.scrollHeight
                }
            })
        },
        // the finished text opens at its end when the user was following it here
        saveTextFollowing() {
            if(this.listViewState && this.stream?.view === 'text') {
                this.listViewState.stickToBottom = this.stickToBottom
            }
        },
        stop() {
            this.$store.state.requestAbortController[this.tabId]?.abort()
        },
    },
}
</script>

<style scoped>
.response-panel-stream-actions {
    display: flex;
    align-items: center;
    height: 100%;
    margin-left: 1rem;
    padding-right: 0.5rem;
}

.response-panel-stream-text {
    position: relative;
    height: 100%;
    min-height: 0;
}

.response-panel-stream-text-scroller {
    position: absolute;
    inset: 0;
    overflow: auto;
}

.response-panel-stream-text pre {
    margin: 0;
    padding: 0.5rem;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-monospace);
}

.response-panel-stream-hint {
    padding: 0.5rem;
    color: var(--tip-text-color);
}

.response-panel-stream-scroll-to-latest {
    position: absolute;
    bottom: 0.6rem;
    left: 50%;
    transform: translateX(-50%);
    box-shadow: 0 2px 4px var(--box-shadow-color);
}
</style>
