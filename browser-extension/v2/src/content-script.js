function init() {
    if('__EXTENSION_HOOK__' in window) {
        return
    }

    window.__EXTENSION_HOOK__ = 'Restfox CORS Helper Enabled'
    window.eval(`window.__EXTENSION_HOOK__ = 'Restfox CORS Helper Enabled'`)

    console.log(window.__EXTENSION_HOOK__)
}

init()
