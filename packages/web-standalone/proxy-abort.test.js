import { once } from 'events'
import http from 'http'
import test from 'node:test'
import assert from 'node:assert/strict'
import app from './app.js'

function listenServer(server) {
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve(server))
    })
}

function listenApp() {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server))
    })
}

function failAfter(ms) {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms)
    })
}

test('aborting a proxy request aborts the upstream request', async() => {
    let upstreamClosedResolve
    const upstreamClosed = new Promise(resolve => {
        upstreamClosedResolve = resolve
    })

    const upstream = http.createServer((req, res) => {
        req.socket.on('close', upstreamClosedResolve)
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.write('pending')
    })

    await listenServer(upstream)
    const proxy = await listenApp()
    const upstreamPort = upstream.address().port

    try {
        const abortController = new AbortController()
        const upstreamRequest = once(upstream, 'request')
        const response = fetch(`http://127.0.0.1:${proxy.address().port}/proxy`, {
            method: 'POST',
            headers: {
                'x-proxy-req-url': `http://127.0.0.1:${upstreamPort}/slow`,
                'x-proxy-req-method': 'GET',
                'x-proxy-flag-disable-ssl-verification': 'false',
            },
            signal: abortController.signal,
        }).catch(() => undefined)

        await upstreamRequest
        abortController.abort()

        await Promise.race([upstreamClosed, failAfter(1000)])
        await response

        assert.ok(true)
    } finally {
        proxy.closeAllConnections()
        proxy.close()
        upstream.closeAllConnections()
        upstream.close()
    }
})

test('proxy timeout aborts the upstream request', async() => {
    let upstreamClosedResolve
    const upstreamClosed = new Promise(resolve => {
        upstreamClosedResolve = resolve
    })

    const upstream = http.createServer((req, res) => {
        req.socket.on('close', upstreamClosedResolve)
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.write('pending')
    })

    await listenServer(upstream)
    const proxy = await listenApp()
    const upstreamPort = upstream.address().port

    try {
        const upstreamRequest = once(upstream, 'request')
        const response = fetch(`http://127.0.0.1:${proxy.address().port}/proxy`, {
            method: 'POST',
            headers: {
                'x-proxy-req-url': `http://127.0.0.1:${upstreamPort}/slow`,
                'x-proxy-req-method': 'GET',
                'x-proxy-flag-disable-ssl-verification': 'false',
                'x-proxy-flag-timeout': '10',
            },
        }).then(response => response.json()).catch(() => undefined)

        await upstreamRequest

        await Promise.race([upstreamClosed, failAfter(1000)])
        const body = await response

        assert.equal(body?.event, 'responseError')
    } finally {
        proxy.closeAllConnections()
        proxy.close()
        upstream.closeAllConnections()
        upstream.close()
    }
})
