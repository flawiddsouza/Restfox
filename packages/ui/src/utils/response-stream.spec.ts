// @vitest-environment edge-runtime
import { describe, expect, test, vi } from 'vitest'
import {
    NDJSON_CONTENT_TYPES,
    getStreamView,
    mimeTypeFromContentType,
    BODY_INCOMPLETE_MESSAGES,
    ResponseBodyCollector,
} from './response-stream'
import type { ResponseHead } from '@/global'

describe(`Function: ${getStreamView.name}`, () => {
    test('gives events for text/event-stream, ignoring parameters and case', () => {
        expect(getStreamView('text/event-stream')).toBe('events')
        expect(getStreamView('Text/Event-Stream; charset=utf-8')).toBe('events')
        expect(getStreamView('  text/event-stream ;charset=UTF-8')).toBe('events')
    })

    test('gives lines for every NDJSON type', () => {
        for(const contentType of NDJSON_CONTENT_TYPES) {
            expect(getStreamView(contentType)).toBe('lines')
            expect(getStreamView(`${contentType.toUpperCase()}; charset=utf-8`)).toBe('lines')
        }
    })

    test('gives text for textual types', () => {
        const textual = [
            'text/plain',
            'TEXT/HTML; charset=UTF-8',
            'application/json',
            'application/json; charset=utf-8',
            'application/json-seq',
            'application/xml',
            'application/javascript',
            'application/yaml',
            'application/problem+json',
            'application/problem+xml',
        ]
        for(const contentType of textual) {
            expect(getStreamView(contentType)).toBe('text')
        }
    })

    test('gives bytes for a type the finished response panel does not show as text either, so both views agree', () => {
        // the finished panel asks before showing these, the live view shows only the size
        expect(getStreamView('application/vnd.api+json')).toBe('bytes')
        expect(getStreamView('application/atom+xml')).toBe('bytes')
    })

    test('gives text for a custom format and bytes without it', () => {
        expect(getStreamView('application/vnd.custom; v=1')).toBe('bytes')
        expect(getStreamView('application/vnd.custom; v=1', ['application/vnd.custom'])).toBe('text')
        expect(getStreamView('Application/VND.Custom.Sub', ['application/vnd.custom'])).toBe('text')
        expect(getStreamView('image/png', [''])).toBe('bytes')
    })

    test('gives bytes for other types and a missing header', () => {
        expect(getStreamView('image/png')).toBe('bytes')
        expect(getStreamView('application/octet-stream')).toBe('bytes')
        expect(getStreamView('application/pdf')).toBe('bytes')
        expect(getStreamView('')).toBe('bytes')
    })
})

describe(`Function: ${mimeTypeFromContentType.name}`, () => {
    test('matches the type of a blob read from a response with the same header', async() => {
        const samples = [
            'text/HTML; Charset=UTF-8',
            'garbage',
            'text/plain;charset="utf-8"',
            'application/json; charset=utf-8, text/plain',
            'application/json',
            'text/event-stream',
            '',
        ]
        for(const contentType of samples) {
            const expected = (await new Response('x', { headers: { 'content-type': contentType } }).blob()).type
            expect(await mimeTypeFromContentType(contentType)).toBe(expected)
        }
    })

    test('gives an empty string for no header, as a blob does', async() => {
        expect(await mimeTypeFromContentType('')).toBe('')
        // a byte body, since a string body adds a text/plain header of its own
        expect(await mimeTypeFromContentType('')).toBe((await new Response(Uint8Array.from([120])).blob()).type)
    })
})

describe('BODY_INCOMPLETE_MESSAGES', () => {
    test('has a message for every stored value', () => {
        expect(Object.keys(BODY_INCOMPLETE_MESSAGES).sort()).toEqual(['cancelled', 'failed', 'timedOut'])
    })
})

describe('Class: ResponseBodyCollector', () => {
    const head: ResponseHead = {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'application/octet-stream']],
        headTimeTaken: 5,
    }

    const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i)

    test('joins all 256 byte values split into uneven chunks byte for byte', async() => {
        const collector = new ResponseBodyCollector(Date.now())
        collector.head(head)
        const sizes = [1, 0, 2, 3, 5, 8, 13, 21, 34, 55, 114]
        let offset = 0
        for(const size of sizes) {
            collector.push(allBytes.slice(offset, offset + size))
            offset += size
        }
        expect(offset).toBe(256)

        const result = await collector.result()
        expect(result.buffer).toBeInstanceOf(ArrayBuffer)
        expect(result.buffer.byteLength).toBe(256)
        expect(new Uint8Array(result.buffer)).toEqual(allBytes)
    })

    test('copies bytes out of chunks that are views into a larger buffer', async() => {
        const backing = new Uint8Array(1024).fill(7)
        backing.set(allBytes, 100)
        const collector = new ResponseBodyCollector(Date.now())
        collector.head(head)
        collector.push(backing.subarray(100, 228))
        collector.push(backing.subarray(228, 356))
        const result = await collector.result()
        expect(result.buffer.byteLength).toBe(256)
        expect(new Uint8Array(result.buffer)).toEqual(allBytes)
    })

    test('does not change the pushed chunks', async() => {
        const chunk = Uint8Array.from([1, 2, 3])
        const collector = new ResponseBodyCollector(Date.now())
        collector.head(head)
        collector.push(chunk)
        await collector.result()
        expect(chunk).toEqual(Uint8Array.from([1, 2, 3]))
    })

    test('gives an empty buffer for an empty body', async() => {
        const collector = new ResponseBodyCollector(Date.now())
        collector.head(head)
        const result = await collector.result()
        expect(result.buffer).toBeInstanceOf(ArrayBuffer)
        expect(result.buffer.byteLength).toBe(0)
    })

    test('refuses a result before the head arrived', async() => {
        await expect(new ResponseBodyCollector(Date.now()).result()).rejects.toThrow('The response ended before its status and headers arrived')
    })

    test('reports whether a head arrived', () => {
        const collector = new ResponseBodyCollector(Date.now())
        expect(collector.hasHead).toBe(false)
        collector.head(head)
        expect(collector.hasHead).toBe(true)
    })

    test('sets bodyIncomplete only when given', async() => {
        const complete = new ResponseBodyCollector(Date.now())
        complete.head(head)
        expect('bodyIncomplete' in await complete.result()).toBe(false)

        for(const bodyIncomplete of ['cancelled', 'timedOut', 'failed'] as const) {
            const partial = new ResponseBodyCollector(Date.now())
            partial.head(head)
            partial.push(Uint8Array.from([1]))
            expect((await partial.result({}, bodyIncomplete)).bodyIncomplete).toBe(bodyIncomplete)
        }
    })

    test('gives the same shape as a buffered page fetch when the head has no sent headers', async() => {
        const collector = new ResponseBodyCollector(Date.now())
        collector.head(head)
        const result = await collector.result({ timeTaken: 30, bodyTimeTaken: 10 })
        expect(Object.keys(result).sort()).toEqual(['bodyTimeTaken', 'buffer', 'headTimeTaken', 'headers', 'mimeType', 'status', 'statusText', 'timeTaken'])
        expect(result.status).toBe(200)
        expect(result.statusText).toBe('OK')
        expect(result.headers).toEqual(head.headers)
        expect(result.timeTaken).toBe(30)
        expect(result.headTimeTaken).toBe(5)
        expect(result.bodyTimeTaken).toBe(10)
    })

    test('gives the mimeType a blob of the whole response would have, from the head', async() => {
        for(const contentType of ['text/HTML; Charset=UTF-8', 'application/json', 'garbage']) {
            const collector = new ResponseBodyCollector(Date.now())
            collector.head({ ...head, headers: [['Content-Type', contentType]] })
            const expected = (await new Response('x', { headers: { 'content-type': contentType } }).blob()).type
            expect((await collector.result()).mimeType).toBe(expected)
        }

        const withoutContentType = new ResponseBodyCollector(Date.now())
        withoutContentType.head({ ...head, headers: [] })
        expect((await withoutContentType.result()).mimeType).toBe('')
    })

    test('copies requestHeadersSent from the head', async() => {
        const sent: ResponseHead['headers'] = [['Accept', '*/*']]
        const collector = new ResponseBodyCollector(Date.now())
        collector.head({ ...head, requestHeadersSent: sent })
        const result = await collector.result({ timeTaken: 40, bodyTimeTaken: 28 })
        expect(result.requestHeadersSent).toEqual(sent)

        const withNull = new ResponseBodyCollector(Date.now())
        withNull.head({ ...head, requestHeadersSent: null })
        const withNullResult = await withNull.result()
        expect('requestHeadersSent' in withNullResult).toBe(true)
        expect(withNullResult.requestHeadersSent).toBeNull()
    })

    test('measures the body and total time from the start time and the head when the transport gives none', async() => {
        vi.useFakeTimers()
        try {
            vi.setSystemTime(1000)
            const collector = new ResponseBodyCollector(Date.now())
            vi.setSystemTime(1150)
            collector.head(head)
            vi.setSystemTime(1400)
            const result = await collector.result()
            expect(result.headTimeTaken).toBe(5)
            expect(result.bodyTimeTaken).toBe(250)
            expect(result.timeTaken).toBe(400)
        } finally {
            vi.useRealTimers()
        }
    })

    test('never logs', async() => {
        const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => vi.spyOn(console, method))
        try {
            const collector = new ResponseBodyCollector(Date.now())
            collector.head(head)
            collector.push(allBytes)
            await collector.result({}, 'failed')
            for(const spy of spies) {
                expect(spy).not.toHaveBeenCalled()
            }
        } finally {
            spies.forEach(spy => spy.mockRestore())
        }
    })
})
