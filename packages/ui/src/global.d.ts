export {}

declare global {
    interface Window {
        electronIPC: any
        __EXTENSION_HOOK__: any
        createPrompt: any
        createConfirm: any
        createAlert: any
    }

    interface ImportMeta {
        env: {
            MODE: string,
            PROD: boolean,
        }
    }
}

export interface InstallInfo {
    installKind: string
    appName?: string
}

export interface CollectionItem {
    _id: string
    _type: 'request' | 'request_group' | 'socket'
    name: string
    children?: CollectionItem[]
    parentId: string | null
    workspaceId: string
    method?: string
    url?: string
    body?: RequestBody
    headers?: RequestParam[]
    parameters?: RequestParam[]
    pathParameters?: RequestParam[]
    authentication?: RequestAuthentication
    description?: string
    environment?: object
    environments?: object[]
    currentEnvironment?: object
    sortOrder?: number
    plugins?: any // this property is only present in the collection export, never in the actual request
    collapsed?: boolean
}

export interface RequestAuthentication {
    type?: string
    token?: string
    prefix?: string
    username?: string
    password?: string
    disabled?: boolean
    accessTokenUrl?: string
    redirectUri?: string
    state?: string
    authorizationCode?: string
    authorizationUrl?: string
    usePKCE?: boolean
    codeVerifier?: string
    scope?: string
    clientId?: string
    clientSecret?: string
    clientAuthentication?: 'header' | 'body'
    grantType?: 'authorization_code' | 'password' | 'client_credentials' | string
    refreshToken?: string
}

export interface FileObject {
    name: string
    type: string
    buffer: ArrayBuffer
    bufferOmitted?: boolean
}

export interface RequestParam {
    name: string
    value: string
    description?: string
    disabled?: boolean
    type?: string
    files?: File[] | FileObject[]
}

export interface RequestBody {
    mimeType: string
    text?: string
    params?: RequestParam[]
    fileName?: File | FileObject
}

export type RequestInitialResponseHeader = [string, string]

// why a response holds only part of its body, stored in history, so a value never changes meaning
export type BodyIncomplete = 'cancelled' | 'timedOut' | 'failed'

export interface ResponseHead {
    status: number
    statusText: string
    headers: RequestInitialResponseHeader[]
    headTimeTaken: number
    requestHeadersSent?: RequestInitialResponseHeader[] | null
}

export type ResponseProgress =
    | { type: 'head', head: ResponseHead }
    // never changed by the receiver
    | { type: 'data', bytes: Uint8Array }
    // the body is over, whole or cut short, and scripts may still run on it
    | { type: 'end' }

export type ResponseProgressHandler = (progress: ResponseProgress) => void

export interface RequestInitialResponse {
    status: number
    statusText: string
    headers: RequestInitialResponseHeader[]
    mimeType: string
    buffer: ArrayBuffer
    timeTaken: number
    headTimeTaken?: number
    bodyTimeTaken?: number
    // request headers as they went over the wire, null or absent when the transport cannot report them
    requestHeadersSent?: RequestInitialResponseHeader[] | null
    // absent means the whole body arrived
    bodyIncomplete?: BodyIncomplete
}

export type ResponseStreamView = 'events' | 'lines' | 'text' | 'bytes'

export interface ResponseStream {
    sendId: string
    head: ResponseHead
    view: ResponseStreamView
    // Date.now() at head
    headAt: number
    // refreshed at most every 100 ms
    receivedBytes: number
    // markRaw, append-only
    chunks: Uint8Array[]
    // markRaw, append-only, one per chunk: ms since the send started when that chunk arrived
    chunkTimes: number[]
    // bumped with receivedBytes
    revision: number
    // Date.now() when the body was over, null while it arrives
    endedAt: number | null
}

// what the user did in an event list, carried over when one list replaces another for the same response
export interface EventListViewState {
    // the item shown in the detail pane
    selectedIndex: number | null
    // the path the user typed for this request, null until they type one
    extractPathInput: string | null
    // null until the list was scrolled
    scrollTop: number | null
    // the list follows the newest event, null until known: a live list starts following, a finished one does not
    stickToBottom: boolean | null
}

// when each part of a body arrived, kept in memory for responses received since the app started, never saved
export interface ResponseChunkTimes {
    // byte offset in the body where each chunk ends
    chunkEnds: number[]
    // ms since the send started when each chunk arrived
    chunkTimes: number[]
}

export interface EventStreamItem {
    // 0-based, in arrival order
    index: number
    // SSE: data lines joined with \n, lines: the line text
    data: string
    // SSE event field when present
    event?: string
    id?: string
    retry?: number
    // SSE ':' line, data holds the text after ':'
    comment?: boolean
    // not closed by a blank line (SSE) or a newline (lines) when the body ended
    incomplete?: boolean
}

export interface RequestFinalResponse {
    _id: string
    collectionId: string
    url: string
    status: number
    statusText: string
    headers: RequestInitialResponseHeader[]
    mimeType: string
    buffer: ArrayBuffer
    timeTaken: number
    headTimeTaken?: number
    bodyTimeTaken?: number
    request: {
      method: string
      query: string
      headers: Record<string, string>
      headersSent?: RequestInitialResponseHeader[]
      body: any
      original: CollectionItem
      // what a masked prompt tag left out above, missing when nothing was
      maskedPromptOmitted?: MaskedPromptOmitted
    }
    createdAt: number
    testResults: any[]
    name?: string
    // absent means the whole body arrived
    bodyIncomplete?: BodyIncomplete
}

// Settings > CA Certificates
export interface CACertificates {
    fileName: string
    certificates: string // PEM
}

// Settings > Proxy, never saved means System
export interface ProxySettings {
    mode: 'system' | 'off' | 'custom'
    url: string // Custom's proxy, http://, https:// or socks5://
    username: string
    password: string
    bypass: string // hosts Custom connects to directly, separated by commas or spaces
}

export interface Flags {
    hideBrowserRelatedResponsePanelErrors: boolean
    browserExtensionEnabled: boolean
    isBrowser: boolean
    isWebStandalone: boolean
    isElectron: boolean
    disableSSLVerification: boolean
    caCertificates: CACertificates | null
    proxy: ProxySettings | null
    electronSwitchToChromiumFetch: boolean
    hidePasswordFields: boolean
    responseLineWrapping: boolean
    requestTimeout: number
}

export interface Settings {
    customResponseFormats: string[]
}

export interface CollectionRunnerResult {
    requestId: string
    requestName: string
    method?: string
    parentPath?: string
    iteration: number
    status: 'pending' | 'running' | 'success' | 'error'
    error?: string
    timeTaken?: number
    testResults?: PluginTestResult[]
    statusCode?: number
    url?: string
    responseSize?: number
}

export interface CollectionRunnerState {
    isRunning: boolean
    sourceId: string | null
    sourceName: string | null
    allRequests: CollectionItem[]
    selectedRequests: CollectionItem[]
    currentRequestIndex: number
    currentIteration: number
    totalIterations: number
    delayMs: number
    results: CollectionRunnerResult[]
    abortController: AbortController | null
    continueOnError: boolean
    startTime: number | null
    currentRequestId: string | null
}

export interface State {
    consoleLogs: string[]
    collection: CollectionItem[]
    collectionTree: CollectionItem[]
    tabs: CollectionItem[]
    detachedTabs: CollectionItem[]
    activeTab: any | null
    // 'loading', 'receiving', 'loaded' or 'pending', in memory only
    requestResponseStatus: { [key: string]: string }
    requestResponseStreams: { [tabId: string]: ResponseStream }
    // keyed by response _id, markRaw values, dropped with the response
    responseChunkTimes: { [responseId: string]: ResponseChunkTimes }
    // the extracted-text path the user typed for a request's event lists, in memory only, '' when cleared
    extractPathInputs: { [requestId: string]: string }
    requestResponses: { [key: string]: any | null }
    requestAbortController: { [key: string]: AbortController }
    responses: { [key: string]: any[] }
    showImportModal: boolean
    showImportAsCurlModal: boolean
    showImportModalSelectedRequestGroupId: string | null
    showBackupAndRestoreModal: boolean
    collectionFilter: string
    activeSidebarItemForContextMenu: string | null
    sidebarContextMenuElement: HTMLElement | null
    workspaces: Workspace[]
    activeWorkspace: Workspace | null
    activeWorkspaceLoaded: boolean
    plugins: {
        global: any[]
        workspace: any[]
    }
    requestResponseLayout: string
    theme: string
    githubStarCount: string
    sidebarItemTemporaryName: { [key: string]: string }
    flags: Flags
    settings: Settings
    openContextMenuElement: HTMLElement | null
    sockets: { [key: string]: WebSocket | null }
    tabEnvironmentResolved: any
    idMap: Map<string, string> | null
    skipPersistingActiveTab: boolean
    collectionRunner: CollectionRunnerState
    activeMobilePanel: 'collections' | 'content' | 'response'
    showEnvironmentModal: boolean
    showSettingsModal: boolean
    showPluginManagerModal: boolean
    showLogsModal: boolean
}

export interface Plugin {
    _id: string
    name: string | null
    type?: 'script'
    code: string | { pre_request: string, post_request: string }
    workspaceId: string | null
    collectionId: string | null
    enabled: boolean
    createdAt: number
    updatedAt: number
}

export interface CreateRequestDataReturn {
    url: URL;
    headers: Record<string, string>;
    body?: FormData | URLSearchParams | string | File | null;
}

// What a masked prompt tag left out of a saved request. A url saved as written has an empty query, a header left out
// is removed from both header lists, a body left out is null
export type MaskedPromptOmitted =
    // the parts its value went into: the url saved with masked values as ****** ('masked'), or as written when it
    // cannot be ('written'), such as for a masked port, and a header named as sent with masked values as ******
    | { reason: 'masked-field', url: false | 'masked' | 'written', headerNames: string[], body: boolean }
    // a script read the value and may have put it anywhere, even in a header's name, so the url, every header, the
    // body and the test names and errors are left out
    | { reason: 'script-read' }

export interface HandleRequestState {
    currentPlugin: string | null
    testResults: PluginTestResult[]
}

export interface WorkspaceCache {
    tabs: { [workspaceId: string]: CollectionItem[] }
    activeTab: { [workspaceId: string]: CollectionItem | null }
}

export interface Workspace {
    _id: string
    name: string
    environment?: any
    environments?: any[]
    currentEnvironment?: string
    dotEnv?: Record<string, string> // only available in File Workspace, not persisted to indexedDB
    activeTabId?: string
    tabIds?: string[]
    _type?: string
    location?: string
    createdAt: number
    updatedAt: number
}

export interface FileWorkspace {
    version: number
    name: string
    environment?: any
    environments?: any[]
    currentEnvironment?: string
    dotEnv?: Record<string, string>
}

export interface PluginTestResult {
    description: string;
    passed: boolean;
    error?: string; // Optional, only present if `passed` is false
}

type PluginTestFn = (description: string, callback: () => void) => void

export interface PluginExposeContext {
    base64: {
        toUint8Array: (base64: string) => Uint8Array
        fromUint8Array: (uint8Array: Uint8Array) => string
    },
    arrayBuffer: {
        toString: (buffer: ArrayBuffer) => string
        fromString: (base64: string) => ArrayBuffer
    },
    getEnvVar: (objectPath: string) => any
    setEnvVar: (objectPath: string, value: string) => void
    setParentEnvVar: (objectPath: string, value: string) => void
    request?: any
    response?: any
}

export interface PluginExpose {
    context: PluginExposeContext,
    rf: PluginExposeContext,
    test: PluginTestFn
}

export interface OpenApiSpecPathParams {
    paths: {
        [x: string]: {
            [x:string]:{
                parameters?: {
                    name: 'string',
                    in: 'path' | 'else',
                    schema?: {
                        example?: string
                    }
                }[]
            }
        }
    }
}

export interface EditorConfig {
    indentSize: number
}

export type SetEnvironmentVariableFunction = (name: string, value: string, scope?: 'workspace' | 'folder', pluginCollectionId?: string | null) => void
