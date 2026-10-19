import type { InstallInfo } from '@/global'

const UMAMI_COLLECT_URL = 'https://umami.artelin.dev/api/collect'
const UMAMI_WEBSITE_ID = 'ed9e95fd-48af-4aac-a929-2a9f04ce9883'

// Each build reports one page per kind of install and version, such as
// /desktop/snap/0.41.0, so installs of the same kind count together.
export function getAnalyticsPageUrl(build: string, installInfo: InstallInfo | null, version: string): string {
    const parts = [build]
    if(build === 'desktop' || build === 'web-standalone') {
        parts.push(installInfo?.installKind || 'other')
    }
    parts.push(version)
    if(installInfo?.appName && installInfo.appName !== 'Restfox') {
        parts.push(installInfo.appName)
    }
    return '/' + parts.map(part => encodeURIComponent(part)).join('/')
}

// Sends the page view umami's tracking script would send, without loading the
// script: an extension page may only run its own scripts. umami.disabled in
// localStorage opts a browser out, as it does for the script.
export function sendPageView(url: string) {
    if(localStorage.getItem('umami.disabled')) {
        return
    }

    fetch(UMAMI_COLLECT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'pageview',
            payload: {
                website: UMAMI_WEBSITE_ID,
                hostname: window.location.hostname,
                screen: `${window.screen.width}x${window.screen.height}`,
                language: navigator.language,
                url,
                referrer: document.referrer,
            },
        }),
    }).catch(() => {
        // offline or blocked, the page view is lost as it was with the script
    })
}
