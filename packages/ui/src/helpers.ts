import { nanoid } from 'nanoid'
import { createRequestContextForPlugin, createResponseContextForPlugin, usePlugin } from './plugin'
import dayjs from 'dayjs'
import getObjectPathValue from 'lodash.get'
import { toRaw } from 'vue'
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { convert as curlConvert } from './parsers/curl'
import yaml from 'js-yaml'
import {
    CollectionItem,
    RequestAuthentication,
    RequestParam,
    RequestInitialResponse,
    RequestFinalResponse,
    Plugin,
    CreateRequestDataReturn,
    HandleRequestState,
    State,
    OpenApiSpecPathParams,
    EditorConfig,
    SetEnvironmentVariableFunction,
    Flags,
    CACertificates,
    ProxySettings,
    MaskedPromptOmitted,
    BodyIncomplete,
    ResponseHead,
    ResponseProgressHandler,
    GrpcProtoFile,
    GrpcSettings,
} from './global'
import { ActionContext } from 'vuex'
import { version } from '../../electron/package.json'
import constants from '@/constants'
import { handleResponseTag } from '@/utils/tag'
import { MASKED_PREVIEW, getPromptPreviewValue, handlePromptTag } from '@/utils/prompt-tag'
import { handleTags } from '@/parsers/tag'
import type { ParsedResult } from '@/parsers/tag'
import { getSettingsFile, putSettingsFile, deleteSettingsFile, getAllWorkspaces, getFileWorkspace, getCollectionById, updateWorkspace, updateCollection } from '@/db'
import { ResponseBodyCollector, getStreamView, isSendReplaced } from '@/utils/response-stream'
import { getResponseContentType } from '@/utils/response'
import { isGrpcTarget, parseGrpcTarget } from '@/utils/grpc'
import { PROXY_FRAMES_CONTENT_TYPE, PROXY_FRAME_TYPE, readProxyFrames } from '@/utils/proxy-frames'

// From: https://stackoverflow.com/a/67802481/4932305
export function toTree(array: CollectionItem[]): CollectionItem[] {
    const map: Record<string, number> = {}
    let i

    for(i = 0; i < array.length; i += 1) {
        map[array[i]._id] = i
        if(array[i]._type === 'request_group') {
            array[i].children = []
        }
    }

    let node
    const res: any[] = []

    for(i = 0; i < array.length; i += 1) {
        node = array[i]
        if(node.parentId !== null) {
            array[map[node.parentId]]?.children?.push(node)
        } else {
            res.push(node)
        }
    }

    return res
}

export function flattenTree(array: CollectionItem[]) {
    const level: any = []

    array.forEach(item => {
        const newItem = Object.assign({}, item)
        delete newItem.children
        level.push(newItem)

        if(item.children) {
            level.push(...flattenTree(item.children))
        }
    })

    return level
}

// A prompt tag never asks here, it shows its preview value, with what Ask kept in workspaceId: only a SendResolver asks
export function substituteEnvironmentVariables(
    environment: any,
    string: string,
    options: { tagTrigger?: boolean, noError?: boolean, resolvePromptTags?: boolean, workspaceId?: string } = {}
) {
    return substituteEnvironmentVariablesWith(environment, string, options)
}

// send keeps response tags' responses for one send and resolves its prompt tags. promptTagsOnly leaves variables and
// other tags as written
async function substituteEnvironmentVariablesWith(
    environment: any,
    string: string,
    options: { tagTrigger?: boolean, noError?: boolean, resolvePromptTags?: boolean, promptTagsOnly?: boolean, workspaceId?: string },
    send?: { cacheId: string, handlePromptTag: (parsedTag: ParsedResult) => Promise<string>, throwIfStopped: () => void }
) {
    const { tagTrigger = true, noError = false, resolvePromptTags = true, promptTagsOnly = false } = options

    if(promptTagsOnly) {
        environment = {}
    }

    let substitutedString = String(string)

    const possibleEnvironmentObjectPaths = getObjectPaths(environment)

    possibleEnvironmentObjectPaths.forEach(objectPath => {
        let objectPathValue:any = getObjectPathValue(environment, objectPath)

        if (typeof objectPathValue === 'object') {
            objectPathValue = JSON.stringify(objectPathValue)
        }

        /**
         * Insomnia support
         * if "env" doesn't have "_" key, then prefix "objectPath" with "_."
         * and replace occurrences of "_.objectPath"
         */
        if (!environment['_']) {
            substitutedString = substitutedString.replaceAll(`{{ _.${objectPath} }}`, objectPathValue)
            substitutedString = substitutedString.replaceAll(`{{_.${objectPath}}}`, objectPathValue)
        }

        substitutedString = substitutedString.replaceAll(`{{${objectPath}}}`, objectPathValue)
        substitutedString = substitutedString.replaceAll(`{{ ${objectPath} }}`, objectPathValue)
    })

    const handlePromptTagForString = async(parsedTag: ParsedResult) => send ? send.handlePromptTag(parsedTag) : getPromptPreviewValue(parsedTag, options.workspaceId)

    // a send that was stopped sends no request of a response tag still to come in the text
    const handleResponseTagForString = async(parsedTag: ParsedResult, tagTrigger: boolean, cacheId: string | undefined) => {
        send?.throwIfStopped()
        return handleResponseTag(parsedTag, tagTrigger, cacheId, options.workspaceId)
    }

    substitutedString = await handleTags(handleResponseTagForString, substitutedString, tagTrigger, send?.cacheId, noError, handlePromptTagForString, resolvePromptTags, !promptTagsOnly)

    return substitutedString
}

// The part of a send a text goes into, which a masked prompt's value there leaves out of the saved copy: the url is
// saved as written, a header and the body are left out. 'unsaved' is a text no copy of the send keeps, such as an
// OAuth 2.0 token request's fields or generated code
export type SendPart = 'url' | 'body' | { header: string } | 'unsaved'

// One send of a request, or one preparation of it such as generated code. Prompt tags ask only through it, and each
// text it resolves names the part of the send it goes into, so a masked prompt's value never reaches a saved copy
export class SendResolver {
    // what Ask keeps is kept per workspace. tagTrigger false has response tags read the saved response and never send
    // their request, for a resolve the user did not ask for. Once signal aborts, as when the send is cancelled, no text
    // starts resolving and no prompt or response tag in a text still resolving goes on, so neither a prompt nor a
    // response tag's request comes after the cancel
    constructor(readonly workspaceId: string, readonly tagTrigger = true, readonly signal: AbortSignal | null = null) {}

    // response tags keep their response for the send by it
    readonly cacheId = nanoid()
    // the values this send was given, so a prompt used twice in one send asks once
    private readonly promptValues = new Map<string, Promise<string>>()
    // the values masked prompts gave this send, to be hidden in text written from them, such as an error
    private readonly maskedValues = new Set<string>()
    private maskedUrl = false
    private maskedBody = false
    // a header is left out by the name it was sent with, and named in the note with masked values hidden
    private readonly maskedHeaders: { nameSent: string, nameShown: string }[] = []
    // the url as saved when a masked prompt's value went into it, with masked values hidden, null when it cannot be
    // built so, such as for a masked port
    private urlShown: URL | null = null
    private scriptReadMaskedPrompt = false

    resolve(environment: any, text: string, part: SendPart) {
        return this.substitute(environment, text, () => this.omit(part))
    }

    // The url from the texts build resolves, and once more with masked values hidden when one went into it. That
    // second time reuses what this send's tags gave, so nothing asks or is sent twice
    async resolveUrl(environment: any, build: (resolveText: (text: string) => Promise<string>) => Promise<URL>) {
        const url = await build(text => this.resolve(environment, text, 'url'))

        if(this.maskedUrl) {
            try {
                this.urlShown = await build(text => this.substitute(environment, text, () => undefined, { hideMasked: true }))
            } catch {
                // saved as written
            }
        }

        return url
    }

    // A header's name resolves first, then its values unless skip decides from the name that it is not sent, so a
    // prompt in a header that is not sent never asks. promptTagsOnly leaves variables and other tags as written
    async resolveHeader(environment: any, name: string, values: string[], skip: (nameResolved: string) => boolean, promptTagsOnly = false) {
        let nameMasked = false
        const nameResolved = await this.substitute(environment, name, () => {
            nameMasked = true
        }, { promptTagsOnly })

        if(skip(nameResolved)) {
            return null
        }

        const nameResolvedMasked = nameMasked ? await this.substitute(environment, name, () => undefined, { hideMasked: true, promptTagsOnly }) : nameResolved
        if(nameMasked) {
            this.omitHeader(nameResolved, nameResolvedMasked)
        }

        const valuesResolved: string[] = []
        const valuesResolvedMasked: string[] = []

        for(const value of values) {
            let valueMasked = false
            const valueResolved = await this.substitute(environment, value, () => {
                valueMasked = true
                this.omit({ header: nameResolved })
            }, { promptTagsOnly })
            valuesResolved.push(valueResolved)
            valuesResolvedMasked.push(valueMasked ? await this.substitute(environment, value, () => undefined, { hideMasked: true, promptTagsOnly }) : valueResolved)
        }

        return { nameResolved, valuesResolved, nameResolvedMasked, valuesResolvedMasked }
    }

    // A pre-request script may read what a text resolved to. Once it reads a masked prompt's value it may have put it
    // anywhere, so nothing the send resolved to is saved
    async resolveForScript(environment: any, text: string) {
        let masked = false
        const textResolved = await this.substitute(environment, text, () => {
            masked = true
        })

        return () => {
            if(masked) {
                this.markScriptReadMaskedPrompt()
            }
            return textResolved
        }
    }

    markScriptReadMaskedPrompt() {
        this.scriptReadMaskedPrompt = true
    }

    // the text as this send resolved it, and with masked prompt values hidden, which is what may be shown and saved
    async resolveWithMasked(environment: any, text: string, part: SendPart = 'unsaved') {
        let maskedPromptUsed = false
        const textResolved = await this.substitute(environment, text, () => {
            maskedPromptUsed = true
            this.omit(part)
        })

        // resolved again from what this send's tags gave, so nothing asks or is sent twice
        const textResolvedMasked = maskedPromptUsed ? await this.substitute(environment, text, () => undefined, { hideMasked: true }) : textResolved

        return { textResolved, textResolvedMasked, maskedPromptUsed }
    }

    // A text written from what this send resolved, such as an error a library or a server wrote, with each masked
    // prompt value hidden. The longest first, so one inside another is hidden whole
    hideMaskedValues(text: string) {
        let hidden = text
        for(const value of [...this.maskedValues].sort((a, b) => b.length - a.length)) {
            if(value !== '') {
                hidden = hidden.split(value).join(MASKED_PREVIEW)
            }
        }
        return hidden
    }

    // whether a masked prompt gave this send a value, after which history keeps only texts Restfox wrote without the
    // send's texts in them
    get tookMaskedValue() {
        return this.maskedValues.size > 0
    }

    get maskedPromptOmitted(): MaskedPromptOmitted | null {
        if(this.scriptReadMaskedPrompt) {
            return { reason: 'script-read' }
        }

        if(!this.maskedUrl && !this.maskedBody && this.maskedHeaders.length === 0) {
            return null
        }

        const url = !this.maskedUrl ? false : this.urlShown !== null ? 'masked' : 'written'

        return { reason: 'masked-field', url, headerNames: this.maskedHeaders.map(header => header.nameShown), body: this.maskedBody }
    }

    // A masked value may be encoded where it went, such as base64 in Basic auth or url-encoded in a form, so each
    // part it went into is left out whole: the url is rebuilt with masked values hidden, else kept as written, the
    // headers go from both header lists, the body goes
    omitMaskedPromptParts(response: RequestFinalResponse, request: CollectionItem): RequestFinalResponse {
        const maskedPromptOmitted = this.maskedPromptOmitted

        if(maskedPromptOmitted === null) {
            return response
        }

        const scriptRead = maskedPromptOmitted.reason === 'script-read'
        const urlOmitted = scriptRead || maskedPromptOmitted.url !== false
        // a script may have changed a variable the url uses to the value, so only a url the send built itself is shown
        const urlShown = scriptRead ? null : this.urlShown
        const isOmittedHeader = (headerName: string) => scriptRead || this.maskedHeaders.some(header => header.nameSent.toLowerCase() === headerName.toLowerCase())
        // the transport's list also carries the url, in HTTP/2 :path and :authority, and host in both
        const isOmittedHeaderSent = (headerName: string) => isOmittedHeader(headerName) || (urlOmitted && [':path', ':authority', 'host'].includes(headerName.toLowerCase()))

        return {
            ...response,
            url: !urlOmitted ? response.url : urlShown !== null ? urlShown.origin + urlShown.pathname : request.url ?? '',
            request: {
                ...response.request,
                query: !urlOmitted ? response.request.query : urlShown !== null ? urlShown.search : '',
                headers: Object.fromEntries(Object.entries(response.request.headers).filter(([name]) => !isOmittedHeader(name))),
                headersSent: response.request.headersSent?.filter(([name]) => !isOmittedHeaderSent(name)),
                body: scriptRead || maskedPromptOmitted.body ? null : response.request.body,
                maskedPromptOmitted,
            },
            // a script that read the value may have written it into a test's name or error
            testResults: scriptRead ? response.testResults.map(testResult => ({ ...testResult, description: '(left out)', ...(testResult.error !== undefined ? { error: '(left out)' } : {}) })) : response.testResults,
        }
    }

    private async substitute(environment: any, text: string, onMaskedPrompt: () => void, { hideMasked = false, promptTagsOnly = false } = {}) {
        this.throwIfStopped()
        return substituteEnvironmentVariablesWith(environment, text, { promptTagsOnly, tagTrigger: this.tagTrigger, workspaceId: this.workspaceId }, {
            cacheId: this.cacheId,
            throwIfStopped: () => this.throwIfStopped(),
            handlePromptTag: async parsedTag => {
                this.throwIfStopped()
                let masked = false
                const value = await handlePromptTag(parsedTag, this.workspaceId, this.promptValues, () => {
                    masked = true
                    onMaskedPrompt()
                }, hideMasked, this.signal)
                if(masked) {
                    this.maskedValues.add(value)
                }
                return value
            },
        })
    }

    private throwIfStopped() {
        if(this.signal?.aborted) {
            throw new Error('The send was stopped')
        }
    }

    private omit(part: SendPart) {
        if(part === 'url') {
            this.maskedUrl = true
        } else if(part === 'body') {
            this.maskedBody = true
        } else if(part !== 'unsaved') {
            this.omitHeader(part.header, part.header)
        }
    }

    headerTookMaskedValue(name: string) {
        return this.maskedHeaders.some(header => header.nameSent.toLowerCase() === name.toLowerCase())
    }

    // a header named first keeps its place, the later spelling of the same name is the same header
    private omitHeader(nameSent: string, nameShown: string) {
        if(nameSent !== '' && !this.maskedHeaders.some(header => header.nameSent.toLowerCase() === nameSent.toLowerCase())) {
            this.maskedHeaders.push({ nameSent, nameShown })
        }
    }
}

// text resolved as a send of its own, and the same with masked prompt values hidden, which is what may be shown and saved
export function substituteEnvironmentVariablesForSend(environment: any, text: string, workspaceId: string) {
    return new SendResolver(workspaceId).resolveWithMasked(environment, text)
}

export function generateBasicAuthString(username: string, password: string) {
    return 'Basic ' + window.btoa(unescape(encodeURIComponent(username)) + ':' + unescape(encodeURIComponent(password)))
}

export function getSavedRequestTimeout() {
    const savedRequestTimeout = localStorage.getItem(constants.LOCAL_STORAGE_KEY.REQUEST_TIMEOUT)
    const requestTimeout = Number(savedRequestTimeout)
    return Number.isFinite(requestTimeout) && requestTimeout > 0 ? Math.floor(requestTimeout) : 0
}

export const DEFAULT_PROXY_SETTINGS: ProxySettings = { mode: 'system', url: '', username: '', password: '', bypass: '' }

// Settings > Proxy, null when never saved, which is System. Fields a saved value lacks take their defaults
export function getSavedProxySettings(): ProxySettings | null {
    try {
        const savedProxySettings = JSON.parse(localStorage.getItem(constants.LOCAL_STORAGE_KEY.PROXY) ?? 'null')
        return savedProxySettings !== null && typeof savedProxySettings === 'object' ? { ...DEFAULT_PROXY_SETTINGS, ...savedProxySettings } : null
    } catch {
        return null
    }
}

// what the transports need of Settings > Proxy: Custom's fields only while Custom is chosen, so a password kept for
// switching back is not sent along
export function getProxySettingsInUse(proxySettings: ProxySettings): Partial<ProxySettings> & Pick<ProxySettings, 'mode'> {
    return proxySettings.mode === 'custom' ? proxySettings : { mode: proxySettings.mode }
}

// the reason Custom's proxy URL cannot be used, or null. Without a scheme it is an HTTP proxy. Custom is not saved
// until it can be, so picking it keeps the previous choice working while the URL is typed in
export function getProxyUrlError(url: string): string | null {
    if(url.trim() === '') {
        return 'Enter a proxy URL to use Custom'
    }

    // the scheme is read here and the rest parsed as http, browsers before Chromium 130 leave the host of a socks5:// URL
    // empty, as of any scheme they do not know
    const scheme = url.includes('://') ? url.slice(0, url.indexOf('://')).toLowerCase() : 'http'

    if(!['http', 'https', 'socks5'].includes(scheme)) {
        return 'Enter a proxy like http://proxy.example.com:8080, https:// and socks5:// work too'
    }

    try {
        const proxyUrl = new URL(`http://${url.includes('://') ? url.slice(url.indexOf('://') + 3) : url}`)

        if(proxyUrl.hostname === '') {
            return 'Enter a proxy like http://proxy.example.com:8080, https:// and socks5:// work too'
        }

        // Electron hands the proxy's login to Chromium's own connections from the fields, not from the URL
        if(proxyUrl.username || proxyUrl.password) {
            return 'Enter the login in Username and Password, not in the URL'
        }
    } catch {
        return 'Enter a proxy like http://proxy.example.com:8080, https:// and socks5:// work too'
    }

    return null
}

const CA_CERTIFICATES_SETTINGS_FILE_ID = 'ca-certificates'

// read once, web-standalone sends the certificates' id with every request
let savedCACertificates: Promise<CACertificates | null> | undefined

// Settings > CA Certificates, trusted by the Electron and web-standalone transports in addition to the default certificates
// and those installed in the operating system. A copy of the picked file, kept in the settings files database
export function getSavedCACertificates(): Promise<CACertificates | null> {
    savedCACertificates ??= getSettingsFile(CA_CERTIFICATES_SETTINGS_FILE_ID).then(file => {
        return file ? { fileName: file.fileName, certificates: file.content } : null
    }).catch(error => {
        // a failed read is tried again next time
        savedCACertificates = undefined
        throw error
    })

    return savedCACertificates
}

export async function saveCACertificates(caCertificates: CACertificates | null) {
    if(caCertificates) {
        await putSettingsFile(CA_CERTIFICATES_SETTINGS_FILE_ID, { fileName: caCertificates.fileName, content: caCertificates.certificates })
    } else {
        await deleteSettingsFile(CA_CERTIFICATES_SETTINGS_FILE_ID)
    }

    savedCACertificates = Promise.resolve(caCertificates)
}

// a certificate file as PEM text, Windows exports a certificate as binary DER as often as PEM. A text file is left as it
// is, so one that holds no certificate is refused as such
export async function caCertificatesFileToPEM(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const text = new TextDecoder().decode(bytes)

    if(text.includes('-----BEGIN')) {
        return text
    }

    let binary = ''
    for(const byte of bytes) {
        binary += String.fromCharCode(byte)
    }

    const base64Lines = window.btoa(binary).match(/.{1,64}/g) ?? []

    return `-----BEGIN CERTIFICATE-----\n${base64Lines.join('\n')}\n-----END CERTIFICATE-----\n`
}

// web-standalone's server keeps the registered certificates in memory, requests name them by id
const caCertificatesIdsRegisteredWithServer = new Map<string, string>()

async function registerCACertificatesWithServer(certificates: string, registerAgain = false): Promise<string> {
    const registeredId = caCertificatesIdsRegisteredWithServer.get(certificates)

    if(registeredId && !registerAgain) {
        return registeredId
    }

    const response = await fetch('/proxy-ca-certificates', {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
        },
        body: certificates,
    })

    const responseBody = await response.json().catch(() => ({}))

    if(!response.ok) {
        throw new Error(responseBody.error ?? `The server could not use the CA certificates: ${response.status} ${response.statusText}`.trim())
    }

    caCertificatesIdsRegisteredWithServer.set(certificates, responseBody.id)

    return responseBody.id
}

// hands the certificates to the process that sends requests, and throws when it cannot use them. Returns web-standalone's
// id for them. registerAgain skips the id kept from before, which a restarted server has forgotten
export async function registerCACertificates(certificates: string | null, registerAgain = false): Promise<string | null> {
    if(import.meta.env.MODE === 'desktop-electron') {
        const { error } = await window.electronIPC.setCACertificates(certificates)

        if(error) {
            throw new Error(error)
        }
    }

    if(import.meta.env.MODE === 'web-standalone' && certificates !== null) {
        return registerCACertificatesWithServer(certificates, registerAgain)
    }

    return null
}

// web-standalone relays a socket with Settings > Proxy named by the id this returns, so the password stays out of the
// relay's URL, which a reverse proxy in front of the server may log. Registered on every connect, a restarted server has
// forgotten it, and the same setting keeps its id
export async function registerProxySettings(proxySettings: ProxySettings): Promise<string> {
    const proxySettingsInUse = getProxySettingsInUse(proxySettings)

    const response = await fetch('/proxy-settings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(proxySettingsInUse),
    })

    const responseBody = await response.json().catch(() => ({}))

    if(!response.ok) {
        throw new Error(responseBody.error ?? `The server could not use the proxy setting: ${response.status} ${response.statusText}`.trim())
    }

    return responseBody.id
}

// Electron pushes the messages of every send on one channel, a send's handler is found by its request id
const electronRequestEventHandlers = new Map<string, (message: any) => void>()
let electronRequestEventsSource: unknown = null

function listenToElectronRequestEvents() {
    if(electronRequestEventsSource === window.electronIPC) {
        return
    }
    electronRequestEventsSource = window.electronIPC
    window.electronIPC.onRequestEvent((requestId: string, message: any) => {
        electronRequestEventHandlers.get(requestId)?.(message)
    })
}

// The response arrives as head, then body chunks, then end. A caller that passes onResponseProgress is told of each as it
// arrives and, when a timeout, a cancel or a failure cuts the body short after the head, gets what arrived with
// bodyIncomplete set. Any other caller, and every failure before the head, gets the whole response or the error as before
export async function fetchWrapper(url: URL, method: string, headers: Record<string, string>, body: any, abortControllerSignal: AbortSignal, flags: {
    electronSwitchToChromiumFetch: boolean,
    disableSSLVerification: boolean,
    requestTimeout?: number
}, onResponseProgress?: ResponseProgressHandler): Promise<RequestInitialResponse> {
    const requestTimeoutRaw = flags.requestTimeout ?? 0
    const requestTimeout = Number.isFinite(requestTimeoutRaw) && requestTimeoutRaw > 0 ? Math.floor(requestTimeoutRaw) : 0
    let timedOut = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let onCallerAbort: (() => void) | undefined
    let signal = abortControllerSignal

    if(requestTimeout > 0) {
        const timeoutController = new AbortController()
        onCallerAbort = () => timeoutController.abort()

        if(abortControllerSignal.aborted) {
            timeoutController.abort()
        } else {
            abortControllerSignal.addEventListener('abort', onCallerAbort, { once: true })
        }

        timeoutId = setTimeout(() => {
            timedOut = true
            timeoutController.abort()
        }, requestTimeout)

        signal = timeoutController.signal
    }

    // why the body stopped, for a stop on this side: the timeout or the caller's cancel, otherwise the connection
    const bodyIncompleteReason = (): BodyIncomplete => timedOut ? 'timedOut' : abortControllerSignal.aborted ? 'cancelled' : 'failed'

    // what arrived before the body was cut short. A cancel or a timeout is shown in the panel, a failure is also logged
    const partialResponse = async(collector: ResponseBodyCollector, reason: BodyIncomplete, error: unknown, end: { timeTaken?: number, bodyTimeTaken?: number } = {}) => {
        if(reason === 'failed') {
            console.error(error)
        }
        return await collector.result(end, reason)
    }

    try {
        if('__EXTENSION_HOOK__' in window && window.__EXTENSION_HOOK__ === 'Restfox CORS Helper Enabled') {
            let bodyHint: any = null

            if(body instanceof FormData) {
                bodyHint = 'FormData'
                body = Array.from(body.entries())
                let i = 0
                for(const item of body) {
                    if(item[1] instanceof File) {
                        body[i][1] = {
                            name: item[1].name,
                            type: item[1].type,
                            buffer: Array.from(new Uint8Array(await item[1].arrayBuffer()))
                        }
                    }
                    i++
                }
            }

            if(body instanceof File) {
                bodyHint = 'File'
                body = {
                    name: body.name,
                    type: body.type,
                    buffer: Array.from(new Uint8Array(await body.arrayBuffer()))
                }
            }

            if(signal.aborted) {
                throw new DOMException('The user aborted a request.', 'AbortError')
            }

            return await new Promise<RequestInitialResponse>((resolve, reject) => {
                const eventId = generateId()
                const collector = new ResponseBodyCollector(Date.now())
                let settled = false

                // the first outcome wins, later messages for this request are dropped
                const settle = (outcome: () => void) => {
                    if(settled) {
                        return
                    }
                    settled = true
                    window.removeEventListener('message', messageHandler)
                    // the store keeps the signal until the tab's next send, and this handler holds every received chunk
                    signal.onabort = null
                    try {
                        outcome()
                    } catch(e) {
                        reject(e)
                    }
                }

                const messageHandler = (message: MessageEvent) => {
                    // an extension before 1.0.9 in Chrome and 1.0.4 in Firefox sends its reply without the eventId
                    if(message.data?.eventId !== undefined && message.data.eventId !== eventId) {
                        return
                    }

                    // an extension older than 1.1.0 ignores stream and sends the whole response at once
                    if(message.data?.event === 'response') {
                        settle(() => resolve(message.data.eventData))
                    } else if(message.data?.event === 'responseHead') {
                        const head: ResponseHead = message.data.eventData
                        collector.head(head)
                        onResponseProgress?.({ type: 'head', head })
                    } else if(message.data?.event === 'responseData') {
                        const bytes: Uint8Array = message.data.eventData
                        collector.push(bytes)
                        onResponseProgress?.({ type: 'data', bytes })
                    } else if(message.data?.event === 'responseEnd') {
                        settle(() => collector.result(message.data.eventData).then(resolve, reject))
                    } else if(message.data?.event === 'responseBodyError') {
                        const { message: reason, timeTaken, bodyTimeTaken } = message.data.eventData
                        settle(() => {
                            if(onResponseProgress) {
                                partialResponse(collector, 'failed', new Error(reason), { timeTaken, bodyTimeTaken }).then(resolve, reject)
                            } else {
                                reject(new Error(reason))
                            }
                        })
                    } else if(message.data?.event === 'responseError') {
                        settle(() => reject(message.data.eventData))
                    }
                }

                window.addEventListener('message', messageHandler)

                signal.onabort = () => {
                    if(settled) {
                        return
                    }
                    window.postMessage({
                        event: 'cancelRequest',
                        eventId,
                    })
                    settle(() => {
                        if(onResponseProgress && collector.hasHead) {
                            partialResponse(collector, bodyIncompleteReason(), null).then(resolve, reject)
                        } else {
                            reject(new DOMException('The user aborted a request.', 'AbortError'))
                        }
                    })
                }

                window.postMessage({
                    event: 'sendRequest',
                    eventId,
                    // asks for the response in parts as it arrives, as responseHead, responseData and responseEnd
                    stream: true,
                    eventData: {
                        url: url.toString(),
                        method,
                        headers,
                        body,
                        bodyHint
                    }
                })
            })
        }

        if(import.meta.env.MODE === 'web-standalone') {
            const proxyHeaders: Record<string, string> = {
                'x-proxy-flag-disable-ssl-verification': flags.disableSSLVerification.toString(),
                'x-proxy-req-url': url.toString(),
                'x-proxy-req-method': method,
                'x-proxy-flag-timeout': requestTimeout.toString(),
                // header names reach the server lowercased, by Node and by any HTTP/2 hop in front of it, a value keeps them as typed
                'x-proxy-flag-header-names': JSON.stringify(Object.keys(headers)),
                // the body comes back in frames as it arrives (utils/proxy-frames.ts), an older server ignores this
                // and sends the whole response as JSON
                'x-proxy-flag-stream': '1',
            }

            // Settings > Proxy, encoded since a header value holds only Latin-1 and a password may not. Never saved is
            // System, which the server also assumes when the header is missing
            const proxySettings = getSavedProxySettings()
            if(proxySettings) {
                proxyHeaders['x-proxy-flag-proxy'] = encodeURIComponent(JSON.stringify(getProxySettingsInUse(proxySettings)))
            }

            Object.keys(headers).forEach(header => {
                proxyHeaders[`x-proxy-req-header-${header}`] = headers[header]
            })

            const caCertificates = await getSavedCACertificates()

            // the frames reply as is, any other reply, which is everything before the upstream head, read as JSON
            const fetchFromProxy = async(caCertificatesId: string | null) => {
                const response = await fetch('/proxy', {
                    method: 'POST',
                    headers: caCertificatesId ? { ...proxyHeaders, 'x-proxy-flag-ca-certificates-id': caCertificatesId } : proxyHeaders,
                    body: method !== 'GET' ? body : undefined,
                    signal
                })

                if((response.headers.get('content-type') ?? '').startsWith(PROXY_FRAMES_CONTENT_TYPE)) {
                    return response
                }

                return await response.json()
            }

            const caCertificatesId = caCertificates ? await registerCACertificatesWithServer(caCertificates.certificates) : null
            // timed from the send, as the other transports are, since the server answers only once the upstream head arrived
            const collector = new ResponseBodyCollector(Date.now())
            let responseBody = await fetchFromProxy(caCertificatesId)

            // the server restarted and forgot the certificates
            if(!(responseBody instanceof Response) && responseBody.event === 'caCertificatesNotFound' && caCertificates) {
                responseBody = await fetchFromProxy(await registerCACertificatesWithServer(caCertificates.certificates, true))
            }

            if(responseBody instanceof Response) {
                const textDecoder = new TextDecoder()
                // the last frame, set by the frame callback
                const last: {
                    end: { timeTaken: number, bodyTimeTaken: number } | null,
                    failure: { message: string, timedOut: boolean } | null,
                } = { end: null, failure: null }

                try {
                    await readProxyFrames(responseBody.body!, frame => {
                        if(frame.type === PROXY_FRAME_TYPE.HEAD) {
                            const head: ResponseHead = JSON.parse(textDecoder.decode(frame.payload))
                            collector.head(head)
                            onResponseProgress?.({ type: 'head', head })
                        } else if(frame.type === PROXY_FRAME_TYPE.DATA) {
                            collector.push(frame.payload)
                            onResponseProgress?.({ type: 'data', bytes: frame.payload })
                        } else if(frame.type === PROXY_FRAME_TYPE.END) {
                            last.end = JSON.parse(textDecoder.decode(frame.payload))
                        } else if(frame.type === PROXY_FRAME_TYPE.ERROR) {
                            last.failure = JSON.parse(textDecoder.decode(frame.payload))
                        }
                    })
                } catch(e) {
                    if(!onResponseProgress || !collector.hasHead) {
                        throw e
                    }
                    return await partialResponse(collector, bodyIncompleteReason(), e)
                }

                if(last.end !== null) {
                    return await collector.result(last.end)
                }

                // the server's timeout or a failed upstream ends the frames with an error frame, any other end is a lost connection
                const error = new Error(last.failure?.message ?? 'The connection to the server closed before the response ended')
                if(last.failure?.timedOut) {
                    error.name = 'TimeoutError'
                }

                if(!onResponseProgress || !collector.hasHead) {
                    throw error
                }

                return await partialResponse(collector, last.failure?.timedOut ? 'timedOut' : 'failed', error)
            }

            return await new Promise((resolve, reject) => {
                if(responseBody.event === 'response') {
                    responseBody.eventData.buffer = new Uint8Array(responseBody.eventData.buffer).buffer
                    resolve(responseBody.eventData)
                }

                if(responseBody.event === 'responseError') {
                    responseBody.eventData = new Error(responseBody.eventData)
                    reject(responseBody.eventData)
                }
            })
        }

        if (import.meta.env.MODE === 'desktop-electron' && !flags.electronSwitchToChromiumFetch) {
            let bodyHint: any = null

            if(body instanceof FormData) {
                bodyHint = 'FormData'
                body = Array.from(body.entries())
                let i = 0
                for(const item of body) {
                    if(item[1] instanceof File) {
                        body[i][1] = {
                            name: item[1].name,
                            type: item[1].type,
                            buffer: Array.from(new Uint8Array(await item[1].arrayBuffer()))
                        }
                    }
                    i++
                }
            }

            if(body instanceof File) {
                bodyHint = 'File'
                body = {
                    name: body.name,
                    type: body.type,
                    buffer: Array.from(new Uint8Array(await body.arrayBuffer()))
                }
            }

            if(signal.aborted) {
                throw new DOMException('The user aborted a request.', 'AbortError')
            }

            listenToElectronRequestEvents()

            return await new Promise<RequestInitialResponse>((resolve, reject) => {
                const requestId = nanoid()
                const collector = new ResponseBodyCollector(Date.now())
                let settled = false

                // the first outcome wins, later pushes for this request are dropped
                const settle = (outcome: () => void) => {
                    if(settled) {
                        return
                    }
                    settled = true
                    electronRequestEventHandlers.delete(requestId)
                    // the store keeps the signal until the tab's next send, and this handler holds every received chunk
                    signal.onabort = null
                    try {
                        outcome()
                    } catch(e) {
                        reject(e)
                    }
                }

                signal.onabort = () => {
                    if(settled) {
                        return
                    }
                    window.electronIPC.cancelRequest(requestId)
                    settle(() => {
                        if(onResponseProgress && collector.hasHead) {
                            partialResponse(collector, bodyIncompleteReason(), null).then(resolve, reject)
                        } else {
                            reject(new DOMException('The user aborted a request.', 'AbortError'))
                        }
                    })
                }

                // the response arrives only as pushed messages, the invoke reply can land between them and carries nothing
                electronRequestEventHandlers.set(requestId, (message: any) => {
                    if(message.event === 'head') {
                        const head: ResponseHead = message.eventData
                        collector.head(head)
                        onResponseProgress?.({ type: 'head', head })
                    } else if(message.event === 'data') {
                        const bytes: Uint8Array = message.eventData instanceof Uint8Array ? message.eventData : new Uint8Array(message.eventData)
                        collector.push(bytes)
                        onResponseProgress?.({ type: 'data', bytes })
                    } else if(message.event === 'end') {
                        settle(() => collector.result(message.eventData).then(resolve, reject))
                    } else if(message.event === 'bodyError') {
                        const { message: reason, timeTaken, bodyTimeTaken } = message.eventData
                        settle(() => {
                            if(onResponseProgress) {
                                partialResponse(collector, 'failed', new Error(reason), { timeTaken, bodyTimeTaken }).then(resolve, reject)
                            } else {
                                reject(new Error(reason))
                            }
                        })
                    } else if(message.event === 'responseError') {
                        settle(() => reject(new Error(message.eventData)))
                    }
                })

                window.electronIPC.sendRequest({
                    requestId,
                    url: url.toString(),
                    method,
                    headers,
                    body,
                    bodyHint,
                    disableSSLVerification: flags.disableSSLVerification,
                }).catch((error: any) => {
                    settle(() => reject(error))
                })
            })
        }

        const startTime = Date.now()
        const collector = new ResponseBodyCollector(startTime)

        const response = await fetch(url, {
            method,
            headers,
            body: method !== 'GET' ? body : undefined,
            signal
        })

        const headEndTime = Date.now()

        const head: ResponseHead = {
            status: response.status,
            statusText: response.statusText,
            headers: [...response.headers.entries()],
            headTimeTaken: headEndTime - startTime,
        }
        collector.head(head)
        onResponseProgress?.({ type: 'head', head })

        try {
            if(response.body !== null) {
                const reader = response.body.getReader()
                for(let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
                    collector.push(chunk.value)
                    onResponseProgress?.({ type: 'data', bytes: chunk.value })
                }
            }
        } catch(e) {
            if(!onResponseProgress) {
                throw e
            }
            return await partialResponse(collector, bodyIncompleteReason(), e)
        }

        const endTime = Date.now()

        return await collector.result({
            timeTaken: endTime - startTime,
            bodyTimeTaken: endTime - headEndTime,
        })
    } catch(e) {
        if(timedOut) {
            const error = new Error(`Request timed out after ${requestTimeout} ms`)
            error.name = 'TimeoutError'
            throw error
        }
        throw e
    } finally {
        if(timeoutId !== undefined) {
            clearTimeout(timeoutId)
        }
        if(onCallerAbort !== undefined) {
            abortControllerSignal.removeEventListener('abort', onCallerAbort)
        }
    }
}

// header names are sent in the case they were typed in but compared without regard to case, as HTTP compares them
function findHeaderName(headers: Record<string, unknown>, headerName: string): string | undefined {
    const lowerCaseHeaderName = headerName.toLowerCase()
    return Object.keys(headers).find(existingHeaderName => existingHeaderName.toLowerCase() === lowerCaseHeaderName)
}

export async function createRequestData(
    state: HandleRequestState,
    request: CollectionItem,
    environment: any,
    parentHeaders: Record<string, string[]>,
    parentAuthentication: RequestAuthentication | undefined,
    setEnvironmentVariable: SetEnvironmentVariableFunction | null,
    plugins: Plugin[],
    workspaceLocation: string | null,
    // a caller that saves the send, or resolves more of it, passes its own
    send = new SendResolver(request.workspaceId),
    // keyed by the sent name, so masked names that become identical still keep their own entries
    headersMasked?: Map<string, [string, string]>
): Promise<CreateRequestDataReturn> {
    for(const plugin of plugins) {
        const { expose } = await createRequestContextForPlugin(send, request, environment, setEnvironmentVariable, state.testResults, plugin.collectionId)

        state.currentPlugin = plugin.type === 'script' ? 'Script: Pre Request' : `${plugin.name} (Pre Request)`

        await usePlugin(expose, {
            name: state.currentPlugin,
            code: typeof plugin.code === 'object' ? plugin.code.pre_request : plugin.code,
            parentPathForReadFile: workspaceLocation,
        })

        request = {
            ...request,
            headers: expose.context.request.getHeaders(),
            body: expose.context.request.getBody(),
            parameters: expose.context.request.getQueryParams(),
            pathParameters: expose.context.request.getPathParams(),
        }
    }

    let body: any = null

    if (request.body && request.body.mimeType === 'application/x-www-form-urlencoded') {
        if ('params' in request.body && request.body.params) {
            const formParams = new URLSearchParams()

            for (const item of request.body.params.filter(item => !item.disabled)) {
                const name = await send.resolve(environment, item.name, 'body')
                const value = await send.resolve(environment, item.value, 'body')
                formParams.append(name, value)
            }

            body = formParams.toString()
        }
    }

    if(request.body) {
        if(request.body.mimeType === 'multipart/form-data') {
            if('params' in request.body) {
                const formData = new FormData()
                if (request.body.params) {
                    for (const param of request.body.params.filter(item => !item.disabled)) {
                        if (param.type === 'text') {
                            formData.append(
                                await send.resolve(environment, param.name, 'body'),
                                await send.resolve(environment, param.value, 'body')
                            )
                        } else if (param.files) {
                            for (const file of param.files) {
                                formData.append(
                                    await send.resolve(environment, param.name, 'body'),
                                    file as File
                                )
                            }
                        }
                    }
                }
                body = formData
            }
        }

        if(request.body.mimeType === 'text/plain' || request.body.mimeType === 'application/json' || request.body.mimeType === 'application/graphql') {
            body = await send.resolve(environment, request.body.text ?? '', 'body')
        }

        if(request.body.mimeType === 'application/octet-stream' && request.body.fileName instanceof File) {
            body = request.body.fileName
        }
    }

    // the query text typed into the url is mirrored in the Query table, so the url is sent without it and the table rows
    // are added back below; a query string that an environment variable resolves to only exists after substitution,
    // so it is kept and the table rows go after it
    const requestUrl = request.url!
    const requestUrlWithoutQuery = request.parameters ? requestUrl.split('?')[0] : requestUrl

    const buildUrl = async(resolveText: (text: string) => Promise<string>) => {
        let urlWithEnvironmentVariablesSubstituted = await resolveText(requestUrlWithoutQuery)

        if(request.pathParameters) {
            for (const pathParameter of request.pathParameters.filter(item => !item.disabled)) {
                const paramName = await resolveText(pathParameter.name)
                const paramValue = await resolveText(pathParameter.value)

                urlWithEnvironmentVariablesSubstituted = urlWithEnvironmentVariablesSubstituted
                    .replaceAll(`:${paramName}`, paramValue)
                    .replaceAll(`{${paramName}}`, paramValue)
            }
        }

        const builtUrl = new URL(urlWithEnvironmentVariablesSubstituted)

        if(request.parameters) {
            const enabledParams = request.parameters.filter(item => !item.disabled)
            const queryParts: string[] = []

            // the rows hold the query text as typed in the url, so each part is decoded and encoded again: a space goes out
            // as %20 rather than the form encoding's +, which a signed url's exact text needs, and a typed + still goes out
            // as %2B, as it always did; a % that starts no escape is kept as typed instead of failing the send
            const encodeQueryPart = (text: string) => {
                try {
                    return encodeURIComponent(decodeURIComponent(text))
                } catch {
                    return encodeURIComponent(text)
                }
            }

            for (const param of enabledParams) {
                const paramName = await resolveText(param.name)
                const paramValue = await resolveText(param.value)

                queryParts.push(`${encodeQueryPart(paramName)}=${encodeQueryPart(paramValue)}`)
            }

            // appended as text instead of through url.searchParams, which would re-encode the query the variable resolved to
            if(enabledParams.length > 0) {
                builtUrl.search = builtUrl.search + (builtUrl.search ? '&' : '?') + queryParts.join('&')
            }
        }

        return builtUrl
    }

    const url = await send.resolveUrl(environment, buildUrl)

    const headers: Record<string, string | any> = {}

    // sets a header whatever case an earlier one of the same name was typed in, the header keeps its place and takes
    // the later spelling, as in Insomnia
    const setHeader = (headerName: string, headerValue: string, headerNameMasked = headerName, headerValueMasked = headerValue) => {
        const existingHeaderName = findHeaderName(headers, headerName)

        if(existingHeaderName !== undefined && existingHeaderName !== headerName) {
            for(const [name, value] of Object.entries(headers)) {
                delete headers[name]
                headers[name === existingHeaderName ? headerName : name] = value
            }
        }

        headers[headerName] = headerValue
        if(headersMasked) {
            if(existingHeaderName !== undefined) {
                headersMasked.delete(existingHeaderName)
            }
            headersMasked.set(headerName, [headerNameMasked, headerValueMasked])
        }
    }

    // sent as written, as they always were, apart from prompt tags
    if('GLOBAL_HEADERS' in environment) {
        for(const [name, value] of Object.entries(environment.GLOBAL_HEADERS)) {
            const header = typeof value === 'string' ? await send.resolveHeader(environment, name, [value], () => false, true) : null
            setHeader(header?.nameResolved ?? name, header?.valuesResolved[0] ?? value as string, header?.nameResolvedMasked ?? name, header?.valuesResolvedMasked[0] ?? value as string)
        }
    }

    if('headers' in request && request.headers !== undefined) {
        const enabledHeaders = request.headers.filter(header => !header.disabled)
        for(const header of enabledHeaders) {
            // a header without a name is not sent, nor content-type for multipart/form-data
            const resolvedHeader = await send.resolveHeader(environment, header.name, [header.value], headerName => headerName === '' || (body instanceof FormData && headerName.toLowerCase() === 'content-type'))

            if(resolvedHeader === null) {
                continue
            }

            const { nameResolved: headerName, valuesResolved: [headerValue] } = resolvedHeader

            const existingHeaderName = findHeaderName(headers, headerName)
            if(existingHeaderName !== undefined) {
                //allow multiple headers with the same name by concatenating the values with ", " | https://www.rfc-editor.org/rfc/rfc9110.html#section-5.2
                setHeader(headerName, `${headers[existingHeaderName]}, ${headerValue}`, resolvedHeader.nameResolvedMasked, `${headersMasked?.get(existingHeaderName)?.[1] ?? headers[existingHeaderName]}, ${resolvedHeader.valuesResolvedMasked[0]}`)
            } else {
                setHeader(headerName, headerValue, resolvedHeader.nameResolvedMasked, resolvedHeader.valuesResolvedMasked[0])
            }
        }
    }

    for(const [name, values] of Object.entries(parentHeaders)) {
        // the request's own header of the same name wins
        const parentHeader = await send.resolveHeader(environment, name, values, headerName => findHeaderName(headers, headerName) !== undefined)

        if(parentHeader !== null) {
            setHeader(parentHeader.nameResolved, parentHeader.valuesResolved.join(', '), parentHeader.nameResolvedMasked, parentHeader.valuesResolvedMasked.join(', '))
        }
    }

    const setAuthentication = async(authentication: RequestAuthentication) => {
        const existingHeaderName = findHeaderName(headers, 'Authorization')
        let authorizationMasked: string | undefined
        const authorization = await resolveAuthentication(send, authentication, environment, existingHeaderName ?? 'Authorization', headersMasked ? value => {
            authorizationMasked = value
        } : undefined)

        // a typed Authorization header and the Auth tab's are sent together, as the transports joined them when the
        // typed one was a separate lowercase key
        if(existingHeaderName !== undefined) {
            const headerMasked = headersMasked?.get(existingHeaderName)
            setHeader(existingHeaderName, `${headers[existingHeaderName]}, ${authorization}`, headerMasked?.[0] ?? existingHeaderName, authorizationMasked === '' ? '' : `${headerMasked?.[1] ?? headers[existingHeaderName]}, ${authorizationMasked ?? authorization}`)
        } else {
            headers['Authorization'] = authorization
            headersMasked?.set('Authorization', ['Authorization', authorizationMasked ?? String(authorization)])
        }
    }

    if(request.authentication && hasOwnAuthentication(request.authentication)) {
        await setAuthentication(request.authentication)
    } else if(getAuthenticationType(request.authentication) === 'inherit' && parentAuthentication && hasOwnAuthentication(parentAuthentication)) {
        await setAuthentication(parentAuthentication)
    }

    return {
        url,
        headers,
        body,
    }
}

// says what a masked prompt left out of a saved request and why, such as "Left out because a masked prompt was used
// there: the Authorization header and the body"
export function describeMaskedPromptOmitted(maskedPromptOmitted: MaskedPromptOmitted) {
    if(maskedPromptOmitted.reason === 'script-read') {
        return 'Left out because a script read a masked prompt: the URL (shown as written), the headers, the body and the test names and errors'
    }

    const parts = [
        ...(maskedPromptOmitted.url === 'masked' ? ['the masked values in the URL (shown as ******)'] : []),
        ...(maskedPromptOmitted.url === 'written' ? ['the URL (shown as written)'] : []),
        ...maskedPromptOmitted.headerNames.map(name => `the ${name} header`),
        ...(maskedPromptOmitted.body ? ['the body'] : []),
    ]

    return `Left out because a masked prompt was used there: ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join('')}`
}

function setDefaultUserAgent(headers: Record<string, string>) {
    const globalUserAgent = localStorage.getItem(constants.LOCAL_STORAGE_KEY.GLOBAL_USER_AGENT)

    const userAgentHeaderName = findHeaderName(headers, 'user-agent')

    if (userAgentHeaderName === undefined || !headers[userAgentHeaderName]) {
        headers[userAgentHeaderName ?? 'user-agent'] = globalUserAgent || `Restfox/${getVersion()}`
    }
}

// names the plugin and the line that failed, and the error it threw
function describePluginError(e: any, currentPlugin: string | null): { description: string, error: string } {
    if(e?.message === 'Unable to parse plugin') {
        return {
            description: `Error in Plugin "${currentPlugin}"${e.lineNumber !== '' ? ' at line number ' + e.lineNumber : ''}`,
            error: `${e.originalError.name}: ${e.originalError.message}`,
        }
    }

    return {
        description: `Error in Plugin "${currentPlugin}"`,
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    }
}

export async function handleRequest(
    request: CollectionItem,
    environment: any,
    parentHeaders: Record<string, string[]>,
    parentAuthentication: RequestAuthentication | undefined,
    setEnvironmentVariable: SetEnvironmentVariableFunction,
    plugins: Plugin[],
    workspaceLocation: string | null,
    abortControllerSignal: AbortSignal,
    flags: {
        electronSwitchToChromiumFetch: boolean,
        disableSSLVerification: boolean,
        requestTimeout?: number
    },
    onResponseProgress?: ResponseProgressHandler
) {
    const state: HandleRequestState = {
        currentPlugin: null,
        testResults: [],
    }

    // what a masked prompt left out of the saved copy is known once the request is prepared
    const send = new SendResolver(request.workspaceId)

    try {
        const { url, headers, body } = await createRequestData(state, request, environment, parentHeaders, parentAuthentication, setEnvironmentVariable, plugins, workspaceLocation, send)

        setDefaultUserAgent(headers)

        const response = await fetchWrapper(url, request.method!, headers, body, abortControllerSignal, flags, onResponseProgress)
        onResponseProgress?.({ type: 'end' })

        const headersToSave = JSON.parse(JSON.stringify(headers))
        const headersSent = response.requestHeadersSent ?? undefined

        // From: https://fetch.spec.whatwg.org/#forbidden-header-name
        const forbiddenHeaders = [
            'Accept-Charset',
            'Accept-Encoding',
            'Access-Control-Request-Headers',
            'Access-Control-Request-Method',
            'Connection',
            'Content-Length',
            'Cookie',
            'Cookie2',
            'Date',
            'DNT',
            'Expect',
            'Host',
            'Keep-Alive',
            'Origin',
            'Referer',
            'Set-Cookie',
            'TE',
            'Trailer',
            'Transfer-Encoding',
            'Upgrade',
            'Via',
        ]

        // a browser fetch drops these, so they are removed only when the configured headers stand in for the sent ones
        if(!headersSent) {
            forbiddenHeaders.forEach(forbiddenHeader => {
                const headerName = findHeaderName(headersToSave, forbiddenHeader)
                if(headerName !== undefined) {
                    delete headersToSave[headerName]
                }
            })
        }

        const originRequestBodyToSave = structuredClone(toRaw(request.body))

        let responseToSend: RequestFinalResponse = {
            _id: nanoid(),
            collectionId: request._id,
            url: url.origin + url.pathname,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            mimeType: response.mimeType,
            buffer: response.buffer,
            timeTaken: response.timeTaken,
            headTimeTaken: response.headTimeTaken,
            bodyTimeTaken: response.bodyTimeTaken,
            request: {
                method: request.method!,
                query: url.search,
                headers: headersToSave,
                headersSent,
                body: request.method !== 'GET' && request.body && request.body.mimeType === 'multipart/form-data' === false ? body : null,
                original: {
                    url: request.url,
                    body: originRequestBodyToSave
                } as CollectionItem
            },
            createdAt: new Date().getTime(),
            testResults: [],
        }

        if(request.parameters) {
            responseToSend.request.original.parameters = JSON.parse(JSON.stringify(request.parameters))
        }

        if(request.pathParameters) {
            responseToSend.request.original.pathParameters = JSON.parse(JSON.stringify(request.pathParameters))
        }

        if(request.headers) {
            responseToSend.request.original.headers = JSON.parse(JSON.stringify(request.headers))
        }

        if(request.authentication) {
            responseToSend.request.original.authentication = JSON.parse(JSON.stringify(request.authentication))
        }

        // only set on a body cut short, so a complete one is saved as before
        if(response.bodyIncomplete !== undefined) {
            responseToSend.bodyIncomplete = response.bodyIncomplete
        }

        // A body cut short runs the scripts only when it is a stream, where part of it is the point. Any other one skips
        // them, as when a body cut short was not kept, so no script sets a variable from half a body. A send a newer
        // Send replaced is thrown away, so its scripts must not set a variable the new send reads either
        const runsPostRequestScripts = responseToSend.bodyIncomplete === undefined
            || (!isSendReplaced(abortControllerSignal) && ['events', 'lines'].includes(getStreamView(getResponseContentType(responseToSend))))
        const postRequestPlugins = runsPostRequestScripts ? plugins : []

        for(const plugin of postRequestPlugins) {
            const { expose } = createResponseContextForPlugin(responseToSend, environment, setEnvironmentVariable, state.testResults, plugin.collectionId, send)

            state.currentPlugin = plugin.type === 'script' ? 'Script: Post Request' : `${plugin.name} (Post Request)`

            try {
                await usePlugin(expose, {
                    name: state.currentPlugin,
                    code: typeof plugin.code === 'object' ? plugin.code.post_request : plugin.code,
                    parentPathForReadFile: workspaceLocation,
                })

                responseToSend = { ...responseToSend, buffer: expose.context.response.getBody() }
            } catch(e: any) {
                // An endless stream only ends cut short, so scripts run on what arrived. One that fails on it, such as
                // by reading half a JSON body, keeps the received part and is reported as a failed test instead. The
                // scripts after it do not run, as after an error on a complete body
                if(responseToSend.bodyIncomplete === undefined) {
                    throw e
                }
                const pluginError = describePluginError(e, state.currentPlugin)
                console.error(`${pluginError.description}\n\n${pluginError.error}`)
                state.testResults.push({ description: pluginError.description, passed: false, error: pluginError.error })
                break
            }
        }

        responseToSend.testResults = state.testResults

        // after the scripts, which still read the resolved url
        return send.omitMaskedPromptParts(responseToSend, request)
    } catch(e: any) {
        // a cancel the user asked for is reported in the panel, every other failure also goes to Logs
        if(e?.name !== 'AbortError') {
            console.error(e)
        }

        let error = 'Error: Request failed'

        if(typeof e !== 'string')  {
            if(e.message.includes('Invalid URL')) {
                error = 'Error: Invalid URL'
            }

            if(e.name === 'TimeoutError') {
                error = 'Error: Request Timed Out'
            }

            if(e.name === 'AbortError') {
                error = 'Error: Request Cancelled'
            }

            if(e.message === 'Unable to parse plugin') {
                const pluginError = describePluginError(e, state.currentPlugin)
                error = `${pluginError.description}\n\n${pluginError.error}`
            }

            if(e.cause === 'display-error') {
                error = `Error: ${e.message}`
            }
        }

        return {
            status: null,
            statusText: 'Error',
            error
        }
    }
}

const GRAPHQL_SCHEMA_QUERY = '{ __schema { types { name kind description fields { name type { name kind } } } } }'

// asks the request's url for its schema with the request's query parameters, headers and auth, inherited ones
// included, through the transport Send uses, so it reaches whatever the request itself reaches. Scripts do not run
export async function fetchGraphQLSchema(
    request: CollectionItem,
    environment: any,
    parentHeaders: Record<string, string[]>,
    parentAuthentication: RequestAuthentication | undefined,
    abortControllerSignal: AbortSignal,
    flags: {
        electronSwitchToChromiumFetch: boolean,
        disableSSLVerification: boolean,
        requestTimeout?: number
    }
) {
    const state: HandleRequestState = {
        currentPlugin: null,
        testResults: [],
    }

    const { url, headers } = await createRequestData(state, { ...request, body: undefined }, environment, parentHeaders, parentAuthentication, null, [], null)

    setDefaultUserAgent(headers)

    if(findHeaderName(headers, 'content-type') === undefined) {
        headers['Content-Type'] = 'application/json'
    }

    const response = await fetchWrapper(url, 'POST', headers, JSON.stringify({ query: GRAPHQL_SCHEMA_QUERY }), abortControllerSignal, flags)

    let result: any = null

    try {
        result = JSON.parse(new TextDecoder().decode(response.buffer))
    } catch {}

    if(Array.isArray(result?.errors) && result.errors.length > 0) {
        throw new Error(result.errors.map((error: any) => error.message).join('\n'))
    }

    if(response.status < 200 || response.status > 299) {
        throw new Error(`${response.status} ${response.statusText}`.trim())
    }

    if(!Array.isArray(result?.data?.__schema?.types)) {
        throw new Error('The response has no schema')
    }

    return result.data.__schema.types
}

function convertInsomniaAuthToRestfoxAuth(insomniaAuthentication: any): RequestAuthentication {
    if(!insomniaAuthentication || Object.keys(insomniaAuthentication).length === 0) {
        return { type: INHERITED_AUTHENTICATION_TYPE }
    }

    if(insomniaAuthentication.type === 'oauth2') {
        // Insomnia names these OAuth 2.0 fields differently, see AuthTypeOAuth2 in Insomnia's packages/insomnia-data/src/models/request.ts
        const { redirectUrl, code, usePkce, tokenPrefix, accessToken, credentialsInBody, ...authentication } = insomniaAuthentication
        const renamedFields: [string, keyof RequestAuthentication, unknown][] = [
            ['redirectUrl', 'redirectUri', redirectUrl],
            ['code', 'authorizationCode', code],
            ['usePkce', 'usePKCE', usePkce],
            ['tokenPrefix', 'prefix', tokenPrefix],
            ['accessToken', 'token', accessToken],
        ]

        for(const [, restfoxKey, value] of renamedFields) {
            if(value !== undefined && value !== '' && authentication[restfoxKey] === undefined) {
                authentication[restfoxKey] = value
            }
        }

        // Insomnia sends the OAuth 2.0 client credentials in the Basic Authorization header unless credentialsInBody is set
        if(authentication.clientAuthentication === undefined) {
            authentication.clientAuthentication = credentialsInBody ? 'body' : 'header'
        }

        return authentication
    }

    return insomniaAuthentication
}

function convertInsomniaHeaders(headers: any[] | undefined): RequestParam[] {
    return (headers ?? []).map((header: RequestParam) => ({
        name: header.name,
        value: header.value,
        description: header.description,
        disabled: header.disabled
    }))
}

// Insomnia 11 and later export v5 YAML, a nested tree of folders and requests. This flattens it into the v4 resources
// list the importer reads, the way Insomnia's own importer does, see getCollection in packages/insomnia/src/common/insomnia-v5.ts
function convertInsomniaV5ToV4Resources(file: any): any[] {
    const workspaceId = file.meta?.id ?? nanoid()
    const resources: any[] = [{ _id: workspaceId, _type: 'workspace', parentId: null, name: file.name, description: file.meta?.description }]

    const walk = (items: any[] | undefined, parentId: string) => {
        for(const item of items ?? []) {
            const _id = item.meta?.id ?? nanoid()
            const common = { _id, parentId, name: item.name, description: item.meta?.description }
            const isFolder = !('method' in item) && !('url' in item) && !('reflectionApi' in item)

            if(isFolder) {
                resources.push({ ...common, _type: 'request_group', headers: item.headers, authentication: item.authentication, environment: item.environment })
                walk(item.children, _id)
            } else if('method' in item) {
                resources.push({ ...common, _type: 'request', url: item.url, method: item.method, body: item.body ?? {}, parameters: item.parameters, headers: item.headers, authentication: item.authentication, pathParameters: item.pathParameters })
            } else if('reflectionApi' in item) {
                // v5 leaves the proto files out, so the protoFileId names none in the file and the request uses server
                // reflection until files are added
                resources.push({ ...common, _type: 'grpc_request', url: item.url, protoFileId: item.protoFileId, protoMethodName: item.protoMethodName, metadata: item.metadata, body: item.body })
            }
            // WebSocket and Socket.IO requests have nothing the importer maps them to and are left out
        }
    }

    walk(file.collection, workspaceId)

    return resources
}

// The files a gRPC request's proto file is compiled with. Insomnia keeps a proto file on its own or in a folder tree it
// imported whole, which it writes out with the top folder as the root, so a path leaves that folder's name out. The
// request's file comes first
function getInsomniaProtoFiles(resources: any[], protoFileId: string | undefined): GrpcProtoFile[] {
    const protoFile = resources.find(resource => resource._type === 'proto_file' && resource._id === protoFileId)

    if(!protoFile) {
        return []
    }

    const protoDirectories = new Map<string, any>(resources.filter(resource => resource._type === 'proto_directory').map(resource => [resource._id, resource]))

    // the folders from the top one down to the file's
    const getDirectories = (resource: any) => {
        const directories: any[] = []
        for(let directory = protoDirectories.get(resource.parentId); directory; directory = protoDirectories.get(directory.parentId)) {
            directories.unshift(directory)
        }
        return directories
    }

    const getPath = (resource: any) => [...getDirectories(resource).slice(1).map(directory => directory.name), resource.name].join('/')

    const rootDirectory = getDirectories(protoFile)[0]

    if(!rootDirectory) {
        return [{ path: protoFile.name, text: protoFile.protoText ?? '' }]
    }

    const otherFiles = resources.filter(resource => resource._type === 'proto_file' && resource !== protoFile && getDirectories(resource)[0] === rootDirectory)

    return [protoFile, ...otherFiles].map(resource => ({ path: getPath(resource), text: resource.protoText ?? '' }))
}

const URL_SCHEME_REGEX = /^[a-z][a-z0-9+.-]*:\/\//i

// Insomnia uses TLS for a gRPC address only when it starts with grpcs://, and port 443 when it names none. Restfox also
// uses TLS for https:// and for an address with no scheme whose host is not loopback, such as 0.0.0.0:50051, and port
// 80 without TLS, so such an address gets grpc:// and a plaintext one with no port gets :443. One that starts with a
// variable is left as it is, as its value is set in Restfox, where the scheme and port can go too
function convertInsomniaGrpcUrl(url: string) {
    const address = url.trim()
    if(address === '' || /^{[{%]/.test(address) || /^grpcs:\/\//i.test(address)) {
        return url
    }
    // a variable or tag further on, such as the port, stands in as a number, which leaves the scheme and host as typed
    const target = parseGrpcTarget(address.replace(/{{[^{}]*}}|{%[^{}]*%}/g, '1'))
    if(!isGrpcTarget(target)) {
        return url
    }
    const rest = address.replace(URL_SCHEME_REGEX, '')
    const hostAndPort = rest.split('/')[0]
    const hasPort = /:[^:\]]+$/.test(hostAndPort)
    // a variable in the host may hold the port too
    if((hasPort && !target.tls) || (!hasPort && /{[{%]/.test(hostAndPort))) {
        return url
    }
    return `grpc://${hasPort ? rest : `${hostAndPort}:443${rest.slice(hostAndPort.length)}`}`
}

// Insomnia sends a gRPC request with its own metadata only, no folder auth, so the item stores None for auth. Its
// folders' headers are kept on the folders for their HTTP requests, and Restfox sends them with the gRPC item too
function convertInsomniaGrpcRequest(item: any, resources: any[]): Omit<CollectionItem, 'parentId' | 'workspaceId'> {
    const grpc: GrpcSettings = {}

    // such as /demo.v1.Greeter/SayHello, or /Greeter/SayHello for a proto file without a package
    const methodPath = /^\/?([^/]+)\/([^/]+)$/.exec(item.protoMethodName ?? '')
    if(methodPath) {
        grpc.service = methodPath[1]
        grpc.method = methodPath[2]
    }

    const protoFiles = getInsomniaProtoFiles(resources, item.protoFileId)
    if(protoFiles.length > 0) {
        grpc.protoFiles = protoFiles
    }

    return {
        _id: item._id,
        _type: 'grpc',
        name: item.name,
        url: convertInsomniaGrpcUrl(item.url ?? ''),
        grpc,
        ...(typeof item.body?.text === 'string' ? { body: { mimeType: 'application/json', text: item.body.text } } : {}),
        headers: convertInsomniaHeaders(item.metadata),
        authentication: { type: 'none' },
        description: item.description || undefined,
    }
}

// a gRPC message as Insomnia writes it, for the method of the .proto files, in ProtoJSON, as the gRPC engine rewrites it
export type InsomniaGrpcMessageConverter = (spec: { protoFiles: GrpcProtoFile[], service: string, method: string, text: string }) => Promise<string>

// Insomnia writes some values of a gRPC message in another form than ProtoJSON, which Restfox sends, such as a BoolValue
// as {"value": true}. convertGrpcMessage rewrites them from the request's .proto files. Without them, or where the
// builds cannot run gRPC, the message is kept as written
async function convertInsomniaGrpcMessages(collection: CollectionItem[], convertGrpcMessage: InsomniaGrpcMessageConverter) {
    for(const item of flattenTree(collection) as CollectionItem[]) {
        const { protoFiles, service, method } = item.grpc ?? {}
        if(item._type !== 'grpc' || !protoFiles?.length || !service || !method || typeof item.body?.text !== 'string') {
            continue
        }
        try {
            item.body.text = await convertGrpcMessage({ protoFiles, service, method, text: item.body.text })
        } catch(error) {
            console.warn(`${item.name}: its message is kept as Insomnia wrote it, as it could not be read with its .proto files: ${error instanceof Error ? error.message : String(error)}`)
        }
    }
}

// the Import dialog hands over a parsed .json file as an object and any other file as the File itself
export async function convertInsomniaFileToRestfoxCollection(file: any, workspaceId: string, convertGrpcMessage: InsomniaGrpcMessageConverter | null = null) {
    let data = file

    if(typeof file?.text === 'function') {
        // YAML is a superset of JSON, so this reads v4 JSON and YAML exports and v5 YAML exports alike
        data = yaml.load(await file.text())
    }

    if(typeof data?.type === 'string' && (data.type.startsWith('collection.insomnia.rest/5') || data.type.startsWith('spec.insomnia.rest/5'))) {
        data = { resources: convertInsomniaV5ToV4Resources(data) }
    }

    if(!Array.isArray(data?.resources)) {
        throw new Error('Not an Insomnia export: expected an Insomnia collection or design document export')
    }

    const collection = convertInsomniaExportToRestfoxCollection(data, workspaceId)

    if(convertGrpcMessage !== null) {
        await convertInsomniaGrpcMessages(collection, convertGrpcMessage)
    }

    return collection
}

export function convertInsomniaExportToRestfoxCollection(json: any, workspaceId: string) {
    const collection: CollectionItem[] = []

    const workspace = json.resources.find((item: any) => item._type === 'workspace')

    // other resource types, such as environments or WebSocket requests, have nothing here they map to
    json.resources.filter((item: any) => ['workspace', 'request_group', 'request', 'grpc_request'].includes(item._type)).forEach((item: any) => {
        if(item._type === 'grpc_request') {
            collection.push({
                ...convertInsomniaGrpcRequest(item, json.resources),
                parentId: item.parentId === '__WORKSPACE_ID__' && !workspace ? null : item.parentId,
                workspaceId
            })
        } else if(item._type === 'workspace' || item._type === 'request_group') {
            let parentId = item.parentId

            if(item.parentId === '__WORKSPACE_ID__' && !workspace) {
                parentId = null
            }

            collection.push({
                _id: item._id,
                _type: 'request_group',
                name: item.name,
                environment: item.environment,
                headers: convertInsomniaHeaders(item.headers),
                authentication: convertInsomniaAuthToRestfoxAuth(item.authentication),
                description: item.description || undefined,
                parentId,
                workspaceId
            })
        } else {
            let body: any = {
                mimeType: 'No Body'
            }

            if(item.body.mimeType === 'application/x-www-form-urlencoded' || item.body.mimeType === 'multipart/form-data') {
                body = {
                    mimeType: item.body.mimeType,
                    params: 'params' in item.body ? item.body.params.map((parameter: RequestParam) => ({
                        name: parameter.name,
                        value: parameter.value,
                        description: parameter.description,
                        disabled: parameter.disabled
                    })) : []
                }

                if (item.body.mimeType === 'multipart/form-data') {
                    body.params.forEach((param: RequestParam) => {
                        param.type = 'text'
                    })
                }
            }

            if(item.body.mimeType === 'text/plain' || item.body.mimeType === 'application/json' || item.body.mimeType === 'application/graphql') {
                body = {
                    mimeType: item.body.mimeType,
                    text: item.body.text
                }
            }

            let parentId = item.parentId

            if(item.parentId === '__WORKSPACE_ID__' && !workspace) {
                parentId = null
            }

            collection.push({
                _id: item._id,
                _type: item._type,
                name: item.name,
                url: item.url,
                method: item.method,
                body: body,
                headers: item.headers ? item.headers.map((header: RequestParam) => ({
                    name: header.name,
                    value: header.value,
                    description: header.description,
                    disabled: header.disabled
                })) : [],
                parameters: item.parameters ? item.parameters.map((parameter: RequestParam) => ({
                    name: parameter.name,
                    value: parameter.value,
                    description: parameter.description,
                    disabled: parameter.disabled
                })) : [],
                pathParameters: item.pathParameters ?? [],
                authentication: convertInsomniaAuthToRestfoxAuth(item.authentication),
                description: 'description' in item ? item.description : undefined,
                parentId,
                workspaceId
            })
        }
    })

    return toTree(collection)
}

function importRestfoxV1(collections: CollectionItem[], workspaceId: string, workspacePlugins: Plugin[] = []) {
    const collection: CollectionItem[] = []
    // scripts belong to the workspace they are imported into, whatever workspace they were exported from
    const plugins: Plugin[] = workspacePlugins.map(plugin => ({ ...plugin, workspaceId, collectionId: null }))

    collections.forEach(item => {
        if(item._type === 'request_group') {
            collection.push({
                _id: item._id,
                _type: 'request_group',
                name: item.name,
                environment: item.environment,
                environments: item.environments,
                currentEnvironment: item.currentEnvironment,
                headers: item.headers,
                authentication: item.authentication,
                description: item.description,
                parentId: item.parentId,
                workspaceId,
                sortOrder: item.sortOrder
            })
        } else {
            // every item but an HTTP request is kept whole, a type only a newer version knows too, so its own data is
            // there when a version that knows it opens it
            if(item._type !== 'request' && item._type !== undefined) {
                collection.push({
                    ...item,
                    workspaceId,
                })
            } else {
                collection.push({
                    _id: item._id,
                    _type: item._type,
                    name: item.name,
                    url: item.url,
                    method: item.method,
                    body: item.body,
                    headers: item.headers ? item.headers.map(header => ({
                        name: header.name,
                        value: header.value,
                        description: header.description,
                        disabled: header.disabled
                    })) : [],
                    parameters: item.parameters ? item.parameters.map(parameter => ({
                        name: parameter.name,
                        value: parameter.value,
                        description: parameter.description,
                        disabled: parameter.disabled
                    })) : [],
                    pathParameters: item.pathParameters ? item.pathParameters.map(parameter => ({
                        name: parameter.name,
                        value: parameter.value,
                        description: parameter.description,
                        disabled: parameter.disabled
                    })) : [],
                    authentication: item.authentication && Object.keys(item.authentication).length > 0 ? item.authentication : { type: INHERITED_AUTHENTICATION_TYPE },
                    description: item.description,
                    parentId: item.parentId,
                    workspaceId,
                    sortOrder: item.sortOrder
                })
            }
        }

        if(item.plugins) {
            plugins.push(...item.plugins.map((plugin: Plugin) => ({ ...plugin, workspaceId })))
        }
    })

    const collectionTree = toTree(collection)
    sortTree(collectionTree)

    return {
        newCollectionTree: collectionTree,
        newPlugins: plugins
    }
}

export function convertRestfoxExportToRestfoxCollection(json: any, workspaceId: string) {
    if('exportedFrom' in json) {
        if(json.exportedFrom === 'Restfox-1.0.0') {
            return importRestfoxV1(json.collection, workspaceId, json.plugins ?? [])
        }
    }

    throw new Error('Invalid Restfox Export')
}

export function extractPathParameters(openapiSchema: string) {
    const apiSchema = yaml.load(openapiSchema) as OpenApiSpecPathParams
    const pathParams: {
        [x: string]: {
            name: string;
            value: string;
        }[];
    } = {}
    Object.entries(apiSchema.paths).forEach((path) => {
        Object.entries(path[1]).forEach(method => {
            method[1]?.parameters?.forEach(param => {
                if (param.in === 'path') {
                    if (pathParams[path[0] + '-' + [method[0].toLowerCase()]]?.length > 0) {
                        pathParams[path[0] + '-' + [method[0].toLowerCase()]].push({
                            name: param.name,
                            value: param.schema?.example ?? '',
                        })
                    } else {
                        pathParams[path[0] + '-' + [method[0].toLowerCase()]] = [{
                            name: param.name,
                            value:  param.schema?.example ?? '',
                        }]
                    }
                }
            })
        })
    })
    return pathParams
}

export async function convertOpenAPIExportToRestfoxCollection(exportString: string, workspaceId: string) {
    const { convert: insomniaImporter } = await import('insomnia-importers-browser')
    const initExport = await insomniaImporter(
        exportString.replace(/\/{([^}]+)}/g, '/:$1:')
    )
    const pathParams = extractPathParameters(exportString)
    initExport.data.resources = initExport.data.resources.map((item:{[x:string]:any}) => {
        if (item.url) {
            item['url'] = item.url.replace(/\/:([^:]+):/g, '/{$1}')
            item['pathParameters'] = pathParams[item['url'].replace(/{{ base_url }}/, '') + '-' + item['method'].toLowerCase()] ?? []
        }
        return item
    })

    return convertInsomniaExportToRestfoxCollection(initExport.data, workspaceId)
}

export async function convertCurlCommandToRestfoxCollection(curlCommand: string, workspaceId: string) {
    const insomniaExport: any = curlConvert(curlCommand)

    if(insomniaExport === null) {
        throw new Error('Invalid Curl Command')
    }

    if('body' in insomniaExport[0]) {
        if('text' in insomniaExport[0].body) {
            if (insomniaExport[0].body.mimeType !== constants.MIME_TYPE.GRAPHQL) {
                // for some reason we get \\n instead of \n in the text field
                insomniaExport[0].body.text = insomniaExport[0].body.text.replaceAll('\\n', '\n')
            } else {
                const parsedBody = JSON.parse(insomniaExport[0].body.text)
                parsedBody.query = parsedBody.query.replaceAll('\\n', '\n')
                insomniaExport[0].body.text = JSON.stringify(parsedBody)
            }
        }
    }
    return convertInsomniaExportToRestfoxCollection({ resources: insomniaExport }, workspaceId)
}

// From: https://stackoverflow.com/a/66387148/4932305
export async function fileToJSON(file: File) {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader()
        fileReader.onload = (event: ProgressEvent<FileReader>) => {
            if (event.target) {
                try {
                    resolve(JSON.parse(event.target.result as string))
                } catch(e) {
                    reject(e)
                }
            } else {
                reject(new Error('Failed to read file'))
            }
        }
        fileReader.onerror = error => reject(error)
        fileReader.readAsText(file)
    })
}

export async function fileToString(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader()
        fileReader.onload = (event: ProgressEvent<FileReader>) => {
            if (event.target) {
                resolve(event.target.result as string)
            } else {
                reject(new Error('Failed to read file'))
            }
        }
        fileReader.onerror = error => reject(error)
        fileReader.readAsText(file)
    })
}

// From: https://stackoverflow.com/a/57218589/4932305 but modified to return children on parent matches
export function filterTree(array: CollectionItem[], name: string) {
    return array.reduce((r: any[], { children = [], ...o }) => {
        if(o.name.toLowerCase().includes(name.toLowerCase())) {
            r.push(Object.assign(o, { children }))
            return r
        }
        children = filterTree(children, name)
        if(children.length) {
            r.push(Object.assign(o, { children }))
        }
        return r
    }, [])
}

export function addSortOrderToTree(array: CollectionItem[]) {
    array.forEach((item, index) => {
        item.sortOrder = index
        if(item.children) {
            addSortOrderToTree(item.children)
        }
    })
}

export function sortTree(array: CollectionItem[]) {
    array.sort((a, b) => a.sortOrder! - b.sortOrder!)
    array.forEach(item => {
        if(item.children) {
            sortTree(item.children)
        }
    })
}

export function removeFromTree(array: any[], key: string, keyValue: string): boolean {
    const index = array.findIndex(x => x[key] === keyValue)
    if (index > -1) {
        array.splice(index, 1)
        return true
    } else {
        return array.some(item => {
            if (item.children) {
                return removeFromTree(item.children, key, keyValue)
            } else {
                return false
            }
        })
    }
}

// From: https://stackoverflow.com/a/34720792/4932305
// Note: the final array includes the initially passed id as well
export function getChildIds(arr: any[], id: string) {
    const ret: any[] = []
    for (let i = 0; i < arr.length; i++) {
        const item = arr[i]
        if (item.parentId == id || item._id == id) {
            if (ret.indexOf(item._id) < 0) {
                ret.push(item._id)
                const newret: any[] = []
                for (let x = 0; x < arr.length; x++) {
                    if (x != i) {
                        newret.push(arr[x])
                    }
                }
                const children = getChildIds(newret, item._id)
                if (children.length > 0) {
                    for (let j = 0; j < children.length; j++) {
                        if (!(ret.indexOf(children[j]) >= 0)) {
                            ret.push(children[j])
                        }
                    }
                }
            }

        }
    }
    return ret
}

export function findItemInTreeById(array: CollectionItem[], id: string): CollectionItem | null {
    let result = null
    function findItemInTreeByIdRecurse(array2: CollectionItem[], id2: string) {
        for(let i = 0; i < array2.length; i++) {
            if(array2[i]._id === id2) {
                result = array2[i]
            }

            if('children' in array2[i]) {
                findItemInTreeByIdRecurse(array2[i].children as CollectionItem[], id2)
            }
        }
    }
    findItemInTreeByIdRecurse(array, id)
    return result
}

export function generateNewIdsForTreeItemChildren(treeItem: CollectionItem, oldIdNewIdMapping: Record<string, string> | null = null) {
    const parentId = treeItem._id
    treeItem.children?.forEach(item => {
        const newId = nanoid()
        if(oldIdNewIdMapping !== null) {
            oldIdNewIdMapping[item._id] = newId
        }
        item._id = newId
        item.parentId = parentId
        if('children' in item) {
            generateNewIdsForTreeItemChildren(item, oldIdNewIdMapping)
        }
    })
}

export function generateNewIdsForTree(array: CollectionItem[]) {
    const oldIdNewIdMapping: Record<string, string> = {}

    array.forEach(treeItem => {
        const newId = nanoid()
        oldIdNewIdMapping[treeItem._id] = newId
        treeItem._id = newId
        if('children' in treeItem) {
            treeItem.children?.forEach(item => {
                const newId = nanoid()
                oldIdNewIdMapping[item._id] = newId
                item._id = newId
                item.parentId = treeItem._id
                if('children' in item) {
                    generateNewIdsForTreeItemChildren(item, oldIdNewIdMapping)
                }
            })
        }
    })

    return oldIdNewIdMapping
}

// From: https://stackoverflow.com/a/6470794/4932305
export function arrayMove(array: any[], fromIndex: number, toIndex: number) {
    const element = array[fromIndex]
    array.splice(fromIndex, 1)
    array.splice(toIndex, 0, element)
}

// From: https://stackoverflow.com/a/65939108/4932305
export function downloadObjectAsJSON(filename: string, dataObjToWrite: any) {
    const blob = new Blob([JSON.stringify(dataObjToWrite)], { type: 'text/json' })
    const link = document.createElement('a')

    link.download = filename
    link.href = window.URL.createObjectURL(blob)
    link.dataset.downloadurl = ['text/json', link.download, link.href].join(':')

    const event = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
    })

    link.dispatchEvent(event)
    link.remove()
}

export function todayISODate() {
    return dayjs().format('YYYY-MM-DD')
}

// From: https://stackoverflow.com/a/46800515/4932305
export function isFirstIdIndirectOrDirectParentOfSecondIdInTree(array: any, firstId: any, secondId: any) {
    let result = false

    function f(data: any, a: any, b: any, p = false) {
        if (Array.isArray(data)) {
            data.forEach(function(o) {
                if(p && a == o._id) {
                    result = true
                } else {
                    if('children' in o) {
                        f(o.children, a, b, !p ? b == o._id : p)
                    }
                }
            })
        } else {
            if('children' in data) {
                f(data.children, a, b, p)
            }
        }
    }

    f(array, secondId, firstId)

    return result
}

export function dateFormat(date: number, includeSeconds = false) {
    let format = 'DD-MMM-YY hh:mm A'

    if(includeSeconds) {
        format = 'DD-MMM-YY hh:mm:ss A'
    }

    return dayjs(date).format(format)
}

// From: https://github.com/Kong/insomnia/blob/e5b6f9034e34afc06def38c9d6a79a978fb19bb2/packages/insomnia-app/app/ui/components/tags/time-tag.tsx
export function humanFriendlyTime(milliseconds: number) {
    let unit = 'ms'
    let number = milliseconds

    if (milliseconds > 1000 * 60) {
        unit = 'm'
        number = milliseconds / 1000 / 60
    } else if (milliseconds > 1000) {
        unit = 's'
        number = milliseconds / 1000
    }

    // Round to 0, 1, 2 decimal places depending on how big the number is
    if (number > 100) {
        number = Math.round(number)
    } else if (number > 10) {
        number = Math.round(number * 10) / 10
    } else {
        number = Math.round(number * 100) / 100
    }

    return `${number} ${unit}`
}

// A time that is still counting, as humanFriendlyTime shows it once it stops, rounded down to a tenth of a second, so
// each tick moves it by a tenth whenever the tick lands
export function humanFriendlyRunningTime(milliseconds: number) {
    return humanFriendlyTime(Math.floor(milliseconds / 100) * 100)
}

export function getObjectPaths(object: object): string[] {
    const paths: any[] = []

    function recurse(obj: any, keyParent = '') {
        if(typeof obj === 'number' || typeof obj === 'string' || obj === null) {
            return
        }
        const isArray = Array.isArray(obj)
        Object.keys(obj).forEach(key => {
            let newKeyParent = keyParent
            if(newKeyParent) {
                if(isArray) {
                    newKeyParent = `${newKeyParent}[${key}]`
                } else {
                    newKeyParent = `${newKeyParent}.${key}`
                }
            } else {
                newKeyParent = key
            }
            paths.push(newKeyParent)
            recurse(obj[key], newKeyParent)
        })
    }

    recurse(object)

    return paths
}

// the items with their scripts attached for an export, ids regenerated when asked so the file paths a file workspace
// uses as ids do not leak, with the scripts following their item through the regeneration
export function prepareCollectionForExport(collectionItems: CollectionItem[], plugins: Plugin[], regenerateIds: boolean): CollectionItem[] {
    let collection: CollectionItem[] = deepClone(collectionItems)

    for(const item of collection) {
        item.plugins = deepClone(plugins.filter(plugin => plugin.collectionId === item._id))
    }

    if(regenerateIds) {
        const collectionTree = toTree(collection)
        const oldIdNewIdMapping = generateNewIdsForTree(collectionTree)
        collection = flattenTree(collectionTree)

        for(const item of collection) {
            for(const plugin of item.plugins) {
                plugin.collectionId = oldIdNewIdMapping[plugin.collectionId]
            }
        }
    }

    return collection
}

// plugins are the workspace-level scripts, the scripts of an item travel on the item itself
export function exportRestfoxCollection(collection: CollectionItem[], environments = undefined, plugins: Plugin[] | undefined = undefined) {
    downloadObjectAsJSON(`Restfox_${todayISODate()}.json`, {
        exportedFrom: 'Restfox-1.0.0',
        collection,
        environments,
        plugins,
    })
}

export function exportCollection(collection: any, appName: 'Postman' | 'Insomnia') {
    downloadObjectAsJSON(`${appName}_${todayISODate()}.json`, collection)
}

// From: https://github.com/Kong/insomnia/blob/fac2627d695a10865d0f7f9ea7b2c04a77d92194/packages/insomnia/src/common/misc.ts#L169-L192
export function humanFriendlySize(bytes: number, long = false) {
    bytes = Math.round(bytes * 10) / 10
    let size
    // NOTE: We multiply these by 2 so we don't end up with
    // values like 0 GB
    let unit

    if (bytes < 1024 * 2) {
        size = bytes
        unit = long ? 'bytes' : 'B'
    } else if (bytes < 1024 * 1024 * 2) {
        size = bytes / 1024
        unit = long ? 'kilobytes' : 'KB'
    } else if (bytes < 1024 * 1024 * 1024 * 2) {
        size = bytes / 1024 / 1024
        unit = long ? 'megabytes' : 'MB'
    } else {
        size = bytes / 1024 / 1024 / 1024
        unit = long ? 'gigabytes' : 'GB'
    }

    const rounded = Math.round(size * 10) / 10
    return `${rounded} ${unit}`
}

export function checkHotkeyAgainstKeyEvent(hotkey: string, event: KeyboardEvent) {
    const keys: string[] = hotkey.split(' + ')
    const ctrlKeyRequired: boolean = keys.includes('Ctrl')
    const altKeyRequired: boolean = keys.includes('Alt')
    const shiftKeyRequired: boolean = keys.includes('Shift')
    const requiredKey = keys.filter(key => !['Ctrl', 'Alt', 'Shift'].includes(key)).pop()

    let hotkeyMatched = true

    if(ctrlKeyRequired) {
        if(!event.ctrlKey) {
            hotkeyMatched = false
        }
    } else {
        if(event.ctrlKey) {
            hotkeyMatched = false
        }
    }

    if(altKeyRequired) {
        if(!event.altKey) {
            hotkeyMatched = false
        }
    } else {
        if(event.altKey) {
            hotkeyMatched = false
        }
    }

    if(shiftKeyRequired) {
        if(!event.shiftKey) {
            hotkeyMatched = false
        }
    } else {
        if(event.shiftKey) {
            hotkeyMatched = false
        }
    }

    if(event.key.toLowerCase() !== requiredKey?.toLowerCase()) {
        hotkeyMatched = false
    }

    return hotkeyMatched
}

// accepts the same paths as the lodash.get used for reading ('a.b', 'a[0].b', 'a["b.c"]') and creates the
// missing levels on the way, an array when the next key is an index, but never touches the prototype chain
export function setObjectPathValue(object: any, path: string, value: any) {
    const keys = (path.match(/[^.[\]]+|\[(?:"[^"]*"|'[^']*'|[^\]]*)\]/g) ?? ['']).map(key => {
        return key.startsWith('[') ? key.slice(1, -1).replace(/^(["'])(.*)\1$/, '$2') : key
    })

    if(keys.some(key => key === '__proto__' || key === 'constructor' || key === 'prototype')) {
        console.warn(`setObjectPathValue: refusing to set "${path}"`)
        return
    }

    let current = object

    keys.forEach((key, index) => {
        if(index === keys.length - 1) {
            current[key] = value
            return
        }

        if(typeof current[key] !== 'object' || current[key] === null) {
            current[key] = /^\d+$/.test(keys[index + 1]) ? [] : {}
        }

        current = current[key]
    })
}

export function applyTheme(themeName: 'light' | 'dark' | 'dracula', doc: Document = document) {
    doc.documentElement.className = `theme-${themeName}`
}

export function codeMirrorSyntaxHighlighting() {
    const highlightStyle = HighlightStyle.define([
        {
            tag: tags.string,
            class: 'cm-string'
        },
        {
            tag: tags.number,
            class: 'cm-number'
        },
        {
            tag: tags.bool,
            class: 'cm-boolean'
        },
        {
            tag: tags.null,
            class: 'cm-null'
        },
        {
            tag: tags.propertyName,
            class: 'cm-property'
        },
        {
            tag: tags.comment,
            class: 'cm-comment'
        },
        {
            tag: tags.keyword,
            class: 'cm-keyword'
        },
        {
            tag: tags.definition(tags.variableName),
            class: 'cm-variable'
        },
    ])

    return highlightStyle
}

export function downloadBlob(filename: string, blob: Blob) {
    const link = document.createElement('a')

    link.download = filename
    link.href = window.URL.createObjectURL(blob)

    const event = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
    })

    link.dispatchEvent(event)
    link.remove()
}

export function parseContentDispositionHeaderAndGetFileName(headerValue: string, fallbackFileName: string) {
    const filenameItem = headerValue.split(';').map(item => item.trim()).find(item => item.startsWith('filename='))
    if (filenameItem) {
        let fileNameToReturn = filenameItem.split('=')[1]
        if (fileNameToReturn.startsWith('"') && fileNameToReturn.endsWith('"')) {
            fileNameToReturn = fileNameToReturn.slice(1, -1)
        }
        return fileNameToReturn
    }
    return fallbackFileName
}

export function formatTimestamp(epoch: number) {
    return dayjs(epoch).format('YYYY-MM-DD hh:mm:ss A')
}

export function generateId() {
    return nanoid()
}

export function setEnvironmentVariable(store: ActionContext<State, State>, objectPath: string, value: string, save = true) {
    try {
        if(store.state.activeWorkspace === null) {
            throw new Error('activeWorkspace is null')
        }

        const environmentToModify = store.state.activeWorkspace.environment ?? {}
        const environmentsToModify = store.state.activeWorkspace.environments ?? [
            {
                name: constants.DEFAULT_ENVIRONMENT.name,
                environment: {},
                color: constants.DEFAULT_ENVIRONMENT.color
            }
        ]
        setObjectPathValue(environmentToModify, objectPath, value)
        store.state.activeWorkspace.environment = environmentToModify
        if(save) {
            store.commit('updateWorkspaceEnvironment',  {
                workspaceId: store.state.activeWorkspace._id,
                environment: environmentToModify
            })
        }
        const currentEnvironment = environmentsToModify.find(environmentItem => environmentItem.name === (store.state.activeWorkspace!.currentEnvironment ?? 'Default'))
        currentEnvironment.environment = environmentToModify
        if(save) {
            store.commit('updateWorkspaceEnvironments',  {
                workspaceId: store.state.activeWorkspace._id,
                environments: environmentsToModify
            })
        }
    } catch(e) {
        console.error('Failed to set environment variable:')
        console.error(e)
    }
}

export function setParentEnvironmentVariable(store: ActionContext<State, State>, objectPath: string, value: string, currentCollectionItem: CollectionItem, save = true) {
    try {
        if(store.state.activeWorkspace === null) {
            throw new Error('activeWorkspace is null')
        }

        // Find the target folder (parent folder of the current item)
        let targetFolderId: string | null = null

        if(currentCollectionItem.parentId) {
            // If it has a parent, use the parent folder (works for both requests and folders)
            targetFolderId = currentCollectionItem.parentId
        } else {
            // If there's no parent, fall back to global environment
            setEnvironmentVariable(store, objectPath, value, save)
            return
        }

        const targetFolder = findItemInTreeById(store.state.collectionTree, targetFolderId)

        if(!targetFolder || targetFolder._type !== 'request_group') {
            // If folder not found, fall back to global environment
            setEnvironmentVariable(store, objectPath, value, save)
            return
        }

        const folderEnvironment = targetFolder.environment ?? {}
        setObjectPathValue(folderEnvironment, objectPath, value)
        targetFolder.environment = folderEnvironment

        if(save) {
            store.commit('updateCollectionItemEnvironment', {
                collectionId: targetFolderId,
                environment: folderEnvironment
            })
        }

        if(targetFolder.environments) {
            const currentEnvironmentName = targetFolder.currentEnvironment ?? constants.DEFAULT_ENVIRONMENT.name
            const currentEnvironment = targetFolder.environments.find((env: any) => env.name === currentEnvironmentName) as any
            if(currentEnvironment) {
                currentEnvironment.environment = folderEnvironment
                if(save) {
                    store.commit('updateCollectionItemEnvironments', {
                        collectionId: targetFolderId,
                        environments: targetFolder.environments
                    })
                }
            }
        }

        store.dispatch('reloadTabEnvironmentResolved')

    } catch(e) {
        console.error('Failed to set folder environment variable:')
        console.error(e)
        // Fall back to global environment on error
        setEnvironmentVariable(store, objectPath, value, save)
    }
}

const workspaceEnvironmentWrites = new Map<string, Promise<void>>()

export function setRequestEnvironmentVariable(
    store: ActionContext<State, State>, workspaceId: string, request: CollectionItem,
    objectPath: string, value: string, scope: 'workspace' | 'folder', pluginCollectionId?: string | null
) {
    const itemId = pluginCollectionId ?? request._id
    const applyToActiveWorkspace = (save = true) => {
        if(store.state.activeWorkspace?._id !== workspaceId) {
            return false
        }
        if(scope === 'folder') {
            const item = findItemInTreeById(store.state.collectionTree, itemId) ?? request
            setParentEnvironmentVariable(store, objectPath, value, item, save)
        } else {
            setEnvironmentVariable(store, objectPath, value, save)
        }
        return true
    }

    if(applyToActiveWorkspace()) {
        return
    }

    // A read and its saves finish before another script reads this workspace's environments.
    const write = (workspaceEnvironmentWrites.get(workspaceId) ?? Promise.resolve()).then(async() => {
        if(applyToActiveWorkspace()) {
            return
        }
        const workspace = store.state.workspaces.find(item => item._id === workspaceId)
        if(!workspace) {
            console.error('Environment value was not saved because its workspace no longer exists')
            return
        }

        if(scope === 'folder') {
            const item = await getCollectionById(workspaceId, itemId)
            if(applyToActiveWorkspace()) {
                return
            }
            if(item?.parentId) {
                const folder = await getCollectionById(workspaceId, item.parentId)
                if(applyToActiveWorkspace()) {
                    return
                }
                if(folder?._type === 'request_group') {
                    const environment = folder.environment ?? {}
                    setObjectPathValue(environment, objectPath, value)
                    const currentEnvironment = folder.environments?.find((environment: any) => environment.name === (folder.currentEnvironment ?? constants.DEFAULT_ENVIRONMENT.name)) as any
                    if(currentEnvironment) {
                        currentEnvironment.environment = environment
                    }
                    await updateCollection(workspaceId, folder._id, { environment })
                    if(currentEnvironment) {
                        if(applyToActiveWorkspace()) {
                            return
                        }
                        await updateCollection(workspaceId, folder._id, { environments: folder.environments })
                    }
                    applyToActiveWorkspace(false)
                    return
                }
            }
        }

        const workspaceSaved = workspace._type === 'file'
            ? await getFileWorkspace(workspace.location!)
            : (await getAllWorkspaces()).find(item => item._id === workspaceId)
        if(applyToActiveWorkspace()) {
            return
        }
        if(!workspaceSaved) {
            console.error('Environment value was not saved because its workspace no longer exists')
            return
        }
        const environment = workspaceSaved.environment ?? {}
        const environments = workspaceSaved.environments ?? [{
            name: constants.DEFAULT_ENVIRONMENT.name, environment: {}, color: constants.DEFAULT_ENVIRONMENT.color
        }]
        setObjectPathValue(environment, objectPath, value)
        const currentEnvironment = environments.find((environment: any) => environment.name === (workspaceSaved.currentEnvironment ?? constants.DEFAULT_ENVIRONMENT.name))
        currentEnvironment.environment = environment

        // File workspaces handle these fields separately, just like the active workspace's mutations.
        await updateWorkspace(workspaceId, { environment })
        if(applyToActiveWorkspace()) {
            return
        }
        await updateWorkspace(workspaceId, { environments })
        if(!applyToActiveWorkspace(false)) {
            const workspaceCurrent = store.state.workspaces.find(item => item._id === workspaceId)
            if(workspaceCurrent) {
                workspaceCurrent.environment = environment
                workspaceCurrent.environments = environments
            }
        }
    }).catch(error => {
        console.error('Failed to set environment variable:')
        console.error(error)
    }).finally(() => {
        if(workspaceEnvironmentWrites.get(workspaceId) === write) {
            workspaceEnvironmentWrites.delete(workspaceId)
        }
    })
    workspaceEnvironmentWrites.set(workspaceId, write)
    return write
}

export function getParentPath(collection: CollectionItem[], itemId: string): string {
    const parents: string[] = []

    function findParents(items: CollectionItem[], targetId: string, currentPath: string[] = []): boolean {
        for (const item of items) {
            if (item._id === targetId) {
                parents.push(...currentPath)
                return true
            }
            if (item.children) {
                if (findParents(item.children, targetId, [...currentPath, item.name])) {
                    return true
                }
            }
        }
        return false
    }

    findParents(collection, itemId)
    return parents.join(' / ')
}

export function prependParentTitleToChildTitle(array: CollectionItem[], prepend = '') {
    array.forEach(item => {
        item.name = `${prepend ? prepend + ' ' : ''}${item.name}`
        if(item.children) {
            prependParentTitleToChildTitle(item.children, item.name + ' → ')
        }
    })
}

export function debounce<T extends(...args: any[]) => any>(
    func: T,
    timeout = 300
): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | undefined
    return (...args: Parameters<T>) => {
        clearTimeout(timer)
        timer = setTimeout(() => func(...args), timeout)
    }
}

export function getAlertConfirmPromptContainer(componentRootElement: HTMLElement) : {
    createPrompt: any
    createConfirm: any
    createAlert: any
} {
    return (componentRootElement.ownerDocument?.defaultView ?? window).document.querySelector('alert-confirm-prompt') as any
}

export function getCurrentTimestamp(): string {
    return dayjs().format('HH:mm:ss:SSS')
}

export function getVersion(): string {
    return version
}

// the self-hosted build, whose server makes gRPC calls for the page
export function isWebStandaloneBuild() {
    return import.meta.env.MODE === 'web-standalone'
}

// Names the build this page is, for page view analytics
export function getBuild(): 'desktop' | 'web-standalone' | 'extension' | 'web' {
    if(import.meta.env.MODE === 'desktop-electron') {
        return 'desktop'
    }
    if(import.meta.env.MODE === 'web-standalone') {
        return 'web-standalone'
    }
    if(window.location.protocol.endsWith('-extension:')) {
        return 'extension'
    }
    return 'web'
}

export function uriParse(urlString: string): {
    protocol: string | null;
    host: string | null;
    port: string | null;
    pathname: string | null;
    hash: string | null;
    search: string | null;
} {
    const { protocol, host, port, pathname, hash, search }  = new URL(urlString)
    return { protocol, host, port, pathname, hash, search }
}

function isLoopbackHostname(hostname: string) {
    return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127(\.\d{1,3}){3}$/.test(hostname)
}

// web-standalone connects sockets through its server, like requests, so a Socket.IO target needs no CORS for this page,
// an https page can reach a ws:// target, and Settings > Proxy applies. Loopback stays with the browser, which is the
// user's own machine and not always the server's. A browser checks a socket's certificate itself and cannot be told to
// skip that or to trust another CA, so a secure loopback socket still goes through the server with SSL verification
// disabled or CA certificates registered under caCertificatesId
export function getSocketConnectionUrl(url: string, flags: Pick<Flags, 'isWebStandalone' | 'disableSSLVerification'> & { caCertificatesId?: string | null, proxySettingsId?: string | null }, serverLocation: Pick<Location, 'protocol' | 'host'> = window.location): string {
    if(!flags.isWebStandalone) {
        return url
    }

    let parsedUrl: URL

    try {
        parsedUrl = new URL(url)
    } catch {
        return url
    }

    if(!['ws:', 'wss:', 'http:', 'https:'].includes(parsedUrl.protocol)) {
        return url
    }

    let options: string

    if(isLoopbackHostname(parsedUrl.hostname)) {
        if((parsedUrl.protocol !== 'wss:' && parsedUrl.protocol !== 'https:') || (!flags.disableSSLVerification && !flags.caCertificatesId)) {
            return url
        }

        options = flags.disableSSLVerification ? 'true' : `ca-${flags.caCertificatesId}`
    } else {
        // with SSL verification disabled there is nothing to check a certificate against
        options = encodeURIComponent(JSON.stringify({
            disableSSLVerification: flags.disableSSLVerification,
            caCertificatesId: flags.disableSSLVerification ? null : (flags.caCertificatesId ?? null),
            proxySettingsId: flags.proxySettingsId ?? null,
        }))
    }

    const protocol = parsedUrl.protocol.startsWith('ws') ? (serverLocation.protocol === 'https:' ? 'wss:' : 'ws:') : serverLocation.protocol

    return `${protocol}//${serverLocation.host}/proxy-socket/${options}/${encodeURIComponent(parsedUrl.origin)}${parsedUrl.pathname}${parsedUrl.search}`
}

export function getStatusText(statusCode: number): string {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return constants.STATUS_CODE_TEXT_MAPPING[statusCode.toString()].title
}

export function getStatusDescription(statusCode: number): string {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return constants.STATUS_CODE_TEXT_MAPPING[statusCode.toString()].description
}

export function timeAgo(timestamp: number) {
    const now: any = new Date()
    const date: any = new Date(timestamp)
    const secondsPast = Math.floor((now - date) / 1000)

    if (secondsPast < 60) {
        return secondsPast === 1 || secondsPast < 1 ? 'Just Now' : `${secondsPast} seconds ago`
    }
    if (secondsPast < 3600) {
        const minutesPast = Math.floor(secondsPast / 60)
        return minutesPast === 1 ? '1 minute ago' : `${minutesPast} minutes ago`
    }
    if (secondsPast < 86400) {
        const hoursPast = Math.floor(secondsPast / 3600)
        return hoursPast === 1 ? 'one hour ago' : `${hoursPast} hours ago`
    }
    if (secondsPast < 2592000) { // Less than 30 days
        const daysPast = Math.floor(secondsPast / 86400)
        return daysPast === 1 ? 'one day ago' : `${daysPast} days ago`
    }
    if (secondsPast < 31536000) { // Less than 365 days
        const monthsPast = Math.floor(secondsPast / 2592000)
        return monthsPast === 1 ? 'one month ago' : `${monthsPast} months ago`
    }
    const yearsPast = Math.floor(secondsPast / 31536000)
    return yearsPast === 1 ? 'one year ago' : `${yearsPast} years ago`
}

export function responseStatusColorMapping(response: Response) {
    let color

    if(response.status >= 200 && response.status <= 299) {
        color = 'green'
    }

    if(response.status >= 400 && response.status <= 499) {
        color = 'yellow'
    }

    if(response.status >= 500 || response.statusText === 'Error') {
        color = 'red'
    }

    return color
}

// From: https://dexie.org/docs/StorageManager#summary
async function tryPersistWithoutPromtingUser() {
    if (!navigator.storage || !navigator.storage.persisted) {
        return 'never'
    }
    let persisted = await navigator.storage.persisted()
    if (persisted) {
        return 'persisted'
    }
    if (!navigator.permissions || !navigator.permissions.query) {
        return 'prompt' // It MAY be successful to prompt. Don't know.
    }
    const permission = await navigator.permissions.query({
        name: 'persistent-storage'
    })
    if (permission.state === 'granted') {
        persisted = await navigator.storage.persist()
        if (persisted) {
            return 'persisted'
        } else {
            throw new Error('Failed to persist')
        }
    }
    if (permission.state === 'prompt') {
        return 'prompt'
    }
    return 'never'
}

// From: https://dexie.org/docs/StorageManager#summary
export async function initStoragePersistence() {
    const persist = await tryPersistWithoutPromtingUser()
    switch (persist) {
        case 'never':
            console.log('Not possible to persist storage')
            break
        case 'persisted':
            console.log('Successfully persisted storage silently')
            break
        case 'prompt':
            console.log('Not persisted, so we will try to prompt user')
            if(navigator.storage && navigator.storage.persist) {
                if(await navigator.storage.persist()) {
                    console.log('Storage is now persisted')
                } else {
                    console.log('Storage was not persisted')
                }
            }
            break
    }
}

// what an item that inherits stores. It is the value every older version wrote for an item without an auth of its own,
// and the only one they read as inherit, so it is kept so that a collection exported from here inherits in every version
export const INHERITED_AUTHENTICATION_TYPE = 'No Auth'

// 'inherit' takes the auth of the nearest folder above that has one of its own, 'none' sends no auth and, on a folder, stops
// inheritance below it. An item without an authentication object or type inherits as well
export function getAuthenticationType(authentication: RequestAuthentication | undefined): string {
    if(authentication === undefined || authentication.type === undefined || authentication.type === INHERITED_AUTHENTICATION_TYPE) {
        return 'inherit'
    }

    return authentication.type
}

// an auth that is unticked counts as none, it neither sends anything nor falls back to the folder's
export function hasOwnAuthentication(authentication: RequestAuthentication): boolean {
    const authenticationType = getAuthenticationType(authentication)
    return authenticationType !== 'inherit' && authenticationType !== 'none' && !authentication.disabled
}

// RFC 6749 section 2.3.1, the client credentials go either in a Basic Authorization header, id and secret urlencoded
// before the base64, or as client_id and client_secret in the form body. A config saved before the choice existed has no
// clientAuthentication and keeps sending them in the body
export function createOAuthTokenRequest(clientId: string, clientSecret: string, clientAuthentication: RequestAuthentication['clientAuthentication'], parameters: Record<string, string>) {
    const headers: Record<string, string> = {
        'Content-Type': constants.MIME_TYPE.FORM_URL_ENCODED
    }
    const body = new URLSearchParams(parameters)

    if(clientAuthentication === 'header') {
        headers['Authorization'] = generateBasicAuthString(encodeURIComponent(clientId), encodeURIComponent(clientSecret))
    } else {
        body.set('client_id', clientId)
        body.set('client_secret', clientSecret)
    }

    return { headers, body: body.toString() }
}

export interface OAuthTokenFieldValues {
    grantType?: string
    accessTokenUrl: string
    username?: string
    authorizationCode?: string
    redirectUri?: string
}

function isOAuthTokenFieldMissing(value: string | undefined) {
    // a variable that resolves to nothing substitutes to the text 'undefined'
    return value === undefined || value.trim() === '' || value === 'undefined'
}

// names the fields a token request cannot be sent without, RFC 6749 makes them required parameters. The client id and
// secret are not among them, a public client has no secret and some servers take neither, so the server decides on those
export function getMissingOAuthTokenFieldsMessage(purpose: 'get' | 'refresh', values: OAuthTokenFieldValues): string | null {
    const missing: string[] = []

    if(purpose === 'get' && isOAuthTokenFieldMissing(values.grantType)) {
        missing.push('Grant Type')
    }

    if(isOAuthTokenFieldMissing(values.accessTokenUrl)) {
        missing.push('Access Token URL')
    }

    if(purpose === 'get' && values.grantType === constants.GRANT_TYPES.password_credentials && isOAuthTokenFieldMissing(values.username)) {
        missing.push('Username')
    }

    if(purpose === 'get' && values.grantType === constants.GRANT_TYPES.authorization_code) {
        if(isOAuthTokenFieldMissing(values.authorizationCode)) {
            missing.push('Authorization Code')
        }
        if(isOAuthTokenFieldMissing(values.redirectUri)) {
            missing.push('Redirect URI')
        }
    }

    if(missing.length === 0) {
        return null
    }

    const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
    return `${list} ${missing.length === 1 ? 'is' : 'are'} required to ${purpose === 'get' ? 'get a token' : 'refresh the token'}.`
}

export function parseOAuthTokenResponse(buffer: ArrayBuffer | undefined): any {
    try {
        return JSON.parse(new TextDecoder().decode(buffer))
    } catch {
        return null
    }
}

// the start of a non-JSON answer as readable text, an HTML error page loses its markup
function getResponseTextSnippet(text: string) {
    const readable = text
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    return readable.length > 120 ? readable.slice(0, 120) + '...' : readable
}

// says what went wrong with a token request and what to change, for every way it can fail: an HTTP error with or without
// the RFC 6749 section 5.2 error body, a 200 without a token, a timeout, or a server that could not be reached
export function describeOAuthTokenError(error: any, accessTokenUrl: string): string {
    if(typeof error?.status === 'number') {
        const text = error.buffer ? new TextDecoder().decode(error.buffer) : ''
        const json = parseOAuthTokenResponse(error.buffer)
        // an answer without the OAuth error field, such as an API gateway's own JSON, is shown as its text
        const snippet = json && typeof json.error === 'string' ? '' : getResponseTextSnippet(text)
        const statusLine = `HTTP ${error.status}${error.statusText ? ' ' + error.statusText : ''}`

        if(json && typeof json.error === 'string') {
            let message = `The token endpoint answered ${statusLine}: ${json.error}${json.error_description ? ', ' + json.error_description : ''}.`
            if(json.error === 'invalid_client') {
                message += ' It refused the client credentials. Check the Client ID and Client Secret, or switch Client Authentication between Basic Auth Header and Request Body.'
            }
            return message
        }

        if(error.status === 200) {
            return json ? `The token endpoint answered HTTP 200 without an access_token: ${snippet}.` : `The token endpoint answered HTTP 200 with something other than JSON${snippet ? ': ' + snippet : ''}.`
        }

        let message = `The token endpoint answered ${statusLine}${snippet ? ': ' + snippet : ''}.`
        if(error.status === 401 || error.status === 403) {
            message += ' It refused the request. Check the Client ID and Client Secret, or switch Client Authentication between Basic Auth Header and Request Body.'
        } else if(error.status === 404 || error.status === 405) {
            message += ' Check the Access Token URL.'
        }
        return message
    }

    if(error?.name === 'TimeoutError') {
        return `The token request to ${accessTokenUrl} timed out. Check that the server is running, or raise Request Timeout in Settings.`
    }

    const reason = error instanceof Error ? error.message : String(error)
    let message = `Could not reach the token endpoint at ${accessTokenUrl}: ${reason}. Check the Access Token URL and that the server is running.`
    if(reason === 'Failed to fetch') {
        message += ' In the browser the server must also allow cross-origin requests, otherwise use the Restfox CORS Helper extension or the desktop app.'
    }
    return message
}

// headerName is the header the auth is sent in
export async function resolveAuthentication(send: SendResolver, authentication: RequestAuthentication, environment: any, headerName: string, onResolvedMasked?: (value: string) => void) {
    const part = { header: headerName }

    if(authentication.type === 'basic') {
        const username = await send.resolveWithMasked(environment, authentication.username ?? '', part)
        const password = await send.resolveWithMasked(environment, authentication.password ?? '', part)
        const authorization = generateBasicAuthString(username.textResolved, password.textResolved)
        onResolvedMasked?.(username.maskedPromptUsed || password.maskedPromptUsed ? '' : authorization)
        return authorization
    }

    if(authentication.type === 'bearer' || authentication.type === 'oauth2') {
        const authenticationBearerPrefix = authentication.prefix !== undefined && authentication.prefix !== '' ? authentication.prefix : 'Bearer'
        const authenticationBearerToken = authentication.token !== undefined ? authentication.token : ''
        const prefix = await send.resolveWithMasked(environment, authenticationBearerPrefix, part)
        const token = await send.resolveWithMasked(environment, authenticationBearerToken, part)
        onResolvedMasked?.(`${prefix.textResolvedMasked} ${token.textResolvedMasked}`)
        return `${prefix.textResolved} ${token.textResolved}`
    }
}

export function toggleDropdown(event: any, dropdownState: any) {
    dropdownState.visible = !dropdownState.visible

    if (dropdownState.visible) {
        const containerElement = event.target.closest('.custom-dropdown')
        const rect = containerElement.getBoundingClientRect()
        dropdownState.contextMenuX = rect.left
        dropdownState.contextMenuY = rect.top + rect.height
        dropdownState.element = containerElement
    } else {
        dropdownState.element = null
    }
}

/**
 * Convert a script from one environment to another based on script type.
 *
 * @param {string} scriptToConvert - The script to convert.
 * @param {string} scriptType - The type of script being converted.
 * @returns {string} - The converted script.
 */
export function scriptConversion(scriptToConvert: string, scriptType: 'postmanToRestfox' | 'restfoxToPostman' | 'restfoxToInsomnia') {
    const mappings = {
        postmanToRestfox: {
            'pm.environment.set': 'rf.setEnvVar',
            'pm.environment.get': 'rf.getEnvVar',
            'pm.response.json()': 'rf.response.getBodyJSON()',
            'pm.response.code': 'rf.response.getStatusCode()',
            'pm.test': 'test',
            'pm.expect': 'expect',
            'pm.response.text()': 'rf.response.getBodyText()'
        },
        restfoxToPostman: {
            'rf.setEnvVar': 'pm.environment.set',
            'rf.getEnvVar': 'pm.environment.get',
            'rf.response.getBodyJSON()': 'pm.response.json()'
        },
        restfoxToInsomnia: {
            'rf.setEnvVar': 'insomnia.setEnvironmentVariable',
            'rf.getEnvVar': 'insomnia.getEnvironmentVariable',
            'rf.response.getBodyJSON()': 'insomnia.response.json()'
        },
    }

    const selectedMapping = mappings[scriptType]
    if (!selectedMapping) {
        throw new Error(`Unsupported script type: ${scriptType}`)
    }

    let convertedScript = scriptToConvert

    // Replace basic mappings
    for (const [key, value] of Object.entries(selectedMapping)) {
        convertedScript = convertedScript.replaceAll(key, value)
    }

    // Generalize status code conversion for Postman to Restfox
    if (scriptType === 'postmanToRestfox') {
        convertedScript = convertedScript.replace(/pm\.response\.to\.have\.status\((\d+)\)/g, 'rf.response.getStatusCode() === $1')
    }

    return convertedScript
}

export async function convertCollectionsFromRestfoxToPostman(restfoxCollections: any) {
    const restfoxData: any = restfoxCollections

    const postmanCollection: any = {
        info: {
            name: 'Imported Collection',
            schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
        },
        item: []
    }

    const folderMap: any = {}

    // First, create all folders and store them in folderMap
    restfoxData.forEach((item: any) => {
        if (item._type === 'request_group') {
            const postmanItem: { name: any, item: any[] } = {
                name: item.name,
                item: []
            }
            folderMap[item._id] = postmanItem

            // Check if the parent folder exists in folderMap and add the folder as a child
            if (item.parentId && folderMap[item.parentId]) {
                folderMap[item.parentId].item.push(postmanItem)
            } else {
                postmanCollection.item.push(postmanItem)
            }
        }
    })

    // Then, create all requests and push them to the appropriate folders in folderMap
    restfoxData.forEach((item: any) => {
        if (item._type === 'request') {
            const postmanRequest: any = {
                name: item.name,
                request: {
                    method: item.method,
                    header: [],
                    body: {
                        mode: 'raw',
                        raw: item.body.text,
                        options: {
                            raw: {
                                language: item.body.mimeType.split('/')[1]
                            }
                        }
                    },
                    url: {
                        raw: item.url,
                        host: item.url,
                        query: item.parameters ? item.parameters.filter((param: any) => !param.disabled).map((param: any) => ({ key: param.name, value: param.value })) : []
                    }
                },
                event: [],
                response: []
            }

            if (item.headers && item.headers.length > 0) {
                postmanRequest.request.header = item.headers.map((header: any) => ({
                    key: header.name,
                    value: header.value
                }))
            }

            if (item.plugins && item.plugins.length > 0) {
                item.plugins.forEach((plugin: any) => {
                    if (plugin.enabled && plugin.type === 'script') {
                        if (plugin.code.pre_request) {
                            postmanRequest.event.push({
                                listen: 'prerequest',
                                script: {
                                    type: 'text/javascript',
                                    exec: scriptConversion(plugin.code.pre_request, 'restfoxToPostman').trim().split('\n')
                                }
                            })
                        }
                        if (plugin.code.post_request) {
                            postmanRequest.event.push({
                                listen: 'test',
                                script: {
                                    type: 'text/javascript',
                                    exec: scriptConversion(plugin.code.post_request, 'restfoxToPostman').trim().split('\n')
                                }
                            })
                        }
                    }
                })
            }

            // Check if the parent folder exists in folderMap and add the request to that folder
            if (item.parentId && folderMap[item.parentId]) {
                folderMap[item.parentId].item.push(postmanRequest)
            } else {
                postmanCollection.item.push(postmanRequest)
            }
        }
    })

    return postmanCollection
}

export async function convertCollectionsFromRestfoxToInsomnia(restfoxCollections: any) {
    const insomniaCollection: any = {
        _type: 'export',
        __export_format: 4,
        __export_date: new Date().toISOString(),
        __export_source: 'restfox-to-insomnia-converter',
        resources: []
    }

    const workspaceId = restfoxCollections[0].workspaceId || 'root_workspace'

    const workspace = {
        _id: workspaceId,
        _type: 'workspace',
        name: 'Imported from Restfox',
        description: '',
        scope: 'collection',
    }

    insomniaCollection.resources.push(workspace)

    const folderMap: any = {}

    // First, create all folders and store them in folderMap
    restfoxCollections.forEach((item: any) => {
        if (item._type === 'request_group') {
            const insomniaFolder = {
                _id: item._id,
                _type: 'request_group',
                parentId: item.parentId || workspaceId,
                name: item.name,
            }
            folderMap[item._id] = insomniaFolder
            insomniaCollection.resources.push(insomniaFolder)
        }
    })

    // Then, create all requests and push them to the appropriate folders in folderMap
    restfoxCollections.forEach((restfoxRequest: any) => {
        if (restfoxRequest._type !== 'request') {
            return
        }

        let body = {}

        if (restfoxRequest.body.mimeType !== 'No Body') {
            body = restfoxRequest.body
        }

        const insomniaRequest: any = {
            _id: restfoxRequest._id,
            _type: 'request',
            parentId: restfoxRequest.parentId || workspaceId,
            name: restfoxRequest.name || restfoxRequest.url,
            method: restfoxRequest.method,
            url: restfoxRequest.url,
            body,
            headers: restfoxRequest.headers,
            authentication: convertRestfoxAuthToInsomniaAuth(restfoxRequest.authentication),
            parameters: restfoxRequest.parameters,
        }

        const scripts = restfoxRequest.plugins?.find((plugin: any) => plugin.type === 'script')
        if (scripts) {
            insomniaRequest.hook = {
                preRequest: scriptConversion(scripts.code.pre_request, 'restfoxToInsomnia').trim() || '',
                postRequest: scriptConversion(scripts.code.post_request, 'restfoxToInsomnia').trim() || ''
            }
        }

        insomniaCollection.resources.push(insomniaRequest)
    })

    return insomniaCollection
}

function convertRestfoxAuthToInsomniaAuth(auth: any) {
    const insomniaAuth: any = {}

    switch (auth?.type) {
        case 'No Auth':
            insomniaAuth.type = 'none'
            break
        case 'Basic Auth':
            insomniaAuth.type = 'basic'
            insomniaAuth.username = auth?.username || ''
            insomniaAuth.password = auth?.password || ''
            break
        case 'Bearer Token':
            insomniaAuth.type = 'bearer'
            insomniaAuth.token = auth?.token || ''
            break
        default:
            insomniaAuth.type = 'none'
            break
    }

    return insomniaAuth
}

export function convertPostmanAuthToRestfoxAuth(request: any) {
    // Postman leaves auth out of an item that inherits its folder's and writes noauth on one that opted out
    let authentication: RequestAuthentication = { type: INHERITED_AUTHENTICATION_TYPE }

    if('auth' in request && request.auth) {
        const authType = request.auth.type

        if(authType === 'noauth') {
            authentication = { type: 'none' }
        } else if(authType === 'bearer' && request.auth.bearer) {
            const token = Array.isArray(request.auth.bearer)
                ? request.auth.bearer.find((item: any) => item.key === 'token')?.value || ''
                : request.auth.bearer.token

            authentication = {
                type: 'bearer',
                token,
            }

        } else if(authType === 'basic' && request.auth.basic) {
            // Handle Basic Authentication for both v2.0 and v2.1 formats
            let username = ''
            let password = ''

            if(Array.isArray(request.auth.basic)) {
                // Postman v2.1 format
                username = request.auth.basic.find((item: any) => item.key === 'username')?.value || ''
                password = request.auth.basic.find((item: any) => item.key === 'password')?.value || ''
            } else {
                // Postman v2.0 format
                username = request.auth.basic.username || ''
                password = request.auth.basic.password || ''
            }

            authentication = {
                type: 'basic',
                username,
                password,
            }

        } else if(authType === 'oauth2' && request.auth.oauth2) {
            // Postman v2.1 stores the settings as a list of key and value, v2.0 as a plain object
            const oauth2Entries: { key: string, value: any }[] = Array.isArray(request.auth.oauth2)
                ? request.auth.oauth2
                : Object.entries(request.auth.oauth2).map(([key, value]) => ({ key, value }))
            // older Postman versions wrote some settings under other names, in both formats, see oAuth2 in
            // postman-collection-transformer lib/util.js. The first name given with a value wins, the current one is first
            const getOAuth2Value = (...keys: string[]) => {
                for(const key of keys) {
                    const value = oauth2Entries.find(item => item.key === key)?.value
                    if(value !== undefined && value !== '') {
                        return value
                    }
                }
                return undefined
            }

            const postmanGrantType = getOAuth2Value('grant_type', 'grantType') || ''
            const username = getOAuth2Value('username') || ''
            const password = getOAuth2Value('password') || ''
            const clientId = getOAuth2Value('clientId') || ''
            const clientSecret = getOAuth2Value('clientSecret') || ''
            const accessTokenUrl = getOAuth2Value('accessTokenUrl') || ''
            const scope = getOAuth2Value('scope') || ''
            const clientAuthentication = getOAuth2Value('client_authentication', 'clientAuth')

            // Postman names two grant types differently from the grant_type they send, and marks PKCE on the grant type
            // itself. Any other value, such as implicit which Restfox does not support, is kept so the selector shows it
            const grantType = new Map([
                ['password_credentials', constants.GRANT_TYPES.password_credentials],
                ['authorization_code_with_pkce', constants.GRANT_TYPES.authorization_code],
            ]).get(postmanGrantType) ?? postmanGrantType

            authentication = {
                type: 'oauth2',
                grantType,
                username,
                password,
                clientId,
                clientSecret,
                accessTokenUrl,
                scope,
            }

            if(clientAuthentication === 'header' || clientAuthentication === 'body') {
                authentication.clientAuthentication = clientAuthentication
            }

            if(postmanGrantType === 'authorization_code_with_pkce') {
                authentication.usePKCE = true
            }

            // fields only set when the export carries them. The Callback URL is the redirect uri, older versions wrote it as
            // callBackUrl next to a redirectUri. Older versions also saved the tokens themselves
            const optionalFields: [string[], keyof RequestAuthentication][] = [
                [['authUrl'], 'authorizationUrl'],
                [['redirect_uri', 'callBackUrl', 'redirectUri'], 'redirectUri'],
                [['state'], 'state'],
                [['code_verifier'], 'codeVerifier'],
                [['headerPrefix'], 'prefix'],
                [['accessToken'], 'token'],
                [['refreshToken'], 'refreshToken'],
            ]

            for(const [postmanKeys, restfoxKey] of optionalFields) {
                const value = getOAuth2Value(...postmanKeys)
                if(typeof value === 'string' && value !== '') {
                    (authentication as Record<string, unknown>)[restfoxKey] = value
                }
            }
        }
    }

    return authentication
}

export function getEditorConfig(): EditorConfig {
    return {
        indentSize: parseInt(localStorage.getItem(constants.LOCAL_STORAGE_KEY.INDENT_SIZE) || constants.EDITOR_CONFIG.indent_size.toString(), 10)
    }
}

export function jsonStringify(data: any, space: number = getEditorConfig().indentSize): any {
    return JSON.stringify(data, null, space)
}

export function getSpaces(value: string | number): string {
    const numSpaces = Number(value)
    return isNaN(numSpaces) || numSpaces < 0 ? '' : ' '.repeat(numSpaces)
}

export function deepClone(obj: any) {
    return JSON.parse(JSON.stringify(obj))
}

// A gRPC item in the shape createRequestData resolves, so its metadata carries the headers and auth it inherits. The
// url is the server's address, which is not an HTTP url, so it is resolved on its own
function grpcItemAsRequest(grpcRequest: CollectionItem, message: string): CollectionItem {
    return {
        ...grpcRequest,
        _type: 'request',
        method: 'POST',
        url: 'http://grpc.invalid/',
        parameters: [],
        pathParameters: [],
        body: { mimeType: 'application/json', text: message },
    }
}

// A gRPC item's metadata, with the headers and auth it inherits, resolved as a request's headers are. A call also sends
// Settings > Global User Agent, or Restfox's own, when the item sets none
export async function resolveGrpcMetadata(
    grpcRequest: CollectionItem,
    environment: any,
    parentHeaders: Record<string, string[]>,
    parentAuthentication: RequestAuthentication | undefined,
    workspaceLocation: string | null,
    send: SendResolver,
    { defaultUserAgent = false, metadataMasked }: { defaultUserAgent?: boolean, metadataMasked?: [string, string][] } = {}
): Promise<[string, string][]> {
    const state: HandleRequestState = {
        currentPlugin: null,
        testResults: []
    }

    // the message is resolved on its own, a stream's only when it is sent
    const headersMasked = metadataMasked ? new Map<string, [string, string]>() : undefined
    const { headers } = await createRequestData(state, grpcItemAsRequest(grpcRequest, ''), environment, parentHeaders, parentAuthentication, null, [], workspaceLocation, send, headersMasked)

    if(defaultUserAgent) {
        const userAgentHeaderName = findHeaderName(headers, 'user-agent')
        const usesDefaultUserAgent = userAgentHeaderName !== undefined && !headers[userAgentHeaderName]
        setDefaultUserAgent(headers)
        if(userAgentHeaderName !== undefined && usesDefaultUserAgent) {
            headersMasked?.set(userAgentHeaderName, [headersMasked.get(userAgentHeaderName)?.[0] ?? userAgentHeaderName, headers[userAgentHeaderName]])
        }
    }

    return Object.entries(headers).map(([name, value]) => {
        const valueResolved = String(value)
        const [nameMasked, valueMasked] = headersMasked?.get(name) ?? [name, valueResolved]
        // binary metadata and Basic auth encode their values, so a masked value leaves the whole value out
        const valueSaved = name.trim().toLowerCase().endsWith('-bin') && send.headerTookMaskedValue(name) ? '' : valueMasked
        metadataMasked?.push([nameMasked, valueSaved])
        return [name, valueResolved]
    })
}

// What a gRPC item sends, resolved as a call resolves it
export async function createGrpcRequestData(
    grpcRequest: CollectionItem,
    environment: any,
    parentHeaders: Record<string, string[]>,
    parentAuthentication: RequestAuthentication | undefined,
    workspaceLocation: string | null
) {
    const send = new SendResolver(grpcRequest.workspaceId)
    return {
        url: await send.resolve(environment, grpcRequest.url ?? '', 'url'),
        metadata: await resolveGrpcMetadata(grpcRequest, environment, parentHeaders, parentAuthentication, workspaceLocation, send),
        message: await send.resolve(environment, grpcRequest.body?.text ?? '{}', 'body'),
    }
}

// a word the shell takes as it is, quoted only when it has to be
function quoteShellWord(text: string) {
    if(/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) {
        return text
    }

    return `'${text.replaceAll('\'', '\'\\\'\'')}'`
}

// Metadata a call leaves out, as the engine does (packages/electron/src/grpc.js): names gRPC or HTTP/2 set themselves,
// the connection-specific ones HTTP/2 refuses, and the reserved grpc- ones
const GRPC_RESERVED_METADATA_NAMES = ['content-type', 'te', 'host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'http2-settings']

function isGrpcMetadataSent(name: string) {
    const key = name.trim().toLowerCase()
    return key !== '' && !key.startsWith(':') && !key.startsWith('grpc-') && !GRPC_RESERVED_METADATA_NAMES.includes(key)
}

// each .proto file as grpcurl finds it: the folder it searches and the path from there. A call matches an import to
// the file of that path, to one whose path ends with it, as when the folder picked is above the one the imports
// start from, or to one whose path it ends with, as when files are picked on their own. grpcurl only finds an import
// at its path inside a folder it searches, so a file is named by the path its imports use
function getGrpcurlProtoPaths(protoFiles: GrpcProtoFile[]) {
    const found = new Map<string, { folder: string, path: string }>()

    for(const protoFile of protoFiles) {
        for(const [, importPath] of protoFile.text.matchAll(/^\s*import\s+(?:weak\s+|public\s+)?["']([^"']+)["']\s*;/gm)) {
            const imported = protoFiles.find(file => file.path === importPath)
                ?? protoFiles.find(file => file.path.endsWith(`/${importPath}`))
                ?? protoFiles.find(file => importPath.endsWith(`/${file.path}`))
            if(imported && !found.has(imported.path)) {
                const folder = imported.path.endsWith(`/${importPath}`) ? imported.path.slice(0, -importPath.length - 1) : '.'
                found.set(imported.path, { folder, path: importPath })
            }
        }
    }

    const folders = [...found.values()].map(({ folder }) => folder).filter(folder => folder !== '.')

    return protoFiles.map(protoFile => {
        const imported = found.get(protoFile.path)
        if(imported) {
            return imported
        }
        // a file nothing imports, found from the folder the others are
        const folder = folders.find(folder => protoFile.path.startsWith(`${folder}/`))
        return folder ? { folder, path: protoFile.path.slice(folder.length + 1) } : { folder: '.', path: protoFile.path }
    })
}

// Copy as grpcurl. grpcurl reads proto files from disk, so with .proto files the command names their paths, which
// it finds in the folder it runs in, where the user keeps their own copy of the files
export function generateGrpcurlCommand(
    grpcRequest: CollectionItem,
    resolved: { target: { address: string, tls: boolean }, metadata: [string, string][], message: string, disableSSLVerification: boolean }
) {
    const { service, method, protoFiles } = grpcRequest.grpc ?? {}

    if(!service || !method) {
        throw new Error('Choose a method first')
    }

    const words = ['grpcurl']

    if(!resolved.target.tls) {
        words.push('-plaintext')
    } else if(resolved.disableSSLVerification) {
        words.push('-insecure')
    }

    // grpcurl drops a User-Agent given with -H and takes it only as -user-agent. The call sends the last row's
    let userAgent: string | null = null

    for(const [name, value] of resolved.metadata) {
        if(name.trim().toLowerCase() === 'user-agent') {
            userAgent = value
        } else if(isGrpcMetadataSent(name)) {
            // rows of one -bin name come joined with a comma, which the call sends as separate values and grpcurl
            // would take as one
            const values = name.trim().toLowerCase().endsWith('-bin') ? value.split(',').map(part => part.trim()) : [value]
            for(const oneValue of values) {
                words.push('-H', quoteShellWord(`${name}: ${oneValue}`))
            }
        }
    }

    if(userAgent !== null) {
        words.push('-user-agent', quoteShellWord(userAgent))
    }

    if(resolved.message.trim() !== '') {
        words.push('-d', quoteShellWord(resolved.message))
    }

    if(protoFiles && protoFiles.length > 0) {
        const protoPaths = getGrpcurlProtoPaths(protoFiles)
        for(const folder of new Set(protoPaths.map(({ folder }) => folder))) {
            words.push('-import-path', quoteShellWord(folder))
        }
        for(const path of new Set(protoPaths.map(({ path }) => path))) {
            words.push('-proto', quoteShellWord(path))
        }
    }

    words.push(quoteShellWord(resolved.target.address), quoteShellWord(`${service}/${method}`))

    return words.join(' ')
}

export function getAllHttpRequestsInFolder(folder: CollectionItem): CollectionItem[] {
    const requests: CollectionItem[] = []

    function traverse(item: CollectionItem) {
        if (item._type === 'request') {
            requests.push(item)
        }

        if (item.children && item.children.length > 0) {
            item.children.forEach(child => traverse(child))
        }
    }

    traverse(folder)
    return requests
}
