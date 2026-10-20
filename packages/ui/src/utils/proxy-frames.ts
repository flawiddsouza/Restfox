// The web-standalone /proxy reply to a request sent with x-proxy-flag-stream: 1, written by
// packages/web-standalone/src/proxy-frames.js. Each frame is [type: uint8][payload length: uint32 big-endian][payload]
export const PROXY_FRAMES_CONTENT_TYPE = 'application/vnd.restfox.proxy-frames'

export const PROXY_FRAME_TYPE = {
    // JSON { status, statusText, headers, headTimeTaken, requestHeadersSent }
    HEAD: 1,
    // upstream body bytes as received
    DATA: 2,
    // JSON { timeTaken, bodyTimeTaken }, the last frame
    END: 3,
    // JSON { message, timedOut }, the last frame
    ERROR: 4,
} as const

export interface ProxyFrame {
    type: 1 | 2 | 3 | 4
    payload: Uint8Array
}

const FRAME_HEADER_LENGTH = 5

// Calls onFrame for each frame, wherever the reads split them, and stops after an end or error frame. A stream that
// closes before one only gives the whole frames it held. A failed read rejects with its error
export async function readProxyFrames(body: ReadableStream<Uint8Array>, onFrame: (frame: ProxyFrame) => void): Promise<void> {
    const reader = body.getReader()

    // received bytes not yet taken, the first chunk from queueOffset on
    const queue: Uint8Array[] = []
    let queueOffset = 0
    let available = 0

    // a frame that lies within one read is passed on as a view of it, without a copy
    const take = (length: number): Uint8Array => {
        available -= length

        const first = queue[0]
        if(length === 0) {
            return new Uint8Array(0)
        }

        if(first.byteLength - queueOffset >= length) {
            const bytes = first.subarray(queueOffset, queueOffset + length)
            queueOffset += length
            if(queueOffset === first.byteLength) {
                queue.shift()
                queueOffset = 0
            }
            return bytes
        }

        const bytes = new Uint8Array(length)
        let filled = 0
        while(filled < length) {
            const chunk = queue[0]
            const part = Math.min(chunk.byteLength - queueOffset, length - filled)
            bytes.set(chunk.subarray(queueOffset, queueOffset + part), filled)
            filled += part
            queueOffset += part
            if(queueOffset === chunk.byteLength) {
                queue.shift()
                queueOffset = 0
            }
        }
        return bytes
    }

    let frameHeader: { type: number, length: number } | null = null

    // passes on every whole frame received so far, true once the last frame has come
    const passWholeFrames = (): boolean => {
        for(;;) {
            if(frameHeader === null) {
                if(available < FRAME_HEADER_LENGTH) {
                    return false
                }
                const headerBytes = take(FRAME_HEADER_LENGTH)
                frameHeader = {
                    type: headerBytes[0],
                    length: new DataView(headerBytes.buffer, headerBytes.byteOffset, FRAME_HEADER_LENGTH).getUint32(1),
                }
            }

            if(available < frameHeader.length) {
                return false
            }

            const type = frameHeader.type as ProxyFrame['type']
            const payload = take(frameHeader.length)
            frameHeader = null

            onFrame({ type, payload })

            if(type === PROXY_FRAME_TYPE.END || type === PROXY_FRAME_TYPE.ERROR) {
                return true
            }
        }
    }

    for(let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        if(chunk.value.byteLength === 0) {
            continue
        }

        queue.push(chunk.value)
        available += chunk.value.byteLength

        if(passWholeFrames()) {
            reader.releaseLock()
            return
        }
    }
}
