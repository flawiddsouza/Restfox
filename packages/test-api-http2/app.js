import http2 from 'http2'
import fs from 'fs'
import path from 'path'

const serverOptions = {
    key: fs.readFileSync(path.join('..', 'test-api', 'files', 'localhost.key')),
    cert: fs.readFileSync(path.join('..', 'test-api', 'files', 'localhost.crt'))
}

const server = http2.createSecureServer(serverOptions)

server.on('stream', (stream, headers) => {
    const path = headers[':path']

    // Send a simple respnse
    stream.respond({
        'content-type': 'text/html',
        ':status': 200
    })
    stream.end('<h1>Hello from HTTP/2 server!</h1>')
})

server.listen(8443, () => {
    console.log('HTTP/2 server is listening on https://localhost:8443')
})
