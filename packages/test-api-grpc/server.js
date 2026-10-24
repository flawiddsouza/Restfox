import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'
import { ReflectionService } from '@grpc/reflection'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const protosDirectory = path.join(directory, 'protos')
const filesDirectory = path.join(directory, '..', 'test-api', 'files')

const packageDefinition = protoLoader.loadSync('demo/v1/demo.proto', {
    includeDirs: [protosDirectory],
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
})

const demoService = grpc.loadPackageDefinition(packageDefinition).demo.v1.Demo.service

// metadata named x-echo-*, to be sent back
function getEchoMetadata(metadata) {
    const echo = new grpc.Metadata()
    for(const [name, values] of Object.entries(metadata.toJSON())) {
        if(name.startsWith('x-echo-')) {
            for(const value of values) {
                echo.add(name, value)
            }
        }
    }
    return echo
}

// protobuf wire format, enough for google.rpc.Status and google.rpc.BadRequest
function encodeVarint(value) {
    const bytes = []
    let remaining = BigInt.asUintN(64, BigInt(value))
    do {
        let byte = Number(remaining & 0x7fn)
        remaining >>= 7n
        if(remaining > 0n) {
            byte |= 0x80
        }
        bytes.push(byte)
    } while(remaining > 0n)
    return Buffer.from(bytes)
}

function encodeField(fieldNumber, value) {
    if(typeof value === 'number') {
        return Buffer.concat([encodeVarint(fieldNumber << 3), encodeVarint(value)])
    }
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
    return Buffer.concat([encodeVarint((fieldNumber << 3) | 2), encodeVarint(bytes.length), bytes])
}

// google.rpc.Status { code, message, details: [Any(google.rpc.BadRequest { field_violations: [{ field, description }] })] }
function encodeStatusDetails(code, message) {
    const violation = Buffer.concat([encodeField(1, 'code'), encodeField(2, `asked for status ${code}`)])
    const badRequest = encodeField(1, violation)
    const any = Buffer.concat([encodeField(1, 'type.googleapis.com/google.rpc.BadRequest'), encodeField(2, badRequest)])
    return Buffer.concat([encodeField(1, code), encodeField(2, message), encodeField(3, any)])
}

const implementation = {
    SayHello(call, callback) {
        const echo = getEchoMetadata(call.metadata)
        call.sendMetadata(echo)
        const reply = () => callback(null, { message: `Hello ${call.request.name ?? ''}` }, echo)
        if(call.request.name === 'slow') {
            const timer = setTimeout(reply, 3000)
            call.on('cancelled', () => clearTimeout(timer))
            return
        }
        reply()
    },

    Fail(call, callback) {
        const { code, message } = call.request
        if(!code) {
            callback(null, {})
            return
        }
        const metadata = new grpc.Metadata()
        metadata.set('grpc-status-details-bin', encodeStatusDetails(code, message ?? ''))
        callback({ code, details: message ?? '', metadata })
    },

    Count(call) {
        const to = call.request.to ?? 0
        let n = 0
        const timer = setInterval(() => {
            n++
            call.write({ n })
            if(to !== 0 && n >= to) {
                clearInterval(timer)
                call.end()
            }
        }, call.request.interval_ms || 100)
        call.on('cancelled', () => clearInterval(timer))
    },

    Sum(call, callback) {
        let total = 0n
        let count = 0
        call.on('data', request => {
            total += BigInt(request.value ?? 0)
            count++
        })
        call.on('end', () => callback(null, { total: total.toString(), count }))
    },

    Chat(call) {
        call.on('data', message => call.write({ text: `echo: ${message.text ?? ''}` }))
        call.on('end', () => call.end())
    },

    Everything(call, callback) {
        callback(null, call.request)
    },
}

// reflection: true serves v1 and v1alpha, 'v1alpha' only the older one, false none
export function startServer({ port = 0, tls = false, reflection = true } = {}) {
    const server = new grpc.Server()
    server.addService(demoService, implementation)

    if(reflection) {
        const reflectionService = new ReflectionService(packageDefinition)
        if(reflection === 'v1alpha') {
            reflectionService.v1Alpha.addToServer(server)
        } else {
            reflectionService.addToServer(server)
        }
    }

    const credentials = tls
        ? grpc.ServerCredentials.createSsl(null, [{
            private_key: fs.readFileSync(path.join(filesDirectory, 'localhost.key')),
            cert_chain: fs.readFileSync(path.join(filesDirectory, 'localhost.crt')),
        }])
        : grpc.ServerCredentials.createInsecure()

    return new Promise((resolve, reject) => {
        server.bindAsync(`127.0.0.1:${port}`, credentials, (error, boundPort) => {
            if(error) {
                reject(error)
                return
            }
            resolve({ port: boundPort, close: () => server.forceShutdown() })
        })
    })
}

// listen only when started directly, tests import startServer and pick their own port
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const servers = [
        { port: 50051, tls: false, reflection: true, label: 'plaintext with server reflection' },
        { port: 50052, tls: true, reflection: true, label: 'TLS (packages/test-api/files/localhost.crt) with server reflection' },
        { port: 50053, tls: false, reflection: false, label: 'plaintext without server reflection' },
    ]
    for(const { label, ...options } of servers) {
        await startServer(options)
        console.log(`gRPC test server listening on 127.0.0.1:${options.port}, ${label}`)
    }
}
