import dedent from 'dedent'

const plugin = {
    generalMethods: dedent`
        // console.log(...)
    `,
    generalContextMethods: dedent`
        // rf.getEnvVar('<ENVIRONMENT_VARIABLE_NAME>')
        // rf.setEnvVar('<ENVIRONMENT_VARIABLE_NAME>', '<ENVIRONMENT_VARIABLE_VALUE>')
    `,
    availableRequestMethods: dedent`
        // rf.request.getMethod()
        // rf.request.getURL()
        // rf.request.getHeader('<HEADER_NAME>')
        // rf.request.setHeader('<HEADER_NAME>', '<HEADER_VALUE>') - sets header value
        // rf.request.getHeaders()
        // rf.request.setHeaders(<HEADER_ARRAY>) - replaces all headers with contents of <HEADER_ARRAY>
        // rf.request.getBody()
        // rf.request.setBody(<REQUEST_BODY_OBJECT>)
        // rf.request.getQueryParams()
        // rf.request.setQueryParams(<REQUEST_QUERY_PARAMS_ARRAY>)
    `,
    availableResponseMethods: dedent`
        // rf.response.getURL()
        // rf.response.getHeader('<HEADER_NAME>')
        // rf.response.getHeaders()
        // rf.response.getBody() - returns ArrayBuffer
        // rf.response.setBody(<RESPONSE_BODY_ARRAY_BUFFER>)
        // rf.response.getBodyText() - returns rf.response.getBody() ArrayBuffer as text
        // rf.response.setBodyText(<RESPONSE_BODY_TEXT>) - sets given text as rf.response.setBody(<RESPONSE_BODY_ARRAY_BUFFER>)
        // rf.response.getBodyJSON() - returns rf.response.getBody() ArrayBuffer as a JSON object
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
            ${plugin.generalMethods}
            ${plugin.generalContextMethods}
            ${plugin.availableRequestMethods}
            ${plugin.availableResponseMethods}

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
            PRE_REQUEST: dedent`
                // Available methods:
                ${plugin.generalMethods}
                ${plugin.generalContextMethods}
                ${plugin.availableRequestMethods}
            ` + '\n\n',
            POST_REQUEST: dedent`
                // Available methods:
                ${plugin.generalMethods}
                ${plugin.generalContextMethods}
                ${plugin.availableResponseMethods}
            ` + '\n\n',
        }
    },
}
