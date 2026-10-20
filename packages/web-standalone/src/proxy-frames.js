// The /proxy reply for a request sent with x-proxy-flag-stream: 1, read by packages/ui/src/utils/proxy-frames.ts.
// Each frame is [type: uint8][payload length: uint32 big-endian][payload]. Released UIs read these values, so a frame
// type keeps its meaning and a new kind of frame gets a new number
export const PROXY_FRAMES_CONTENT_TYPE = 'application/vnd.restfox.proxy-frames'

export const PROXY_FRAME_TYPE = {
    HEAD: 1, // JSON { status, statusText, headers, headTimeTaken, requestHeadersSent }
    DATA: 2, // upstream body bytes as received, never empty
    END: 3, // JSON { timeTaken, bodyTimeTaken }, the last frame
    ERROR: 4, // JSON { message, timedOut }, the last frame
}

const PROXY_FRAME_HEADER_LENGTH = 5

export function encodeProxyFrame(type, payload) {
    const frame = Buffer.allocUnsafe(PROXY_FRAME_HEADER_LENGTH + payload.byteLength)
    frame.writeUInt8(type, 0)
    frame.writeUInt32BE(payload.byteLength, 1)
    frame.set(payload, PROXY_FRAME_HEADER_LENGTH)
    return frame
}

export function encodeProxyJsonFrame(type, value) {
    return encodeProxyFrame(type, Buffer.from(JSON.stringify(value)))
}
