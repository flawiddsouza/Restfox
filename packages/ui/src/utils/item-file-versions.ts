// What this page knows about the file of each item in a file workspace, a folder's being its headers and auth, and the
// order of each script's saves, kept by workspace and item id, which every copy of an item keeps, such as the tab opened on it, so all copies save from one version. It is
// kept in memory only, never in the item, so it is never saved or exported. An entry is changed in place and never
// replaced, so a write that started on it still reaches it after its item was renamed
export interface ItemFileEntry {
    // the item's id now, which a reload that finds it renamed moves the entry to
    id: string
    // the file's version as this page last loaded or wrote it, null when none is known, as in a browser workspace
    version: string | null
    // every version taken since the current reload began: a reload that read the file at one of them finds it
    // unchanged, even when a later save has moved the version on since
    history: string[]
    // raised when a reload, a load or a create at the same id replaces the item's objects, so a save asked for before
    // then, made from an object replaced, is not sent
    generation: number
    // the item's writes, one at a time in the order they were asked for
    chain: Promise<void>
    // the whole save waiting to start, which a later ask joins
    wholeSaveQueued: { object: object, generation: number } | null
    // a delete of the item waits for its writes, and whole saves that start meanwhile, such as a connected socket's
    // tab saving each message it receives, are dropped
    deleting: boolean
    // the latest object whose save was dropped while deleting and the generation it was asked in, saved after all if the
    // delete fails, unless a reload has replaced the item since
    savedWhileDeleting: { object: object, generation: number } | null
    // a merge of its sort order landed since the current reload began, so the reload's read order is older
    sortOrderMerged: boolean
    // the load count when this page created the item, so a reload that began before it and read without it keeps it
    createdInLoad: number | null
    // for a set of environments: saves the storage refused, so a pick asked for after one of them is not made, as it
    // can name an environment that save would have added or renamed
    refusals: number
    // for a set of environments: scripts' values waiting for a save that may be refused, set again after its reload
    retriesAfterRefusal: (() => void)[]
    // for a set of environments: those of saves refused, waiting for the reload the first of them asked for
    retriesAfterReload: (() => void)[]
    // for a set of environments: its pick was saved since the current reload began, so the reload's read pick is older
    currentEnvironmentPicked: boolean
    // for a set of environments: a refusal was told and its reload has not ended, so the next is neither told nor reloads
    reloadAsked: boolean
}

const entriesByWorkspace = new Map<string, Map<string, ItemFileEntry>>()

// raised by every load or reload of a workspace, so a reload that finds it moved knows a newer read was applied
let workspaceLoads = 0

// per workspace, the ids this page deleted and the load count then, so a reload that read before a delete leaves the
// item out. Cleared as the next reload of the workspace begins, which reads after the delete
const deletedByWorkspace = new Map<string, Map<string, number>>()

function entriesOf(workspaceId: string) {
    let entries = entriesByWorkspace.get(workspaceId)
    if(!entries) {
        entries = new Map()
        entriesByWorkspace.set(workspaceId, entries)
    }
    return entries
}

export function getItemEntry(workspaceId: string, id: string): ItemFileEntry {
    const entries = entriesOf(workspaceId)
    let entry = entries.get(id)
    if(!entry) {
        entry = { id, version: null, history: [], generation: 0, chain: Promise.resolve(), wholeSaveQueued: null, deleting: false, savedWhileDeleting: null, sortOrderMerged: false, createdInLoad: null, refusals: 0, retriesAfterRefusal: [], retriesAfterReload: [], reloadAsked: false, currentEnvironmentPicked: false }
        entries.set(id, entry)
    }
    return entry
}

// The entry of a workspace's environments, or a folder's, as a set: not an item id, as those are paths
export function environmentsKey(collectionId: string | null | undefined) {
    return `environments:${collectionId ?? ''}`
}

// the versions a load read, of items and of each set of environments, as one map of entries
export function withEnvironmentVersions(versions: Record<string, string> | undefined, environmentVersions: Record<string, string> | undefined) {
    const merged = { ...versions }
    for(const [collectionId, version] of Object.entries(environmentVersions ?? {})) {
        merged[environmentsKey(collectionId)] = version
    }
    return merged
}

export function peekItemEntry(workspaceId: string, id: string): ItemFileEntry | undefined {
    return entriesByWorkspace.get(workspaceId)?.get(id)
}

export function getItemVersion(workspaceId: string, id: string): string | null {
    return peekItemEntry(workspaceId, id)?.version ?? null
}

// reloads under way, which one at a time compare what they read with the versions taken since they began
let reloadsRunning = 0

export function setItemVersion(entry: ItemFileEntry, version: string) {
    entry.version = version
    if(reloadsRunning > 0) {
        entry.history.push(version)
    } else {
        entry.history = [version]
    }
}

// the queue of one script's saves, by the script's own id, which a rename of its request leaves as it is
const SCRIPT_WRITES_PREFIX = 'plugin:'

export function scriptWriteKey(pluginId: string) {
    return `${SCRIPT_WRITES_PREFIX}${pluginId}`
}

// The versions a load of the workspace shown read, whose objects replace those shown before. Entries of ids it did
// not read are forgotten
export function loadItemVersions(workspaceId: string, versions: Record<string, string> | undefined) {
    workspaceLoads++
    const entries = entriesOf(workspaceId)
    for(const id of [...entries.keys()]) {
        // a load knows nothing of a script's saves, and one may still be running
        if(versions?.[id] === undefined && !id.startsWith(SCRIPT_WRITES_PREFIX)) {
            entries.delete(id)
        }
    }
    for(const [id, version] of Object.entries(versions ?? {})) {
        const entry = getItemEntry(workspaceId, id)
        // the load replaces the objects, so a save still asked for from one before it, made from another version of
        // the file, is not sent
        if(entry.version !== null && entry.version !== version) {
            entry.generation++
        }
        entry.version = version
        entry.history = [version]
    }
}

// this page created the item, as a create's or a duplicate's reply says
export function noteItemCreated(workspaceId: string, id: string) {
    getItemEntry(workspaceId, id).createdInLoad = workspaceLoads
}

export function noteItemsDeleted(workspaceId: string, ids: string[]) {
    let deleted = deletedByWorkspace.get(workspaceId)
    if(!deleted) {
        deleted = new Map()
        deletedByWorkspace.set(workspaceId, deleted)
    }
    for(const id of ids) {
        deleted.set(id, workspaceLoads)
    }
}

// whether the page deleted the item after the reload whose load count is given began
export function deletedSince(workspaceId: string, id: string, load: number) {
    return deletedByWorkspace.get(workspaceId)?.get(id) === load
}

// whether the page created the item after the reload whose load count is given began
export function createdSince(workspaceId: string, id: string, load: number) {
    return peekItemEntry(workspaceId, id)?.createdInLoad === load
}

// A reload of the workspace shown begins: from here on, history holds only versions taken since. Returns the load
// count to pass to loadedSince
export function beginItemReload(workspaceId: string): number {
    reloadsRunning++
    workspaceLoads++
    deletedByWorkspace.delete(workspaceId)
    for(const entry of entriesOf(workspaceId).values()) {
        entry.history = entry.version === null ? [] : [entry.version]
        entry.sortOrderMerged = false
        entry.currentEnvironmentPicked = false
    }
    return workspaceLoads
}

// the reload begun by beginItemReload has ended, applied or not
export function endItemReload() {
    reloadsRunning--
}

export function loadedSince(load: number) {
    return workspaceLoads !== load
}

// a reload found items renamed or moved, previousIdByNewId holding only the ids that changed
export function renameItemIds(workspaceId: string, previousIdByNewId: Map<string, string>) {
    const entries = entriesOf(workspaceId)
    const moved = new Map<string, ItemFileEntry>()
    for(const [newId, previousId] of previousIdByNewId) {
        const entry = entries.get(previousId)
        if(entry) {
            moved.set(newId, entry)
        }
    }
    for(const previousId of previousIdByNewId.values()) {
        entries.delete(previousId)
    }
    for(const [newId, entry] of moved) {
        entry.id = newId
        entries.set(newId, entry)
    }
}

export function forgetItems(workspaceId: string, ids: string[]) {
    const entries = entriesByWorkspace.get(workspaceId)
    ids.forEach(id => entries?.delete(id))
}

// every write asked for so far of the workspace's items, which a load waits for, as it replaces the objects they were
// made from
export async function workspaceWritesSettled(workspaceId: string): Promise<void> {
    await Promise.all([...(entriesByWorkspace.get(workspaceId)?.values() ?? [])].map(entry => entry.chain))
}

export function itemWritesSettled(workspaceId: string, id: string): Promise<void> {
    return entriesByWorkspace.get(workspaceId)?.get(id)?.chain ?? Promise.resolve()
}

// the item writes asked for that the page has not yet handed over, which leaving it would lose: those waiting behind a
// running one, and a running one until it calls sent, as it starts the Electron call, the request to the server or the
// browser database write, such as after reading a request's body files. A request to the server still uploading when
// the page goes can be cut off, as each save always could be
let itemWritesWaiting = 0

export function itemWritesPending() {
    return itemWritesWaiting > 0
}

// changes other than item writes that wait in the page and then call the storage, such as a rename or a delete
const heldWork = new Set<Promise<void>>()

// Such a change, from its wait for the item's writes until the storage answers it, counts as an item write waiting,
// so leaving the page meanwhile is held and Electron's repeated close waits for it too
export async function holdUnloadWhile<T>(work: Promise<T>): Promise<T> {
    itemWritesWaiting++
    const settled = work.then(() => undefined, () => undefined)
    heldWork.add(settled)
    try {
        return await work
    } finally {
        itemWritesWaiting--
        heldWork.delete(settled)
    }
}

// every item write asked for so far, of every workspace
export async function allItemWritesSettled(): Promise<void> {
    await Promise.all([...entriesByWorkspace.values()].flatMap(entries => [...entries.values()].map(entry => entry.chain)).concat([...heldWork]))
}

// The write is given the entry as it was when asked for, which a rename meanwhile moves rather than replaces, and the
// sent to call once its data has left the page, or it counts as waiting until it ends
export function enqueueItemWrite<T>(entry: ItemFileEntry, write: (entry: ItemFileEntry, sent: () => void) => Promise<T>): Promise<T> {
    itemWritesWaiting++
    let waiting = true
    const sent = () => {
        if(waiting) {
            waiting = false
            itemWritesWaiting--
        }
    }
    const result = entry.chain.then(() => write(entry, sent))
    entry.chain = result.then(sent, sent)
    return result
}

// A save of the whole item reads the object when it runs, so one queued save covers every change made before it
// starts. An ask made after a reload replaced the item for an outside change takes the queued save's place, and the
// object of the queued one, which the reload replaced, is passed to notSaved
export function queueWholeItemSave<T extends object>(
    entry: ItemFileEntry,
    object: T,
    save: (object: T, generation: number, sent: () => void) => Promise<void>,
    notSaved: (object: T) => void,
) {
    const queued = entry.wholeSaveQueued
    if(queued) {
        if(entry.generation > queued.generation && queued.object !== object) {
            notSaved(queued.object as T)
            queued.generation = entry.generation
        }
        queued.object = object
        return
    }
    const ask = { object: object as object, generation: entry.generation }
    entry.wholeSaveQueued = ask
    enqueueItemWrite(entry, (_entry, sent) => {
        entry.wholeSaveQueued = null
        return save(ask.object as T, ask.generation, sent)
    })
}
