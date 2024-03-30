import dedent from 'dedent'

const plugin = {
    availableRequestMethods: dedent`
        // context.request.getMethod()
        // context.request.getEnvironmentVariable('<ENVIRONMENT_VARIABLE_NAME>')
        // context.request.setEnvironmentVariable('<ENVIRONMENT_VARIABLE_NAME>', '<ENVIRONMENT_VARIABLE_VALUE>')
        // context.request.getHeader('<HEADER_NAME>')
        // context.request.setHeader('<HEADER_NAME>', '<HEADER_VALUE>') - sets header value
        // context.request.getHeaders()
        // context.request.setHeaders(<HEADER_ARRAY>) - replaces all headers with contents of <HEADER_ARRAY>
        // context.request.getURL()
        // context.request.getBody()
        // context.request.setBody(<REQUEST_BODY_OBJECT>)
        // context.request.getQueryParams()
        // context.request.setQueryParams(<REQUEST_QUERY_PARAMS_ARRAY>)
    `,
    availableResponseMethods: dedent`
        // context.response.getEnvironmentVariable('<ENVIRONMENT_VARIABLE_NAME>')
        // context.response.setEnvironmentVariable('<ENVIRONMENT_VARIABLE_NAME>', '<ENVIRONMENT_VARIABLE_VALUE>')
        // context.response.getHeader('<HEADER_NAME>')
        // context.response.getHeaders()
        // context.response.getURL()
        // context.response.getBody() - returns ArrayBuffer
        // context.response.setBody(<RESPONSE_BODY_ARRAY_BUFFER>)
        // context.response.getBodyText() - returns context.response.getBody() ArrayBuffer as text
        // context.response.setBodyText(<RESPONSE_BODY_TEXT>) - sets given text as context.response.setBody(<RESPONSE_BODY_ARRAY_BUFFER>)
    `,
    generalMethods: dedent`
        // console.log(...)
    `
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
        ELECTRON_SWITCH_TO_CHROMIUM_FETCH: 'Restfox-ElectronSwitchToChromiumFetch',
        GENERATE_CODE_LANGUAGE: 'Restfox-GenerateCodeLanguage',
        GENERATE_CODE_CLIENT: 'Restfox-GenerateCodeClient',
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
            // Available methods:
            ${plugin.availableRequestMethods}
            ${plugin.availableResponseMethods}
            ${plugin.generalMethods}

            function handleRequest() {
                console.log(context.request.getBody())
            }

            function handleResponse() {
                console.log(context.response.getBody())
            }

            if('request' in context) {
                handleRequest()
            }

            if('response' in context) {
                handleResponse()
            }
        ` + '\n',
        SCRIPT: {
            PRE_REQUEST: dedent`
                // Available methods:
                ${plugin.availableRequestMethods}
                ${plugin.generalMethods}
            ` + '\n\n',
            POST_REQUEST: dedent`
                // Available methods:
                ${plugin.availableResponseMethods}
                ${plugin.generalMethods}
            ` + '\n\n',
        }
    },
}
