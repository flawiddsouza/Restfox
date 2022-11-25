chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({
        'url': chrome.runtime.getURL('ui/index.html'),
        'selected': true
    })
})
