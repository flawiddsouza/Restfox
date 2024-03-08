import { getKey, setKey } from './helpers.js'

const domains = [
    'https://restfox.dev'
]

async function isRestfoxTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })

    if(!tab) {
        return false
    }

    if('url' in tab === false) {
        return false
    }

    if(tab.url.startsWith(`${domains[0]}`) === false) {
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

    // chrome.scripting.executeScript needs to come before chrome.tabs.sendMessage
    // if there's a message that the injected content script has to receive
    chrome.scripting.executeScript({
        target: {
            tabId: tab.id
        },
        files: [
            'content-script.js'
        ]
    })

    const extensionDisabled = await getKey('extensionDisabled')
    if(!extensionDisabled) {
        chrome.action.setIcon({
            path: 'icons/favicon-128.png'
        })

        chrome.tabs.sendMessage(tab.id, {
            event: '__EXTENSION_HOOK__',
            eventData: 'Restfox CORS Helper Enabled'
        })
    }
}

async function handleAction() {
    const tab = await isRestfoxTab()

    if(tab === false) {
        return
    }

    let extensionDisabled = await getKey('extensionDisabled')
    extensionDisabled = !extensionDisabled
    await setKey('extensionDisabled', extensionDisabled)

    if(extensionDisabled) {
        chrome.action.setIcon({
            path: 'icons/favicon-disabled-128.png'
        })

        chrome.tabs.sendMessage(tab.id, {
            event: '__EXTENSION_UN_HOOK__',
            eventData: 'Restfox CORS Helper Disabled'
        })
    } else {
        chrome.action.setIcon({
            path: 'icons/favicon-128.png'
        })

        chrome.tabs.sendMessage(tab.id, {
            event: '__EXTENSION_HOOK__',
            eventData: 'Restfox CORS Helper Enabled'
        })
    }
}

let abortController = new Map()

async function handleSendRequest(message, sendResponse) {
    const { eventId } = message

    try {
        const { url, method, headers, bodyHint } = message.eventData
        let { body } = message.eventData

        abortController.set(eventId, new AbortController())

        if(bodyHint === 'FormData') {
            const formData = new FormData()
            for(const item of body) {
                const value = typeof item[1] !== 'object' ? item[1] : new File([new Uint8Array(item[1].buffer)], item[1].name, { type: item[1].type })
                formData.append(item[0], value)
            }
            body = formData
        }

        if(bodyHint === 'File') {
            body = new File([new Uint8Array(body.buffer)], body.name, { type: body.type })
        }

        const startTime = new Date()

        const response = await fetch(url, {
            method,
            headers,
            body: method !== 'GET' ? body : undefined,
            signal: abortController.get(eventId).signal
        })

        const endTime = new Date()

        const status = response.status
        const statusText = response.statusText
        const responseHeaders = [...response.headers.entries()]

        const responseBlob = await response.blob()
        const mimeType = responseBlob.type
        const buffer = await responseBlob.arrayBuffer()

        const timeTaken = endTime - startTime

        const responseToSend = {
            status,
            statusText,
            headers: responseHeaders,
            mimeType,
            buffer: Array.from(new Uint8Array(buffer)),
            timeTaken
        }

        sendResponse({
            event: 'response',
            eventId,
            eventData: responseToSend
        })
    } catch(e) {
        sendResponse({
            event: 'responseError',
            eventId,
            eventData: e.message
        })
    }
}

function messageHandler(message, _sender, sendResponse) {
    if(message.event === 'sendRequest') {
        handleSendRequest(message, sendResponse)
    }

    if(message.event === 'cancelRequest') {
        abortController.get(message.eventId).abort()
    }

    if(message.event === 'ping') {
        sendResponse({
            event: 'pong'
        })
    }

    // Needed because: https://stackoverflow.com/a/59915897
    return true
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

    chrome.runtime.onMessage.removeListener(messageHandler)
    chrome.runtime.onMessage.addListener(messageHandler)
}

chrome.runtime.onInstalled.addListener(async() => {
    init()
})

init()
