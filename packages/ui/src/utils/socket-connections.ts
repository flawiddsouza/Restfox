// In memory only. How many times each socket item was closed and each client removed, so a Connect that waited, such as
// for a response tag in its URL to resolve, opens no socket for one closed or removed meanwhile, also through another
// copy of its tab, such as the one a workspace switch loads again
const itemCloses = new Map<string, number>()
const clientRemovals = new Map<string, number>()
// how many times each client's Connect started, or Disconnect was clicked, so a Connect that waited opens no socket after
// a later one started or a Disconnect, also in a panel rebuilt after a tab switch, which knows nothing of the earlier one
const connectStarts = new Map<string, number>()
// the socket keys each item's Connect opened, so closing the item closes every one, also of a client its tab no longer
// lists, such as after a reload or in another copy of the tab
const openedSocketKeys = new Map<string, Set<string>>()

export function noteSocketItemsClosed(itemIds: string[]) {
    for(const itemId of itemIds) {
        itemCloses.set(itemId, (itemCloses.get(itemId) ?? 0) + 1)
    }
}

export function getSocketItemCloses(itemId: string) {
    return itemCloses.get(itemId) ?? 0
}

export function noteSocketClientRemoved(socketKey: string) {
    clientRemovals.set(socketKey, (clientRemovals.get(socketKey) ?? 0) + 1)
}

export function getSocketClientRemovals(socketKey: string) {
    return clientRemovals.get(socketKey) ?? 0
}

export function noteSocketConnectStarted(socketKey: string) {
    const starts = (connectStarts.get(socketKey) ?? 0) + 1
    connectStarts.set(socketKey, starts)
    return starts
}

export function isLatestSocketConnect(socketKey: string, starts: number) {
    return connectStarts.get(socketKey) === starts
}

export function noteSocketOpened(itemId: string, socketKey: string) {
    if(!openedSocketKeys.has(itemId)) {
        openedSocketKeys.set(itemId, new Set())
    }
    openedSocketKeys.get(itemId)!.add(socketKey)
}

export function takeOpenedSocketKeys(itemId: string) {
    const socketKeys = [...openedSocketKeys.get(itemId) ?? []]
    openedSocketKeys.delete(itemId)
    return socketKeys
}
