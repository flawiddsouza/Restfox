// @vitest-environment edge-runtime
import { describe, expect, test } from 'vitest'
import { PROXY_FRAMES_CONTENT_TYPE, PROXY_FRAME_TYPE, readProxyFrames } from './proxy-frames'
import type { ProxyFrame } from './proxy-frames'

function encodeFrame(type: number, payload: Uint8Array) {
    const frame = new Uint8Array(5 + payload.byteLength)
    frame[0] = type
    new DataView(frame.buffer).setUint32(1, payload.byteLength)
    frame.set(payload, 5)
    return frame
}

function concat(parts: Uint8Array[]) {
    const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
    let offset = 0
    for(const part of parts) {
        bytes.set(part, offset)
        offset += part.byteLength
    }
    return bytes
}

function streamOf(chunks: Uint8Array[]) {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            chunks.forEach(chunk => controller.enqueue(chunk))
            controller.close()
        },
    })
}

async function read(chunks: Uint8Array[]) {
    const frames: { type: number, payload: number[] }[] = []
    await readProxyFrames(streamOf(chunks), (frame: ProxyFrame) => {
        frames.push({ type: frame.type, payload: Array.from(frame.payload) })
    })
    return { frames }
}

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const allByteValues = Uint8Array.from({ length: 256 }, (_, index) => index)

const reply = concat([
    encodeFrame(PROXY_FRAME_TYPE.HEAD, json({ status: 200, statusText: 'OK', headers: [['content-type', 'text/event-stream']] })),
    encodeFrame(PROXY_FRAME_TYPE.DATA, allByteValues),
    encodeFrame(PROXY_FRAME_TYPE.DATA, new Uint8Array([0, 0, 0, 0, 5])),
    encodeFrame(PROXY_FRAME_TYPE.END, json({ mimeType: 'text/event-stream', timeTaken: 3, bodyTimeTaken: 1 })),
])

describe(`Function: ${readProxyFrames.name}`, () => {
    test('the content type is the one the server sends', () => {
        expect(PROXY_FRAMES_CONTENT_TYPE).toBe('application/vnd.restfox.proxy-frames')
    })

    test('one reply split at every byte offset, or a byte at a time, gives the same frames', async() => {
        const whole = await read([reply])
        expect(whole.frames.map(frame => frame.type)).toEqual([1, 2, 2, 3])
        expect(whole.frames[1].payload).toEqual(Array.from(allByteValues))

        for(let offset = 1; offset < reply.byteLength; offset++) {
            expect(await read([reply.subarray(0, offset), reply.subarray(offset)])).toEqual(whole)
        }

        expect(await read(Array.from(reply, byte => new Uint8Array([byte])))).toEqual(whole)
    })

    test('an error frame ends the reply, nothing after it is read', async() => {
        const { frames } = await read([concat([
            encodeFrame(PROXY_FRAME_TYPE.HEAD, json({ status: 200, statusText: 'OK', headers: [] })),
            encodeFrame(PROXY_FRAME_TYPE.ERROR, json({ message: 'Request timed out after 100 ms', timedOut: true })),
            encodeFrame(PROXY_FRAME_TYPE.DATA, allByteValues),
        ])])
        expect(frames.map(frame => frame.type)).toEqual([1, 4])
    })

    test('a stream closed mid-frame, or after whole frames, gives only the whole frames and no end or error', async() => {
        for(let offset = 0; offset < reply.byteLength; offset++) {
            const { frames } = await read([reply.subarray(0, offset)])
            expect(frames.map(frame => frame.type)).not.toContain(PROXY_FRAME_TYPE.END)
            expect(frames.map(frame => frame.type)).not.toContain(PROXY_FRAME_TYPE.ERROR)
        }
    })

    test('a stream that fails while reading rejects with its error', async() => {
        const failure = new Error('connection reset')
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(reply.subarray(0, 20))
                controller.error(failure)
            },
        })
        await expect(readProxyFrames(body, () => undefined)).rejects.toBe(failure)
    })
})
