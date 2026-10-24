import http from 'http'
import net from 'net'
import tls from 'tls'

// a socket to a host and port through a proxy, Custom or System: an HTTP or HTTPS proxy's CONNECT tunnel, or SOCKS5

// how long a proxy, or the target when connecting directly, has to open the tunnel, as long as requests give a connection.
// Kept in an object so the specs can shorten it
export const limits = {
    tunnelTimeoutMs: 10000,
}

function createTimeoutError(what) {
    return Object.assign(new Error(`${what} did not answer within ${limits.tunnelTimeoutMs / 1000} s`), { code: 'ETIMEDOUT' })
}

// destroys what is opening the tunnel once the signal aborts, as when its caller stopped waiting for it. Gives the
// function that stops watching the signal
function destroyOnAbort(signal, destroyable) {
    const onAbort = () => destroyable.destroy(Object.assign(new Error('The tunnel was no longer needed'), { code: 'ABORT_ERR' }))
    if(signal?.aborted) {
        onAbort()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    return () => signal?.removeEventListener('abort', onAbort)
}

export function getProxyAuthorization(proxyUrl) {
    if(!proxyUrl.username) {
        return null
    }

    return `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64')}`
}

function connectToProxy(proxyUrl, tlsOptions) {
    const port = Number(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : proxyUrl.protocol === 'http:' ? 80 : 1080)

    if(proxyUrl.protocol === 'https:') {
        return tls.connect({ host: proxyUrl.hostname, port, servername: net.isIP(proxyUrl.hostname) ? undefined : proxyUrl.hostname, ...tlsOptions })
    }

    return net.connect(port, proxyUrl.hostname)
}

// reads a SOCKS5 answer a byte count at a time, keeping what follows for the tunnel
function createSocketReader(socket) {
    let buffer = Buffer.alloc(0)
    let pending = null

    const settle = () => {
        if(pending && buffer.length >= pending.length) {
            const chunk = buffer.subarray(0, pending.length)
            buffer = buffer.subarray(pending.length)
            const { resolve } = pending
            pending = null
            resolve(chunk)
        }
    }

    const onData = chunk => {
        buffer = Buffer.concat([buffer, chunk])
        settle()
    }
    const onEnd = () => pending?.reject(new Error('The SOCKS5 proxy closed the connection'))
    const onError = error => pending?.reject(error)

    socket.on('data', onData)
    socket.on('end', onEnd)
    socket.on('error', onError)

    return {
        read: length => new Promise((resolve, reject) => {
            pending = { length, resolve, reject }
            settle()
        }),
        release() {
            socket.pause()
            socket.removeListener('data', onData)
            socket.removeListener('end', onEnd)
            socket.removeListener('error', onError)
            if(buffer.length > 0) {
                socket.unshift(buffer)
            }
        },
    }
}

// SOCKS5's address of a target: an IPv4 or IPv6 address as one, anything else as a name for the proxy to look up
function getSocks5Address(host) {
    if(net.isIP(host) === 4) {
        return Buffer.from([1, ...host.split('.').map(Number)])
    }

    // an IPv6 address with an IPv4 part, such as ::ffff:10.0.0.1, goes as a name
    if(net.isIP(host) === 6 && !host.includes('.')) {
        const [head, tail = ''] = host.split('::')
        const headGroups = head === '' ? [] : head.split(':')
        const tailGroups = tail === '' ? [] : tail.split(':')
        const groups = [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill('0'), ...tailGroups]
        return Buffer.from([4, ...groups.flatMap(group => [parseInt(group, 16) >> 8, parseInt(group, 16) & 255])])
    }

    const name = Buffer.from(host)
    return Buffer.concat([Buffer.from([3, name.length]), name])
}

// RFC 1928 with a username and password login from RFC 1929
async function openSocks5Tunnel(proxyUrl, host, port, signal) {
    const socket = net.connect(Number(proxyUrl.port) || 1080, proxyUrl.hostname)
    const timer = setTimeout(() => socket.destroy(createTimeoutError('The SOCKS5 proxy')), limits.tunnelTimeoutMs)
    const stopWatchingSignal = destroyOnAbort(signal, socket)

    try {
        await new Promise((resolve, reject) => {
            socket.once('connect', resolve)
            socket.once('error', reject)
        })
    } catch(e) {
        clearTimeout(timer)
        stopWatchingSignal()
        throw e
    }

    const reader = createSocketReader(socket)

    try {
        const username = proxyUrl.username ? Buffer.from(decodeURIComponent(proxyUrl.username)) : null
        const password = Buffer.from(decodeURIComponent(proxyUrl.password))

        socket.write(Buffer.from(username ? [5, 2, 0, 2] : [5, 1, 0]))
        const [, method] = await reader.read(2)

        if(method === 2 && username) {
            socket.write(Buffer.concat([Buffer.from([1, username.length]), username, Buffer.from([password.length]), password]))
            const [, status] = await reader.read(2)
            if(status !== 0) {
                throw Object.assign(new Error('The SOCKS5 proxy refused the login'), { statusCode: 407 })
            }
        } else if(method !== 0) {
            throw Object.assign(new Error('The SOCKS5 proxy wants a login'), { statusCode: 407 })
        }

        const portBuffer = Buffer.alloc(2)
        portBuffer.writeUInt16BE(Number(port))
        socket.write(Buffer.concat([Buffer.from([5, 1, 0]), getSocks5Address(host), portBuffer]))

        const [, reply, , addressType] = await reader.read(4)
        const addressLength = addressType === 1 ? 4 : addressType === 4 ? 16 : (await reader.read(1))[0]
        await reader.read(addressLength + 2)

        if(reply !== 0) {
            throw Object.assign(new Error(`The SOCKS5 proxy could not connect, reply ${reply}`), { statusCode: 502 })
        }

        reader.release()
        return socket
    } catch(e) {
        socket.destroy()
        throw e
    } finally {
        clearTimeout(timer)
        stopWatchingSignal()
    }
}

// a socket to host:port, through the proxy or, bypassed, directly. The signal, when given, stops opening it
export function openTunnel(proxyUrl, host, port, tlsOptions, signal = null) {
    if(proxyUrl === null) {
        return new Promise((resolve, reject) => {
            const socket = net.connect(Number(port), host, () => {
                clearTimeout(timer)
                stopWatchingSignal()
                resolve(socket)
            })
            const timer = setTimeout(() => socket.destroy(createTimeoutError(`${host}:${port}`)), limits.tunnelTimeoutMs)
            const stopWatchingSignal = destroyOnAbort(signal, socket)
            socket.once('error', error => {
                clearTimeout(timer)
                stopWatchingSignal()
                reject(error)
            })
        })
    }

    if(proxyUrl.protocol === 'socks5:' || proxyUrl.protocol === 'socks:') {
        return openSocks5Tunnel(proxyUrl, host, port, signal)
    }

    return new Promise((resolve, reject) => {
        const authorization = getProxyAuthorization(proxyUrl)
        const authority = net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`
        const connectRequest = http.request({
            method: 'CONNECT',
            path: authority,
            headers: { host: authority, ...(authorization ? { 'proxy-authorization': authorization } : {}) },
            createConnection: () => connectToProxy(proxyUrl, tlsOptions),
        })

        // destroying the request closes its connection to the proxy, and gives the error below
        const timer = setTimeout(() => connectRequest.destroy(createTimeoutError('The proxy')), limits.tunnelTimeoutMs)
        const stopWatchingSignal = destroyOnAbort(signal, connectRequest)

        connectRequest.once('connect', (response, socket, head) => {
            clearTimeout(timer)
            stopWatchingSignal()
            if(response.statusCode !== 200) {
                socket.destroy()
                reject(Object.assign(new Error(`The proxy answered ${response.statusCode}`), { statusCode: response.statusCode }))
                return
            }
            if(head.length > 0) {
                socket.unshift(head)
            }
            resolve(socket)
        })
        connectRequest.once('error', error => {
            clearTimeout(timer)
            stopWatchingSignal()
            reject(error)
        })
        connectRequest.end()
    })
}
