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

function renderMaskedTimeline(url: string, request: Record<string, unknown>) {
    const methods = (Timeline as any).methods
    return methods.timelineViewer.call(methods, {
        url,
        createdAt: Date.UTC(2026, 8, 22, 10, 0, 0),
        request: { method: 'GET', query: '', headers: {}, body: null, ...request },
        status: 200,
        statusText: 'OK',
        headers: [],
        buffer: new TextEncoder().encode('ok').buffer,
    }) as string
}

test('a header a masked prompt was used in is listed as left out, the rest of the request as saved', () => {
    const output = renderMaskedTimeline('https://example.test/items', { query: '?q=1', headers: { 'X-Trace': 't1' }, maskedPromptOmitted: { reason: 'masked-field', url: false, headerNames: ['Authorization'], body: false } })
    expect(output).toContain('* Left out because a masked prompt was used there: the Authorization header')
    expect(output).toContain('> GET /items?q=1')
    expect(output).toContain('> X-Trace: t1')
    expect(output).toContain('> Authorization: (left out)')
})

test('a header left out of the headers the transport reported is listed after them', () => {
    const output = renderMaskedTimeline('https://example.test/items', { headersSent: [['host', 'example.test'], ['x-trace', 't1']], maskedPromptOmitted: { reason: 'masked-field', url: false, headerNames: ['Authorization'], body: false } })
    expect(output).toContain('> host: example.test\n> x-trace: t1\n> Authorization: (left out)')
})

test('a url a masked prompt was used in that is saved as written is shown so, even one that starts with a variable', () => {
    const output = renderMaskedTimeline('{{ BASE_URL }}/items', { maskedPromptOmitted: { reason: 'masked-field', url: 'written', headerNames: [], body: false } })
    expect(output).toContain('* Left out because a masked prompt was used there: the URL (shown as written)')
    expect(output).toContain('> GET {{ BASE_URL }}/items')
    expect(output).toContain('< 200 OK')
})

test('a send whose script read a masked prompt shows the url as written and says why the rest is left out', () => {
    const output = renderMaskedTimeline('{{ BASE_URL }}/items', { maskedPromptOmitted: { reason: 'script-read' } })
    expect(output).toContain('* Left out because a script read a masked prompt: the URL (shown as written), the headers, the body and the test names and errors')
    expect(output).toContain('> GET {{ BASE_URL }}/items')
})

test('a url saved with its masked values as ****** shows them in the request line', () => {
    const output = renderMaskedTimeline('https://example.test/users/******', { query: '?key=******', maskedPromptOmitted: { reason: 'masked-field', url: 'masked', headerNames: [], body: false } })
    expect(output).toContain('* Left out because a masked prompt was used there: the masked values in the URL (shown as ******)')
    expect(output).toContain('> GET /users/******?key=******')
    expect(output).toContain('> Host: example.test')
})
