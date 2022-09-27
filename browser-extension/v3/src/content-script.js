function init() {
    if('contentScriptLoaded' in window) {
        return
    }

    window.contentScriptLoaded = true

    window.addEventListener('message', message => {
        if(message.data.event === 'sendRequest') {
            chrome.runtime.sendMessage(message.data, receivedMessage => {
                if(receivedMessage.event === 'response') {
                    receivedMessage.eventData.buffer = new Uint8Array(receivedMessage.eventData.buffer).buffer
                    window.postMessage(receivedMessage)
                }

                if(receivedMessage.event === 'responseError') {
                    receivedMessage.eventData = new Error(receivedMessage.eventData)
                    window.postMessage(receivedMessage)
                }
            })
        }

        if(message.data.event === 'cancelRequest') {
            chrome.runtime.sendMessage(message.data)
        }
    })

    chrome.runtime.onMessage.addListener((message) => {
        if(message.event === '__EXTENSION_HOOK__' || message.event === '__EXTENSION_UN_HOOK__') {
            window.postMessage(message)
        }
    })
}

init()
