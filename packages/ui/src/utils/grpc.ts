import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { GrpcCallKind, GrpcCallResult, GrpcCallResultEvent, GrpcStatus } from '@/global'
import { getEditorConfig, humanFriendlyTime, jsonStringify } from '@/helpers'
import { emitter } from '@/event-bus'
import type { GrpcCallEvent, GrpcMethodSchema, GrpcSchema, GrpcServiceSchema, GrpcTarget } from '@/utils/grpc-transport'

// the shapes the transport carries, named here as the panels use them
export type { GrpcCallEvent, GrpcSchema, GrpcTarget }
export type GrpcSchemaMethod = GrpcMethodSchema

export const GRPC_UNAVAILABLE_MESSAGE = 'gRPC calls need the Restfox desktop app or a self-hosted Restfox. Browsers cannot make them.'
export const GRPC_RESPONSE_TAG_UNARY_MESSAGE = 'A response tag can read only a unary gRPC call'

export function formatGrpcJson(text: string, indentSize: number): string {
    try {
        return jsonStringify(JSON.parse(text), indentSize)
    } catch {
        return text
    }
}

export function useGrpcMessagePreview(event: () => GrpcCallResultEvent | null) {
    const indentSize = ref(getEditorConfig().indentSize)
    const updateIndentSize = () => {
        indentSize.value = getEditorConfig().indentSize
    }
    emitter.on('editor_indent_size', updateIndentSize)
    onBeforeUnmount(() => emitter.off('editor_indent_size', updateIndentSize))
    const largeResponseConfirmed = ref(false)
    const selectedText = ref('')
    watch(event, () => {
        largeResponseConfirmed.value = false
        selectedText.value = ''
    })
    const responseSize = computed(() => new TextEncoder().encode(event()?.json ?? '').byteLength + (event()?.bytes?.length ?? 0))
    // the response panel asks before showing a body larger than 3 MB
    const shouldShowLargeResponseWarning = computed(() => responseSize.value > 3 * 1024 * 1024 && !largeResponseConfirmed.value)
    const json = computed(() => formatGrpcJson(event()?.json ?? '', indentSize.value))
    // the raw reply and the indent, not the formatted text, so a large reply is not formatted before Load Response
    watch([() => event()?.json, () => event()?.bytes, indentSize], () => selectedText.value = '')
    const note = computed(() => {
        const message = event()
        if(message?.decodeError) {
            return 'Could not be decoded'
        }
        return message?.unknownFields?.length ? `Has fields the .proto files do not describe: ${message.unknownFields.join(', ')}` : ''
    })
    return { indentSize, json, note, selectedText, responseSize, largeResponseConfirmed, shouldShowLargeResponseWarning }
}

// where the user left a message list, kept by the panel so the finished list of a call starts where its live list was
export interface GrpcMessageListViewState {
    scrollTop: number | null
    stickToBottom: boolean | null
    selectedIndex: number | null
}

const SCHEME_REGEX = /^([a-z][a-z0-9+.-]*):\/\//i
// a variable the environment has no value for stays in the text as typed
const VARIABLE_REGEX = /{{\s*([^{}]*?)\s*}}/

function isLoopbackHost(host: string) {
    const hostLowerCase = host.toLowerCase()
    return hostLowerCase === 'localhost'
        || hostLowerCase.endsWith('.localhost')
        || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostLowerCase)
        || hostLowerCase === '::1'
        || hostLowerCase === '0:0:0:0:0:0:0:1'
}

// The server a gRPC item calls, from its address as typed with variables resolved: grpcs:// and https:// use TLS,
// grpc:// and http:// do not, and an address with no scheme uses TLS unless it is this machine
export function parseGrpcTarget(url: string): GrpcTarget | { error: string } {
    let rest = url.trim()

    if(rest === '') {
        return { error: 'Enter the server address, such as localhost:50051' }
    }

    const variableMatch = rest.match(VARIABLE_REGEX)
    if(variableMatch) {
        return { error: `The variable ${variableMatch[1]} has no value in the environment` }
    }

    let tls: boolean | null = null

    const schemeMatch = rest.match(SCHEME_REGEX)
    if(schemeMatch) {
        const scheme = schemeMatch[1].toLowerCase()
        if(scheme === 'grpcs' || scheme === 'https') {
            tls = true
        } else if(scheme === 'grpc' || scheme === 'http') {
            tls = false
        } else {
            return { error: `A gRPC server address starts with grpc://, grpcs://, http://, https:// or no scheme, not ${schemeMatch[1]}://` }
        }
        rest = rest.slice(schemeMatch[0].length)
    }

    // a lone slash at the end, as a pasted url often has, is no path
    const authorityEnd = rest.search(/[/?#]/)
    if(authorityEnd !== -1) {
        if(rest.slice(authorityEnd) !== '/') {
            return { error: 'A gRPC server address has no path, such as localhost:50051' }
        }
        rest = rest.slice(0, authorityEnd)
    }

    if(/\s/.test(rest)) {
        return { error: 'A gRPC server address has no spaces, such as localhost:50051' }
    }

    if(rest.includes('@')) {
        return { error: 'A gRPC server address has no user name. Send credentials in Metadata or Auth' }
    }

    let host: string
    let portText: string | null = null

    if(rest.startsWith('[')) {
        const closingBracket = rest.indexOf(']')
        if(closingBracket === -1) {
            return { error: 'An IPv6 address needs its closing bracket, such as [::1]:50051' }
        }
        host = rest.slice(1, closingBracket)
        const afterHost = rest.slice(closingBracket + 1)
        if(afterHost !== '') {
            if(!afterHost.startsWith(':')) {
                return { error: 'A gRPC server address is a host and a port, such as [::1]:50051' }
            }
            portText = afterHost.slice(1)
        }
    } else if((rest.match(/:/g) ?? []).length > 1) {
        // an IPv6 address written without brackets, which leaves no room for a port
        host = rest
    } else {
        const colon = rest.indexOf(':')
        host = colon === -1 ? rest : rest.slice(0, colon)
        portText = colon === -1 ? null : rest.slice(colon + 1)
    }

    if(host === '') {
        return { error: 'Enter the server\'s host, such as localhost:50051' }
    }

    if(tls === null) {
        tls = !isLoopbackHost(host)
    }

    let port = tls ? 443 : 80

    if(portText !== null) {
        port = /^\d+$/.test(portText) ? Number(portText) : NaN
        if(!Number.isInteger(port) || port < 1 || port > 65535) {
            return { error: 'The port is a number from 1 to 65535, such as localhost:50051' }
        }
    }

    const address = `${host.includes(':') ? `[${host}]` : host}:${port}`

    return { address, host, port, tls }
}

export function isGrpcTarget(target: GrpcTarget | { error: string }): target is GrpcTarget {
    return !('error' in target)
}

export function getGrpcCallKind(method: Pick<GrpcSchemaMethod, 'requestStream' | 'responseStream'>): GrpcCallKind {
    if(method.requestStream) {
        return method.responseStream ? 'bidiStream' : 'clientStream'
    }
    return method.responseStream ? 'serverStream' : 'unary'
}

export const GRPC_CALL_KIND_LABELS: Record<GrpcCallKind, string> = {
    unary: 'unary',
    serverStream: 'server stream',
    clientStream: 'client stream',
    bidiStream: 'bidi stream',
}

// the client sends its messages one by one while the call is open
export function isClientStreaming(kind: GrpcCallKind | null | undefined) {
    return kind === 'clientStream' || kind === 'bidiStream'
}

// what the action button says while a call runs, which the waiting view's button says too: a unary call is cancelled,
// a stream stopped. A call whose method is not known yet says Cancel
export function getGrpcStopLabel(kind: GrpcCallKind | null | undefined) {
    return kind === 'unary' || kind === null || kind === undefined ? 'Cancel' : 'Stop'
}

// OK alone, CANCELLED alone since the user asked for it, any other with its number, such as NOT_FOUND (5)
export function getGrpcStatusLabel(status: Pick<GrpcStatus, 'code' | 'name'>) {
    return status.code === 0 || status.code === 1 ? status.name : `${status.name} (${status.code})`
}

// the tag color class the response panel shares with HTTP's, none for a cancelled call
export function getGrpcStatusColor(status: Pick<GrpcStatus, 'code'> | null, error?: string) {
    if(status === null) {
        return error ? 'red' : ''
    }
    if(status.code === 0) {
        return 'green'
    }
    if(status.code === 1) {
        return ''
    }
    return 'red'
}

// What the response panel says about how a call ended, null for a call that ended well. Such as
// "NOT_FOUND (5): user 42 not found", "Cancelled after 4.2 s" or "Timed out after 30 s"
export function getGrpcEndedMessage(result: Pick<GrpcCallResult, 'kind' | 'method' | 'events' | 'status' | 'error' | 'timeTaken' | 'ended'>) {
    if(result.ended === 'cancelled') {
        // the button said Cancel for a unary call and for one whose method was not known yet, Stop for the others
        return `${getGrpcStopLabel(result.kind) === 'Cancel' ? 'Cancelled' : 'Stopped'} after ${humanFriendlyTime(result.timeTaken)}`
    }

    if(result.ended === 'timedOut') {
        return `Timed out after ${humanFriendlyTime(result.timeTaken)}`
    }

    if(result.error) {
        return result.error
    }

    if(result.status && result.status.code !== 0) {
        const label = getGrpcStatusLabel(result.status)
        return result.status.details ? `${label}: ${result.status.details}` : label
    }

    if(result.ended === 'failed') {
        return 'The call failed'
    }

    // A method that returns one message, whose server ended with OK and none or more. The server's OK stays as it came,
    // this says what it left out
    if(result.status?.code === 0 && (result.kind === 'unary' || result.kind === 'clientStream')) {
        const receivedCount = result.events.filter(event => event.type === 'received').length
        if(receivedCount !== 1) {
            return `${result.method} returns one message. The server sent ${receivedCount === 0 ? 'none' : receivedCount}.`
        }
    }

    return null
}

// a method by its service's short name, such as Greeter.SayHello, the name a new item takes when one is chosen. A dot,
// not the path's slash, which a file workspace would escape in the file name
export function getGrpcMethodShortName(service: string, method: string) {
    return `${getShortServiceName(service)}.${method}`
}

// the last part of a fully qualified name, such as Greeter for demo.v1.Greeter
export function getShortServiceName(service: string) {
    const lastDot = service.lastIndexOf('.')
    return lastDot === -1 ? service : service.slice(lastDot + 1)
}

export function findGrpcMethod(schema: GrpcSchema | null | undefined, service: string | undefined, method: string | undefined) {
    if(!schema || !service || !method) {
        return null
    }
    return schema.services.find(schemaService => schemaService.name === service)?.methods.find(schemaMethod => schemaMethod.name === method) ?? null
}

function countGrpcMethods(schema: GrpcSchema) {
    return schema.services.reduce((count, service) => count + service.methods.length, 0)
}

function plural(count: number, noun: string) {
    return `${count} ${noun}${count === 1 ? '' : 's'}`
}

// such as "2 services, 9 methods from server reflection"
export function describeGrpcSchema(schema: GrpcSchema) {
    return `${plural(schema.services.length, 'service')}, ${plural(countGrpcMethods(schema), 'method')} from ${schema.source === 'reflection' ? 'server reflection' : '.proto files'}`
}

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compareNatural(a: string, b: string) {
    return naturalCollator.compare(a, b)
}

// where words start in a name: after leading symbols, after any symbol, at a capital after a lowercase letter
// (SayHello) and at a digit after a letter
function getWordStarts(name: string) {
    const starts: number[] = []
    for(let index = 0; index < name.length; index++) {
        const character = name[index]
        if(!/[a-z0-9]/i.test(character)) {
            continue
        }
        const previous = index > 0 ? name[index - 1] : ''
        if(previous === '' || !/[a-z0-9]/i.test(previous)
            || (/[A-Z]/.test(character) && /[a-z]/.test(previous))
            || (/[0-9]/.test(character) && /[a-z]/i.test(previous))) {
            starts.push(index)
        }
    }
    return starts
}

// 0 at the start of the name, 1 at the start of a word, 2 inside a word, null for no match
function getMatchTier(name: string, word: string): number | null {
    const nameLowerCase = name.toLowerCase()
    const starts = getWordStarts(name)
    let tier: number | null = null
    let from = nameLowerCase.indexOf(word)
    while(from !== -1) {
        const matchTier = from === starts[0] ? 0 : starts.includes(from) ? 1 : 2
        if(tier === null || matchTier < tier) {
            tier = matchTier
        }
        from = nameLowerCase.indexOf(word, from + 1)
    }
    return tier
}

export interface GrpcMethodSearchResult {
    service: GrpcServiceSchema
    method: GrpcSchemaMethod
}

// Methods whose name has every word of the query, in any order, best match first: a word at the start of the name,
// then at the start of a word in it, then inside a word, and a word found only in the service's name last. Ties go
// by name, numbers in order
export function searchGrpcMethods(schema: GrpcSchema, query: string): GrpcMethodSearchResult[] {
    // a slash splits too, so a full name such as demo.v1.Demo/SayHello finds its method
    const words = query.toLowerCase().split(/[\s/]+/).filter(word => word !== '')
    const ranked: { result: GrpcMethodSearchResult, tiers: number[] }[] = []

    for(const service of schema.services) {
        for(const method of service.methods) {
            const tiers: number[] = []
            for(const word of words) {
                const nameTier = getMatchTier(method.name, word)
                if(nameTier !== null) {
                    tiers.push(nameTier)
                } else if(service.name.toLowerCase().includes(word) || `${service.name}.${method.name}`.toLowerCase().includes(word)) {
                    // the second, such as Demo.SayHello, the name a request takes from its method
                    tiers.push(3)
                } else {
                    break
                }
            }
            if(tiers.length === words.length) {
                ranked.push({ result: { service, method }, tiers: tiers.sort((a, b) => b - a) })
            }
        }
    }

    if(words.length === 0) {
        return ranked.map(item => item.result)
    }

    return ranked.sort((a, b) => {
        // the worst word decides first, then the rest in turn
        for(let index = 0; index < a.tiers.length; index++) {
            if(a.tiers[index] !== b.tiers[index]) {
                return a.tiers[index] - b.tiers[index]
            }
        }
        return compareNatural(a.result.method.name, b.result.method.name) || compareNatural(a.result.service.name, b.result.service.name)
    }).map(item => item.result)
}

// the one line a message list row shows of a message
export function getGrpcMessagePreview(event: { json?: string, omitted?: boolean }, maxLength = 500) {
    if(event.omitted) {
        return '(left out, a masked prompt value went into it)'
    }
    const json = event.json ?? ''
    const start = json.length > maxLength ? json.slice(0, maxLength) : json
    return start.replace(/\s*[\r\n]+\s*/g, ' ')
}

export function getGrpcProtoFilesSize(protoFiles: { text: string }[]) {
    const encoder = new TextEncoder()
    return protoFiles.reduce((size, protoFile) => size + encoder.encode(protoFile.text).byteLength, 0)
}

// Proto files picked one by one keep their names, a folder's keep their path inside it. Only .proto files are kept,
// and a file picked again replaces the one with its path
export async function readGrpcProtoFiles(files: File[], fromFolder: boolean) {
    const protoFiles: { path: string, text: string }[] = []
    for(const file of files) {
        let path = file.name
        if(fromFolder && file.webkitRelativePath) {
            path = file.webkitRelativePath.split('/').slice(1).join('/')
        }
        if(!path.toLowerCase().endsWith('.proto')) {
            continue
        }
        protoFiles.push({ path, text: await file.text() })
    }
    return protoFiles
}

export function mergeGrpcProtoFiles(existing: { path: string, text: string }[], added: { path: string, text: string }[]) {
    const byPath = new Map(existing.map(protoFile => [protoFile.path, protoFile]))
    for(const protoFile of added) {
        byPath.set(protoFile.path, protoFile)
    }
    return [...byPath.values()].sort((a, b) => compareNatural(a.path, b.path))
}
