function init() {
    if('contentScriptLoaded' in window) {
        return
    }

    window.contentScriptLoaded = true

    // the open port of each request sent with stream, by eventId
    const streamingRequests = new Map()

    // the response comes back in parts as it arrives, each passed on to the page with the request's eventId
    const sendStreamingRequest = ({ eventId, eventData }) => {
        const port = chrome.runtime.connect({ name: 'sendRequest' })
        streamingRequests.set(eventId, port)
        let headReceived = false

        port.onMessage.addListener(receivedMessage => {
            if(receivedMessage.event === 'responseHead') {
                headReceived = true
            }

            if(receivedMessage.event === 'responseData') {
                receivedMessage.eventData = new Uint8Array(receivedMessage.eventData)
            }

            if(receivedMessage.event === 'responseError') {
                receivedMessage.eventData = new Error(receivedMessage.eventData)
            }

            window.postMessage({ ...receivedMessage, eventId })

            if(['responseEnd', 'responseBodyError', 'responseError'].includes(receivedMessage.event)) {
                streamingRequests.delete(eventId)
                port.disconnect()
            }
        })

        // the extension was reloaded, updated or turned off before the response ended
        port.onDisconnect.addListener(() => {
            if(!streamingRequests.has(eventId)) {
                return
            }
            streamingRequests.delete(eventId)
            const reason = 'The Restfox CORS Helper extension stopped before the response ended'
            window.postMessage(headReceived ? { event: 'responseBodyError', eventId, eventData: { message: reason } } : { event: 'responseError', eventId, eventData: new Error(reason) })
        })

        port.postMessage({ eventData })
    }

    window.addEventListener('message', message => {
        if(message.data.event === 'sendRequest' && message.data.stream) {
            sendStreamingRequest(message.data)
            return
        }

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
            const port = streamingRequests.get(message.data.eventId)
            if(port) {
                // the background aborts the request when its port disconnects
                streamingRequests.delete(message.data.eventId)
                port.disconnect()
            } else {
                chrome.runtime.sendMessage(message.data)
            }
        }
    })

    chrome.runtime.onMessage.addListener((message) => {
        if(message.event === '__EXTENSION_HOOK__' || message.event === '__EXTENSION_UN_HOOK__') {
            window.postMessage(message)
        }
    })

    const wakeup = () => {
        setTimeout(function(){
            try {
                chrome.runtime.sendMessage({ event: 'ping' })
            } catch {}
            wakeup()
        }, 1000)
    }

    wakeup()
}

init()
