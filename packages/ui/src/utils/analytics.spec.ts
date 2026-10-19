// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getAnalyticsPageUrl, sendPageView } from './analytics'

describe('getAnalyticsPageUrl', () => {
    it('names web and extension builds by version alone', () => {
        expect(getAnalyticsPageUrl('web', null, '0.41.0')).toBe('/web/0.41.0')
        expect(getAnalyticsPageUrl('extension', null, '0.41.0')).toBe('/extension/0.41.0')
    })

    it('adds the install kind for desktop and web-standalone', () => {
        expect(getAnalyticsPageUrl('desktop', { installKind: 'snap', appName: 'Restfox' }, '0.41.0')).toBe('/desktop/snap/0.41.0')
        expect(getAnalyticsPageUrl('web-standalone', { installKind: 'docker' }, '0.41.0')).toBe('/web-standalone/docker/0.41.0')
    })

    it('reports other when the shell or server cannot say how it was installed', () => {
        expect(getAnalyticsPageUrl('desktop', null, '0.41.0')).toBe('/desktop/other/0.41.0')
    })

    it('adds the name of a renamed app', () => {
        expect(getAnalyticsPageUrl('desktop', { installKind: 'windows-zip', appName: 'Other App' }, '1.8.0')).toBe('/desktop/windows-zip/1.8.0/Other%20App')
    })
})

describe('sendPageView', () => {
    // Node 25 and later define their own localStorage, which stays undefined
    // without --localstorage-file and hides happy-dom's
    beforeEach(() => {
        const store = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => store.set(key, value),
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('posts the page view umami\'s script would send', () => {
        const fetchMock = vi.fn(() => Promise.resolve(new Response('ok')))
        vi.stubGlobal('fetch', fetchMock)

        sendPageView('/web/0.41.0')

        expect(fetchMock).toHaveBeenCalledOnce()
        const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
        expect(url).toBe('https://umami.artelin.dev/api/collect')
        expect(options.method).toBe('POST')
        expect(JSON.parse(options.body as string)).toEqual({
            type: 'pageview',
            payload: {
                website: 'ed9e95fd-48af-4aac-a929-2a9f04ce9883',
                hostname: window.location.hostname,
                screen: `${window.screen.width}x${window.screen.height}`,
                language: navigator.language,
                url: '/web/0.41.0',
                referrer: document.referrer,
            },
        })
    })

    it('sends nothing when umami.disabled is set', () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        localStorage.setItem('umami.disabled', '1')

        sendPageView('/web/0.41.0')

        expect(fetchMock).not.toHaveBeenCalled()
    })
})
