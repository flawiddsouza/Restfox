// @vitest-environment happy-dom

import { test, expect } from 'vitest'
import Timeline from './ResponsePanelTimeline.vue'

function renderTimeline(responseHeaders: [string, string][], headersSent?: [string, string][]) {
    const methods = (Timeline as any).methods
    return methods.timelineViewer.call(methods, {
        url: 'https://example.test/',
        createdAt: Date.UTC(2026, 8, 22, 10, 0, 0),
        request: { method: 'GET', headers: { accept: '*/*' }, headersSent },
        status: 200,
        statusText: 'OK',
        headers: responseHeaders,
        buffer: new TextEncoder().encode('ok').buffer,
    }) as string
}

test('response section lists only headers the server sent, no invented Date', () => {
    const output = renderTimeline([['content-type', 'text/plain']])
    expect(output).not.toContain('< Date:')
    expect(output).toContain('< content-type: text/plain')
})

test('response section shows the server Date header once', () => {
    const output = renderTimeline([['date', 'Tue, 22 Sep 2026 09:59:58 GMT']])
    expect(output.match(/^< date: /gmi)).toHaveLength(1)
    expect(output).toContain('< date: Tue, 22 Sep 2026 09:59:58 GMT')
})

test('response header values keep their commas', () => {
    const output = renderTimeline([
        ['cache-control', 'public, max-age=60'],
        ['vary', 'Accept-Encoding, Origin'],
    ])
    expect(output).toContain('< cache-control: public, max-age=60')
    expect(output).toContain('< vary: Accept-Encoding, Origin')
})

test('request section shows the headers the transport reported sending', () => {
    const output = renderTimeline([], [
        ['host', 'example.test'],
        ['connection', 'keep-alive'],
        ['accept', '*/*'],
        ['accept-encoding', 'gzip, deflate'],
    ])
    expect(output).toContain('> connection: keep-alive\n')
    expect(output).toContain('> accept-encoding: gzip, deflate\n')
    expect(output.match(/^> host: /gmi)).toHaveLength(1)
    expect(output).not.toContain('as configured')
})

test('request section says the headers are the configured ones when nothing was captured', () => {
    const output = renderTimeline([])
    expect(output).toContain('* Request headers below are as configured, headers the transport adds or drops are not shown\n')
    expect(output).toContain('> Host: example.test\n')
    expect(output).toContain('> accept: */*\n')
})
