import net from 'net'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash, randomBytes } from 'crypto'
import { getCACertificatesWithCustom } from './ca-certificates.js'

export function createGrpc(grpc, protobuf, grpcSchema, grpcJson) {
    const { loadProtoFiles, getRpcRoot, decodeFileDescriptor, loadFileDescriptors, describeSchema, findMethod } = grpcSchema
    const { encodeMessage, decodeReceivedMessage, decodeStatusDetails, convertObjectJsonToProtoJson } = grpcJson

    const STATUS_NAMES = [
        'OK', 'CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS',
        'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED',
        'INTERNAL', 'UNAVAILABLE', 'DATA_LOSS', 'UNAUTHENTICATED',
    ]

    // Waits that have no deadline of their own. Server reflection only reads, so with Settings > Request Timeout at none it
    // still gives up on a server that never answers, which would otherwise keep its connection open until the app quits. A
    // tunnel through a proxy gets as long as requests give a connection. Kept in an object so the specs can shorten them
    const limits = {
        reflectionTimeoutMs: 30000,
        tunnelTimeoutMs: 10000,
    }

    function getStatusName(code) {
        return STATUS_NAMES[code] ?? String(code)
    }

    // metadata names grpc-js or HTTP/2 set themselves, and the connection-specific ones HTTP/2 refuses, which would make
    // grpc-js drop the connection and try again without end
    const RESERVED_METADATA_NAMES = new Set(['content-type', 'te', 'host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'http2-settings'])

    // base64 or its URL-safe form, as gRPC accepts in -bin values
    const BASE64_REGEX = /^[A-Za-z0-9+/_-]*={0,2}$/

    // Whether a -bin value is whole base64, padded or not. Buffer.from drops a last letter that makes no whole byte, so
    // such a value would send other bytes than the ones meant
    function isBase64(value) {
        const letters = value.replace(/=+$/, '')
        return BASE64_REGEX.test(value) && letters.length % 4 !== 1 && (letters.length === value.length || value.length % 4 === 0)
    }
    // what gRPC takes in a metadata name, once lowercased, and in a value that is not -bin. Checked here rather than left to
    // grpc-js, whose error quotes the name lowercased, where a masked prompt value in it could no longer be found to hide
    const METADATA_NAME_REGEX = /^[0-9a-z_.-]+$/
    const METADATA_TEXT_VALUE_REGEX = /^[ -~]*$/

    // what a copy of a text for history shows in place of a part that came from a text the send resolved
    const MASKED = '******'

    // Gives an error the engine wrote its copy for history, which the page saves once the send took a masked prompt value:
    // the same text with each part that came from a text the send resolved, such as the address or a metadata name, as
    // ******. The page saves an error with no copy as a fixed text after such a send, so an error left out here leaks
    // nothing. A text that quotes only what the server sent, the proto files or the method, which no tag resolves in, is
    // its own copy
    function markWithoutValues(error, messageWithoutValues = error.message) {
        error.messageWithoutValues = messageWithoutValues
        return error
    }

    // an error about a metadata row, whose name may hold a masked prompt value
    function createMetadataError(name, problem, cause) {
        return markWithoutValues(new Error(`Metadata ${name}: ${problem}`, { cause }), `Metadata ${MASKED}: ${problem}`)
    }

    // the metadata pairs as grpc-js Metadata, and a user-agent, which grpc-js sends from a channel option
    function createMetadata(pairs) {
        const metadata = new grpc.Metadata()
        let userAgent = null
        let userAgentIndex = null
        const indexes = []

        for(const [index, [name, value]] of (pairs ?? []).entries()) {
            const key = String(name).trim().toLowerCase()

            if(key === '' || RESERVED_METADATA_NAMES.has(key) || key.startsWith(':') || key.startsWith('grpc-')) {
                continue
            }

            if(!METADATA_NAME_REGEX.test(key)) {
                throw createMetadataError(name, 'a name has only letters, digits, -, _ and .')
            }

            if(key === 'user-agent') {
                // grpc-js would leave out a value it cannot send, and log it
                if(!METADATA_TEXT_VALUE_REGEX.test(String(value))) {
                    throw createMetadataError(name, 'a value has only printable ASCII characters, a -bin name takes any bytes as base64')
                }
                userAgent = String(value)
                userAgentIndex = index
                continue
            }

            // Rows of one name come joined with a comma, as HTTP headers are. gRPC takes that as the same for text values,
            // and a -bin one is split into its values, as gRPC splits them
            const values = key.endsWith('-bin') ? String(value).split(',').map(part => part.trim()) : [String(value)]

            for(const oneValue of values) {
                if(key.endsWith('-bin') && !isBase64(oneValue)) {
                    throw createMetadataError(name, 'a -bin value is base64, such as aGVsbG8=')
                }
                if(!key.endsWith('-bin') && !METADATA_TEXT_VALUE_REGEX.test(oneValue)) {
                    throw createMetadataError(name, 'a value has only printable ASCII characters, a -bin name takes any bytes as base64')
                }

                try {
                    metadata.add(key, key.endsWith('-bin') ? Buffer.from(oneValue, 'base64') : oneValue)
                } catch(e) {
                    // grpc-js's text may quote the name or the value
                    throw markWithoutValues(new Error(`Metadata ${name}: ${e.message}`, { cause: e }), `Metadata ${MASKED}: gRPC cannot send it`)
                }
            }
            indexes.push(index)
        }

        if(userAgentIndex !== null) {
            indexes.push(userAgentIndex)
            indexes.sort((a, b) => a - b)
        }
        return { metadata, userAgent, indexes }
    }

    // [name, value] pairs of received metadata, -bin values as base64
    function metadataToPairs(metadata) {
        const pairs = []
        for(const [name, values] of Object.entries(metadata?.toJSON() ?? {})) {
            for(const value of values) {
                pairs.push([name, Buffer.isBuffer(value) ? value.toString('base64') : String(value)])
            }
        }
        return pairs
    }

    // grpc-js's text for a connection that could not be made, such as "No connection established. Last error: Error:
    // self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca. Resolution
    // note: ", in plain words that say what to change in Restfox. null for any other text. withoutValues gives its copy for
    // history, which names the server as ****** and leaves out a reason only the network library wrote, as it may name the
    // address
    function describeConnectionFailure(details, target, { withoutValues = false } = {}) {
        const text = String(details ?? '')
        const server = withoutValues ? { address: MASKED, host: MASKED } : target

        const lastErrorMatch = text.match(/Last error: ([\s\S]*?)\.?\s*(?:Resolution note:[\s\S]*)?$/)
        if(!lastErrorMatch) {
            return null
        }

        const reason = lastErrorMatch[1]
            .replace(/^(?:Error|TypeError)(?: \[[A-Z0-9_]+\])?: /, '')
            .replace(/; if the root CA is installed locally, try running Node\.js with --use-system-ca/, '')
            .trim()

        if(/self[- ]signed certificate|unable to verify the first certificate|unable to get (?:local )?issuer certificate/i.test(reason)) {
            return `The server's certificate is not trusted (${reason}). Add its CA certificate in Settings > CA Certificates, or turn on Disable SSL Verification`
        }

        if(/certificate has expired|certificate is not yet valid/i.test(reason)) {
            return `The server's certificate ${/expired/i.test(reason) ? 'has expired' : 'is not valid yet'}. Turn on Disable SSL Verification to connect anyway`
        }

        if(/does not match certificate's altnames|ERR_TLS_CERT_ALTNAME_INVALID/i.test(lastErrorMatch[1])) {
            return `The server's certificate is not for ${server.host}. Turn on Disable SSL Verification to connect anyway`
        }

        if(/wrong[ _]version[ _]number|packet[ _]length[ _]too[ _]long|http[ _]request/i.test(reason)) {
            return 'The server did not answer with TLS. For a server without TLS, start the address with grpc://'
        }

        if(/ECONNREFUSED/.test(reason)) {
            return `${server.address} refused the connection`
        }

        if(/ETIMEDOUT/.test(reason)) {
            return `Connecting to ${server.address} timed out`
        }

        if(/ENOTFOUND|EAI_AGAIN/.test(reason)) {
            return `Could not look up ${server.host}`
        }

        if(/ECONNRESET|socket hang up/i.test(reason)) {
            return `${server.address} closed the connection`
        }

        return withoutValues ? `Could not connect to ${MASKED}` : `Could not connect to ${target.address}: ${reason}`
    }

    function createCredentials(target, connection) {
        if(!target.tls) {
            return grpc.credentials.createInsecure()
        }

        const roots = Buffer.from(getCACertificatesWithCustom(connection?.caCertificates ?? []).join('\n'))
        const credentials = connection?.rejectUnauthorized === false
            ? grpc.credentials.createSsl(roots, null, null, { rejectUnauthorized: false, checkServerIdentity: () => undefined })
            : grpc.credentials.createSsl(roots, null, null, { rejectUnauthorized: true })

        // grpc-js sends the host as the TLS server name even when it is an IP address, which Node 26 refuses (RFC 6066
        // allows only names there), so for one it sends none and Node checks the certificate against the address
        if(net.isIP(target.host)) {
            const createSecureConnector = credentials._createSecureConnector.bind(credentials)
            credentials._createSecureConnector = (...args) => {
                const connector = createSecureConnector(...args)
                delete connector.connectionOptions?.servername
                return connector
            }
        }

        return credentials
    }

    // the signal, when given, stops connecting
    function connectDirectly(host, port, signal = null) {
        return new Promise((resolve, reject) => {
            const onAbort = () => socket.destroy(createStoppedError())
            const socket = net.connect(Number(port), host, () => {
                signal?.removeEventListener('abort', onAbort)
                resolve(socket)
            })
            socket.once('error', error => {
                signal?.removeEventListener('abort', onAbort)
                reject(error)
            })
            if(signal?.aborted) {
                onAbort()
            }
            signal?.addEventListener('abort', onAbort, { once: true })
        })
    }

    function createStoppedError() {
        return Object.assign(new Error('The call was stopped'), { stopped: true })
    }

    // Waits for a tunnel, no longer than the deadline or limits.tunnelTimeoutMs, and not at all once the signal aborts. A
    // tunnel that opens after the wait ended is closed. throughProxy tells whether the wait is still on the proxy, so a
    // timeout there names the proxy
    function waitForTunnel(promise, target, deadline, signal, throughProxy) {
        return new Promise((resolve, reject) => {
            const deadlineFirst = deadline - Date.now() < limits.tunnelTimeoutMs
            let settled = false

            const settle = (callback, value) => {
                if(settled) {
                    return false
                }
                settled = true
                clearTimeout(timer)
                signal?.removeEventListener('abort', onAbort)
                callback(value)
                return true
            }

            const timer = setTimeout(() => {
                const seconds = limits.tunnelTimeoutMs / 1000
                settle(reject, deadlineFirst
                    ? Object.assign(markWithoutValues(new Error(`Deadline exceeded while connecting to ${target.address}`), `Deadline exceeded while connecting to ${MASKED}`), { grpcCode: grpc.status.DEADLINE_EXCEEDED })
                    : throughProxy()
                        ? Object.assign(markWithoutValues(new Error(`Could not connect to the proxy: The proxy did not answer within ${seconds} s`)), { grpcCode: grpc.status.UNAVAILABLE })
                        : Object.assign(markWithoutValues(new Error(`Connecting to ${target.address} timed out after ${seconds} s`), `Connecting to ${MASKED} timed out after ${seconds} s`), { grpcCode: grpc.status.UNAVAILABLE }))
            }, Math.max(0, Math.min(limits.tunnelTimeoutMs, deadline - Date.now())))

            const onAbort = () => settle(reject, createStoppedError())
            signal?.addEventListener('abort', onAbort)

            if(signal?.aborted) {
                onAbort()
            }

            promise.then(tunnel => {
                if(!settle(resolve, tunnel)) {
                    tunnel?.destroy()
                }
            }, error => settle(reject, error))
        })
    }

    // The relay listens on a named pipe on Windows and a socket file in a private folder elsewhere, so other users cannot
    // send through it (a Windows named pipe lets them open it read-only, not write). A loopback port would let any of them
    // reach the target through the proxy and its login
    function createRelayPath() {
        if(process.platform === 'win32') {
            return `\\\\.\\pipe\\restfox-grpc-${randomBytes(8).toString('hex')}`
        }
        return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'restfox-grpc-')), 'relay.sock')
    }

    // grpc-js cannot be handed a socket, so a proxied client connects to a local server that passes each connection
    // through its own tunnel. The first tunnel, opened to learn whether there is a proxy at all, serves the first connection
    // unless the proxy closed it before then, as a connection piped to a tunnel whose close has passed would stay open
    function startTunnelRelay(firstTunnel, openConnection) {
        let unusedTunnel = firstTunnel
        const sockets = new Set()
        // stops the connections still being made once the relay closes, as one waiting on a proxy is in no socket yet
        const connectionsWanted = new AbortController()
        // why the latest tunnel could not be opened, until one opens, as grpc-js only learns that the relay closed on it
        let tunnelError = null

        const track = socket => {
            sockets.add(socket)
            socket.on('close', () => sockets.delete(socket))
            socket.on('error', () => {})
        }

        // at once, as a proxy can reset it before the client connects, and an HTTP proxy's tunnel has no error listener left
        track(firstTunnel)

        const server = net.createServer(async clientSocket => {
            track(clientSocket)

            let upstreamSocket = unusedTunnel?.destroyed ? null : unusedTunnel
            unusedTunnel = null

            if(!upstreamSocket) {
                try {
                    upstreamSocket = await openConnection(connectionsWanted.signal)
                } catch(e) {
                    tunnelError = e
                    clientSocket.destroy()
                    return
                }
                tunnelError = null
                track(upstreamSocket)
            }

            // one that closed by now has had its close, which the listeners below would wait for forever
            if(clientSocket.destroyed || upstreamSocket.destroyed) {
                clientSocket.destroy()
                upstreamSocket.destroy()
                return
            }

            upstreamSocket.on('close', () => clientSocket.destroy())
            clientSocket.on('close', () => upstreamSocket.destroy())
            // a SOCKS5 tunnel comes paused, pipe lets it flow
            upstreamSocket.pipe(clientSocket)
            clientSocket.pipe(upstreamSocket)
        })

        const relayPath = createRelayPath()
        const relayFolder = process.platform === 'win32' ? null : path.dirname(relayPath)
        const removeRelayFolder = () => {
            if(relayFolder !== null) {
                fs.rmSync(relayFolder, { recursive: true, force: true })
            }
        }
        server.once('close', removeRelayFolder)

        return new Promise((resolve, reject) => {
            server.once('error', reject)
            server.listen(relayPath, () => resolve({
                path: relayPath,
                getTunnelError: () => tunnelError,
                close() {
                    server.close()
                    connectionsWanted.abort()
                    for(const socket of sockets) {
                        socket.destroy()
                    }
                },
            }))
        }).catch(error => {
            removeRelayFolder()
            throw error
        })
    }

    // A grpc-js client for the target. grpc-js keeps a connection it is still making after its client closes, and makes
    // none with a time limit, so a server that takes the connection and never answers would keep it open until the app
    // quits. So the client connects through a local relay, whose connections, made here through the proxy when
    // connection.openTunnel gives a tunnel, else directly, close with the client. The first one is made before the client
    // exists, so a connection that fails says why, and waiting for it ends at the deadline and when the signal aborts
    async function openChannel(target, connection, userAgent, { deadline = Infinity, signal = null } = {}) {
        const options = {
            // each call's own connection, closed with it, rather than one shared with other calls to the same server
            'grpc.use_local_subchannel_pool': 1,
            'grpc.max_receive_message_length': -1,
            'grpc.default_authority': target.address,
        }

        if(userAgent !== null) {
            options['grpc.primary_user_agent'] = userAgent
        }

        if(target.tls) {
            options['grpc.ssl_target_name_override'] = target.host
        }

        const openTunnel = connection?.openTunnel ?? (async() => null)

        // a proxy that could not be reached is named as the proxy, so the user does not look for the fault in the server.
        // Its texts name the proxy, a setting, and not the server
        const proxyFailure = e => {
            const reason = e.syscall ? e.message : e instanceof AggregateError && e.code ? e.code : null
            throw reason !== null
                ? Object.assign(markWithoutValues(new Error(`Could not connect to the proxy: ${reason}`, { cause: e })), { grpcCode: grpc.status.UNAVAILABLE })
                : markWithoutValues(e, 'Could not connect to the proxy')
        }

        // until openTunnel answers that no proxy applies
        let throughProxy = true
        // the signal, when given, stops making the connection
        const openConnection = (signal = null) => Promise.resolve()
            .then(() => openTunnel(target.host, target.port, signal))
            .catch(proxyFailure)
            .then(socket => {
                if(socket) {
                    return socket
                }
                throughProxy = false
                return connectDirectly(target.host, target.port, signal)
            })

        // a name with several addresses, such as localhost, refused at each one fails with an AggregateError that has only
        // a code and an empty message
        const toConnectionError = e => {
            const reason = e.syscall ? e.message : e instanceof AggregateError && e.code ? e.code : null
            if(reason === null) {
                return e
            }
            const details = `Last error: ${reason}`
            return Object.assign(markWithoutValues(new Error(describeConnectionFailure(details, target), { cause: e }), describeConnectionFailure(details, target, { withoutValues: true })), { grpcCode: grpc.status.UNAVAILABLE })
        }

        // the first connection is no longer made once the wait for it ends, so a proxy or server that has not answered
        // keeps nothing open
        const firstConnection = new AbortController()
        let tunnel
        try {
            tunnel = await waitForTunnel(openConnection(firstConnection.signal), target, deadline, signal, () => throughProxy)
        } catch(e) {
            firstConnection.abort()
            throw toConnectionError(e)
        }

        let relay
        try {
            relay = await startTunnelRelay(tunnel, openConnection)
        } catch(e) {
            // the relay could not listen, such as in a temp folder that cannot be written, so nothing will take the tunnel
            tunnel.destroy()
            throw e
        }

        if(signal?.aborted) {
            relay.close()
            throw createStoppedError()
        }

        const client = new grpc.Client(`unix:${relay.path}`, createCredentials(target, connection), options)

        // a status can come from the server only once grpc-js has connected, so until then any status is grpc-js's own.
        // grpc-js calls a watcher as the state changes, before a call can use the connection
        let connectedOnce = false
        const grpcChannel = client.getChannel()
        const watchConnection = () => {
            const state = grpcChannel.getConnectivityState(false)
            if(state === grpc.connectivityState.READY) {
                connectedOnce = true
            } else if(state !== grpc.connectivityState.SHUTDOWN) {
                grpcChannel.watchConnectivityState(state, Infinity, watchConnection)
            }
        }
        watchConnection()

        return {
            client,
            // a status grpc-js gives for a connection it could not make, in plain words, with why the relay's latest
            // connection failed when one did, such as a proxy that refused it. null for any other status, and for every
            // status once connected, as the server's text is never rewritten. withoutValues gives its copy for history,
            // see describeConnectionFailure
            describeConnectionFailure(status, { withoutValues = false } = {}) {
                const connectionFailure = status.code === grpc.status.UNAVAILABLE && !connectedOnce ? describeConnectionFailure(status.details, target, { withoutValues }) : null
                const tunnelError = relay.getTunnelError()
                if(connectionFailure === null || tunnelError === null) {
                    return connectionFailure
                }
                const error = toConnectionError(tunnelError)
                return withoutValues ? error.messageWithoutValues ?? `Could not connect to ${MASKED}` : error.message
            },
            close() {
                client.close()
                relay.close()
            },
        }
    }

    // server reflection's messages, the same in v1 and v1alpha
    const reflectionRoot = protobuf.parse(`
syntax = "proto3";
message ServerReflectionRequest {
    string host = 1;
    oneof message_request {
        string file_by_filename = 3;
        string file_containing_symbol = 4;
        string all_extension_numbers_of_type = 6;
        string list_services = 7;
    }
}
message ServerReflectionResponse {
    string valid_host = 1;
    ServerReflectionRequest original_request = 2;
    oneof message_response {
        FileDescriptorResponse file_descriptor_response = 4;
        ListServiceResponse list_services_response = 6;
        ErrorResponse error_response = 7;
    }
}
message FileDescriptorResponse {
    repeated bytes file_descriptor_proto = 1;
}
message ListServiceResponse {
    repeated ServiceResponse service = 1;
}
message ServiceResponse {
    string name = 1;
}
message ErrorResponse {
    int32 error_code = 1;
    string error_message = 2;
}
`, { keepCase: true }).root

    const ReflectionRequest = reflectionRoot.lookupType('ServerReflectionRequest')
    const ReflectionResponse = reflectionRoot.lookupType('ServerReflectionResponse')

    // a status grpc-js gave reflection as an error, a connection that could not be made as what to change
    function createStatusError(status, channel) {
        const connectionFailure = channel.describeConnectionFailure(status)
        if(connectionFailure !== null) {
            return Object.assign(markWithoutValues(new Error(connectionFailure), channel.describeConnectionFailure(status, { withoutValues: true })), { grpcCode: status.code, code: 'CONNECTION_FAILED' })
        }
        // the server's text, or grpc-js's, which never names the server: it connects only to the relay
        return Object.assign(markWithoutValues(new Error(`${getStatusName(status.code)}: ${status.details}`)), { grpcCode: status.code })
    }

    // asks the server one reflection version's questions over one stream: its services, the files defining them, then
    // any file those import that the server has not sent yet. Gives the root and the services the server listed
    async function reflectWith(channel, version, metadata, { deadline, signal }) {
        if(signal?.aborted) {
            throw createStoppedError()
        }

        const call = channel.client.makeBidiStreamRequest(
            `/grpc.reflection.${version}.ServerReflection/ServerReflectionInfo`,
            request => Buffer.from(ReflectionRequest.encode(ReflectionRequest.fromObject(request)).finish()),
            buffer => ReflectionResponse.decode(buffer),
            metadata,
            { deadline },
        )

        // closing the client leaves a stream running, so a stopped call ends this one itself
        const onAbort = () => call.cancel()
        signal?.addEventListener('abort', onAbort)

        const waiting = []
        let failure = null

        const fail = error => {
            failure = failure ?? error
            for(const { reject } of waiting.splice(0)) {
                reject(failure)
            }
        }

        call.on('data', response => waiting.shift()?.resolve(response))
        call.on('error', () => {})
        call.on('status', status => fail(signal?.aborted ? createStoppedError() : status.code === grpc.status.OK ? markWithoutValues(new Error('The server ended server reflection before answering')) : createStatusError(status, channel)))

        const ask = request => new Promise((resolve, reject) => {
            if(failure) {
                reject(failure)
                return
            }
            waiting.push({ resolve, reject })
            call.write(request)
        })

        try {
            const listed = await ask({ list_services: '' })
            if(listed.error_response) {
                throw markWithoutValues(new Error(listed.error_response.error_message || `error ${listed.error_response.error_code}`))
            }

            const serviceNames = listed.list_services_response.service.map(service => service.name).filter(name => !name.startsWith('grpc.reflection.'))
            const files = new Map()

            const addFiles = response => {
                for(const buffer of response.file_descriptor_response?.file_descriptor_proto ?? []) {
                    const file = decodeFileDescriptor(buffer)
                    if(!files.has(file.name)) {
                        files.set(file.name, file)
                    }
                }
            }

            // a service the server lists but cannot describe is named in the schema as missing
            for(const response of await Promise.all(serviceNames.map(name => ask({ file_containing_symbol: name })))) {
                addFiles(response)
            }

            for(;;) {
                const missing = [...new Set([...files.values()].flatMap(file => file.dependency ?? []))].filter(name => !files.has(name))
                if(missing.length === 0) {
                    break
                }
                const responses = await Promise.all(missing.map(name => ask({ file_by_filename: name })))
                responses.forEach((response, index) => {
                    if(response.error_response) {
                        throw markWithoutValues(new Error(`The server did not give ${missing[index]}: ${response.error_response.error_message}`))
                    }
                    addFiles(response)
                    if(!files.has(missing[index])) {
                        throw markWithoutValues(new Error(`The server did not give ${missing[index]}`))
                    }
                })
            }

            return { root: loadFileDescriptors([...files.values()]), serviceNames }
        } finally {
            signal?.removeEventListener('abort', onAbort)
            call.end()
            call.cancel()
        }
    }

    // v1, else v1alpha, which older servers offer alone
    async function reflect(channel, metadata, options) {
        try {
            return await reflectWith(channel, 'v1', metadata, options)
        } catch(e) {
            if(e.grpcCode !== grpc.status.UNIMPLEMENTED) {
                throw e
            }
        }

        try {
            return await reflectWith(channel, 'v1alpha', metadata, options)
        } catch(e) {
            if(e.grpcCode === grpc.status.UNIMPLEMENTED) {
                throw Object.assign(markWithoutValues(new Error('The server does not offer server reflection')), { code: 'REFLECTION_UNIMPLEMENTED' })
            }
            throw e
        }
    }

    // schemas by server and source, so a call right after loading one does not ask the server again
    const schemaCache = new Map()
    const SCHEMA_CACHE_LIMIT = 20
    // the number of the latest load started for each key, so a load that ends after a newer one, which may have found
    // methods the server added since, does not replace what that one cached
    const schemaLoadNumbers = new Map()
    let schemaLoadCount = 0

    function getSchemaKey(target, protoFiles) {
        const source = protoFiles?.length > 0
            ? createHash('sha256').update(JSON.stringify(protoFiles.map(file => [file.path, file.text])))
                .digest('hex')
            : 'reflection'
        return `${target.address}|${target.tls}|${source}`
    }

    // an error's copy for history, see markWithoutValues, for an error made from it, and none when it has none
    function getCopyWithoutValues(error, wrap = text => text) {
        return error.messageWithoutValues === undefined ? {} : { messageWithoutValues: wrap(error.messageWithoutValues) }
    }

    // The schema's root and, for server reflection, the services the server listed. Gives up at the deadline, and at once
    // when the signal aborts. A connection that could not be made is not a reflection failure, its error code says so
    async function fetchSchema({ target, connection, metadata, protoFiles, deadline, signal = null }) {
        const key = getSchemaKey(target, protoFiles)
        const loadNumber = ++schemaLoadCount
        schemaLoadNumbers.set(key, loadNumber)

        let schema
        try {
            schema = await fetchSchemaUncached({ target, connection, metadata, protoFiles, deadline, signal })
        } finally {
            if(schemaLoadNumbers.get(key) === loadNumber) {
                schemaLoadNumbers.delete(key)
                if(schema) {
                    schemaCache.delete(key)
                    schemaCache.set(key, schema)
                    if(schemaCache.size > SCHEMA_CACHE_LIMIT) {
                        schemaCache.delete(schemaCache.keys().next().value)
                    }
                }
            }
        }

        return schema
    }

    // fetchSchema without the cache
    async function fetchSchemaUncached({ target, connection, metadata, protoFiles, deadline, signal }) {
        let schema
        if(protoFiles?.length > 0) {
            try {
                schema = { root: loadProtoFiles(protoFiles), serviceNames: null }
            } catch(e) {
                throw markWithoutValues(e)
            }
        } else {
            const { metadata: grpcMetadata, userAgent } = createMetadata(metadata)
            let channel = null
            try {
                try {
                    channel = await openChannel(target, connection, userAgent, { deadline, signal })
                } catch(e) {
                    // such as a proxy that refused or never answered
                    throw e.stopped ? e : Object.assign(new Error(e.message, { cause: e }), { code: 'CONNECTION_FAILED', grpcCode: e.grpcCode }, getCopyWithoutValues(e))
                }
                schema = await reflect(channel, grpcMetadata, { deadline, signal })
            } catch(e) {
                if(e.stopped || e.code === 'REFLECTION_UNIMPLEMENTED' || e.code === 'CONNECTION_FAILED') {
                    throw e
                }
                throw Object.assign(new Error(`Server reflection failed: ${e.message}`, { cause: e }), { code: 'REFLECTION_FAILED', grpcCode: e.grpcCode }, getCopyWithoutValues(e, text => `Server reflection failed: ${text}`))
            } finally {
                channel?.close()
            }
        }

        return schema
    }

    // a message imported from Insomnia, for the method of the proto files, in ProtoJSON, see convertObjectJsonToProtoJson
    function convertInsomniaMessage({ protoFiles, service, method, text }) {
        const found = findMethod(loadProtoFiles(protoFiles), service, method)
        return convertObjectJsonToProtoJson(found.method.resolvedRequestType, text)
    }

    // always asks again, it is the user's Reload. Stops when the signal aborts, such as when the page that asked is gone
    async function loadSchema({ target, connection, metadata, protoFiles, timeoutMs, signal = null }) {
        const { root, serviceNames } = await fetchSchema({ target, connection, metadata, protoFiles, deadline: Date.now() + (timeoutMs > 0 ? timeoutMs : limits.reflectionTimeoutMs), signal })
        return describeSchema(root, protoFiles?.length > 0 ? 'proto' : 'reflection', serviceNames)
    }

    const passBuffer = buffer => buffer

    // an error's text for an event, with its form that quotes nothing the user wrote when it has one
    function getErrorMessages(e) {
        return e.messageWithoutValues === undefined ? { message: e.message } : { message: e.message, messageWithoutValues: e.messageWithoutValues }
    }

    // starts a call and reports it through emit, with the events the GrpcCallEvent type in ui/src/utils/grpc-transport.ts
    // lists. Each message given, the first of a unary or server streaming call included, has a number counting from 0,
    // which its sent or sendError event carries
    function startCall({ target, connection, metadata, protoFiles, service, method, deadlineMs, messages = [] }, emit) {
        const startedAt = Date.now()
        const deadline = deadlineMs > 0 ? startedAt + deadlineMs : Infinity
        // stops the schema load and the wait for a tunnel when the call ends early
        const abortController = new AbortController()

        let finished = false
        let cancelled = false
        let halfClosed = false
        let channel = null
        let call = null
        let requestType = null
        let streamsRequests = false
        // the number the next message given with send takes
        let messageCount = messages.length
        // messages and an end the user gave before the call was open
        const pending = []

        const post = event => {
            if(!finished) {
                emit({ ...event, time: Date.now() - startedAt })
            }
        }

        const finish = event => {
            if(finished) {
                return
            }
            post(event)
            finished = true
            abortController.abort()
            channel?.close()
        }

        // A message counts as sent once the connection is made. grpc-js takes one before that and keeps it, so until then
        // its sent event waits here, and a call that never connects sent nothing
        let connected = false
        const sentBeforeConnected = []

        const postSent = event => {
            if(connected) {
                post(event)
            } else {
                sentBeforeConnected.push(event)
            }
        }

        const write = (json, index) => {
            let encoded
            try {
                encoded = encodeMessage(requestType, json)
            } catch(e) {
                post({ type: 'sendError', ...getErrorMessages(e), index })
                return false
            }
            call.write(encoded.buffer)
            postSent({ type: 'sent', json: encoded.json, index })
            return true
        }

        // the connected event, once the connection is made, then the sent events that waited for it
        const reportConnected = indexes => {
            const grpcChannel = channel.client.getChannel()
            const check = () => {
                if(finished) {
                    return
                }
                const state = grpcChannel.getConnectivityState(true)
                if(state === grpc.connectivityState.READY) {
                    connected = true
                    post({ type: 'connected' })
                    post({ type: 'sentMetadata', indexes })
                    for(const event of sentBeforeConnected.splice(0)) {
                        post(event)
                    }
                    return
                }
                if(state !== grpc.connectivityState.SHUTDOWN) {
                    grpcChannel.watchConnectivityState(state, Infinity, check)
                }
            }
            check()
        }

        const run = async() => {
            // no event before startCall returns, so the caller can keep the call before its first event, even when the
            // schema is cached and the message cannot be encoded
            await null

            const { metadata: grpcMetadata, userAgent, indexes } = createMetadata(metadata)

            const { root } = schemaCache.get(getSchemaKey(target, protoFiles))
                ?? await fetchSchema({ target, connection, metadata, protoFiles, deadline: Math.min(deadline, Date.now() + limits.reflectionTimeoutMs), signal: abortController.signal })

            if(finished) {
                return
            }

            let found
            try {
                found = findMethod(root, service, method)
            } catch(e) {
                throw markWithoutValues(e)
            }
            requestType = found.method.resolvedRequestType
            const responseType = found.method.resolvedResponseType
            streamsRequests = Boolean(found.method.requestStream)

            // a single request is encoded before connecting, so a mistake in it needs no server
            let firstMessage = null
            if(!streamsRequests) {
                try {
                    firstMessage = encodeMessage(requestType, messages[0] ?? '{}')
                } catch(e) {
                    post({ type: 'sendError', ...getErrorMessages(e), index: 0 })
                    finish({ type: 'error', ...getErrorMessages(e) })
                    return
                }
            }

            channel = await openChannel(target, connection, userAgent, { deadline, signal: abortController.signal })

            if(finished) {
                channel.close()
                return
            }

            call = channel.client.makeBidiStreamRequest(`/${found.service.fullName.slice(1)}/${found.method.name}`, passBuffer, passBuffer, grpcMetadata, { deadline })
            reportConnected(indexes)

            let status = null
            let readEnded = false

            // the status can come before the last messages are read, it is reported after them
            const finishWithStatus = () => {
                if(status === null || !readEnded) {
                    return
                }

                const connectionFailure = channel.describeConnectionFailure(status)

                const event = {
                    type: 'status',
                    code: status.code,
                    name: getStatusName(status.code),
                    details: connectionFailure ?? status.details,
                    trailers: metadataToPairs(status.metadata),
                }
                // details the engine wrote, which name the server, have a copy for history. Others are the server's, or
                // grpc-js's, which never names the server as it connects only to the relay
                if(connectionFailure !== null) {
                    event.detailsWithoutValues = channel.describeConnectionFailure(status, { withoutValues: true })
                }

                const statusDetails = status.metadata?.get('grpc-status-details-bin')[0]
                if(statusDetails) {
                    try {
                        event.errorDetails = decodeStatusDetails(statusDetails, root, getRpcRoot())
                    } catch {
                        // left out when it is not a google.rpc.Status
                    }
                }

                finish(event)
            }

            call.on('metadata', received => post({ type: 'headers', metadata: metadataToPairs(received) }))
            call.on('data', buffer => post({ type: 'received', ...decodeReceivedMessage(responseType, buffer) }))
            call.on('end', () => {
                readEnded = true
                finishWithStatus()
            })
            call.on('error', () => {})
            call.on('status', received => {
                status = received
                finishWithStatus()
            })

            if(!streamsRequests) {
                call.write(firstMessage.buffer)
                postSent({ type: 'sent', json: firstMessage.json, index: 0 })
                call.end()
                return
            }

            messages.forEach((json, index) => write(json, index))

            for(const action of pending.splice(0)) {
                if(action === null) {
                    call.end()
                } else {
                    write(action.json, action.index)
                }
            }
        }

        run().catch(e => {
            if(e.stopped) {
                return
            }
            // ended as grpc-js ends a call it could not connect, or that ran out of time doing so
            if(e.grpcCode === grpc.status.UNAVAILABLE || (e.grpcCode === grpc.status.DEADLINE_EXCEEDED && deadline !== Infinity && Date.now() >= deadline - 50)) {
                finish({ type: 'status', code: e.grpcCode, name: getStatusName(e.grpcCode), details: e.message, detailsWithoutValues: e.messageWithoutValues ?? `Could not connect to ${MASKED}`, trailers: [] })
                return
            }
            finish({ type: 'error', ...getErrorMessages(e) })
        })

        return {
            send(json) {
                if(finished || halfClosed || (requestType !== null && !streamsRequests)) {
                    return
                }
                const index = messageCount++
                if(call === null) {
                    pending.push({ json, index })
                } else {
                    write(json, index)
                }
            },
            end() {
                if(finished || halfClosed || (requestType !== null && !streamsRequests)) {
                    return
                }
                halfClosed = true
                if(call === null) {
                    pending.push(null)
                } else {
                    call.end()
                }
            },
            cancel() {
                if(finished || cancelled) {
                    return
                }
                cancelled = true
                if(call !== null) {
                    call.cancel()
                    return
                }
                // not connected yet, so grpc-js has no call to give the status
                finish({ type: 'status', code: grpc.status.CANCELLED, name: 'CANCELLED', details: 'Cancelled on client', trailers: [] })
            },
        }
    }

    return {
        convertInsomniaMessage,
        describeConnectionFailure,
        getStatusName,
        limits,
        loadSchema,
        startCall,
    }
}
