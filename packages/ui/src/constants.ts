import dedent from 'dedent'
import { snippet } from '@codemirror/autocomplete'

const autocompleteGeneralMethods = []

if(import.meta.env.MODE === 'desktop-electron') {
    autocompleteGeneralMethods.push({
        label: 'await readFile(path)',
        type: 'function',
        info: 'Reads the content of a file at the specified path',
        apply: snippet('await readFile(${path})')
    })
}

export default {
    LOCAL_STORAGE_KEY: {
        ACTIVE_WORKSPACE_ID: 'Restfox-ActiveWorkspaceId',
        SIDEBAR_WIDTH: 'Restfox-SidebarWidth',
        REQUEST_PANEL_RATIO: 'Restfox-RequestPanelRatio',
        RESPONSE_PANEL_RATIO: 'Restfox-ResponsePanelRatio',
        REQUEST_RESPONSE_LAYOUT: 'Restfox-RequestResponseLayout',
        THEME: 'Restfox-Theme',
        GITHUB_STAR_COUNT: 'Restfox-GithubStarCount',
        DISABLE_PAGE_VIEW_ANALYTICS_TRACKING: 'Restfox-DisablePageViewAnalyticsTracking',
        DISABLE_SSL_VERIFICATION: 'Restfox-DisableSSLVerification',
        DISABLE_IFRAME_SANDBOX: 'Restfox-DisableIframeSandbox',
        DISABLE_AUTO_UPDATE: 'Restfox-DisableAutoUpdate',
        ELECTRON_SWITCH_TO_CHROMIUM_FETCH: 'Restfox-ElectronSwitchToChromiumFetch',
        GENERATE_CODE_LANGUAGE: 'Restfox-GenerateCodeLanguage',
        GENERATE_CODE_CLIENT: 'Restfox-GenerateCodeClient',
        GLOBAL_USER_AGENT: 'Restfox-GlobalUserAgent',
        INDENT_SIZE: 'Restfox-IndentSize',
        SHOW_TABS: 'Restfox-ShowTabs',
        HIDE_PASSWORD_FIELDS: 'Restfox-HidePasswordFields',
        CUSTOM_RESPONSE_FORMATS: 'Restfox-CustomResponseFormats',
    },
    HOTKEYS: {
        SEND_REQUEST: 'Ctrl + Enter',
        SWITCH_TO_NEXT_TAB: 'Ctrl + Tab',
        SWITCH_TO_PREVIOUS_TAB: 'Ctrl + Shift + Tab',
        SWITCH_TO_NEXT_TAB_ALTERNATE: 'Ctrl + Alt + ArrowRight',
        SWITCH_TO_PREVIOUS_TAB_ALTERNATE: 'Ctrl + Alt + ArrowLeft',
        CLOSE_TAB: 'Ctrl + W',
        CLOSE_TAB_ALTERNATE: 'Ctrl + Alt + W'
    },
    DEFAULT_LIMITS: {
        RESPONSE_HISTORY: 20
    },
    CODE_EXAMPLE: {
        PLUGIN: dedent`
            function preRequest() {
                console.log(rf.request.getBody())
            }

            function postRequest() {
                console.log(rf.response.getBody())
            }

            if('request' in rf) {
                preRequest()
            }

            if('response' in rf) {
                postRequest()
            }
        ` + '\n',
        SCRIPT: {
            PRE_REQUEST: '',
            POST_REQUEST: '',
        }
    },
    AUTOCOMPLETIONS: {
        PLUGIN: {
            GENERAL_METHODS: [
                {
                    label: 'console.log(message)',
                    type: 'function',
                    info: 'Logs information to the console',
                    apply: snippet('console.log(${message})')
                },
                {
                    label: 'alert(message)',
                    type: 'function',
                    info: 'Displays an alert dialog box with a specified message and an OK button',
                    apply: snippet('alert(${message})')
                },
                {
                    label: `rf.getEnvVar(name)`,
                    type: 'function',
                    info: 'Gets the value of an environment variable',
                    apply: snippet(`rf.getEnvVar($\{name})`)
                },
                {
                    label: `rf.setEnvVar(name, value)`,
                    type: 'function',
                    info: 'Sets the value of an environment variable',
                    apply: snippet(`rf.setEnvVar($\{name}, $\{value})`)
                },
                {
                    label: 'rf.arrayBuffer.toString(buffer)',
                    type: 'function',
                    info: 'Converts an ArrayBuffer to a string',
                    apply: snippet('rf.arrayBuffer.toString(${buffer})')
                },
                {
                    label: 'rf.arrayBuffer.fromString(string)',
                    type: 'function',
                    info: 'Converts a string to an ArrayBuffer',
                    apply: snippet('rf.arrayBuffer.fromString(${string})')
                },
                {
                    label: 'rf.base64.toUint8Array(base64)',
                    type: 'function',
                    info: 'Converts a base64 encoded string to a Uint8Array',
                    apply: snippet('rf.base64.toUint8Array(${base64})')
                },
                {
                    label: 'rf.base64.fromUint8Array(uint8Array)',
                    type: 'function',
                    info: 'Converts a Uint8Array to a base64 encoded string',
                    apply: snippet('rf.base64.fromUint8Array(${uint8Array})')
                },
                {
                    label: 'fetchSync(url, options)',
                    type: 'function',
                    info: 'Performs a synchronous HTTP fetch operation',
                    apply: snippet('fetchSync(${url}, ${options})')
                },
                ...autocompleteGeneralMethods,
            ],
            REQUEST_METHODS: [
                {
                    label: 'rf.request.getMethod()',
                    type: 'function',
                    info: 'Gets the HTTP request method'
                },
                {
                    label: 'rf.request.getURL()',
                    type: 'function',
                    info: 'Gets the URL of the request'
                },
                {
                    label: 'rf.request.getHeader(name)',
                    type: 'function',
                    info: 'Gets a specific header from the request',
                    apply: snippet('rf.request.getHeader(${name})')
                },
                {
                    label: 'rf.request.setHeader(name, value)',
                    type: 'function',
                    info: 'Sets a specific header value for the request',
                    apply: snippet('rf.request.setHeader(${name}, ${value})')
                },
                {
                    label: 'rf.request.getHeaders()',
                    type: 'function',
                    info: 'Gets all the headers from the request'
                },
                {
                    label: 'rf.request.setHeaders(headers)',
                    type: 'function',
                    info: 'Replaces all headers with the contents of the provided array',
                    apply: snippet('rf.request.setHeaders(${headers})')
                },
                {
                    label: 'rf.request.getBody()',
                    type: 'function',
                    info: 'Gets the body of the request'
                },
                {
                    label: 'rf.request.setBody(body)',
                    type: 'function',
                    info: 'Sets the body of the request',
                    apply: snippet('rf.request.setBody(${body})')
                },
                {
                    label: 'rf.request.getQueryParams()',
                    type: 'function',
                    info: 'Gets the query parameters of the request'
                },
                {
                    label: 'rf.request.setQueryParams(queryParams)',
                    type: 'function',
                    info: 'Sets the query parameters of the request',
                    apply: snippet('rf.request.setQueryParams(${queryParams})')
                },
                {
                    label: 'rf.request.getPathParams()',
                    type: 'function',
                    info: 'Gets the path parameters of the request'
                },
                {
                    label: 'rf.request.setPathParams(pathParams)',
                    type: 'function',
                    info: 'Sets or replaces path parameters with the provided array',
                    apply: snippet('rf.request.setPathParams(${pathParams})')
                }
            ],
            RESPONSE_METHODS: [
                {
                    label: 'rf.response.getURL()',
                    type: 'function',
                    info: 'Gets the URL of the response'
                },
                {
                    label: 'rf.response.getHeader(name)',
                    type: 'function',
                    info: 'Gets a specific header from the response',
                    apply: snippet('rf.response.getHeader(${name})')
                },
                {
                    label: 'rf.response.getHeaders()',
                    type: 'function',
                    info: 'Gets all the headers from the response'
                },
                {
                    label: 'rf.response.setHeader(name, value)',
                    type: 'function',
                    info: 'Sets a specific header value for the response',
                    apply: snippet('rf.response.setHeader(${name}, ${value})')
                },
                {
                    label: 'rf.response.getBody()',
                    type: 'function',
                    info: 'Gets the body of the response as an ArrayBuffer'
                },
                {
                    label: 'rf.response.setBody(body)',
                    type: 'function',
                    info: 'Sets the body of the response with an ArrayBuffer',
                    apply: snippet('rf.response.setBody(${body})')
                },
                {
                    label: 'rf.response.getBodyText()',
                    type: 'function',
                    info: 'Returns the response body as text'
                },
                {
                    label: 'rf.response.setBodyText(bodyText)',
                    type: 'function',
                    info: 'Sets the given text as the body of the response',
                    apply: snippet('rf.response.setBodyText(${bodyText})')
                },
                {
                    label: 'rf.response.getBodyJSON()',
                    type: 'function',
                    info: 'Returns the response body as a parsed JSON object'
                },
                {
                    label: 'rf.response.getStatusCode()',
                    type: 'function',
                    info: 'Returns the status code of the response',
                },
                {
                    info: 'Returns the response time in milliseconds',
                    type: 'function',
                    label: 'rf.response.getResponseTime()'
                }
            ],
        },
        TAGS: [
            {
                label: 'response()',
                type: 'function',
                apply: snippet('{% response() %}')
            }
        ],
    },
    MIME_TYPE: {
        FORM_URL_ENCODED: 'application/x-www-form-urlencoded',
        FORM_DATA: 'multipart/form-data',
        TEXT_PLAIN: 'text/plain',
        JSON: 'application/json',
        JAVASCRIPT: 'application/javascript',
        GRAPHQL: 'application/graphql',
        OCTET_STREAM: 'application/octet-stream',
        XML: 'application/xml',
        TEXT_CSV: 'text/csv',
    },
    STATUS_CODE_TEXT_MAPPING: {
        '100': { 'title': 'Continue', 'description': 'The server has received the request headers and the client should proceed to send the request body.' },
        '101': { 'title': 'Switching Protocols', 'description': 'The requester has asked the server to switch protocols, and the server is acknowledging that it will do so.' },
        '102': { 'title': 'Processing', 'description': 'A WebDAV request may take longer to process, so the server sends this code to indicate that it has received and is processing the request.' },
        '103': { 'title': 'Early Hints', 'description': 'Primarily intended to be used with the Link header, letting the user-agent start preloading resources while the server prepares a final response.' },
        '200': { 'title': 'OK', 'description': 'The request has succeeded. The content sent in the response body will depend on the method used in the request.' },
        '201': { 'title': 'Created', 'description': 'The request has been fulfilled, resulting in the creation of a new resource.' },
        '202': { 'title': 'Accepted', 'description': 'The request has been accepted for processing, but the processing has not been completed yet.' },
        '203': { 'title': 'Non-Authoritative Information', 'description': 'The request was successful but the information may come from a third-party source and not the originating server.' },
        '204': { 'title': 'No Content', 'description': 'The server successfully processed the request and is not returning any content.' },
        '205': { 'title': 'Reset Content', 'description': 'The server successfully processed the request, but is instructing the client to reset the view.' },
        '206': { 'title': 'Partial Content', 'description': 'The server is delivering only part of the resource due to a range header sent by the client.' },
        '207': { 'title': 'Multi-Status', 'description': 'Provides information about multiple resources in situations where multiple actions were taken, typically used in WebDAV.' },
        '208': { 'title': 'Already Reported', 'description': 'The members of a DAV binding have already been enumerated in a previous reply to this request, and are not being included again.' },
        '226': { 'title': 'IM Used', 'description': 'The server has fulfilled a GET request for the resource, and the response is a representation of the result of one or more instance-manipulations applied to the current instance.' },
        '300': { 'title': 'Multiple Choices', 'description': 'The request has more than one possible response. User-agent or user should choose one of them.' },
        '301': { 'title': 'Moved Permanently', 'description': 'The requested resource has been permanently moved to a new URL.' },
        '302': { 'title': 'Found', 'description': 'The requested resource resides temporarily under a different URL, but future requests should use the original URL.' },
        '303': { 'title': 'See Other', 'description': 'The response to the request can be found under another URI using a GET method.' },
        '304': { 'title': 'Not Modified', 'description': 'Indicates that the resource has not been modified since the version specified by the request headers.' },
        '305': { 'title': 'Use Proxy', 'description': 'The requested resource is available only through a proxy, whose address is provided in the response.' },
        '307': { 'title': 'Temporary Redirect', 'description': 'The requested resource resides temporarily under a different URL, and the client should use the same method for the next request.' },
        '308': { 'title': 'Permanent Redirect', 'description': 'The resource has been permanently moved to a new URL and all future requests should use that new URL.' },
        '400': { 'title': 'Bad Request', 'description': 'The server cannot or will not process the request due to an apparent client error (e.g., malformed request syntax, invalid request).' },
        '401': { 'title': 'Unauthorized', 'description': 'Authentication is required and has failed or has not yet been provided.' },
        '402': { 'title': 'Payment Required', 'description': 'Reserved for future use, originally created to enable digital payment systems.' },
        '403': { 'title': 'Forbidden', 'description': 'The request was valid, but the server is refusing to respond to it. The client does not have permission to access the resource.' },
        '404': { 'title': 'Not Found', 'description': 'The requested resource could not be found but may be available in the future.' },
        '405': { 'title': 'Method Not Allowed', 'description': 'A request method is not supported for the requested resource.' },
        '406': { 'title': 'Not Acceptable', 'description': 'The requested resource is only capable of generating content not acceptable according to the Accept headers sent in the request.' },
        '407': { 'title': 'Proxy Authentication Required', 'description': 'The client must authenticate itself with the proxy.' },
        '408': { 'title': 'Request Timeout', 'description': 'The server timed out waiting for the request.' },
        '409': { 'title': 'Conflict', 'description': 'Indicates that the request could not be processed because of conflict in the request, such as an edit conflict between multiple simultaneous updates.' },
        '410': { 'title': 'Gone', 'description': 'The resource requested is no longer available and will not be available again.' },
        '411': { 'title': 'Length Required', 'description': 'The request did not specify the length of its content, which is required by the requested resource.' },
        '412': { 'title': 'Precondition Failed', 'description': 'The server does not meet one of the preconditions that the requester put on the request.' },
        '413': { 'title': 'Payload Too Large', 'description': 'The request is larger than the server is willing or able to process.' },
        '414': { 'title': 'URI Too Long', 'description': 'The URI provided was too long for the server to process.' },
        '415': { 'title': 'Unsupported Media Type', 'description': 'The request entity has a media type which the server or resource does not support.' },
        '416': { 'title': 'Range Not Satisfiable', 'description': 'The client has asked for a portion of the file (byte serving), but the server cannot supply that portion.' },
        '417': { 'title': 'Expectation Failed', 'description': 'The server cannot meet the requirements of the Expect request-header field.' },
        '418': { 'title': 'I\'m a teapot', 'description': 'This code was defined as an April Fools\' joke in 1998, and is not expected to be implemented by actual HTTP servers.' },
        '421': { 'title': 'Misdirected Request', 'description': 'The request was directed at a server that is not able to produce a response.' },
        '422': { 'title': 'Unprocessable Entity', 'description': 'The request was well-formed but was unable to be followed due to semantic errors, typically used in WebDAV.' },
        '423': { 'title': 'Locked', 'description': 'The resource that is being accessed is locked, typically used in WebDAV.' },
        '424': { 'title': 'Failed Dependency', 'description': 'The request failed due to failure of a previous request, typically used in WebDAV.' },
        '425': { 'title': 'Too Early', 'description': 'Indicates that the server is unwilling to risk processing a request that might be replayed.' },
        '426': { 'title': 'Upgrade Required', 'description': 'The client should switch to a different protocol, such as TLS/1.3, given in the Upgrade header field.' },
        '428': { 'title': 'Precondition Required', 'description': 'The server requires the request to be conditional, typically to prevent lost updates.' },
        '429': { 'title': 'Too Many Requests', 'description': 'The user has sent too many requests in a given amount of time.' },
        '431': { 'title': 'Request Header Fields Too Large', 'description': 'The server is unwilling to process the request because its header fields are too large.' },
        '451': { 'title': 'Unavailable For Legal Reasons', 'description': 'The server is denying access to the resource as a consequence of a legal demand.' },
        '500': { 'title': 'Internal Server Error', 'description': 'The server encountered an unexpected condition that prevented it from fulfilling the request.' },
        '501': { 'title': 'Not Implemented', 'description': 'The server does not support the functionality required to fulfill the request.' },
        '502': { 'title': 'Bad Gateway', 'description': 'The server was acting as a gateway or proxy and received an invalid response from the upstream server.' },
        '503': { 'title': 'Service Unavailable', 'description': 'The server is currently unavailable (because it is overloaded or down for maintenance).' },
        '504': { 'title': 'Gateway Timeout', 'description': 'The server was acting as a gateway or proxy and did not receive a timely response from the upstream server.' },
        '505': { 'title': 'HTTP Version Not Supported', 'description': 'The server does not support the HTTP protocol version used in the request.' },
        '506': { 'title': 'Variant Also Negotiates', 'description': 'The server has an internal configuration error.' },
        '507': { 'title': 'Insufficient Storage', 'description': 'The server is unable to store the representation needed to complete the request.' },
        '508': { 'title': 'Loop Detected', 'description': 'The server detected an infinite loop while processing a request.' },
        '510': { 'title': 'Not Extended', 'description': 'Further extensions to the request are required for the server to fulfill it.' },
        '511': { 'title': 'Network Authentication Required', 'description': 'The client needs to authenticate to gain network access.' }
    },
    DEFAULT_ENVIRONMENT: {
        name: 'Default',
        color: 'var(--text-color)',
    },
    POSTMAN_SCHEMA: {
        'v2.0': 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json',
        'v2.1': 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    EDITOR_CONFIG: {
        indent_size: '4',
    },
    GRANT_TYPES: {
        'password_credentials': 'password',
        'client_credentials': 'client_credentials',
        'refresh_token': 'refresh_token',
    },
    REQUESTS: {
        http: {
            title: 'HTTP Request',
            alt: 'HTTP Request',
            type: 'http-request'
        },
        graphql: {
            title: 'GraphQL Request',
            alt: 'GraphQL Request',
            type: 'graphql-request'
        },
        websocket: {
            title: 'Websocket Request',
            alt: 'Websocket Request',
            type: 'websocket-request'
        }
    }
}
