async function getKey(key) {
    return new Promise((resolve, reject) => {
        try {
            browser.storage.local.get([key], (result) => {
                resolve(result[key])
            })
        } catch (ex) {
            reject(ex)
        }
    })
}

async function setKey(key, value) {
    return new Promise((resolve, reject) => {
        try {
            browser.storage.local.set({ [key]: value }, () => {
                resolve()
            })
        } catch (ex) {
            reject(ex)
        }
    })
}

const domains = [
    'https://restfox.dev'
]

async function isRestfoxTab() {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true })

    if(!tab) {
        return false
    }

    if('url' in tab === false) {
        return false
    }

    if(tab.url.startsWith(domains[0]) === false) {
        return false
    }

    return tab
}

async function corsBypass(e) {
    const tab = await isRestfoxTab()

    if(tab === false) {
        return
    }

    let extensionDisabled = await getKey('extensionDisabled')

    if(extensionDisabled) {
        return
    }

    const headers = [
        {
            name: 'Access-Control-Allow-Origin',
            value: '*'
        },
        {
            name: 'Access-Control-Allow-Methods',
            value: '*'
        },
        {
            name: 'Access-Control-Allow-Headers',
            value: '*'
        },
        {
            name: 'Access-Control-Expose-Headers',
            value: '*'
        }
    ]

    e.responseHeaders.push(...headers)

    return { responseHeaders: e.responseHeaders }
}

browser.webRequest.onHeadersReceived.addListener(
    corsBypass,
    {
        urls: ['<all_urls>']
    },
    [
        'blocking',
        'responseHeaders'
    ]
)

async function tabChanged() {
    const tab = await isRestfoxTab()

    if(tab === false) {
        return
    }

    await browser.pageAction.setIcon({
        path: 'icons/favicon-disabled-128.png',
        tabId: tab.id
    })

    const extensionDisabled = await getKey('extensionDisabled')
    if(!extensionDisabled) {
        await browser.pageAction.setIcon({
            path: 'icons/favicon-128.png',
            tabId: tab.id
        })
    }
}

browser.tabs.onActivated.addListener(tabChanged)
browser.tabs.onUpdated.addListener(tabChanged)

async function handleAction() {
    const tab = await isRestfoxTab()

    if(tab === false) {
        return
    }

    let extensionDisabled = await getKey('extensionDisabled')
    extensionDisabled = !extensionDisabled
    await setKey('extensionDisabled', extensionDisabled)

    if(extensionDisabled) {
        browser.pageAction.setIcon({
            path: 'icons/favicon-disabled-128.png',
            tabId: tab.id
        })
    } else {
        browser.pageAction.setIcon({
            path: 'icons/favicon-128.png',
            tabId: tab.id
        })
    }
}

browser.pageAction.onClicked.addListener(handleAction)
