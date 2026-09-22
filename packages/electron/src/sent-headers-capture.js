const { AsyncLocalStorage } = require('node:async_hooks')
const diagnosticsChannel = require('node:diagnostics_channel')

// undici reports what it sends through diagnostics channels, the request it creates inside fetch
// is tied back to the calling fetch through async context so concurrent requests stay apart
const sentHeadersCapture = new AsyncLocalStorage()
const coreRequestCaptures = new WeakMap()

// turns "name: value\r\n" lines into [name, value] pairs in wire order
function parseHeaderBlock(block) {
    return block.split('\r\n').filter(line => line !== '').map(line => {
        const separator = line.indexOf(': ')
        return separator === -1 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 2)]
    })
}

diagnosticsChannel.subscribe('undici:request:create', ({ request }) => {
    const capture = sentHeadersCapture.getStore()
    if(capture) {
        coreRequestCaptures.set(request, capture)
    }
})

diagnosticsChannel.subscribe('undici:client:sendHeaders', ({ request, headers, socket }) => {
    const capture = coreRequestCaptures.get(request)

    // only the first hop is kept, a redirect sends a further request that the timeline does not show
    if(!capture || capture.headers !== null) {
        return
    }

    if(socket.alpnProtocol === 'h2') {
        // HTTP/2 has no request line and the published block is the complete header list, pseudo headers included
        capture.headers = parseHeaderBlock(headers)
        return
    }

    // for HTTP/1.1 undici publishes the block before it appends content-length or transfer-encoding,
    // so read what reaches the socket up to the blank line that ends the headers
    let raw = ''
    const originalWrite = socket.write

    const finish = () => {
        socket.write = originalWrite
        socket.removeListener('close', finish)
    }

    socket.write = function(chunk, ...args) {
        raw += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('latin1')
        const headerEnd = raw.indexOf('\r\n\r\n')
        if(headerEnd !== -1) {
            capture.headers = parseHeaderBlock(raw.slice(raw.indexOf('\r\n') + 2, headerEnd))
            finish()
        }
        return originalWrite.call(this, chunk, ...args)
    }

    socket.once('close', finish)
})

// runs the given fetch and returns its result together with the request headers that went over the wire,
// headersSent is null when the transport did not report them
async function withSentHeadersCapture(run) {
    const capture = { headers: null }
    const result = await sentHeadersCapture.run(capture, run)
    return { result, headersSent: capture.headers }
}

module.exports = {
    withSentHeadersCapture,
}
