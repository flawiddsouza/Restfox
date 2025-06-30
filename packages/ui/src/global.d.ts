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
    scope?: string
    clientId?: string
    clientSecret?: string
    grantType?: 'authorization_code' | 'password' | 'client_credentials' | string
    refreshToken?: string
}

export interface FileObject {
    name: string
    type: string
    buffer: ArrayBuffer
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

export interface RequestInitialResponse {
    status: number
    statusText: string
    headers: RequestInitialResponseHeader[]
    mimeType: string
    buffer: ArrayBuffer
    timeTaken: number
    headTimeTaken?: number
    bodyTimeTaken?: number
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
      body: any
      original: CollectionItem
    }
    createdAt: number
    testResults: any[]
    name?: string
}

export interface Flags {
    hideBrowserRelatedResponsePanelErrors: boolean
    browserExtensionEnabled: boolean
    isBrowser: boolean
    isWebStandalone: boolean
    isElectron: boolean
    disableSSLVerification: boolean
    electronSwitchToChromiumFetch: boolean
    hidePasswordFields: boolean
}

export interface Settings {
    customResponseFormats: string[]
}

export interface State {
    consoleLogs: string[]
    collection: CollectionItem[]
    collectionTree: CollectionItem[]
    tabs: CollectionItem[]
    detachedTabs: CollectionItem[]
    activeTab: any | null
    requestResponseStatus: { [key: string]: string }
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
