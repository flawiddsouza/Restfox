// @vitest-environment edge-runtime
import { describe, expect, test, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
    createEventStreamParser,
    createJsonLinesParser,
    INFER_EXTRACT_PATH_ITEM_LIMIT,
    parseEventStream,
    parseJsonLines,
    inferExtractPath,
    extractText,
} from './event-stream'
import type { EventStreamItem } from '@/global'

const fixturesFolder = path.join(process.cwd(), 'test-data', 'event-streams')

function readFixture(name: string) {
    return new Uint8Array(readFileSync(path.join(fixturesFolder, name)))
}

function parseFixture(name: string) {
    const bytes = readFixture(name)
    return name.endsWith('.sse') ? parseEventStream(bytes) : parseJsonLines(bytes)
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

type ParserFactory = typeof createEventStreamParser

function feedChunks(createParser: ParserFactory, chunks: Uint8Array[]) {
    const parser = createParser()
    const items: EventStreamItem[] = []
    for(const chunk of chunks) {
        items.push(...parser.push(chunk))
    }
    items.push(...parser.end())
    return items
}

function splitEvery(bytes: Uint8Array, size: number) {
    const chunks: Uint8Array[] = []
    for(let offset = 0; offset < bytes.length; offset += size) {
        chunks.push(bytes.slice(offset, offset + size))
    }
    return chunks
}

function withLineEnding(bytes: Uint8Array, lineEnding: '\r\n' | '\r') {
    return encoder.encode(decoder.decode(bytes).replace(/\r\n|\r|\n/g, lineEnding))
}

// vercel/ai's test server sends each recorded chunk as one SSE event, then [DONE]
function chunksToEventStream(bytes: Uint8Array) {
    const lines = decoder.decode(bytes).split('\n').filter(line => line !== '')
    return encoder.encode(lines.map(line => `data: ${line}\n\n`).join('') + 'data: [DONE]\n\n')
}

const sseFixtures = [
    'openai-chat-completions.sse',
    'openai-responses.sse',
    'anthropic-messages.sse',
    'gemini-alt-sse.sse',
    'mcp-initialize.sse',
    'test-api-streaming-response.sse',
]

const jsonLinesFixtures = [
    'ollama-chat.ndjson',
    'ollama-generate.ndjson',
    'openai-completions.chunks.jsonl',
]

describe('Function: createEventStreamParser', () => {
    test.each(sseFixtures)('%s gives the same items for any split of its bytes', (name) => {
        const bytes = readFixture(name)
        const whole = parseEventStream(bytes)
        expect(whole.length).toBeGreaterThan(0)

        expect(feedChunks(createEventStreamParser, splitEvery(bytes, 1))).toEqual(whole)
        const wholeJson = JSON.stringify(whole)
        for(let offset = 0; offset <= bytes.length; offset++) {
            const items = feedChunks(createEventStreamParser, [bytes.subarray(0, offset), bytes.subarray(offset)])
            if(JSON.stringify(items) !== wholeJson) {
                expect(items, `split at byte ${offset}`).toEqual(whole)
            }
        }
    })

    test.each(sseFixtures)('%s gives the same items with CRLF, CR and LF line endings', (name) => {
        const bytes = readFixture(name)
        const whole = parseEventStream(bytes)
        for(const lineEnding of ['\r\n', '\r'] as const) {
            const converted = withLineEnding(bytes, lineEnding)
            expect(parseEventStream(converted)).toEqual(whole)
            expect(feedChunks(createEventStreamParser, splitEvery(converted, 1))).toEqual(whole)
        }
        expect(parseEventStream(encoder.encode(decoder.decode(bytes).replace(/\r\n/g, '\n')))).toEqual(whole)
    })

    test('reads the OpenAI chat completion stream into one event per data line, ending with [DONE]', () => {
        const bytes = readFixture('openai-chat-completions.sse')
        const items = parseEventStream(bytes)
        const dataLineCount = decoder.decode(bytes).split('\n').filter(line => line.startsWith('data: ')).length
        expect(items).toHaveLength(dataLineCount)
        expect(items.map(item => item.index)).toEqual(items.map((_item, index) => index))
        expect(items.every(item => item.event === undefined && !item.incomplete && !item.comment)).toBe(true)
        expect(items.at(-1)).toEqual({ index: dataLineCount - 1, data: '[DONE]' })
        expect(JSON.parse(items[0].data).object).toBe('chat.completion.chunk')
    })

    test('reads event names from the Anthropic Messages stream, ping included', () => {
        const items = parseEventStream(readFixture('anthropic-messages.sse'))
        expect(items[0].event).toBe('message_start')
        expect(items[2]).toEqual({ index: 2, event: 'ping', data: '{"type": "ping"}' })
        expect(items[items.length - 1].event).toBe('message_stop')
        expect(JSON.parse(items[items.length - 1].data)).toEqual({ type: 'message_stop' })
        expect(items.every(item => item.event === JSON.parse(item.data).type)).toBe(true)
    })

    test('reads the Gemini alt=sse stream, which ends lines with CRLF', () => {
        const bytes = readFixture('gemini-alt-sse.sse')
        expect(decoder.decode(bytes)).toContain('\r\n\r\n')
        const items = parseEventStream(bytes)
        expect(items).toHaveLength(3)
        expect(items.map(item => JSON.parse(item.data).candidates[0].content.parts[0].text)).toEqual(['The', ' capital of France', ' is Paris.\n'])
    })

    test('reads an MCP Streamable HTTP reply as one message event holding the JSON-RPC result', () => {
        const items = parseEventStream(readFixture('mcp-initialize.sse'))
        expect(items).toHaveLength(1)
        expect(items[0].event).toBe('message')
        const message = JSON.parse(items[0].data)
        expect(message.jsonrpc).toBe('2.0')
        expect(message.result.serverInfo.name).toBe('Playwright')
    })

    test('the test-api-streaming-response stream never dispatches, since it sends no blank line', () => {
        const bytes = readFixture('test-api-streaming-response.sse')
        const expectedData = 'Chunk 1\nChunk 2\nChunk 3\nChunk 4\nChunk 5\nEnd of streaming'

        for(const chunks of [[bytes], splitEvery(bytes, 1)]) {
            const parser = createEventStreamParser()
            const pushed = chunks.flatMap(chunk => parser.push(chunk))
            expect(pushed).toEqual([])
            expect(parser.peek()).toEqual({ index: 0, data: expectedData })
            expect(parser.end()).toEqual([{ index: 0, data: expectedData, incomplete: true }])
        }
    })

    test('peek shows the event being built and null between events', () => {
        const parser = createEventStreamParser()
        expect(parser.peek()).toBeNull()
        expect(parser.push(encoder.encode('event: update\ndata: one\n'))).toEqual([])
        expect(parser.peek()).toEqual({ index: 0, event: 'update', data: 'one' })
        expect(parser.push(encoder.encode('data: two\n\n'))).toEqual([{ index: 0, event: 'update', data: 'one\ntwo' }])
        expect(parser.peek()).toBeNull()
        expect(parser.end()).toEqual([])
    })

    test('reads comments, multi-line data, id and retry', () => {
        const text = ': keep-alive\n:\nevent: add\nid: 7\nretry: 3000\ndata: first\ndata\ndata:  third\n\ndata: {"a":1}\n\n'
        expect(parseEventStream(encoder.encode(text))).toEqual([
            { index: 0, data: 'keep-alive', comment: true },
            { index: 1, data: '', comment: true },
            { index: 2, event: 'add', id: '7', retry: 3000, data: 'first\n\n third' },
            { index: 3, data: '{"a":1}' },
        ])
    })

    test('ignores an id holding NUL, a retry that is not digits and unknown fields', () => {
        const text = 'id: a\0b\nretry: 10s\nfoo: bar\ndata: x\n\nid\nretry: 5\n\n'
        expect(parseEventStream(encoder.encode(text))).toEqual([
            { index: 0, data: 'x' },
            { index: 1, data: '', id: '', retry: 5 },
        ])
    })

    test('a blank line dispatches only after data or a field was seen', () => {
        expect(parseEventStream(encoder.encode('\n\n\nunknown: 1\n\nevent: ping\n\n\n'))).toEqual([
            { index: 0, event: 'ping', data: '' },
        ])
    })

    test('drops a leading BOM, also when it is split across chunks, and keeps a later one', () => {
        const bytes = encoder.encode('\uFEFFdata: a\uFEFF\n\n')
        const expected = [{ index: 0, data: 'a\uFEFF' }]
        expect(parseEventStream(bytes)).toEqual(expected)
        expect(feedChunks(createEventStreamParser, splitEvery(bytes, 1))).toEqual(expected)
        expect(feedChunks(createEventStreamParser, [bytes.subarray(0, 2), bytes.subarray(2)])).toEqual(expected)
    })

    test('a split inside a multibyte character or inside the field name gives the same event', () => {
        const bytes = encoder.encode('data: caf\u00e9 \u{1F600} \u4e2d\n\n')
        const expected = [{ index: 0, data: 'caf\u00e9 \u{1F600} \u4e2d' }]
        for(let offset = 0; offset <= bytes.length; offset++) {
            expect(feedChunks(createEventStreamParser, [bytes.subarray(0, offset), bytes.subarray(offset)])).toEqual(expected)
        }
    })

    test('a CR at the end of one chunk and an LF at the start of the next are one line break', () => {
        const parser = createEventStreamParser()
        expect(parser.push(encoder.encode('data: a\r'))).toEqual([])
        expect(parser.push(encoder.encode('\ndata: b\r'))).toEqual([])
        expect(parser.push(encoder.encode('\n\r'))).toEqual([{ index: 0, data: 'a\nb' }])
        expect(parser.push(encoder.encode('\r'))).toEqual([])
        expect(parser.push(encoder.encode('\n'))).toEqual([])
        expect(parser.end()).toEqual([])
    })

    test('end reads a last line without a line break and marks the event incomplete', () => {
        expect(parseEventStream(encoder.encode('data: a\n\ndata: b\ndata: c'))).toEqual([
            { index: 0, data: 'a' },
            { index: 1, data: 'b\nc', incomplete: true },
        ])
        expect(parseEventStream(encoder.encode('data: a\n\n: partial comment'))).toEqual([
            { index: 0, data: 'a' },
            { index: 1, data: 'partial comment', comment: true, incomplete: true },
        ])
    })

    test('never mutates the chunks it is given', () => {
        const bytes = readFixture('anthropic-messages.sse')
        const copy = bytes.slice()
        feedChunks(createEventStreamParser, splitEvery(bytes, 7))
        expect(bytes).toEqual(copy)
    })

    test('accepts an ArrayBuffer and a view into a larger buffer', () => {
        const bytes = encoder.encode('xxdata: a\n\nyy')
        expect(parseEventStream(bytes.buffer.slice(2, 12))).toEqual([{ index: 0, data: 'a' }])
        expect(parseEventStream(new DataView(bytes.buffer, 2, 10))).toEqual([{ index: 0, data: 'a' }])
        expect(parseEventStream(new ArrayBuffer(0))).toEqual([])
    })
})

describe('Function: createJsonLinesParser', () => {
    test.each(jsonLinesFixtures)('%s gives the same items for any split of its bytes', (name) => {
        const bytes = readFixture(name)
        const whole = parseJsonLines(bytes)
        expect(whole.length).toBeGreaterThan(0)

        expect(feedChunks(createJsonLinesParser, splitEvery(bytes, 1))).toEqual(whole)
        for(const size of [2, 3, 7, 64, 1000, 4096]) {
            expect(feedChunks(createJsonLinesParser, splitEvery(bytes, size))).toEqual(whole)
        }
        // every split of the 167 KB Ollama chat capture would take minutes, the 1-byte chunks above cover its boundaries
        if(bytes.length < 20000) {
            const wholeJson = JSON.stringify(whole)
            for(let offset = 0; offset <= bytes.length; offset++) {
                const items = feedChunks(createJsonLinesParser, [bytes.subarray(0, offset), bytes.subarray(offset)])
                if(JSON.stringify(items) !== wholeJson) {
                    expect(items, `split at byte ${offset}`).toEqual(whole)
                }
            }
        }
        for(const lineEnding of ['\r\n', '\r'] as const) {
            expect(parseJsonLines(withLineEnding(bytes, lineEnding))).toEqual(whole)
        }
    })

    test('reads the Ollama /api/chat stream into one item per line', () => {
        const bytes = readFixture('ollama-chat.ndjson')
        const lines = decoder.decode(bytes).split('\n').filter(line => line !== '')
        const items = parseJsonLines(bytes)
        expect(items).toEqual(lines.map((line, index) => ({ index, data: line })))
        expect(JSON.parse(items[items.length - 1].data).done).toBe(true)
    })

    test('marks the Ollama /api/generate capture\'s last line incomplete, as it was saved without a line break', () => {
        const bytes = readFixture('ollama-generate.ndjson')
        expect(bytes.at(-1)).not.toBe(0x0A)
        const parser = createJsonLinesParser()
        const pushed = parser.push(bytes)
        expect(pushed).toHaveLength(157)
        expect(parser.peek()?.index).toBe(157)
        const ended = parser.end()
        expect(ended).toHaveLength(1)
        expect(ended[0].incomplete).toBe(true)
        expect(JSON.parse(ended[0].data).done).toBe(true)
        expect(parseJsonLines(bytes).at(-1)).toEqual(ended[0])
    })

    test('an OpenAI Responses stream is known from its first event, though reasoning sends more than the scanned events before the text', () => {
        const event = (data: object) => `data: ${JSON.stringify(data)}\n\n`
        const body = [
            event({ type: 'response.created', response: { id: 'resp_1' } }),
            ...Array.from({ length: INFER_EXTRACT_PATH_ITEM_LIMIT + 200 }, (_, index) => event({ type: 'response.reasoning_summary_text.delta', delta: `step ${index} ` })),
            event({ type: 'response.output_text.delta', delta: 'The answer' }),
        ].join('')
        const items = parseEventStream(encoder.encode(body))
        const path = inferExtractPath(items.slice(0, INFER_EXTRACT_PATH_ITEM_LIMIT))
        expect(path).not.toBeNull()
        expect(extractText(items, path!)).toEqual({ text: 'The answer', matched: 1 })
    })

    test('drops empty lines and a leading BOM', () => {
        const text = '\uFEFF{"a":1}\n\n{"b":2}\r\n   \n{"c":3}'
        expect(parseJsonLines(encoder.encode(text))).toEqual([
            { index: 0, data: '{"a":1}' },
            { index: 1, data: '{"b":2}' },
            { index: 2, data: '{"c":3}', incomplete: true },
        ])
    })

    test('peek shows the line being received', () => {
        const parser = createJsonLinesParser()
        expect(parser.peek()).toBeNull()
        expect(parser.push(encoder.encode('{"a":1}\n{"b"'))).toEqual([{ index: 0, data: '{"a":1}' }])
        expect(parser.peek()).toEqual({ index: 1, data: '{"b"' })
        expect(parser.push(encoder.encode(':2}\r'))).toEqual([{ index: 1, data: '{"b":2}' }])
        expect(parser.peek()).toBeNull()
        expect(parser.push(encoder.encode('\n'))).toEqual([])
        expect(parser.end()).toEqual([])
    })
})

describe('Function: inferExtractPath', () => {
    test.each([
        ['openai-chat-completions.sse', '$.choices[0].delta.content'],
        ['openai-responses.sse', '$[?(@root.type === \'response.output_text.delta\' && @property === \'delta\')]'],
        ['anthropic-messages.sse', '$.delta.text'],
        ['gemini-alt-sse.sse', '$.candidates[0].content.parts[?(!@.thought)].text'],
        ['ollama-chat.ndjson', '$.message.content'],
        ['ollama-generate.ndjson', '$.response'],
        ['openai-completions.chunks.jsonl', '$.choices[0].text'],
        ['mcp-initialize.sse', null],
        ['test-api-streaming-response.sse', null],
    ])('%s gives %s', (name, expected) => {
        expect(inferExtractPath(parseFixture(name))).toBe(expected)
    })

    test('recognizes OpenAI legacy completions sent as an event stream', () => {
        const items = parseEventStream(chunksToEventStream(readFixture('openai-completions.chunks.jsonl')))
        expect(inferExtractPath(items)).toBe('$.choices[0].text')
    })

    test('knows an Anthropic stream from its first event, message_start, and does not take its content array for Ollama chat', () => {
        const [messageStart] = parseEventStream(readFixture('anthropic-messages.sse'))
        expect(JSON.parse(messageStart.data).type).toBe('message_start')
        expect(JSON.parse(messageStart.data).message.content).toEqual([])
        expect(inferExtractPath([messageStart])).toBe('$.delta.text')
    })

    test('skips comments and items that are not JSON objects', () => {
        expect(inferExtractPath([
            { index: 0, data: '{"response":"hi","done":false}', comment: true },
            { index: 1, data: '[DONE]' },
            { index: 2, data: 'null' },
            { index: 3, data: '[1,2]' },
            { index: 4, data: '{"response":"hi","done":false}' },
        ])).toBe('$.response')
        expect(inferExtractPath([])).toBeNull()
    })
})

describe('Function: extractText', () => {
    test.each([
        ['openai-chat-completions.sse', 'The capital of the UK is London.'],
        ['openai-responses.sse', '2 + 2 equals 4.'],
        ['gemini-alt-sse.sse', 'The capital of France is Paris.\n'],
        ['openai-completions.chunks.jsonl', 'The holiday is called "Gratitude Day" and it is a day dedicated to'],
    ])('%s joins to the answer', (name, expected) => {
        const items = parseFixture(name)
        expect(extractText(items, inferExtractPath(items) ?? '').text).toBe(expected)
    })

    test('the OpenAI chat stream matches every chunk with choices, and [DONE] is skipped', () => {
        const items = parseEventStream(readFixture('openai-chat-completions.sse'))
        const withChoices = items.filter(item => item.data !== '[DONE]' && JSON.parse(item.data).choices.length > 0)
        expect(extractText(items, '$.choices[0].delta.content').matched).toBe(withChoices.length - 1)
    })

    test('the OpenAI Responses stream joins only the answer, without the reasoning summary or the code a tool ran, which also come as deltas', () => {
        const items = parseFixture('openai-responses-reasoning-code-interpreter.sse')
        const events = items.map(item => JSON.parse(item.data))
        const answer = events.find(event => event.type === 'response.output_text.done').text
        const reasoning = events.filter(event => event.type === 'response.reasoning_summary_text.delta').map(event => event.delta).join('')
        expect(reasoning.length).toBeGreaterThan(0)

        const result = extractText(items, inferExtractPath(items) ?? '')
        expect(result.text).toBe(answer)
        expect(result.matched).toBe(events.filter(event => event.type === 'response.output_text.delta').length)
    })

    test('the Gemini stream joins only the answer, without the parts marked as thoughts', () => {
        const items = parseFixture('gemini-thinking.sse')
        const result = extractText(items, inferExtractPath(items) ?? '')
        expect(result.text.startsWith('This is a great question! Safely crossing the street is all about being aware and predictable.')).toBe(true)
        expect(result.text).not.toContain('**Clarifying User Goals**')
    })

    test('the Anthropic stream joins the text deltas and leaves out the thinking deltas', () => {
        const items = parseEventStream(readFixture('anthropic-messages.sse'))
        const result = extractText(items, '$.delta.text')
        expect(result.text.startsWith('Here are the basic steps for safely crossing the street:\n\n**At intersections with traffic lights:**\n')).toBe(true)
        expect(result.text.endsWith('Always prioritize safety over speed when crossing streets.')).toBe(true)
        expect(result.text).not.toContain('This is a straightforward question about')
        expect(result.matched).toBe(items.filter(item => JSON.parse(item.data).delta?.type === 'text_delta').length)
    })

    test('the Ollama streams join to the whole answer', () => {
        const chatBytes = readFixture('ollama-chat.ndjson')
        const chatLines = decoder.decode(chatBytes).split('\n').filter(line => line !== '').map(line => JSON.parse(line))
        const chat = extractText(parseJsonLines(chatBytes), '$.message.content')
        expect(chat.text).toBe(chatLines.map(line => line.message.content).join(''))
        expect(chat.text.startsWith('The move sequence **1. e4 e5** is the foundation of the **Open Game** in chess.')).toBe(true)
        expect(chat.matched).toBe(chatLines.length)

        const generateBytes = readFixture('ollama-generate.ndjson')
        const generate = extractText(parseJsonLines(generateBytes), '$.response')
        expect(generate.text.startsWith(' Large language models are a type of artificial intelligence (AI) model')).toBe(true)
        expect(generate.text.endsWith('have achieved state-of-the-art results on many NLP benchmarks.')).toBe(true)
        expect(generate.matched).toBe(158)
    })

    test('the legacy completions stream joins the same text over an event stream', () => {
        const items = parseEventStream(chunksToEventStream(readFixture('openai-completions.chunks.jsonl')))
        expect(extractText(items, '$.choices[0].text').text).toBe('The holiday is called "Gratitude Day" and it is a day dedicated to')
    })

    test('joins only string matches, counts the items that matched and skips comments', () => {
        const items: EventStreamItem[] = [
            { index: 0, data: '{"t":"a"}' },
            { index: 1, data: '{"t":1}' },
            { index: 2, data: 'not json' },
            { index: 3, data: '{"t":"b"}', comment: true },
            { index: 4, data: '{"t":["c","d"]}' },
            { index: 5, data: '{"t":""}' },
            { index: 6, data: '{"t":"e"}', incomplete: true },
        ]
        expect(extractText(items, '$.t')).toEqual({ text: 'ae', matched: 3 })
        expect(extractText(items, '$.t[*]')).toEqual({ text: 'cd', matched: 1 })
        expect(extractText(items, '$.missing')).toEqual({ text: '', matched: 0 })
    })
})

describe('No logging', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    test('malformed input and paths log nothing and throw nothing', () => {
        const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map(method => vi.spyOn(console, method))

        const garbage = new Uint8Array([0xFF, 0xFE, 0x0D, 0xC3, 0x0A, 0x00, 0x3A, 0x0A, 0x0A, 0xE2, 0x82])
        for(const createParser of [createEventStreamParser, createJsonLinesParser]) {
            const parser = createParser()
            parser.push(garbage)
            parser.peek()
            parser.end()
        }
        const items = [...parseEventStream(garbage), ...parseJsonLines(garbage), { index: 0, data: 'null' }, { index: 1, data: '{"a":' }, { index: 2, data: '"text"' }]
        inferExtractPath(items)
        for(const jsonPath of ['', '$', '$..', '$[?(@.a', 'not a path', '$.a[', '$..*']) {
            extractText(items, jsonPath)
        }

        for(const spy of spies) {
            expect(spy).not.toHaveBeenCalled()
        }
    })
})
