export async function getKey(key) {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.get([key], (result) => {
                resolve(result[key])
            })
        } catch (ex) {
            reject(ex)
        }
    })
}

export async function setKey(key, value) {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.set({ [key]: value }, () => {
                resolve()
            })
        } catch (ex) {
            reject(ex)
        }
    })
}
