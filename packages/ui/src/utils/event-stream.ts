import { JSONPath } from 'jsonpath-plus'
import type { EventStreamItem } from '@/global'

// Parsers for streamed response bodies: text/event-stream (SSE) and JSON lines
// (NDJSON, JSON Lines). They take the body in any split and give the
// same items as for the whole body. Nothing in this file logs, since every
// console line is shown to the user in Logs.

export interface EventStreamParser {
    // items completed by this chunk
    push(chunk: Uint8Array): EventStreamItem[]
    // the item still being received, or null
    peek(): EventStreamItem | null
    // the item left unfinished when the body ended, marked incomplete
    end(): EventStreamItem[]
}

// Splits decoded UTF-8 text into lines on CR, LF or CRLF, also when the CR
// and the LF arrive in different chunks. TextDecoder drops a leading BOM.
function createLineSplitter() {
    const decoder = new TextDecoder('utf-8')
    let pendingLine = ''
    let skipNextLineFeed = false

    function splitText(text: string) {
        const lines: string[] = []
        let lineStart = 0
        for(let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i)
            if(skipNextLineFeed) {
                skipNextLineFeed = false
                if(charCode === 10) {
                    lineStart = i + 1
                    continue
                }
            }
            if(charCode === 10 || charCode === 13) {
                lines.push(pendingLine + text.slice(lineStart, i))
                pendingLine = ''
                lineStart = i + 1
                skipNextLineFeed = charCode === 13
            }
        }
        pendingLine += text.slice(lineStart)
        return lines
    }

    return {
        push(chunk: Uint8Array) {
            return splitText(decoder.decode(chunk, { stream: true }))
        },
        // flushes the decoder and returns the lines it completed plus the last
        // line, which had no line break, or null when there is none
        end() {
            const lines = splitText(decoder.decode())
            const lastLine = pendingLine
            pendingLine = ''
            return { lines, lastLine: lastLine === '' ? null : lastLine }
        },
        get pendingLine() {
            return pendingLine
        },
    }
}

function toUint8Array(buffer: BufferSource) {
    if(buffer instanceof Uint8Array) {
        return buffer
    }
    if(ArrayBuffer.isView(buffer)) {
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    }
    return new Uint8Array(buffer)
}

// Follows the WHATWG event stream rules, except that a comment line gives an
// item of its own and a blank line also dispatches an event without data
// lines when it had another field, so every received line shows up. An id or
// retry shows only on the event that carried it, it is not carried forward as
// the last event ID and reconnection time are.
export function createEventStreamParser(): EventStreamParser {
    const lineSplitter = createLineSplitter()
    let nextIndex = 0
    let dataLines: string[] = []
    let eventName: string | undefined
    let eventId: string | undefined
    let retry: number | undefined
    let fieldSeen = false

    function buildEvent(): EventStreamItem {
        const item: EventStreamItem = { index: nextIndex, data: dataLines.join('\n') }
        if(eventName !== undefined) {
            item.event = eventName
        }
        if(eventId !== undefined) {
            item.id = eventId
        }
        if(retry !== undefined) {
            item.retry = retry
        }
        return item
    }

    function resetEvent() {
        dataLines = []
        eventName = undefined
        eventId = undefined
        retry = undefined
        fieldSeen = false
    }

    function readLine(line: string, items: EventStreamItem[]) {
        if(line === '') {
            if(fieldSeen) {
                items.push(buildEvent())
                nextIndex++
            }
            resetEvent()
            return
        }

        const colonIndex = line.indexOf(':')

        if(colonIndex === 0) {
            const text = line.charCodeAt(1) === 32 ? line.slice(2) : line.slice(1)
            items.push({ index: nextIndex, data: text, comment: true })
            nextIndex++
            return
        }

        let field = line
        let value = ''
        if(colonIndex !== -1) {
            field = line.slice(0, colonIndex)
            value = line.charCodeAt(colonIndex + 1) === 32 ? line.slice(colonIndex + 2) : line.slice(colonIndex + 1)
        }

        if(field === 'data') {
            dataLines.push(value)
            fieldSeen = true
        } else if(field === 'event') {
            eventName = value
            fieldSeen = true
        } else if(field === 'id') {
            if(!value.includes('\0')) {
                eventId = value
                fieldSeen = true
            }
        } else if(field === 'retry') {
            if(/^[0-9]+$/.test(value)) {
                retry = Number(value)
                fieldSeen = true
            }
        }
    }

    return {
        push(chunk) {
            const items: EventStreamItem[] = []
            for(const line of lineSplitter.push(chunk)) {
                readLine(line, items)
            }
            return items
        },
        peek() {
            return fieldSeen ? buildEvent() : null
        },
        end() {
            const items: EventStreamItem[] = []
            const { lines, lastLine } = lineSplitter.end()
            for(const line of lines) {
                readLine(line, items)
            }
            if(lastLine !== null) {
                const itemCount = items.length
                readLine(lastLine, items)
                // a comment cut short by the end of the body
                for(let i = itemCount; i < items.length; i++) {
                    items[i].incomplete = true
                }
            }
            if(fieldSeen) {
                items.push({ ...buildEvent(), incomplete: true })
                nextIndex++
            }
            resetEvent()
            return items
        },
    }
}

function lineToItemData(line: string) {
    return line.trim() === '' ? null : line
}

// One item per line that is not blank, for NDJSON and JSON Lines.
export function createJsonLinesParser(): EventStreamParser {
    const lineSplitter = createLineSplitter()
    let nextIndex = 0

    function readLines(lines: string[], items: EventStreamItem[]) {
        for(const line of lines) {
            const data = lineToItemData(line)
            if(data !== null) {
                items.push({ index: nextIndex, data })
                nextIndex++
            }
        }
    }

    return {
        push(chunk) {
            const items: EventStreamItem[] = []
            readLines(lineSplitter.push(chunk), items)
            return items
        },
        peek() {
            const data = lineToItemData(lineSplitter.pendingLine)
            return data === null ? null : { index: nextIndex, data }
        },
        end() {
            const items: EventStreamItem[] = []
            const { lines, lastLine } = lineSplitter.end()
            readLines(lines, items)
            const data = lastLine === null ? null : lineToItemData(lastLine)
            if(data !== null) {
                items.push({ index: nextIndex, data, incomplete: true })
                nextIndex++
            }
            return items
        },
    }
}

function parseWhole(parser: EventStreamParser, buffer: BufferSource) {
    return [...parser.push(toUint8Array(buffer)), ...parser.end()]
}

export function parseEventStream(buffer: BufferSource): EventStreamItem[] {
    return parseWhole(createEventStreamParser(), buffer)
}

export function parseJsonLines(buffer: BufferSource): EventStreamItem[] {
    return parseWhole(createJsonLinesParser(), buffer)
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object'
}

function parseJsonObject(item: EventStreamItem): JsonObject | null {
    if(item.comment) {
        return null
    }
    try {
        const value: unknown = JSON.parse(item.data)
        return isObject(value) && !Array.isArray(value) ? value : null
    } catch {
        return null
    }
}

function extractPathFor(json: JsonObject): string | null {
    const firstChoice = Array.isArray(json.choices) ? json.choices[0] : undefined
    if(isObject(firstChoice) && isObject(firstChoice.delta)) {
        // OpenAI chat completions and compatible servers
        return '$.choices[0].delta.content'
    }
    if(isObject(firstChoice) && typeof firstChoice.text === 'string') {
        // OpenAI legacy completions
        return '$.choices[0].text'
    }
    if(json.type === 'content_block_delta' || (json.type === 'message_start' && isObject(json.message))) {
        // Anthropic Messages, known from its first event, message_start, which comes before the first text
        return '$.delta.text'
    }
    if(typeof json.type === 'string' && json.type.startsWith('response.')) {
        // OpenAI Responses, known from its first event, response.created, since reasoning or a tool run can send
        // many events before the first text. Its reasoning, tool arguments and code also come as a delta of events of
        // other types, so only output_text deltas are joined
        return '$[?(@root.type === \'response.output_text.delta\' && @property === \'delta\')]'
    }
    const firstCandidate = Array.isArray(json.candidates) ? json.candidates[0] : undefined
    if(isObject(firstCandidate) && isObject(firstCandidate.content) && Array.isArray(firstCandidate.content.parts)) {
        // Gemini, whose thinking comes as parts marked thought
        return '$.candidates[0].content.parts[?(!@.thought)].text'
    }
    if(isObject(json.message) && typeof json.message.content === 'string') {
        // Ollama /api/chat, Anthropic's message_start holds an array instead
        return '$.message.content'
    }
    if(typeof json.response === 'string' && 'done' in json) {
        // Ollama /api/generate
        return '$.response'
    }
    return null
}

// How far into a stream its kind is looked for. A stream of another kind is not
// read through to its end
export const INFER_EXTRACT_PATH_ITEM_LIMIT = 1000

export function inferExtractPath(items: EventStreamItem[]): string | null {
    for(const item of items) {
        const json = parseJsonObject(item)
        if(json === null) {
            continue
        }
        const path = extractPathFor(json)
        if(path !== null) {
            return path
        }
    }
    return null
}

export function extractText(items: EventStreamItem[], path: string): { text: string, matched: number } {
    let text = ''
    let matched = 0
    for(const item of items) {
        if(item.comment) {
            continue
        }
        let json: null | boolean | number | string | object
        try {
            json = JSON.parse(item.data)
        } catch {
            continue
        }
        let results: unknown[]
        try {
            results = JSONPath({ json, path, wrap: true }) ?? []
        } catch {
            continue
        }
        let itemMatched = false
        for(const result of results) {
            if(typeof result === 'string') {
                text += result
                itemMatched = true
            }
        }
        if(itemMatched) {
            matched++
        }
    }
    return { text, matched }
}
