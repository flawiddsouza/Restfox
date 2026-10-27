import { resolveEnvironmentForRequest, type RequestEnvironment } from '@/utils/environment'
import type { ResolutionMode } from '@/global'
import { markRaw, reactive, toRaw } from 'vue'
import type { Store } from 'vuex'
import { nanoid } from 'nanoid'
import type {
    CollectionItem,
    GrpcCallKind,
    GrpcCallResult,
    GrpcCallResultEvent,
    GrpcFinalResponse,
    GrpcMetadata,
    GrpcProtoFile,
    GrpcStatus,
    RequestAuthentication,
    State,
} from '@/global'
import {
    SendResolver,
    getAuthenticationType,
    getSavedRequestTimeout,
    resolveGrpcMetadata,
    substituteEnvironmentVariables,
} from '@/helpers'
import {
    GRPC_UNAVAILABLE_MESSAGE,
    GRPC_RESPONSE_TAG_UNARY_MESSAGE,
    type GrpcCallEvent,
    type GrpcSchema,
    type GrpcTarget,
    findGrpcMethod,
    getGrpcCallKind,
    isClientStreaming,
    isGrpcTarget,
    parseGrpcTarget,
} from '@/utils/grpc'
import { type GrpcCallTransport, isGrpcAvailable, loadGrpcSchema, startGrpcCall } from '@/utils/grpc-transport'

// how long a server stream runs before the panel shows its messages as they arrive, so one that ends at once goes
// straight to its result
const LIVE_SHOWN_AFTER_MS = 250
// a DEADLINE_EXCEEDED this close to the call's own deadline is the deadline's, an earlier one the server's own
const DEADLINE_MARGIN_MS = 100
// how often the panel redraws while messages arrive
const EVENTS_SHOWN_EVERY_MS = 100

type GrpcCallPhase = 'idle' | 'connecting' | 'open' | 'ended'

// one item's call, live while it runs and kept after it ends until the next one starts
export interface GrpcLiveCall {
    // also the id of its entry in response history
    id: string
    phase: GrpcCallPhase
    // null until the method is found
    kind: GrpcCallKind | null
    url: string
    service: string
    method: string
    // grows in place, revision tells the panels it did
    events: GrpcCallResultEvent[]
    revision: number
    sentMetadata?: GrpcMetadata
    headers: GrpcMetadata | null
    trailers: GrpcMetadata | null
    status: GrpcStatus | null
    error: string | null
    // a streamed message that could not be sent, the call stays open
    sendError: string | null
    // why the end of the stream could not be sent, the stream stays open
    endError: string | null
    createdAt: number
    // when the call went out, null while its address, metadata and prompts resolve
    startedAt: number | null
    endedAt: number | null
    ended: GrpcCallResult['ended'] | null
    // as of the last redraw, when revision last grew
    sentCount: number
    receivedCount: number
    halfClosed: boolean
    // the panel shows the messages as they arrive, and until then that the call waits, at once as for an HTTP send
    liveShown: boolean
}

// what a call needs that is not shown, kept out of the reactive state
interface GrpcCallState {
    onFinished: (response?: GrpcFinalResponse) => void
    // the item's id now, which a rename or move in a file workspace changes while the call runs
    itemId: string
    workspaceId: string
    transport: GrpcCallTransport | null
    // aborts once the call is cancelled, stopped, replaced or over, so the methods load it waits on stops, and no text
    // of the call still resolving, such as a stream message, asks a prompt or sends a response tag's request
    stopAbortController: AbortController
    cancelRequested: boolean
    // a newer call on the item stopped this one, which leaves no trace
    replaced: boolean
    send: SendResolver | null
    sentMetadataSaved: GrpcMetadata | null
    environment: any
    deadlineMs: number
    // whether each message given to the engine took a masked prompt value, by the number the engine gives it
    omittedByIndex: boolean[]
    // a message the transport could not deliver may not have reached the engine, which then numbers the later ones
    // one lower, so from then on a sent message is left out when any message took a masked value
    indexUncertain: boolean
    // the stream's messages and its End stream, each step waiting for the ones clicked before it, so a message that
    // resolves slowly, such as one whose response tag sends a request, still goes out in its place
    messageSteps: Promise<void>
    timers: ReturnType<typeof setTimeout>[]
    revisionTimer: ReturnType<typeof setTimeout> | undefined
    // counted here and copied onto the call when it redraws, so a stream's messages redraw the panel no more often
    sentCountLatest: number
    receivedCountLatest: number
}

// A file workspace's item ids are paths inside it, so two workspaces can each hold an item with the same id. What is
// kept here for an item is kept by its workspace and id, see getGrpcItemKey
export const grpcCalls = reactive<Record<string, GrpcLiveCall>>({})
const controllers = new Map<string, GrpcCallState>()

export function getGrpcItemKey(item: { workspaceId: string, _id: string }) {
    return JSON.stringify([item.workspaceId, item._id])
}

export interface GrpcSchemaEntry {
    loading: boolean
    // the last schema that loaded, kept while it reloads and after a reload fails
    schema: GrpcSchema | null
    loadedAt: number | null
    error: string | null
    errorCode: string | null
    failedAt: number | null
}

// Schemas by server and source, so items calling the same server share one. A proto files schema does not depend on
// the server, so it is kept by the files alone
export const grpcSchemas = reactive<Record<string, GrpcSchemaEntry>>({})
// the schema each item uses, by getGrpcItemKey, null while its server is not known
export const grpcItemSchemaKeys = reactive<Record<string, string | null>>({})
// Preparation can fail before an address supplies a schema key.
export const grpcItemSchemaPreparations = reactive<Record<string, { loading: boolean, error: string | null, failedAt: number | null }>>({})
// A load runs while a caller waits on it. A caller that can stop waiting, such as a Send that is cancelled, passes a
// signal, and the load stops, closing its connection, once no caller waits on it
interface SchemaLoad {
    loadNumber: number
    promise: Promise<SchemaLoadResult>
    abortController: AbortController
    waiting: number
}
const schemaLoads = new Map<string, SchemaLoad>()
let schemaLoadCount = 0
// counts the changes to the settings a connection follows, see forgetFailedGrpcSchemaLoads
let connectionSettingsChanges = 0
// the item whose own metadata or prompts may have made a schema's error, by schema key, so another item on the same
// server loads for itself rather than taking that error. A server that could not be reached, or .proto files that do
// not load, fail the same for every item and have none
const schemaFailedItemKeys = new Map<string, string>()
// each item's latest methods request, numbered across all items, so an item deleted and made again at the same path
// never takes a number its earlier requests had
const itemSchemaRequests = new Map<string, number>()
let schemaRequestCount = 0

export function isGrpcCallRunning(call: GrpcLiveCall | null | undefined) {
    return call !== null && call !== undefined && (call.phase === 'connecting' || call.phase === 'open')
}

// the stream is open for the user's messages
export function isGrpcCallAcceptingMessages(call: GrpcLiveCall | null | undefined) {
    return call !== null && call !== undefined && call.phase === 'open' && isClientStreaming(call.kind) && !call.halfClosed
}

export function getGrpcProtoFiles(item: CollectionItem): GrpcProtoFile[] | null {
    const protoFiles = item.grpc?.protoFiles
    return protoFiles && protoFiles.length > 0 ? protoFiles : null
}

// a short hash of the proto files, so the same files give the same key
function hashText(text: string) {
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for(let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index)
        h1 = Math.imul(h1 ^ code, 2654435761)
        h2 = Math.imul(h2 ^ code, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export function getGrpcSchemaKey(target: GrpcTarget | null, protoFiles: GrpcProtoFile[] | null) {
    if(protoFiles) {
        return `proto:${hashText(JSON.stringify(protoFiles.map(protoFile => [protoFile.path, protoFile.text])))}`
    }
    if(target === null) {
        return null
    }
    return `reflection:${target.tls ? 'tls' : 'plaintext'}:${target.address}`
}

const PROMPT_TAG_REGEX = /{% prompt\(/

// Whether loading methods would ask a prompt, which only an action of the user may do, so automatic loads skip it
async function asksPrompt(item: CollectionItem, environment: any, parentHeaders: Record<string, string[]>, parentAuthentication: RequestAuthentication | undefined, texts: string[]) {
    const authentications = [item.authentication]
    if(getAuthenticationType(item.authentication) === 'inherit') {
        authentications.push(parentAuthentication)
    }
    const allTexts = [
        ...texts,
        ...(item.headers ?? []).filter(header => !header.disabled).flatMap(header => [header.name, header.value]),
        ...Object.entries(parentHeaders).flatMap(([name, values]) => [name, ...values]),
        ...authentications.filter(authentication => authentication && !authentication.disabled).map(authentication => JSON.stringify(authentication)),
        JSON.stringify(environment?.GLOBAL_HEADERS ?? {}),
    ]
    for(const text of allTexts) {
        const textResolved = await substituteEnvironmentVariables(environment, text ?? '', 'display', { noError: true, resolvePromptTags: false, resolveResponseTags: false, workspaceId: item.workspaceId })
        if(PROMPT_TAG_REGEX.test(textResolved)) {
            return true
        }
    }
    return false
}

// The server address as typed, with variables resolved as a preview, never asking a prompt
export async function previewGrpcTarget(item: CollectionItem, environment: any) {
    const urlResolved = await substituteEnvironmentVariables(environment ?? {}, item.url ?? '', 'display', { noError: true, responseTagErrors: 'placeholder', workspaceId: item.workspaceId })
    return parseGrpcTarget(urlResolved)
}

function resolveMetadata(store: Store<State>, item: CollectionItem, environment: any, parentHeaders: Record<string, string[]>, parentAuthentication: RequestAuthentication | undefined, send: SendResolver, metadataMasked?: GrpcMetadata): Promise<GrpcMetadata> {
    return resolveGrpcMetadata(item, environment, parentHeaders, parentAuthentication, store.state.activeWorkspace?.location ?? null, send, { defaultUserAgent: true, metadataMasked })
}

// Settings > Disable SSL Verification
function isSSLVerificationDisabled(store: Store<State>) {
    return store.state.flags.disableSSLVerification === true
}

// A placeholder server for proto files whose item has no usable address yet: their schema does not depend on it
const PROTO_ONLY_TARGET: GrpcTarget = { address: 'localhost:443', host: 'localhost', port: 443, tls: true }

function describeError(error: any) {
    if(typeof error === 'string') {
        return error
    }
    if(error?.cause === 'display-error' || error?.message) {
        return String(error.message)
    }
    return 'The call failed'
}

// A cold dependency uses one resolver for its schema and call, including the call's Stop signal.
export type GrpcRequestPreparation = RequestEnvironment & { send: SendResolver, stopAbortController: AbortController }

// connectionStatus is the status of a load that could not reach the server, such as UNAVAILABLE
// errorWithoutValues is the engine's copy of the error for history, see GrpcCallEvent
type SchemaLoadResult = { schema: GrpcSchema | null, error: string | null, errorWithoutValues?: string, connectionStatus: GrpcStatus | null, requestPreparation?: GrpcRequestPreparation }

// what a caller that stopped waiting gets, which it does not show
const SCHEMA_LOAD_NOT_WAITED_ON: SchemaLoadResult = { schema: null, error: 'The methods load was stopped', connectionStatus: null }

// signal, when given, aborts once this caller no longer waits on the load, which then answers it at once
function waitForSchemaLoad(schemaLoad: SchemaLoad, signal?: AbortSignal): Promise<SchemaLoadResult> {
    schemaLoad.waiting++
    let stoppedWaiting: () => void = () => undefined
    const stopWaiting = () => {
        schemaLoad.waiting--
        if(schemaLoad.waiting === 0) {
            schemaLoad.abortController.abort()
        }
        stoppedWaiting()
    }
    if(signal?.aborted) {
        stopWaiting()
        return Promise.resolve(SCHEMA_LOAD_NOT_WAITED_ON)
    }
    if(!signal) {
        return schemaLoad.promise
    }
    signal.addEventListener('abort', stopWaiting, { once: true })
    return Promise.race([
        schemaLoad.promise.finally(() => signal.removeEventListener('abort', stopWaiting)),
        new Promise<SchemaLoadResult>(resolve => {
            stoppedWaiting = () => resolve(SCHEMA_LOAD_NOT_WAITED_ON)
        }),
    ])
}

// the load of the key still running, waited on until it ends, as the method list does
function waitForRunningSchemaLoad(key: string) {
    const schemaLoad = schemaLoads.get(key)
    return schemaLoad ? waitForSchemaLoad(schemaLoad) : undefined
}

// metadataItemKey is the item whose metadata the load sends, null for one that sends none. signal is the caller's, see
// SchemaLoad
async function runSchemaLoad(key: string, metadataItemKey: string | null, load: (signal: AbortSignal) => Promise<GrpcSchema>, signal?: AbortSignal): Promise<SchemaLoadResult> {
    const loadNumber = ++schemaLoadCount
    const settingsChangesAtStart = connectionSettingsChanges
    if(!(key in grpcSchemas)) {
        grpcSchemas[key] = { loading: true, schema: null, loadedAt: null, error: null, errorCode: null, failedAt: null }
    }
    grpcSchemas[key].loading = true

    // a newer load of the same key answers for it
    const isLatestLoad = () => schemaLoads.get(key)?.loadNumber === loadNumber
    const endLoad = () => {
        if(isLatestLoad()) {
            grpcSchemas[key].loading = false
            schemaLoads.delete(key)
        }
    }
    const abortController = new AbortController()
    // a stopped load ends at once, as the desktop app answers the abort only later, so a caller from then on loads again
    abortController.signal.addEventListener('abort', endLoad, { once: true })

    const promise = (async(): Promise<SchemaLoadResult> => {
        try {
            const schema = markRaw(await load(abortController.signal))
            if(isLatestLoad()) {
                Object.assign(grpcSchemas[key], { schema, loadedAt: Date.now(), error: null, errorCode: null, failedAt: null })
                schemaFailedItemKeys.delete(key)
            }
            return { schema, error: null, connectionStatus: null }
        } catch(error: any) {
            // a load that failed under settings changed since is not kept, so the next load tries the new ones. One
            // that no caller waited on anymore did not fail and leaves the methods as they were
            if(isLatestLoad() && settingsChangesAtStart === connectionSettingsChanges && !abortController.signal.aborted) {
                Object.assign(grpcSchemas[key], { error: describeError(error), errorCode: error?.code ?? null, failedAt: Date.now() })
                if(metadataItemKey !== null && error?.code !== 'CONNECTION_FAILED') {
                    schemaFailedItemKeys.set(key, metadataItemKey)
                } else {
                    schemaFailedItemKeys.delete(key)
                }
            }
            const connectionStatus = error?.code === 'CONNECTION_FAILED' && error.grpcStatus ? { ...error.grpcStatus, details: describeError(error) } : null
            return { schema: null, error: describeError(error), errorWithoutValues: error?.messageWithoutValues, connectionStatus }
        } finally {
            endLoad()
        }
    })()

    const schemaLoad: SchemaLoad = { loadNumber, promise, abortController, waiting: 0 }
    schemaLoads.set(key, schemaLoad)
    return waitForSchemaLoad(schemaLoad, signal)
}

// Loads the methods an item can call. An automatic load, such as on opening the item or after its address changes,
// reuses a schema already loaded or loading and never asks a prompt. The user's Reload always loads again
export async function loadGrpcSchemaForItem(store: Store<State>, item: CollectionItem, options: { automatic?: boolean, force?: boolean, mode: ResolutionMode }): Promise<SchemaLoadResult | undefined> {
    if(!isGrpcAvailable()) {
        return
    }

    const { automatic = false, force = false } = options ?? {}
    const mode = options?.mode === 'send' ? 'send' : 'display'
    const itemKey = getGrpcItemKey(item)
    const requestNumber = ++schemaRequestCount
    itemSchemaRequests.set(itemKey, requestNumber)
    const isLatestRequest = () => itemSchemaRequests.get(itemKey) === requestNumber
    grpcItemSchemaPreparations[itemKey] = { loading: true, error: null, failedAt: null }
    const preparation = grpcItemSchemaPreparations[itemKey]
    const isLatestPreparation = () => isLatestRequest() && grpcItemSchemaPreparations[itemKey] === preparation
    let key: string | null = null
    let send: SendResolver | undefined
    // A newer waiter for the same address still needs the load that prepared its metadata.
    const ownsLoad = () => isLatestRequest() || (key !== null && grpcItemSchemaKeys[itemKey] === key)
    const reuses = (schemaKey: string) => !force && schemaKey in grpcSchemas && (grpcSchemas[schemaKey].loading || grpcSchemas[schemaKey].schema !== null || (mode === 'display' && automatic && grpcSchemas[schemaKey].error !== null && (schemaFailedItemKeys.get(schemaKey) ?? itemKey) === itemKey))
    const reusedResult = (schemaKey: string) => waitForRunningSchemaLoad(schemaKey) ?? Promise.resolve({ schema: grpcSchemas[schemaKey].schema, error: grpcSchemas[schemaKey].schema ? null : grpcSchemas[schemaKey].error, connectionStatus: null })

    try {
        const requestEnvironment = await resolveEnvironmentForRequest(store, item, mode, { resolveResponseTags: !automatic })
        const { environment, parentHeaders, parentAuthentication } = requestEnvironment
        if(!isLatestRequest()) {
            return
        }
        const protoFiles = getGrpcProtoFiles(item)
        if(protoFiles) {
            // the files' schema does not depend on the address, so an address that fails to resolve stays this item's error
            const protoKey = getGrpcSchemaKey(null, protoFiles)!
            grpcItemSchemaKeys[itemKey] = protoKey
            if(reuses(protoKey)) {
                return await reusedResult(protoKey)
            }
            const target = await previewGrpcTarget(item, environment)
            if(!isLatestPreparation()) {
                return
            }
            return await runSchemaLoad(protoKey, null, signal => loadGrpcSchema({
                target: isGrpcTarget(target) ? target : PROTO_ONLY_TARGET,
                metadata: [],
                protoFiles,
                disableSSLVerification: isSSLVerificationDisabled(store),
                timeoutMs: getSavedRequestTimeout(),
            }, signal))
        }

        const url = item.url ?? ''
        if(automatic && await asksPrompt(item, environment, parentHeaders, parentAuthentication, [url])) {
            if(!PROMPT_TAG_REGEX.test(await substituteEnvironmentVariables(environment, url, 'display', { noError: true, resolvePromptTags: false, resolveResponseTags: false, workspaceId: item.workspaceId }))) {
                const target = await previewGrpcTarget(item, environment)
                if(isLatestRequest()) {
                    grpcItemSchemaKeys[itemKey] = isGrpcTarget(target) ? getGrpcSchemaKey(target, null) : null
                }
            } else if(isLatestRequest()) {
                grpcItemSchemaKeys[itemKey] = null
            }
            return
        }

        const stopAbortController = new AbortController()
        send = new SendResolver(item.workspaceId, mode, stopAbortController.signal)
        // a newer load took over, a response tag waiting on this one still calls the item with what this resolved
        const overtaken = () => ({ schema: null, error: null, connectionStatus: null, requestPreparation: { ...requestEnvironment, send: send!, stopAbortController } })
        const target = parseGrpcTarget(await send.resolve(environment, url, 'unsaved'))
        if(!isLatestRequest()) {
            return overtaken()
        }
        if(!isGrpcTarget(target)) {
            grpcItemSchemaKeys[itemKey] = null
            return { schema: null, error: target.error, errorWithoutValues: send.tookMaskedValue ? undefined : target.error, connectionStatus: null }
        }
        key = getGrpcSchemaKey(target, null)!
        grpcItemSchemaKeys[itemKey] = key
        if(reuses(key)) {
            const result = await reusedResult(key)
            return { ...result, requestPreparation: { ...requestEnvironment, send, stopAbortController } }
        }
        const metadata = await resolveMetadata(store, item, environment, parentHeaders, parentAuthentication, send)
        if(!ownsLoad()) {
            return overtaken()
        }
        const result = await runSchemaLoad(key, itemKey, signal => loadGrpcSchema({
            target,
            metadata,
            protoFiles: null,
            disableSSLVerification: isSSLVerificationDisabled(store),
            timeoutMs: getSavedRequestTimeout(),
        }, signal))
        return { ...result, requestPreparation: { ...requestEnvironment, send, stopAbortController } }
    } catch(error) {
        const message = describeError(error)
        if(isLatestPreparation()) {
            Object.assign(grpcItemSchemaPreparations[itemKey], { error: message, failedAt: Date.now() })
        }
        if(ownsLoad()) {
            const schemaKey = key
            if(schemaKey) {
                grpcSchemas[schemaKey] ??= { loading: false, schema: null, loadedAt: null, error: null, errorCode: null, failedAt: null }
                Object.assign(grpcSchemas[schemaKey], { error: message, errorCode: null, failedAt: Date.now() })
                schemaFailedItemKeys.set(schemaKey, itemKey)
            }
        }
        // Environment preparation never asks a prompt. Later preparation errors are safe only before one was masked.
        return { schema: null, error: message, errorWithoutValues: send?.tookMaskedValue ? undefined : message, connectionStatus: null }
    } finally {
        if(isLatestPreparation()) {
            grpcItemSchemaPreparations[itemKey].loading = false
        }
    }
}

// kind is the method's, when the methods loaded before name it
function createLiveCall(item: CollectionItem, kind: GrpcCallKind | null): GrpcLiveCall {
    const now = Date.now()
    // a stream the user writes to shows its messages at once, any other call waits for its reply
    const liveShown = isClientStreaming(kind)
    return {
        id: nanoid(),
        phase: 'connecting',
        kind,
        url: item.url ?? '',
        service: item.grpc?.service ?? '',
        method: item.grpc?.method ?? '',
        events: markRaw([]),
        revision: 0,
        headers: null,
        trailers: null,
        status: null,
        error: null,
        sendError: null,
        endError: null,
        createdAt: now,
        startedAt: null,
        endedAt: null,
        ended: null,
        sentCount: 0,
        receivedCount: 0,
        halfClosed: false,
        liveShown,
    }
}

// tells the panels the events and counts changed
function redraw(call: GrpcLiveCall, controller: GrpcCallState) {
    call.sentCount = controller.sentCountLatest
    call.receivedCount = controller.receivedCountLatest
    call.revision++
}

function showEvents(call: GrpcLiveCall, controller: GrpcCallState) {
    if(controller.revisionTimer === undefined) {
        controller.revisionTimer = setTimeout(() => {
            controller.revisionTimer = undefined
            redraw(call, controller)
        }, EVENTS_SHOWN_EVERY_MS)
    }
}

function clearControllerTimers(controller: GrpcCallState) {
    controller.timers.forEach(timer => clearTimeout(timer))
    controller.timers = []
    clearTimeout(controller.revisionTimer)
    controller.revisionTimer = undefined
}

// plain values, which the store's save can clone
function toCallResult(liveCall: GrpcLiveCall): GrpcCallResult {
    const call = toRaw(liveCall)
    const result: GrpcCallResult = {
        url: call.url,
        service: call.service,
        method: call.method,
        events: call.events,
        headers: call.headers ?? [],
        trailers: call.trailers ?? [],
        status: call.status,
        timeTaken: (call.endedAt ?? Date.now()) - (call.startedAt ?? call.createdAt),
        ended: call.ended ?? 'failed',
    }
    if(call.kind !== null) {
        result.kind = call.kind
    }
    if(call.sentMetadata !== undefined) {
        result.sentMetadata = call.sentMetadata
    }
    if(call.error !== null) {
        result.error = call.error
    }
    return result
}

// What history saves in place of an error Restfox wrote, after a send that took a masked prompt value, when the error
// has no copy that quotes none of the send's texts
const GRPC_ERROR_NOT_SAVED = 'The call failed. Its error is not saved, as it may quote a masked prompt value'

// errorWithoutValues and detailsWithoutValues are the copies of the error and of status details Restfox wrote, see
// GrpcCallEvent. Status details without one are the server's
async function finishCall(store: Store<State>, call: GrpcLiveCall, controller: GrpcCallState, outcome: { ended: GrpcCallResult['ended'], status?: GrpcStatus | null, detailsWithoutValues?: string, error?: string, errorWithoutValues?: string }) {
    if(call.phase === 'ended') {
        return
    }

    clearControllerTimers(controller)
    controller.stopAbortController.abort()
    const itemId = controller.itemId
    const itemKey = getGrpcItemKey({ workspaceId: controller.workspaceId, _id: itemId })
    if(controllers.get(itemKey) === controller) {
        controllers.delete(itemKey)
    }

    // What the server sent, its status included, is shown as it came. An error Restfox wrote may repeat a masked prompt
    // value, which the screen hides where it appears whole
    const status = outcome.status ?? call.status

    call.endedAt = Date.now()
    call.phase = 'ended'
    call.ended = outcome.ended
    call.status = status
    call.error = outcome.error ? controller.send?.hideMaskedValues(outcome.error) ?? outcome.error : null
    call.sendError = null
    call.endError = null
    redraw(call, controller)

    if(controller.replaced) {
        controller.onFinished()
        return
    }

    // dated when it ended, as an HTTP response is when it arrived, so its history says how long ago it finished
    const entry: GrpcFinalResponse = {
        _id: call.id,
        collectionId: itemId,
        createdAt: call.endedAt,
        grpc: toCallResult(call),
    }

    // A text Restfox wrote may quote a masked prompt value changed or in part, such as an address in a connection error
    // or lowercased in a metadata name, which no search for the value finds. So once the send took one, history keeps
    // the copy written without the send's texts, and the server's text as it came
    const entrySaved: GrpcFinalResponse = controller.send?.tookMaskedValue
        ? {
            ...entry,
            grpc: {
                ...entry.grpc,
                ...(controller.sentMetadataSaved !== null ? { sentMetadata: controller.sentMetadataSaved } : {}),
                ...(entry.grpc.error !== undefined ? { error: outcome.errorWithoutValues ?? GRPC_ERROR_NOT_SAVED } : {}),
                ...(entry.grpc.status && outcome.detailsWithoutValues !== undefined ? { status: { ...entry.grpc.status, details: outcome.detailsWithoutValues } } : {}),
            },
        }
        : entry

    // shown at once, the save follows. The responses shown are the open workspace's, where, after a switch, another
    // file workspace's item can have the same id
    if(store.state.activeWorkspace?._id === controller.workspaceId) {
        store.state.requestResponses[itemId] = entry
        store.state.requestResponseStatus[itemId] = 'loaded'
    }

    try {
        await store.dispatch('saveResponse', {
            workspaceId: controller.workspaceId,
            collectionId: itemId,
            response: entrySaved,
        })
    } catch(error) {
        // such as for an item its file workspace no longer has. The call stays on screen
        console.error(`The gRPC call could not be saved to history: ${describeError(error)}`)
    } finally {
        controller.onFinished(entrySaved)
    }
}

// whether a sent message took a masked prompt value, by its number
function isSentMessageOmitted(controller: GrpcCallState, index: number | undefined) {
    if(index === undefined || controller.indexUncertain) {
        return controller.omittedByIndex.some(Boolean)
    }
    return controller.omittedByIndex[index] ?? false
}

function handleEvent(store: Store<State>, call: GrpcLiveCall, controller: GrpcCallState, event: GrpcCallEvent) {
    if(controller.replaced || call.phase === 'ended') {
        return
    }

    // connected until the engine has a connection, which it reports before anything else of the server
    if(call.phase === 'connecting' && event.type !== 'sendError') {
        call.phase = 'open'
    }

    switch(event.type) {
        case 'connected':
            break
        case 'headers':
            call.headers = event.metadata
            break
        case 'sent': {
            const omitted = isSentMessageOmitted(controller, event.index)
            call.events.push(omitted ? { type: 'sent', omitted: true, time: event.time } : { type: 'sent', json: event.json, time: event.time })
            controller.sentCountLatest++
            call.sendError = null
            showEvents(call, controller)
            break
        }
        case 'sendError':
            if(event.index === undefined) {
                controller.indexUncertain = true
            }
            call.sendError = controller.send?.hideMaskedValues(event.message) ?? event.message
            break
        case 'endError':
            // the stream is still open, so End stream can be clicked again
            call.halfClosed = false
            call.endError = event.message
            break
        case 'received':
            call.events.push({ ...event })
            controller.receivedCountLatest++
            showEvents(call, controller)
            break
        case 'status': {
            const status: GrpcStatus = { code: event.code, name: event.name, details: event.details }
            if(event.errorDetails !== undefined) {
                status.errorDetails = event.errorDetails
            }
            call.trailers = event.trailers
            let ended: GrpcCallResult['ended'] = 'completed'
            if(controller.cancelRequested && event.code === 1) {
                ended = 'cancelled'
            } else if(event.code === 4 && controller.deadlineMs > 0 && event.time >= controller.deadlineMs - DEADLINE_MARGIN_MS) {
                ended = 'timedOut'
            }
            finishCall(store, call, controller, { ended, status, detailsWithoutValues: event.detailsWithoutValues })
            break
        }
        case 'error':
            finishCall(store, call, controller, { ended: controller.cancelRequested ? 'cancelled' : 'failed', error: event.message, errorWithoutValues: event.messageWithoutValues })
            break
    }
}

// stops the item's running call without saving it, for when nothing could reach it anymore
function dropGrpcCall(itemKey: string) {
    const controller = controllers.get(itemKey)
    if(controller) {
        controller.replaced = true
        controller.cancelRequested = true
        controller.stopAbortController.abort()
        controller.transport?.cancel()
        clearControllerTimers(controller)
        controller.onFinished()
        controllers.delete(itemKey)
    }
}

// Sends the item's call: Send for unary and server streaming calls, Start for client and bidi streams. A call still
// running on the item stops first and is not saved, since nothing could reach it once this one shows
export async function startGrpcCallForItem(store: Store<State>, item: CollectionItem, { unaryOnly = false, waitForEnd = false, requestPreparation }: { unaryOnly?: boolean, waitForEnd?: boolean, requestPreparation?: GrpcRequestPreparation } = {}) {
    if(unaryOnly && (!item.grpc?.service || !item.grpc?.method)) {
        throw new Error(GRPC_RESPONSE_TAG_UNARY_MESSAGE, { cause: 'display-error' })
    }
    const itemKey = getGrpcItemKey(item)
    const schemaPreparation = grpcItemSchemaPreparations[itemKey]

    dropGrpcCall(itemKey)

    const cachedKey = grpcItemSchemaKeys[itemKey]
    const cachedMethod = cachedKey ? findGrpcMethod(grpcSchemas[cachedKey]?.schema, item.grpc?.service, item.grpc?.method) : null
    const call = createLiveCall(item, cachedMethod ? getGrpcCallKind(cachedMethod) : null)
    grpcCalls[itemKey] = call
    // the reactive copy, which the panels watch
    const liveCall = grpcCalls[itemKey]

    let onFinished: (response?: GrpcFinalResponse) => void = () => undefined
    const finished = new Promise<GrpcFinalResponse | undefined>(resolve => {
        onFinished = resolve
    })
    const controller: GrpcCallState = {
        onFinished,
        itemId: item._id,
        workspaceId: item.workspaceId,
        transport: null,
        stopAbortController: requestPreparation?.stopAbortController ?? new AbortController(),
        cancelRequested: false,
        replaced: false,
        send: null,
        sentMetadataSaved: null,
        environment: null,
        deadlineMs: 0,
        omittedByIndex: [],
        indexUncertain: false,
        messageSteps: Promise.resolve(),
        timers: [],
        revisionTimer: undefined,
        sentCountLatest: 0,
        receivedCountLatest: 0,
    }
    controllers.set(itemKey, controller)

    // a call stopped while it was set up ends with no error of its own
    const fail = (error?: string, errorWithoutValues?: string) => finishCall(store, liveCall, controller, { ended: controller.cancelRequested ? 'cancelled' : 'failed', error, errorWithoutValues })
    const stopped = () => controller.replaced || controller.cancelRequested || liveCall.phase === 'ended'

    if(!isGrpcAvailable()) {
        return fail(GRPC_UNAVAILABLE_MESSAGE)
    }

    if(!liveCall.service || !liveCall.method) {
        return fail('Choose a method to call')
    }

    try {
        const { environment, parentHeaders, parentAuthentication } = requestPreparation ?? await resolveEnvironmentForRequest(store, item, 'send')
        const send = requestPreparation?.send ?? new SendResolver(item.workspaceId, 'send', controller.stopAbortController.signal)
        controller.send = send
        controller.environment = environment

        // the address is saved with masked prompt values hidden
        const { textResolved: urlResolved, textResolvedMasked: urlMasked } = await send.resolveWithMasked(environment, item.url ?? '')
        liveCall.url = urlMasked
        const target = parseGrpcTarget(urlResolved)
        if(!isGrpcTarget(target)) {
            // the address as saved gives the error's copy, with a masked prompt value in it as ******
            const targetMasked = parseGrpcTarget(urlMasked)
            return fail(target.error, isGrpcTarget(targetMasked) ? undefined : targetMasked.error)
        }

        const metadataMasked: GrpcMetadata = []
        const metadata = await resolveMetadata(store, item, environment, parentHeaders, parentAuthentication, send, metadataMasked)
        if(stopped()) {
            return fail()
        }

        const protoFiles = getGrpcProtoFiles(item)
        const key = getGrpcSchemaKey(target, protoFiles)!
        grpcItemSchemaKeys[getGrpcItemKey({ workspaceId: controller.workspaceId, _id: controller.itemId })] = key

        let schema = grpcSchemas[key]?.schema ?? null
        let schemaMethod = findGrpcMethod(schema, liveCall.service, liveCall.method)
        if(!schemaMethod) {
            // not loaded yet, or the server changed since: loaded with what this send resolved, so nothing asks twice
            const loaded = await runSchemaLoad(key, protoFiles ? null : itemKey, signal => loadGrpcSchema({ target, metadata, protoFiles, disableSSLVerification: isSSLVerificationDisabled(store), timeoutMs: getSavedRequestTimeout() }, signal), controller.stopAbortController.signal)
            if(stopped()) {
                return fail()
            }
            // a server that could not be reached ends the call as a call that cannot connect does, with its status
            if(loaded.connectionStatus !== null) {
                return finishCall(store, liveCall, controller, { ended: loaded.connectionStatus.code === 4 ? 'timedOut' : 'completed', status: loaded.connectionStatus, detailsWithoutValues: loaded.errorWithoutValues ?? GRPC_ERROR_NOT_SAVED })
            }
            if(loaded.error !== null) {
                return fail(loaded.error, loaded.errorWithoutValues)
            }
            schema = loaded.schema
            schemaMethod = findGrpcMethod(schema, liveCall.service, liveCall.method)
        }

        if(schema && grpcItemSchemaPreparations[itemKey] === schemaPreparation) {
            delete grpcItemSchemaPreparations[itemKey]
        }

        if(!schemaMethod) {
            return fail(`${protoFiles ? 'The .proto files define' : 'The server offers'} no method ${liveCall.service}/${liveCall.method}`)
        }

        const kind = getGrpcCallKind(schemaMethod)
        if(unaryOnly && kind !== 'unary') {
            dropGrpcCall(itemKey)
            delete grpcCalls[itemKey]
            throw new Error(GRPC_RESPONSE_TAG_UNARY_MESSAGE, { cause: 'display-error' })
        }
        liveCall.kind = kind

        const messages: string[] = []
        if(!isClientStreaming(kind)) {
            const { textResolved, maskedPromptUsed } = await send.resolveWithMasked(environment, item.body?.text ?? '{}')
            messages.push(textResolved.trim() === '' ? '{}' : textResolved)
            controller.omittedByIndex.push(maskedPromptUsed)
        }

        if(stopped()) {
            return fail()
        }

        // a stream's messages come at the user's pace, so only a call that waits for the server has a deadline
        controller.deadlineMs = isClientStreaming(kind) ? 0 : getSavedRequestTimeout()

        liveCall.startedAt = Date.now()
        liveCall.sentMetadata = []
        controller.sentMetadataSaved = []

        liveCall.liveShown = isClientStreaming(kind)
        if(kind === 'serverStream') {
            controller.timers.push(setTimeout(() => {
                if(liveCall.phase !== 'ended') {
                    liveCall.liveShown = true
                }
            }, LIVE_SHOWN_AFTER_MS))
        }

        const transport = await startGrpcCall({
            target,
            metadata,
            protoFiles,
            service: liveCall.service,
            method: liveCall.method,
            disableSSLVerification: isSSLVerificationDisabled(store),
            deadlineMs: controller.deadlineMs,
            messages,
        }, (event: GrpcCallEvent) => {
            if(event.type === 'sentMetadata') {
                if(!stopped()) {
                    liveCall.sentMetadata = event.indexes.map(index => metadata[index])
                    controller.sentMetadataSaved = event.indexes.map(index => metadataMasked[index])
                }
                return
            }
            handleEvent(store, liveCall, controller, event)
        })

        controller.transport = transport

        // stopped while the call was being set up
        if(controller.cancelRequested || controller.replaced) {
            transport.cancel()
        }
        if(waitForEnd) {
            return await finished
        }
    } catch(error: any) {
        if(unaryOnly && error?.message === GRPC_RESPONSE_TAG_UNARY_MESSAGE) {
            throw error
        }
        return fail(describeError(error), error?.messageWithoutValues)
    }
}

// runs after the stream's earlier messages and End stream, whatever became of them
function queueMessageStep(controller: GrpcCallState, step: () => Promise<void> | void) {
    const done = controller.messageSteps.then(step)
    controller.messageSteps = done.catch(() => undefined)
    return done
}

// the stream still takes what was clicked before End stream, until the call ends, stops or a newer one replaces it
function isStreamOpenForQueuedSteps(call: GrpcLiveCall, controller: GrpcCallState) {
    return !controller.replaced && !controller.cancelRequested && call.phase === 'open'
}

// one more message of a client or bidi stream, resolved as the rest of the call was
export function sendGrpcCallMessage(item: CollectionItem, text: string) {
    const call = grpcCalls[getGrpcItemKey(item)]
    const controller = controllers.get(getGrpcItemKey(item))
    if(!controller || !controller.transport || !controller.send || !isGrpcCallAcceptingMessages(call)) {
        return Promise.resolve()
    }
    const { transport, send } = controller

    return queueMessageStep(controller, async() => {
        // a message that waited behind a slow one asks no prompt and sends no response tag's request for a call that is over
        if(!isStreamOpenForQueuedSteps(call, controller)) {
            return
        }
        try {
            const { textResolved, maskedPromptUsed } = await send.resolveWithMasked(controller.environment, text)
            if(!isStreamOpenForQueuedSteps(call, controller)) {
                return
            }
            controller.omittedByIndex.push(maskedPromptUsed)
            transport.send(textResolved.trim() === '' ? '{}' : textResolved)
        } catch(error) {
            if(isStreamOpenForQueuedSteps(call, controller)) {
                call.sendError = send.hideMaskedValues(describeError(error))
            }
        }
    })
}

// tells the server the client sent its last message, once the messages clicked before have gone out. No message is
// taken from the click on
export function endGrpcCallStream(item: CollectionItem) {
    const call = grpcCalls[getGrpcItemKey(item)]
    const controller = controllers.get(getGrpcItemKey(item))
    if(!controller || !controller.transport || !isGrpcCallAcceptingMessages(call)) {
        return Promise.resolve()
    }
    const { transport } = controller
    call.halfClosed = true
    call.endError = null

    return queueMessageStep(controller, () => {
        if(isStreamOpenForQueuedSteps(call, controller)) {
            transport.end()
        }
    })
}

// Cancel and Stop. A call still being set up ends here, one already sent ends when the server's CANCELLED arrives
export function cancelGrpcCallForItem(store: Store<State>, item: CollectionItem) {
    const call = grpcCalls[getGrpcItemKey(item)]
    const controller = controllers.get(getGrpcItemKey(item))
    if(!controller || !isGrpcCallRunning(call)) {
        return
    }
    controller.cancelRequested = true
    controller.stopAbortController.abort()
    if(controller.transport) {
        controller.transport.cancel()
    } else {
        finishCall(store, call, controller, { ended: 'cancelled' })
    }
}

function forgetGrpcCallsForItemKeys(itemKeys: string[]) {
    for(const itemKey of itemKeys) {
        dropGrpcCall(itemKey)
        itemSchemaRequests.delete(itemKey)
        delete grpcItemSchemaPreparations[itemKey]
        delete grpcCalls[itemKey]
        delete grpcItemSchemaKeys[itemKey]
    }
}

// for deleted items, whose running calls nothing could stop or show, and whose saved calls are gone
export function forgetGrpcCallsForItems(workspaceId: string, itemIds: string[]) {
    forgetGrpcCallsForItemKeys(itemIds.map(itemId => getGrpcItemKey({ workspaceId, _id: itemId })))
}

// For a file workspace reloaded with each item's new id by its old one, as after a rename or a move: a running call
// carries on under its item's new id, so its tab can still stop it and it is saved there. One whose item is gone stops.
// oldItemIds are the workspace's items before the reload. The calls of other workspaces are left alone
export function moveGrpcCallsToNewItemIds(workspaceId: string, oldItemIds: string[], newIdsByOldId: Map<string, string>) {
    const oldIds = new Set(oldItemIds)
    const keyOf = (itemId: string) => getGrpcItemKey({ workspaceId, _id: itemId })
    forgetGrpcCallsForItems(workspaceId, [...oldIds].filter(oldId => !newIdsByOldId.has(oldId)))

    // all taken out first, so an item renamed to a name another one just gave up keeps its own call
    const moved = [...oldIds].filter(oldId => newIdsByOldId.has(oldId) && newIdsByOldId.get(oldId) !== oldId).map(oldId => {
        const oldKey = keyOf(oldId)
        const entry = { newId: newIdsByOldId.get(oldId)!, controller: controllers.get(oldKey), call: grpcCalls[oldKey], schemaKey: grpcItemSchemaKeys[oldKey], preparation: grpcItemSchemaPreparations[oldKey] }
        controllers.delete(oldKey)
        delete grpcCalls[oldKey]
        delete grpcItemSchemaKeys[oldKey]
        itemSchemaRequests.delete(oldKey)
        delete grpcItemSchemaPreparations[oldKey]
        return entry
    })
    for(const { newId, controller, call, schemaKey, preparation } of moved) {
        const newKey = keyOf(newId)
        if(controller) {
            controller.itemId = newId
            controllers.set(newKey, controller)
        }
        if(call) {
            grpcCalls[newKey] = call
        }
        if(preparation) {
            grpcItemSchemaPreparations[newKey] = { ...preparation, loading: false }
        }
        if(schemaKey !== undefined) {
            grpcItemSchemaKeys[newKey] = schemaKey
        }
    }
}

// for a workspace deleted or closed, whose items a file workspace keeps only on disk
export function forgetGrpcCallsForWorkspace(workspaceId: string) {
    // ended calls too, which have no controller anymore, and the methods each item uses
    const itemKeys = new Set([...controllers.keys(), ...Object.keys(grpcCalls), ...Object.keys(grpcItemSchemaKeys), ...itemSchemaRequests.keys(), ...Object.keys(grpcItemSchemaPreparations)])
    forgetGrpcCallsForItemKeys([...itemKeys].filter(itemKey => JSON.parse(itemKey)[0] === workspaceId))
}

// The picker reuses a failed load when it opens rather than asking a server that is down again on each open. A change
// to a setting the connection follows, such as CA Certificates, may make it work, so the failure is forgotten and the
// next load tries again. Methods loaded before are kept
export function forgetFailedGrpcSchemaLoads() {
    connectionSettingsChanges++
    for(const preparation of Object.values(grpcItemSchemaPreparations)) {
        Object.assign(preparation, { error: null, failedAt: null })
    }
    for(const [key, entry] of Object.entries(grpcSchemas)) {
        if(!entry.loading && entry.error !== null) {
            Object.assign(entry, { error: null, errorCode: null, failedAt: null })
            schemaFailedItemKeys.delete(key)
        }
    }
}

// for specs, which start each test with no calls or schemas
export function resetGrpcCalls() {
    controllers.forEach(controller => clearControllerTimers(controller))
    controllers.clear()
    schemaLoads.clear()
    schemaFailedItemKeys.clear()
    itemSchemaRequests.clear()
    for(const key of Object.keys(grpcItemSchemaPreparations)) {
        delete grpcItemSchemaPreparations[key]
    }
    for(const key of Object.keys(grpcCalls)) {
        delete grpcCalls[key]
    }
    for(const key of Object.keys(grpcSchemas)) {
        delete grpcSchemas[key]
    }
    for(const key of Object.keys(grpcItemSchemaKeys)) {
        delete grpcItemSchemaKeys[key]
    }
}
