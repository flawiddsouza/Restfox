export {}

declare global {
    interface Window {
        electronIPC: any
        __EXTENSION_HOOK__: any
    }

    interface ImportMeta {
        env: {
            MODE: string
        }
    }
}

export interface Request {
    _id: string
    _type: 'request' | 'request_group' | 'socket'
    name: string
    children?: Request[]
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
}

export interface RequestAuthentication {
    type: string
    token?: string
}

export interface RequestParam {
    name: string
    value: string
    description: string
    disabled: boolean
}

export interface RequestBody {
    mimeType: string
    text?: string
    params?: RequestParam[]
}

export interface RequestInitialResponse {
    status: number
    statusText: string
    headers: [string, string][]
    mimeType: string
    buffer: ArrayBuffer
    timeTaken: number
}

export interface RequestFinalResponse {
    _id: string
    collectionId: string
    url: string
    status: number
    statusText: string
    headers: [string, string][]
    mimeType: string
    buffer: ArrayBuffer
    timeTaken: number
    request: {
      method: string
      query: string
      headers: Record<string, string>
      body: any
      original: Request
    }
    createdAt: number
    testResults: any[]
}

export interface TreeItem extends Request {
    children?: TreeItem[]
    collapsed?: boolean
}

export interface State {
    collection: Request[]
    collectionTree: TreeItem[]
    tabs: any[]
    activeTab: any | null
    requestResponseStatus: { [key: string]: string }
    requestResponses: { [key: string]: any | null }
    requestAbortController: { [key: string]: AbortController }
    responses: { [key: string]: any[] }
    showImportModal: boolean
    showImportModalSelectedRequestGroupId: string | null
    showBackupAndRestoreModal: boolean
    collectionFilter: string
    activeSidebarItemForContextMenu: string | null
    sidebarContextMenuElement: HTMLElement | null
    workspaces: any[]
    activeWorkspace: any | null
    activeWorkspaceLoaded: boolean
    plugins: {
        global: any[]
        workspace: any[]
    }
    requestResponseLayout: string
    theme: string
    githubStarCount: string
    sidebarItemTemporaryName: { [key: string]: string }
    flags: {
        hideBrowserRelatedResponsePanelErrors: boolean
        browserExtensionEnabled: boolean
        isBrowser: boolean
        isElectron: boolean
        disableSSLVerification: boolean
        electronSwitchToChromiumFetch: boolean
    }
    openContextMenuElement: HTMLElement | null
    sockets: { [key: string]: WebSocket | null }
    activeTabEnvironmentResolved: any
}

export interface Plugin {
    _id: string
    name: string
    code: string
    workspaceId: string | null
    collectionId: string | null
    enabled: boolean
    createdAt: number
    updatedAt: number
}
