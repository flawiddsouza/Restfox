// How the UI reaches the gRPC engine, which runs in Node since a page cannot make gRPC calls: Electron's main process
// through IPC (packages/electron/src/app.js), or web-standalone's server through its /grpc routes
// (packages/web-standalone/app.js). The browser build and the extension app have neither
import { nanoid } from 'nanoid'
import type { GrpcProtoFile } from '@/global'
import { getSavedCACertificates, getSavedProxySettings, isWebStandaloneBuild, registerCACertificates, registerProxySettings } from '@/helpers'
import { GRPC_UNAVAILABLE_MESSAGE } from '@/utils/grpc'

// what parseGrpcTarget gives for the item's url
export interface GrpcTarget {
    address: string
    host: string
    port: number
    tls: boolean
}

interface GrpcConnectionSpec {
    target: GrpcTarget
    // names as typed, values resolved, -bin names with base64 values
    metadata: [string, string][]
    // null or empty for server reflection
    protoFiles: GrpcProtoFile[] | null
    disableSSLVerification: boolean
}

export interface GrpcSchemaSpec extends GrpcConnectionSpec {
    // 0 or absent for none
    timeoutMs?: number
}

export interface GrpcCallSpec extends GrpcConnectionSpec {
    // fully qualified, such as demo.v1.Greeter
    service: string
    method: string
    // 0 for none
    deadlineMs: number
    // JSON texts sent at the start, the request of a unary or server streaming call
    messages: string[]
}

export interface GrpcMethodSchema {
    name: string
    // such as /demo.v1.Greeter/SayHello
    path: string
    requestStream: boolean
    responseStream: boolean
    inputType: string
    outputType: string
    // JSON text of an example input message
    example: string
}

export interface GrpcServiceSchema {
    name: string
    methods: GrpcMethodSchema[]
}

export interface GrpcSchema {
    source: 'reflection' | 'proto'
    services: GrpcServiceSchema[]
    // services server reflection listed but could not describe
    missingServices?: string[]
}

// Each with time, the ms since the call started. A call ends with exactly one status or error event. connected comes
// once the connection is made, and the sent events wait for it. index numbers the messages given, from 0, the first of
// a unary or server streaming call included. A sendError of the transport's own has none. messageWithoutValues, and a
// status's detailsWithoutValues, is the engine's copy of a text it wrote, which history saves once the send took a
// masked prompt value: the text with each part that came from a text the send resolved, such as the address, as ******.
// An error without one is saved as a fixed text after such a send. A status without detailsWithoutValues has the
// server's details, which are kept as they came
export type GrpcCallEvent = (
    { type: 'connected' }
    // input rows the engine accepted, in their original order
    | { type: 'sentMetadata', indexes: number[] }
    | { type: 'headers', metadata: [string, string][] }
    | { type: 'sent', json: string, index?: number }
    | { type: 'sendError', message: string, messageWithoutValues?: string, index?: number }
    // the end of a stream that did not reach the call, which stays open for the end to be sent again
    | { type: 'endError', message: string }
    | { type: 'received', json?: string, bytes?: string, decodeError?: string, unknownFields?: string[] }
    | { type: 'status', code: number, name: string, details: string, detailsWithoutValues?: string, trailers: [string, string][], errorDetails?: string }
    | { type: 'error', message: string, messageWithoutValues?: string }
) & { time: number }

export interface GrpcCallTransport {
    // a message of a client or bidi stream
    send(json: string): void
    // no more messages from the client
    end(): void
    cancel(): void
}

// code is such as REFLECTION_UNIMPLEMENTED when the server does not offer server reflection, grpcStatus the gRPC
// status of a load that ended with one, such as UNAVAILABLE for a server that could not be reached
// messageWithoutValues as in GrpcCallEvent
type GrpcError = Error & { code?: string, grpcStatus?: { code: number, name: string }, messageWithoutValues?: string }

function createGrpcError(message: string, code?: string | null, grpcStatus?: { code: number, name: string } | null, messageWithoutValues?: string): GrpcError {
    const error: GrpcError = new Error(message)
    if(code) {
        error.code = code
    }
    if(messageWithoutValues !== undefined) {
        error.messageWithoutValues = messageWithoutValues
    }
    if(grpcStatus) {
        error.grpcStatus = grpcStatus
    }
    return error
}

function isTerminalEvent(grpcEvent: GrpcCallEvent) {
    return grpcEvent.type === 'status' || grpcEvent.type === 'error'
}

function hasElectronGrpc(): boolean {
    return typeof window !== 'undefined' && typeof window.electronIPC?.grpcStartCall === 'function'
}

export function isGrpcAvailable(): boolean {
    return hasElectronGrpc() || isWebStandaloneBuild()
}

// IPC copies its arguments, and a reactive object from the store is a proxy it cannot copy
function toPlain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
}

// signal stops the load and closes its connection
export async function loadGrpcSchema(spec: GrpcSchemaSpec, signal?: AbortSignal): Promise<GrpcSchema> {
    signal?.throwIfAborted()

    if(hasElectronGrpc()) {
        // the main process stops the load by its id
        const loadId = nanoid()
        const cancel = () => window.electronIPC.grpcCancelSchemaLoad(loadId)
        signal?.addEventListener('abort', cancel, { once: true })
        try {
            const { schema, error, code, grpcStatus, errorWithoutValues } = await window.electronIPC.grpcLoadSchema({ ...toPlain(spec), loadId })
            if(error !== undefined) {
                throw createGrpcError(error, code, grpcStatus, errorWithoutValues)
            }
            return schema
        } finally {
            signal?.removeEventListener('abort', cancel)
        }
    }

    if(isWebStandaloneBuild()) {
        // the server stops the load when the request goes away
        const { response, json } = await postWithConnectionIds('/grpc/schema', spec, signal)
        if(json?.schema) {
            return json.schema
        }
        throw createGrpcError(json?.error ?? `The server could not load the schema: ${response.status} ${response.statusText}`.trim(), json?.code, json?.grpcStatus, json?.errorWithoutValues)
    }

    throw createGrpcError(GRPC_UNAVAILABLE_MESSAGE)
}

// a gRPC message imported from Insomnia in ProtoJSON, see InsomniaGrpcMessageConverter in helpers.ts
export async function convertInsomniaGrpcMessage(spec: { protoFiles: GrpcProtoFile[], service: string, method: string, text: string }): Promise<string> {
    if(hasElectronGrpc()) {
        const { text, error } = await window.electronIPC.grpcConvertInsomniaMessage(toPlain(spec))
        if(error !== undefined) {
            throw new Error(error)
        }
        return text
    }

    if(isWebStandaloneBuild()) {
        const response = await fetch('/grpc/insomnia-message', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(spec),
        })
        const json = await response.json().catch(() => null)
        if(typeof json?.text === 'string') {
            return json.text
        }
        throw new Error(json?.error ?? `The server could not read the message: ${response.status} ${response.statusText}`.trim())
    }

    throw new Error(GRPC_UNAVAILABLE_MESSAGE)
}

// onEvent gets the call's events as they happen, the last of them its one status or error event. Nothing follows it
export function startGrpcCall(spec: GrpcCallSpec, onEvent: (grpcEvent: GrpcCallEvent) => void): GrpcCallTransport {
    const callId = nanoid()
    const startedAt = Date.now()
    let ended = false

    const deliver = (grpcEvent: GrpcCallEvent) => {
        if(ended) {
            return
        }
        if(isTerminalEvent(grpcEvent)) {
            ended = true
        }
        onEvent(grpcEvent)
    }

    const fail = (message: string) => deliver({ type: 'error', message, time: Date.now() - startedAt })

    if(hasElectronGrpc()) {
        return startElectronGrpcCall(spec, callId, deliver, fail, () => ended)
    }

    if(isWebStandaloneBuild()) {
        return startServerGrpcCall(spec, callId, deliver, fail, () => ended, startedAt)
    }

    fail(GRPC_UNAVAILABLE_MESSAGE)

    return {
        send: () => undefined,
        end: () => undefined,
        cancel: () => undefined,
    }
}

// Electron pushes the events of every call on one channel, a call's handler is found by its call id
const electronGrpcEventHandlers = new Map<string, (grpcEvent: GrpcCallEvent) => void>()
let electronGrpcEventsSource: unknown = null

function listenToElectronGrpcEvents() {
    if(electronGrpcEventsSource === window.electronIPC) {
        return
    }
    electronGrpcEventsSource = window.electronIPC
    window.electronIPC.onGrpcEvent((callId: string, grpcEvent: GrpcCallEvent) => {
        electronGrpcEventHandlers.get(callId)?.(grpcEvent)
    })
}

function startElectronGrpcCall(spec: GrpcCallSpec, callId: string, deliver: (grpcEvent: GrpcCallEvent) => void, fail: (message: string) => void, isEnded: () => boolean): GrpcCallTransport {
    listenToElectronGrpcEvents()

    // the events arrive only as pushed messages, the invoke reply can land between them and carries nothing
    electronGrpcEventHandlers.set(callId, grpcEvent => {
        if(isTerminalEvent(grpcEvent)) {
            electronGrpcEventHandlers.delete(callId)
        }
        deliver(grpcEvent)
    })

    window.electronIPC.grpcStartCall(toPlain({ ...spec, callId })).catch((error: Error) => {
        electronGrpcEventHandlers.delete(callId)
        fail(error.message)
    })

    // the main process handles these in order after the start, and ignores them once the call has ended
    return {
        send(json) {
            if(!isEnded()) {
                window.electronIPC.grpcSendMessage(callId, json).catch(() => undefined)
            }
        },
        end() {
            if(!isEnded()) {
                window.electronIPC.grpcEndCall(callId).catch(() => undefined)
            }
        },
        cancel() {
            if(!isEnded()) {
                window.electronIPC.grpcCancelCall(callId).catch(() => undefined)
            }
        },
    }
}

// a restarted server has forgotten the registered CA certificates or proxy setting, they are registered again
const SERVER_FORGOT_CODES = ['CA_CERTIFICATES_NOT_FOUND', 'PROXY_SETTINGS_NOT_FOUND']

const NDJSON_CONTENT_TYPE = 'application/x-ndjson'

// How long a cancel request may take before the call is ended here. The browser keeps six connections to a server, and
// each open call, like each live HTTP response, holds one for its reply, so with six open the cancel request waits for
// one that may never come free. Closing the reply also cancels the call on the server
const CANCEL_ANSWERED_WITHIN_MS = 1000

// fetch rejects with no more than "Failed to fetch" when the server is down, which does not say which server
function describeFetchError(error: any) {
    return error?.name === 'AbortError' ? error : new Error(`Could not reach the Restfox server: ${error?.message ?? error}`, { cause: error })
}

// Settings > CA Certificates and Proxy go to web-standalone's server by id, as for /proxy and relayed sockets.
// registerAgain skips the CA certificates' id kept from before, the proxy setting is registered on every call
async function getServerConnectionIds(disableSSLVerification: boolean, registerAgain: boolean) {
    const caCertificates = disableSSLVerification ? null : await getSavedCACertificates()
    const caCertificatesId = caCertificates ? await registerCACertificates(caCertificates.certificates, registerAgain) : null
    // never saved is System, which the server assumes when none is named
    const proxySettings = getSavedProxySettings()
    const proxySettingsId = proxySettings ? await registerProxySettings(proxySettings) : null

    return { caCertificatesId, proxySettingsId }
}

// the reply as is when it is a call's events, any other read as JSON, null when it is not JSON
async function postWithConnectionIds(path: string, spec: GrpcConnectionSpec & { callId?: string }, signal?: AbortSignal): Promise<{ response: Response, json: any }> {
    const post = async(registerAgain: boolean) => {
        let connectionIds: Awaited<ReturnType<typeof getServerConnectionIds>>
        try {
            connectionIds = await getServerConnectionIds(spec.disableSSLVerification, registerAgain)
        } catch(error) {
            // fetch rejects with a TypeError only when no answer came, an answer that refused the setting says why
            throw error instanceof TypeError ? describeFetchError(error) : error
        }
        let response: Response
        try {
            response = await fetch(path, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ...spec, ...connectionIds }),
                signal,
            })
        } catch(error) {
            throw describeFetchError(error)
        }

        if((response.headers.get('content-type') ?? '').startsWith(NDJSON_CONTENT_TYPE)) {
            return { response, json: null }
        }

        return { response, json: await response.json().catch(() => null) }
    }

    const reply = await post(false)

    return SERVER_FORGOT_CODES.includes(reply.json?.code) ? post(true) : reply
}

// one event per line, wherever the reads split the lines
async function readCallEvents(body: ReadableStream<Uint8Array>, onEvent: (grpcEvent: GrpcCallEvent) => void) {
    const reader = body.getReader()
    const textDecoder = new TextDecoder()
    let pending = ''

    const takeLines = (text: string) => {
        const lines = (pending + text).split('\n')
        pending = lines.pop() ?? ''
        for(const line of lines) {
            if(line.trim() !== '') {
                onEvent(JSON.parse(line))
            }
        }
    }

    for(let result = await reader.read(); !result.done; result = await reader.read()) {
        takeLines(textDecoder.decode(result.value, { stream: true }))
    }

    takeLines(textDecoder.decode() + '\n')
}

function startServerGrpcCall(spec: GrpcCallSpec, callId: string, deliver: (grpcEvent: GrpcCallEvent) => void, fail: (message: string) => void, isEnded: () => boolean, startedAt: number): GrpcCallTransport {
    const abortController = new AbortController()
    // the server registers the call before its reply starts, so the stream's messages wait for the reply
    let replyStarted = false

    const cancelHere = () => {
        deliver({ type: 'status', code: 1, name: 'CANCELLED', details: 'Cancelled on client', trailers: [], time: Date.now() - startedAt })
        // the server cancels a call whose reply is closed
        abortController.abort()
    }

    // true once the server has started the call
    const started = (async() => {
        try {
            const { response, json } = await postWithConnectionIds('/grpc/call', { ...spec, callId }, abortController.signal)

            if(json !== null || response.body === null) {
                fail(json?.error ?? `The server could not start the call: ${response.status} ${response.statusText}`.trim())
                return false
            }

            replyStarted = true

            readCallEvents(response.body, deliver).then(() => {
                fail('The Restfox server closed the call before it ended')
            }, (error: Error) => {
                fail(`Lost the connection to the Restfox server: ${error.message}`)
            })

            return true
        } catch(e: any) {
            fail(e.message)
            return false
        }
    })()

    const postToCall = (action: 'send' | 'end' | 'cancel', body: object = {}) => fetch(`/grpc/call/${encodeURIComponent(callId)}/${action}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    })

    // one after another, so the messages reach the server in the order they were sent
    let queue = Promise.resolve()

    const enqueue = (action: () => Promise<void>) => {
        queue = queue.then(async() => {
            if(await started && !isEnded()) {
                await action()
            }
        })
    }

    return {
        send(json) {
            enqueue(async() => {
                try {
                    const response = await postToCall('send', { json })
                    // a call that has ended answers 404, its status or error event is on its way
                    if(!response.ok && response.status !== 404) {
                        const responseBody = await response.json().catch(() => ({}))
                        deliver({ type: 'sendError', message: responseBody.error ?? `The server could not send the message: ${response.status} ${response.statusText}`.trim(), time: Date.now() - startedAt })
                    }
                } catch(e: any) {
                    deliver({ type: 'sendError', message: `The message could not reach the Restfox server: ${e.message}`, time: Date.now() - startedAt })
                }
            })
        },
        end() {
            enqueue(async() => {
                try {
                    const response = await postToCall('end')
                    // a call that has ended answers 404, its status or error event is on its way
                    if(!response.ok && response.status !== 404) {
                        const responseBody = await response.json().catch(() => ({}))
                        deliver({ type: 'endError', message: responseBody.error ?? `The server could not end the stream: ${response.status} ${response.statusText}`.trim(), time: Date.now() - startedAt })
                    }
                } catch(e: any) {
                    deliver({ type: 'endError', message: `The end of the stream could not reach the Restfox server: ${e.message}`, time: Date.now() - startedAt })
                }
            })
        },
        cancel() {
            if(isEnded()) {
                return
            }

            if(!replyStarted) {
                cancelHere()
                return
            }

            // ahead of messages still waiting to be sent. The call's CANCELLED status ends it, unless that takes too long
            setTimeout(() => {
                if(!isEnded()) {
                    cancelHere()
                }
            }, CANCEL_ANSWERED_WITHIN_MS)
            postToCall('cancel').then(response => {
                if(!response.ok && response.status !== 404) {
                    cancelHere()
                }
            }, cancelHere)
        },
    }
}
