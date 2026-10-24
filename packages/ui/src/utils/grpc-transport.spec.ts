// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { convertInsomniaGrpcMessage, isGrpcAvailable, loadGrpcSchema, startGrpcCall } from './grpc-transport'
import type { GrpcCallEvent, GrpcCallSpec, GrpcSchema } from './grpc-transport'
import type { CACertificates, ProxySettings } from '@/global'

const savedSettings: { caCertificates: CACertificates | null, proxy: ProxySettings | null } = { caCertificates: null, proxy: null }

vi.mock('@/helpers', async(importOriginal) => {
    const original: any = await importOriginal()
    return {
        ...original,
        getSavedCACertificates: async() => savedSettings.caCertificates,
        getSavedProxySettings: () => savedSettings.proxy,
    }
})

const target = { address: 'api.example.com:443', host: 'api.example.com', port: 443, tls: true }

function callSpec(fields: Partial<GrpcCallSpec> = {}): GrpcCallSpec {
    return {
        target,
        metadata: [['X-Trace', 'abc']],
        protoFiles: null,
        service: 'demo.v1.Demo',
        method: 'Chat',
        deadlineMs: 0,
        messages: [],
        disableSSLVerification: false,
        ...fields,
    }
}

const schema: GrpcSchema = {
    source: 'reflection',
    services: [{ name: 'demo.v1.Demo', methods: [{ name: 'SayHello', path: '/demo.v1.Demo/SayHello', requestStream: false, responseStream: false, inputType: 'demo.v1.HelloRequest', outputType: 'demo.v1.HelloReply', example: '{\n  "name": ""\n}' }] }],
}

const statusOk: GrpcCallEvent = { type: 'status', code: 0, name: 'OK', details: '', trailers: [], time: 5 }

// lets pending promise callbacks run
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('Electron', () => {
    let pushEvent: (callId: string, grpcEvent: GrpcCallEvent) => void
    let electronIPC: Record<string, ReturnType<typeof vi.fn>>

    beforeEach(() => {
        electronIPC = {
            grpcLoadSchema: vi.fn(),
            grpcStartCall: vi.fn(async() => undefined),
            grpcSendMessage: vi.fn(async() => undefined),
            grpcEndCall: vi.fn(async() => undefined),
            grpcCancelCall: vi.fn(async() => undefined),
            grpcCancelSchemaLoad: vi.fn(async() => undefined),
            grpcConvertInsomniaMessage: vi.fn(),
            onGrpcEvent: vi.fn(callback => {
                pushEvent = callback
            }),
        }
        // a fresh object each test, so the transport subscribes to it again
        vi.stubGlobal('window', { electronIPC })
        vi.stubEnv('MODE', 'desktop-electron')
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
    })

    test('is available', () => {
        expect(isGrpcAvailable()).toBe(true)
    })

    test('starts the call with a call id and passes on its pushed events, nothing after the status and nothing of other calls', async() => {
        const events: GrpcCallEvent[] = []
        startGrpcCall(callSpec(), grpcEvent => events.push(grpcEvent))

        expect(electronIPC.onGrpcEvent).toHaveBeenCalledTimes(1)
        const sentSpec = electronIPC.grpcStartCall.mock.calls[0][0]
        expect(sentSpec).toEqual({ ...callSpec(), callId: expect.any(String) })
        const callId = sentSpec.callId

        pushEvent('another call', { type: 'received', json: '{}', time: 1 })
        pushEvent(callId, { type: 'headers', metadata: [['x-a', '1']], time: 1 })
        pushEvent(callId, { type: 'received', json: '{\n  "text": "hi"\n}', time: 2 })
        pushEvent(callId, statusOk)
        pushEvent(callId, { type: 'received', json: '{}', time: 6 })
        pushEvent(callId, { type: 'error', message: 'late', time: 7 })

        expect(events).toEqual([
            { type: 'headers', metadata: [['x-a', '1']], time: 1 },
            { type: 'received', json: '{\n  "text": "hi"\n}', time: 2 },
            statusOk,
        ])
    })

    test('subscribes to the channel once for every call', () => {
        startGrpcCall(callSpec(), () => undefined)
        startGrpcCall(callSpec(), () => undefined)
        expect(electronIPC.onGrpcEvent).toHaveBeenCalledTimes(1)
        const [first, second] = electronIPC.grpcStartCall.mock.calls.map(call => call[0].callId)
        expect(first).not.toBe(second)
    })

    test('send, end and cancel name the call, and stop once it has ended', () => {
        const call = startGrpcCall(callSpec(), () => undefined)
        const callId = electronIPC.grpcStartCall.mock.calls[0][0].callId

        call.send('{"text":"a"}')
        call.end()
        call.cancel()
        expect(electronIPC.grpcSendMessage).toHaveBeenCalledWith(callId, '{"text":"a"}')
        expect(electronIPC.grpcEndCall).toHaveBeenCalledWith(callId)
        expect(electronIPC.grpcCancelCall).toHaveBeenCalledWith(callId)

        pushEvent(callId, statusOk)
        call.send('{}')
        call.cancel()
        expect(electronIPC.grpcSendMessage).toHaveBeenCalledTimes(1)
        expect(electronIPC.grpcCancelCall).toHaveBeenCalledTimes(1)
    })

    test('a start the main process refuses is the call\'s error event', async() => {
        electronIPC.grpcStartCall.mockRejectedValueOnce(new Error('Error invoking remote method \'grpcStartCall\': boom'))
        const events: GrpcCallEvent[] = []
        startGrpcCall(callSpec(), grpcEvent => events.push(grpcEvent))
        await settle()
        expect(events).toEqual([{ type: 'error', message: 'Error invoking remote method \'grpcStartCall\': boom', time: expect.any(Number) }])
    })

    test('the spec goes as a plain copy, which IPC can clone where it cannot clone a reactive proxy', () => {
        const spec = callSpec()
        const proxied = new Proxy(spec, {})
        startGrpcCall(proxied, () => undefined)
        const sentSpec = electronIPC.grpcStartCall.mock.calls[0][0]
        expect(sentSpec).not.toBe(proxied)
        expect(structuredClone(sentSpec)).toEqual({ ...spec, callId: sentSpec.callId })
    })

    test('converts an Insomnia message, and a failure rejects with the main process\'s reason', async() => {
        const spec = { protoFiles: [{ path: 'a.proto', text: '' }], service: 'a.S', method: 'Call', text: '{"flag": {"value": true}}' }
        electronIPC.grpcConvertInsomniaMessage.mockResolvedValueOnce({ text: '{"flag": true}' })
        await expect(convertInsomniaGrpcMessage(spec)).resolves.toBe('{"flag": true}')
        expect(electronIPC.grpcConvertInsomniaMessage).toHaveBeenCalledWith(spec)

        electronIPC.grpcConvertInsomniaMessage.mockResolvedValueOnce({ error: 'a.S has no method Call' })
        await expect(convertInsomniaGrpcMessage(spec)).rejects.toThrow('a.S has no method Call')
    })

    test('loads the schema, and a failure rejects with the code the main process gave', async() => {
        electronIPC.grpcLoadSchema.mockResolvedValueOnce({ schema })
        await expect(loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: true, timeoutMs: 1000 })).resolves.toEqual(schema)
        expect(electronIPC.grpcLoadSchema).toHaveBeenCalledWith({ target, metadata: [], protoFiles: null, disableSSLVerification: true, timeoutMs: 1000, loadId: expect.any(String) })

        electronIPC.grpcLoadSchema.mockResolvedValueOnce({ error: 'The server does not offer server reflection', code: 'REFLECTION_UNIMPLEMENTED' })
        await expect(loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: false })).rejects.toMatchObject({ message: 'The server does not offer server reflection', code: 'REFLECTION_UNIMPLEMENTED' })

        electronIPC.grpcLoadSchema.mockResolvedValueOnce({ error: 'connect ECONNREFUSED', code: null })
        const error = await loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: false }).catch(e => e)
        expect(error.message).toBe('connect ECONNREFUSED')
        expect(error.code).toBeUndefined()
        expect(error.grpcStatus).toBeUndefined()

        electronIPC.grpcLoadSchema.mockResolvedValueOnce({ error: 'localhost:50051 refused the connection', code: 'CONNECTION_FAILED', grpcStatus: { code: 14, name: 'UNAVAILABLE' } })
        await expect(loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: false })).rejects.toMatchObject({ code: 'CONNECTION_FAILED', grpcStatus: { code: 14, name: 'UNAVAILABLE' } })
    })
})

test.each([['Electron', 'desktop-electron'], ['web-standalone', 'web-standalone']])('%s: an aborted schema load is stopped where it runs', async(_name, mode) => {
    vi.stubEnv('MODE', mode)
    let finishLoad: (value: unknown) => void = () => undefined
    const electronIPC = {
        grpcStartCall: vi.fn(),
        grpcLoadSchema: vi.fn((spec: { loadId: string }) => new Promise(resolve => {
            expect(spec.loadId).toEqual(expect.any(String))
            finishLoad = resolve
        })),
        grpcCancelSchemaLoad: vi.fn(async() => {
            finishLoad({ error: 'The methods load was cancelled', code: 'CANCELLED' })
        }),
    }
    vi.stubGlobal('window', mode === 'desktop-electron' ? { electronIPC } : {})
    let fetchSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
        fetchSignal = init.signal ?? undefined
        fetchSignal?.addEventListener('abort', () => reject(new DOMException('The user aborted a request.', 'AbortError')))
    })))

    try {
        const abortController = new AbortController()
        const loading = loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: true }, abortController.signal).catch(error => error)
        await settle()
        abortController.abort()
        expect(await loading).toBeInstanceOf(Error)

        if(mode === 'desktop-electron') {
            expect(electronIPC.grpcCancelSchemaLoad).toHaveBeenCalledWith(electronIPC.grpcLoadSchema.mock.calls[0][0].loadId)
        } else {
            expect(fetchSignal!.aborted).toBe(true)
        }

        // already aborted, nothing is asked
        await expect(loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: true }, abortController.signal)).rejects.toThrow()
        expect(electronIPC.grpcLoadSchema.mock.calls.length + vi.mocked(fetch).mock.calls.filter(([path]) => path === '/grpc/schema').length).toBe(1)
    } finally {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
    }
})

describe('browser build', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
    })

    test('is not available, and a call ends at once with the reason', async() => {
        vi.stubEnv('MODE', 'development')
        vi.stubGlobal('window', {})
        expect(isGrpcAvailable()).toBe(false)

        const events: GrpcCallEvent[] = []
        startGrpcCall(callSpec(), grpcEvent => events.push(grpcEvent))
        expect(events).toEqual([{ type: 'error', message: 'gRPC calls need the Restfox desktop app or a self-hosted Restfox. Browsers cannot make them.', time: expect.any(Number) }])
        await expect(loadGrpcSchema(callSpec())).rejects.toThrow('gRPC calls need the Restfox desktop app')
    })
})

describe('web-standalone', () => {
    type Route = (init: RequestInit & { signal?: AbortSignal }) => Response | Promise<Response>
    let routes: Record<string, Route[]>
    let requests: { path: string, body: any, signal?: AbortSignal }[]
    let registrations: { ca: number, proxy: number }

    const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

    // a reply whose lines the test pushes as raw chunks
    function ndjsonReply() {
        let controller!: ReadableStreamDefaultController<Uint8Array>
        const body = new ReadableStream<Uint8Array>({
            start(streamController) {
                controller = streamController
            },
        })
        return {
            response: new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }),
            push: (bytes: Uint8Array | string) => controller.enqueue(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes),
            close: () => controller.close(),
            error: (reason: Error) => controller.error(reason),
        }
    }

    function requestsTo(path: string) {
        return requests.filter(request => request.path === path)
    }

    beforeEach(() => {
        vi.stubEnv('MODE', 'web-standalone')
        vi.stubGlobal('window', {})
        savedSettings.caCertificates = null
        savedSettings.proxy = null
        routes = {}
        requests = []
        registrations = { ca: 0, proxy: 0 }
        vi.stubGlobal('fetch', async(path: string, init: RequestInit & { signal?: AbortSignal }) => {
            const body = typeof init.body === 'string' ? (() => {
                try {
                    return JSON.parse(init.body as string)
                } catch {
                    return init.body
                }
            })() : init.body
            requests.push({ path, body, signal: init.signal })
            if(init.signal?.aborted) {
                throw new DOMException('The user aborted a request.', 'AbortError')
            }
            if(path === '/proxy-ca-certificates') {
                registrations.ca++
                return jsonResponse({ id: `ca-${registrations.ca}` })
            }
            if(path === '/proxy-settings') {
                registrations.proxy++
                return jsonResponse({ id: 'proxy-1' })
            }
            const route = routes[path]?.shift()
            if(!route) {
                throw new Error(`no reply for ${path}`)
            }
            return route(init)
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
    })

    test('is available', () => {
        expect(isGrpcAvailable()).toBe(true)
    })

    test('converts an Insomnia message through the server, and a failure rejects with its reason or status', async() => {
        const spec = { protoFiles: [{ path: 'a.proto', text: '' }], service: 'a.S', method: 'Call', text: '{"flag": {"value": true}}' }
        routes['/grpc/insomnia-message'] = [
            () => jsonResponse({ text: '{"flag": true}' }),
            () => jsonResponse({ error: 'a.S has no method Call' }),
            () => new Response('<html>Not Found</html>', { status: 404, statusText: 'Not Found', headers: { 'content-type': 'text/html' } }),
        ]
        await expect(convertInsomniaGrpcMessage(spec)).resolves.toBe('{"flag": true}')
        expect(requestsTo('/grpc/insomnia-message')[0].body).toEqual(spec)
        await expect(convertInsomniaGrpcMessage(spec)).rejects.toThrow('a.S has no method Call')
        await expect(convertInsomniaGrpcMessage(spec)).rejects.toThrow('The server could not read the message: 404 Not Found')
    })

    test('loads the schema with the CA certificates and proxy setting registered and named by id', async() => {
        savedSettings.caCertificates = { fileName: 'ca.pem', certificates: '-----BEGIN CERTIFICATE-----\nschema\n-----END CERTIFICATE-----\n' }
        savedSettings.proxy = { mode: 'custom', url: 'http://proxy:8080', username: 'u', password: 'p', bypass: '' }
        routes['/grpc/schema'] = [() => jsonResponse({ schema })]

        await expect(loadGrpcSchema({ target, metadata: [['a', '1']], protoFiles: [{ path: 'a.proto', text: 'syntax = "proto3";' }], disableSSLVerification: false, timeoutMs: 500 })).resolves.toEqual(schema)

        expect(requestsTo('/grpc/schema')[0].body).toEqual({
            target,
            metadata: [['a', '1']],
            protoFiles: [{ path: 'a.proto', text: 'syntax = "proto3";' }],
            disableSSLVerification: false,
            timeoutMs: 500,
            caCertificatesId: 'ca-1',
            proxySettingsId: 'proxy-1',
        })
        expect(requestsTo('/proxy-settings')[0].body).toEqual({ mode: 'custom', url: 'http://proxy:8080', username: 'u', password: 'p', bypass: '' })
    })

    test('never saved settings send no ids, and Disable SSL Verification registers no CA certificates', async() => {
        routes['/grpc/schema'] = [() => jsonResponse({ schema }), () => jsonResponse({ schema })]
        await loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: false })
        expect(requestsTo('/grpc/schema')[0].body).toMatchObject({ caCertificatesId: null, proxySettingsId: null })

        savedSettings.caCertificates = { fileName: 'ca.pem', certificates: '-----BEGIN CERTIFICATE-----\nskipped\n-----END CERTIFICATE-----\n' }
        await loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: true })
        expect(requestsTo('/grpc/schema')[1].body).toMatchObject({ caCertificatesId: null })
        expect(registrations.ca).toBe(0)
    })

    test('a schema failure rejects with the server\'s message and code, a reply that is not JSON with its status', async() => {
        routes['/grpc/schema'] = [
            () => jsonResponse({ error: 'The server does not offer server reflection', code: 'REFLECTION_UNIMPLEMENTED' }),
            () => new Response('<html>Not Found</html>', { status: 404, statusText: 'Not Found', headers: { 'content-type': 'text/html' } }),
            () => jsonResponse({ error: 'localhost:50051 refused the connection', code: 'CONNECTION_FAILED', grpcStatus: { code: 14, name: 'UNAVAILABLE' } }),
        ]
        await expect(loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: false })).rejects.toMatchObject({ message: 'The server does not offer server reflection', code: 'REFLECTION_UNIMPLEMENTED' })
        await expect(loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: false })).rejects.toThrow('The server could not load the schema: 404 Not Found')
        await expect(loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: false })).rejects.toMatchObject({ code: 'CONNECTION_FAILED', grpcStatus: { code: 14, name: 'UNAVAILABLE' } })
    })

    test('CA certificates a restarted server forgot are registered again and the request repeated once', async() => {
        savedSettings.caCertificates = { fileName: 'ca.pem', certificates: '-----BEGIN CERTIFICATE-----\nforgotten\n-----END CERTIFICATE-----\n' }
        routes['/grpc/schema'] = [
            () => jsonResponse({ error: 'The CA certificates are no longer registered with the server', code: 'CA_CERTIFICATES_NOT_FOUND' }),
            () => jsonResponse({ schema }),
        ]
        await expect(loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: false })).resolves.toEqual(schema)
        expect(requestsTo('/grpc/schema').map(request => request.body.caCertificatesId)).toEqual(['ca-1', 'ca-2'])

        // a server that still cannot find them is not asked a third time
        routes['/grpc/schema'] = [
            () => jsonResponse({ error: 'The proxy setting is no longer registered with the server', code: 'PROXY_SETTINGS_NOT_FOUND' }),
            () => jsonResponse({ error: 'The proxy setting is no longer registered with the server', code: 'PROXY_SETTINGS_NOT_FOUND' }),
        ]
        await expect(loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: false })).rejects.toMatchObject({ code: 'PROXY_SETTINGS_NOT_FOUND' })
        expect(requestsTo('/grpc/schema')).toHaveLength(4)
    })

    test('reads the call\'s events line by line wherever the chunks split them, multibyte text included', async() => {
        const reply = ndjsonReply()
        routes['/grpc/call'] = [() => reply.response]
        const events: GrpcCallEvent[] = []
        startGrpcCall(callSpec({ method: 'SayHello', messages: ['{"name":"é"}'] }), grpcEvent => events.push(grpcEvent))
        await settle()

        expect(requestsTo('/grpc/call')[0].body).toEqual({ ...callSpec({ method: 'SayHello', messages: ['{"name":"é"}'] }), callId: expect.any(String), caCertificatesId: null, proxySettingsId: null })

        const received: GrpcCallEvent = { type: 'received', json: '{\n  "message": "héllo ✓"\n}', time: 3 }
        const bytes = new TextEncoder().encode(JSON.stringify({ type: 'headers', metadata: [], time: 1 }) + '\n' + JSON.stringify(received) + '\n')
        // split inside the multibyte characters and the line ends
        for(let offset = 0; offset < bytes.length; offset += 7) {
            reply.push(bytes.subarray(offset, offset + 7))
        }
        await settle()
        expect(events).toEqual([{ type: 'headers', metadata: [], time: 1 }, received])

        reply.push(JSON.stringify(statusOk))
        reply.close()
        await settle()
        expect(events).toEqual([{ type: 'headers', metadata: [], time: 1 }, received, statusOk])
    })

    test('a reply that closes or breaks before the call ended is the call\'s error event', async() => {
        const closed = ndjsonReply()
        const broken = ndjsonReply()
        routes['/grpc/call'] = [() => closed.response, () => broken.response]
        const closedEvents: GrpcCallEvent[] = []
        const brokenEvents: GrpcCallEvent[] = []
        startGrpcCall(callSpec(), grpcEvent => closedEvents.push(grpcEvent))
        await settle()
        startGrpcCall(callSpec(), grpcEvent => brokenEvents.push(grpcEvent))
        await settle()

        closed.push(JSON.stringify({ type: 'headers', metadata: [], time: 1 }) + '\n')
        closed.close()
        broken.error(new TypeError('network error'))
        await settle()

        expect(closedEvents).toEqual([{ type: 'headers', metadata: [], time: 1 }, { type: 'error', message: 'The Restfox server closed the call before it ended', time: expect.any(Number) }])
        expect(brokenEvents).toEqual([{ type: 'error', message: 'Lost the connection to the Restfox server: network error', time: expect.any(Number) }])
    })

    test('a call the server refuses before it starts is the call\'s error event', async() => {
        routes['/grpc/call'] = [() => jsonResponse({ error: 'A gRPC call with the id x is already running' }, 409)]
        const events: GrpcCallEvent[] = []
        startGrpcCall(callSpec(), grpcEvent => events.push(grpcEvent))
        await settle()
        expect(events).toEqual([{ type: 'error', message: 'A gRPC call with the id x is already running', time: expect.any(Number) }])
    })

    test('messages and the end wait for the call to start and reach the server in order, even when one is slow', async() => {
        let startReply!: (response: Response) => void
        const reply = ndjsonReply()
        routes['/grpc/call'] = [() => new Promise(resolve => {
            startReply = resolve
        })]
        let releaseFirstSend!: () => void
        const call = startGrpcCall(callSpec(), () => undefined)
        await settle()
        const callId = requestsTo('/grpc/call')[0].body.callId
        routes[`/grpc/call/${callId}/send`] = [
            () => new Promise(resolve => {
                releaseFirstSend = () => resolve(jsonResponse({}))
            }),
            () => jsonResponse({}),
        ]
        routes[`/grpc/call/${callId}/end`] = [() => jsonResponse({})]

        call.send('{"text":"1"}')
        call.send('{"text":"2"}')
        call.end()
        await settle()
        expect(requests.filter(request => request.path.startsWith(`/grpc/call/${callId}/`))).toEqual([])

        startReply(reply.response)
        await settle()
        expect(requests.filter(request => request.path.startsWith(`/grpc/call/${callId}/`)).map(request => request.body)).toEqual([{ json: '{"text":"1"}' }])

        releaseFirstSend()
        await settle()
        expect(requests.filter(request => request.path.startsWith(`/grpc/call/${callId}/`)).map(request => [request.path.split('/').pop(), request.body])).toEqual([
            ['send', { json: '{"text":"1"}' }],
            ['send', { json: '{"text":"2"}' }],
            ['end', {}],
        ])
    })

    test('a message the server could not take is a sendError, one for a call that has ended is left to its status', async() => {
        const reply = ndjsonReply()
        routes['/grpc/call'] = [() => reply.response]
        const events: GrpcCallEvent[] = []
        const call = startGrpcCall(callSpec(), grpcEvent => events.push(grpcEvent))
        await settle()
        const callId = requestsTo('/grpc/call')[0].body.callId
        routes[`/grpc/call/${callId}/send`] = [
            () => jsonResponse({ error: 'too large' }, 413),
            () => jsonResponse({ error: 'The call has ended' }, 404),
        ]

        call.send('{}')
        call.send('{}')
        await settle()
        await settle()
        expect(events).toEqual([{ type: 'sendError', message: 'too large', time: expect.any(Number) }])
    })

    test('an end that does not reach the call is an endError, one for a call that has ended is left to its status', async() => {
        const reply = ndjsonReply()
        routes['/grpc/call'] = [() => reply.response]
        const events: GrpcCallEvent[] = []
        const call = startGrpcCall(callSpec(), grpcEvent => events.push(grpcEvent))
        await settle()
        const callId = requestsTo('/grpc/call')[0].body.callId
        routes[`/grpc/call/${callId}/end`] = [
            // such as a reverse proxy in front of the Restfox server
            () => new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' }),
            () => Promise.reject(new TypeError('Failed to fetch')),
            () => jsonResponse({ error: 'The call has ended' }, 404),
        ]

        call.end()
        call.end()
        call.end()
        await settle()
        await settle()
        await settle()
        expect(events).toEqual([
            { type: 'endError', message: 'The server could not end the stream: 503 Service Unavailable', time: expect.any(Number) },
            { type: 'endError', message: 'The end of the stream could not reach the Restfox server: Failed to fetch', time: expect.any(Number) },
        ])
    })

    test('cancel asks the server, whose CANCELLED status ends the call', async() => {
        const reply = ndjsonReply()
        routes['/grpc/call'] = [() => reply.response]
        const events: GrpcCallEvent[] = []
        const call = startGrpcCall(callSpec(), grpcEvent => events.push(grpcEvent))
        await settle()
        const callId = requestsTo('/grpc/call')[0].body.callId
        routes[`/grpc/call/${callId}/cancel`] = [() => jsonResponse({})]

        call.cancel()
        await settle()
        expect(requestsTo(`/grpc/call/${callId}/cancel`)).toHaveLength(1)
        expect(events).toEqual([])

        const cancelled: GrpcCallEvent = { type: 'status', code: 1, name: 'CANCELLED', details: 'Cancelled on client', trailers: [], time: 9 }
        reply.push(JSON.stringify(cancelled) + '\n')
        reply.close()
        await settle()
        expect(events).toEqual([cancelled])
    })

    test('cancel before the call started, or when the server cannot be reached, ends it here and closes its reply', async() => {
        let startReply!: (response: Response) => void
        routes['/grpc/call'] = [() => new Promise(resolve => {
            startReply = resolve
        })]
        const events: GrpcCallEvent[] = []
        const call = startGrpcCall(callSpec(), grpcEvent => events.push(grpcEvent))
        await settle()

        call.cancel()
        expect(events).toEqual([{ type: 'status', code: 1, name: 'CANCELLED', details: 'Cancelled on client', trailers: [], time: expect.any(Number) }])
        expect(requestsTo('/grpc/call')[0].signal?.aborted).toBe(true)
        startReply(ndjsonReply().response)
        await settle()
        expect(events).toHaveLength(1)

        const reply = ndjsonReply()
        routes['/grpc/call'] = [() => reply.response]
        const unreachableEvents: GrpcCallEvent[] = []
        const unreachableCall = startGrpcCall(callSpec(), grpcEvent => unreachableEvents.push(grpcEvent))
        await settle()
        // no route for the cancel, its fetch fails
        unreachableCall.cancel()
        await settle()
        expect(unreachableEvents).toEqual([{ type: 'status', code: 1, name: 'CANCELLED', details: 'Cancelled on client', trailers: [], time: expect.any(Number) }])
        expect(requestsTo('/grpc/call')[1].signal?.aborted).toBe(true)
    })

    // the browser keeps six connections to a server, and each open call holds one for its reply, so with six open a
    // cancel request waits for a free one that may never come
    test('a cancel the server does not answer in a moment ends the call here and closes its reply', async() => {
        vi.useFakeTimers()
        try {
            const reply = ndjsonReply()
            routes['/grpc/call'] = [() => reply.response]
            const events: GrpcCallEvent[] = []
            const call = startGrpcCall(callSpec(), grpcEvent => events.push(grpcEvent))
            await vi.advanceTimersByTimeAsync(0)
            const callId = requestsTo('/grpc/call')[0].body.callId
            routes[`/grpc/call/${callId}/cancel`] = [() => new Promise<Response>(() => undefined)]

            call.cancel()
            await vi.advanceTimersByTimeAsync(100)
            expect(events).toEqual([])

            await vi.advanceTimersByTimeAsync(2000)
            expect(events).toEqual([{ type: 'status', code: 1, name: 'CANCELLED', details: 'Cancelled on client', trailers: [], time: expect.any(Number) }])
            expect(requestsTo('/grpc/call')[0].signal?.aborted).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    test('a Restfox server that cannot be reached is named as such', async() => {
        vi.stubGlobal('fetch', async() => {
            throw new TypeError('Failed to fetch')
        })
        await expect(loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: false })).rejects.toThrow('Could not reach the Restfox server: Failed to fetch')

        const events: GrpcCallEvent[] = []
        startGrpcCall(callSpec(), grpcEvent => events.push(grpcEvent))
        await settle()
        expect(events).toEqual([{ type: 'error', message: 'Could not reach the Restfox server: Failed to fetch', time: expect.any(Number) }])

        // a saved proxy setting is registered first, so that request is the one that fails
        savedSettings.proxy = { mode: 'off', url: '', username: '', password: '', bypass: '' }
        await expect(loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: false })).rejects.toThrow('Could not reach the Restfox server: Failed to fetch')
        const proxiedEvents: GrpcCallEvent[] = []
        startGrpcCall(callSpec(), grpcEvent => proxiedEvents.push(grpcEvent))
        await settle()
        expect(proxiedEvents).toEqual([{ type: 'error', message: 'Could not reach the Restfox server: Failed to fetch', time: expect.any(Number) }])
    })

    test('a proxy setting the server refuses keeps the reason it gives', async() => {
        savedSettings.proxy = { mode: 'custom', url: 'nonsense', username: '', password: '', bypass: '' }
        vi.stubGlobal('fetch', async() => jsonResponse({ error: 'The proxy URL is not valid' }, 400))
        await expect(loadGrpcSchema({ target, metadata: [], protoFiles: null, disableSSLVerification: false })).rejects.toThrow(/^The proxy URL is not valid$/)
    })
})
