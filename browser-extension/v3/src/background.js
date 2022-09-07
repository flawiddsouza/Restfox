import { getKey, setKey } from './helpers.js'

const domains = [
    'restfox.dev'
]

async function isRestfoxTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })

    if(!tab) {
        return false
    }

    if('url' in tab === false) {
        return false
    }

    if(tab.url.startsWith(`https://${domains[0]}`) === false) {
        return false
    }

    return tab
}

async function tabChanged() {
    await chrome.action.setIcon({
        path: 'icons/favicon-disabled-128.png'
    })

    const tab = await isRestfoxTab()

    if(tab === false) {
        return
    }

    const extensionDisabled = await getKey('extensionDisabled')
    if(!extensionDisabled) {
        chrome.action.setIcon({
            path: 'icons/favicon-128.png'
        })
    }

    chrome.scripting.executeScript({
        target: {
            tabId: tab.id
        },
        files: [
            'content-script.js'
        ]
    })
}

const corsBypassRule = {
    id: 1,
    priority: 1,
    action: {
        type: 'modifyHeaders',
        responseHeaders: [
            {
                operation: 'set',
                header: 'Access-Control-Allow-Origin',
                value: '*'
            },
            {
                operation: 'set',
                header: 'Access-Control-Allow-Methods',
                value: '*'
            },
            {
                operation: 'set',
                header: 'Access-Control-Allow-Headers',
                value: '*'
            },
            {
                operation: 'set',
                header: 'Access-Control-Expose-Headers',
                value: '*'
            }
        ]
    },
    condition: {
        initiatorDomains: domains
    }
}

async function handleAction() {
    if(await isRestfoxTab() === false) {
        return
    }

    let extensionDisabled = await getKey('extensionDisabled')
    extensionDisabled = !extensionDisabled
    await setKey('extensionDisabled', extensionDisabled)

    if(extensionDisabled) {
        chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [1]
        })
        chrome.action.setIcon({
            path: 'icons/favicon-disabled-128.png'
        })
    } else {
        chrome.declarativeNetRequest.updateDynamicRules({
            addRules: [corsBypassRule]
        })
        chrome.action.setIcon({
            path: 'icons/favicon-128.png'
        })
    }
}

async function init() {
    chrome.action.setIcon({
        path: 'icons/favicon-disabled-128.png'
    })

    chrome.tabs.onUpdated.removeListener(tabChanged)
    chrome.tabs.onUpdated.addListener(tabChanged)

    chrome.tabs.onActivated.removeListener(tabChanged)
    chrome.tabs.onActivated.addListener(tabChanged)

    chrome.action.onClicked.removeListener(handleAction)
    chrome.action.onClicked.addListener(handleAction)

    const extensionDisabled = await getKey('extensionDisabled')
    if(!extensionDisabled) {
        chrome.action.setIcon({
            path: 'icons/favicon-128.png'
        })
    }
}

chrome.runtime.onInstalled.addListener(async() => {
    chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [corsBypassRule],
        removeRuleIds: [1]
    })

    init()
})

init()
