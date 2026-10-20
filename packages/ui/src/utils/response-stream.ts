import type {
    BodyIncomplete,
    RequestInitialResponse,
    ResponseHead,
    ResponseStreamView,
} from '@/global'
import { getResponseContentType } from '@/utils/response'

export const NDJSON_CONTENT_TYPES = [
    'application/x-ndjson',
    'application/ndjson',
    'application/jsonl',
    'application/jsonlines',
    'application/x-jsonlines',
    'application/stream+json',
]

// the start of each content type the response panel shows as text, live and once it ended
export const TEXT_CONTENT_TYPE_PREFIXES = [
    'text/',
    'application/json',
    'application/problem+json',
    'application/xml',
    'application/problem+xml',
    'application/javascript',
    'application/yaml',
]

// how a body is shown while it arrives, from the content-type header value
export function getStreamView(contentType: string, customFormats: string[] = []): ResponseStreamView {
    const base = contentType.split(';')[0].trim().toLowerCase()

    if(base === 'text/event-stream') {
        return 'events'
    }

    if(NDJSON_CONTENT_TYPES.includes(base)) {
        return 'lines'
    }

    if(
        TEXT_CONTENT_TYPE_PREFIXES.some(prefix => base.startsWith(prefix))
        || customFormats.some(format => format !== '' && base.startsWith(format.toLowerCase()))
    ) {
        return 'text'
    }

    return 'bytes'
}

// the type a blob of the whole response would have had, which is what mimeType held when every body was buffered,
// '' for a response without a content-type header
export async function mimeTypeFromContentType(contentType: string): Promise<string> {
    if(contentType === '') {
        return ''
    }

    return (await new Response(null, { headers: { 'content-type': contentType } }).blob()).type
}

// the signals of sends a newer Send on their tab replaced, whose response is thrown away
const replacedSendSignals = new WeakSet<AbortSignal>()

export function markSendReplaced(signal: AbortSignal): void {
    replacedSendSignals.add(signal)
}

export function isSendReplaced(signal: AbortSignal): boolean {
    return replacedSendSignals.has(signal)
}

export const BODY_INCOMPLETE_MESSAGES: Record<BodyIncomplete, string> = {
    cancelled: 'Response cancelled before it ended',
    timedOut: 'Response timed out before it ended',
    failed: 'Connection lost before the response ended',
}

// gathers a response as it arrives and builds the same RequestInitialResponse a buffered read gives
export class ResponseBodyCollector {
    private startTime: number
    private headEndTime = 0
    private responseHead: ResponseHead | null = null
    private chunks: Uint8Array[] = []
    private byteCount = 0

    // startTime is Date.now() before the request
    constructor(startTime: number) {
        this.startTime = startTime
    }

    head(head: ResponseHead): void {
        this.responseHead = head
        this.headEndTime = Date.now()
    }

    push(bytes: Uint8Array): void {
        this.chunks.push(bytes)
        this.byteCount += bytes.byteLength
    }

    get hasHead(): boolean {
        return this.responseHead !== null
    }

    // timings the transport measured itself, such as Electron's main process, otherwise measured here
    async result(end: { timeTaken?: number, bodyTimeTaken?: number } = {}, bodyIncomplete?: BodyIncomplete): Promise<RequestInitialResponse> {
        if(this.responseHead === null) {
            throw new Error('The response ended before its status and headers arrived')
        }

        const endTime = Date.now()

        // a fresh ArrayBuffer of exactly the received length, never a pushed chunk's backing buffer
        const bytes = new Uint8Array(this.byteCount)
        let offset = 0
        for(const chunk of this.chunks) {
            bytes.set(chunk, offset)
            offset += chunk.byteLength
        }

        const head = this.responseHead

        const response: RequestInitialResponse = {
            status: head.status,
            statusText: head.statusText,
            headers: head.headers,
            mimeType: await mimeTypeFromContentType(getResponseContentType(head)),
            buffer: bytes.buffer,
            timeTaken: end.timeTaken ?? endTime - this.startTime,
            headTimeTaken: head.headTimeTaken,
            bodyTimeTaken: end.bodyTimeTaken ?? endTime - this.headEndTime,
        }

        // absent when the transport does not report them, as a buffered page fetch leaves it
        if('requestHeadersSent' in head) {
            response.requestHeadersSent = head.requestHeadersSent
        }

        if(bodyIncomplete !== undefined) {
            response.bodyIncomplete = bodyIncomplete
        }

        return response
    }
}
