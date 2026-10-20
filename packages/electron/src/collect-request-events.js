// test helper: runs handleSendRequest with an emit that records every pushed message, checks their order, and rebuilds
// the reply sendRequest gave before responses were pushed: { event: 'response', eventData } with the whole body as one
// Uint8Array, less mimeType, which the UI now works out from the headers, or { event: 'responseError', eventData }.
// A body cut short gives { event: 'bodyError', eventData }.
import { handleSendRequest } from './request.js'

function rebuildRequestResult(events) {
    const terminals = events.filter(message => ['end', 'bodyError', 'responseError'].includes(message.event))
    if(terminals.length > 1) {
        throw new Error(`more than one final message: ${terminals.map(message => message.event).join(', ')}`)
    }

    if(events[0]?.event === 'responseError') {
        if(events.length !== 1) {
            throw new Error('messages pushed besides responseError')
        }
        return events[0]
    }

    if(events[0]?.event !== 'head') {
        throw new Error(`first message is ${events[0]?.event}, not head`)
    }

    const head = events[0].eventData
    const chunks = []
    for(const [index, message] of events.slice(1).entries()) {
        const isLast = index === events.length - 2
        if(message.event === 'data') {
            if(!(message.eventData instanceof Uint8Array) || message.eventData.length === 0) {
                throw new Error('data message without bytes')
            }
            if(message.eventData.byteOffset !== 0 || message.eventData.buffer.byteLength !== message.eventData.length) {
                throw new Error('data message shares a larger ArrayBuffer')
            }
            chunks.push(message.eventData)
        } else if(!isLast || !['end', 'bodyError'].includes(message.event)) {
            throw new Error(`unexpected ${message.event} message at ${index + 1}`)
        }
    }

    const buffer = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
    let offset = 0
    for(const chunk of chunks) {
        buffer.set(chunk, offset)
        offset += chunk.length
    }

    const last = events[events.length - 1]

    if(last.event === 'end') {
        return {
            event: 'response',
            eventData: {
                status: head.status,
                statusText: head.statusText,
                headers: head.headers,
                buffer,
                timeTaken: last.eventData.timeTaken,
                headTimeTaken: head.headTimeTaken,
                bodyTimeTaken: last.eventData.bodyTimeTaken,
                requestHeadersSent: head.requestHeadersSent,
            },
        }
    }

    if(last.event !== 'bodyError') {
        throw new Error(`no final message, the last is ${last.event}`)
    }

    return {
        event: 'bodyError',
        eventData: { ...head, buffer, ...last.eventData },
    }
}

export async function collectRequestEvents(data, onMessage = () => {}) {
    const events = []
    const returned = await handleSendRequest(data, message => {
        events.push(message)
        onMessage(message)
    })
    if(returned !== undefined) {
        throw new Error('handleSendRequest returned a value, the response goes through emit only')
    }
    return { events, result: rebuildRequestResult(events) }
}
