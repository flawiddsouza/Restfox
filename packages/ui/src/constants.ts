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
                }
            ],
        }
    },
    MIME_TYPE: {
        FORM_URL_ENCODED: 'application/x-www-form-urlencoded',
        FORM_DATA: 'multipart/form-data',
        TEXT_PLAIN: 'text/plain',
        JSON: 'application/json',
        GRAPHQL: 'application/graphql',
        OCTET_STREAM: 'application/octet-stream',
        XML: 'application/xml'
    },
    STATUS_CODE_TEXT_MAPPING: {
        '100': 'Continue',
        '101': 'Switching Protocols',
        '102': 'Processing',
        '103': 'Early Hints',
        '200': 'OK',
        '201': 'Created',
        '202': 'Accepted',
        '203': 'Non-Authoritative Information',
        '204': 'No Content',
        '205': 'Reset Content',
        '206': 'Partial Content',
        '207': 'Multi-Status',
        '208': 'Already Reported',
        '226': 'IM Used',
        '300': 'Multiple Choices',
        '301': 'Moved Permanently',
        '302': 'Found',
        '303': 'See Other',
        '304': 'Not Modified',
        '305': 'Use Proxy',
        '307': 'Temporary Redirect',
        '308': 'Permanent Redirect',
        '400': 'Bad Request',
        '401': 'Unauthorized',
        '402': 'Payment Required',
        '403': 'Forbidden',
        '404': 'Not Found',
        '405': 'Method Not Allowed',
        '406': 'Not Acceptable',
        '407': 'Proxy Authentication Required',
        '408': 'Request Timeout',
        '409': 'Conflict',
        '410': 'Gone',
        '411': 'Length Required',
        '412': 'Precondition Failed',
        '413': 'Payload Too Large',
        '414': 'URI Too Long',
        '415': 'Unsupported Media Type',
        '416': 'Range Not Satisfiable',
        '417': 'Expectation Failed',
        '418': 'I\'m a teapot',
        '421': 'Misdirected Request',
        '422': 'Unprocessable Entity',
        '423': 'Locked',
        '424': 'Failed Dependency',
        '425': 'Too Early',
        '426': 'Upgrade Required',
        '428': 'Precondition Required',
        '429': 'Too Many Requests',
        '431': 'Request Header Fields Too Large',
        '451': 'Unavailable For Legal Reasons',
        '500': 'Internal Server Error',
        '501': 'Not Implemented',
        '502': 'Bad Gateway',
        '503': 'Service Unavailable',
        '504': 'Gateway Timeout',
        '505': 'HTTP Version Not Supported',
        '506': 'Variant Also Negotiates',
        '507': 'Insufficient Storage',
        '508': 'Loop Detected',
        '510': 'Not Extended',
        '511': 'Network Authentication Required'
    },
    DEFAULT_ENVIRONMENT: {
        name: 'Default',
        color: '#000000',
    }
}
