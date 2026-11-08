import { describe, expect, test } from 'vitest'
import {
    allItemWritesSettled,
    beginItemReload,
    createdSince,
    endItemReload,
    holdUnloadWhile,
    noteItemCreated,
    enqueueItemWrite,
    forgetItems,
    getItemEntry,
    getItemVersion,
    itemWritesPending,
    itemWritesSettled,
    loadItemVersions,
    loadedSince,
    queueWholeItemSave,
    renameItemIds,
    setItemVersion,
    workspaceWritesSettled,
} from './item-file-versions'

function held() {
    let release!: () => void
    const promise = new Promise<void>(resolve => {
        release = resolve
    })
    return { promise, release }
}

describe('item file versions', () => {
    test('are kept per workspace, so an item at the same path in another workspace has its own', () => {
        loadItemVersions('a', { 'Login.json': 'a1' })
        loadItemVersions('b', { 'Login.json': 'b1' })
        expect(getItemVersion('a', 'Login.json')).toBe('a1')
        expect(getItemVersion('b', 'Login.json')).toBe('b1')
        expect(getItemVersion('c', 'Login.json')).toBe(null)
    })

    test('a load changes its entries in place and forgets the ids it did not read', () => {
        loadItemVersions('w', { 'Login.json': 'v1', 'Gone.json': 'g1' })
        const entry = getItemEntry('w', 'Login.json')
        loadItemVersions('w', { 'Login.json': 'v2' })
        expect(getItemEntry('w', 'Login.json')).toBe(entry)
        expect(entry.version).toBe('v2')
        expect(getItemVersion('w', 'Gone.json')).toBe(null)
    })

    test('a load that reads another version than the page held stops saves asked for before it', () => {
        loadItemVersions('w', { 'A.json': 'a1', 'B.json': 'b1' })
        loadItemVersions('w', { 'A.json': 'a1', 'B.json': 'outside' })
        expect(getItemEntry('w', 'A.json').generation).toBe(0)
        expect(getItemEntry('w', 'B.json').generation).toBe(1)
    })

    test('a reload during which the page created an item knows it, and a later one does not', () => {
        const load = beginItemReload('w')
        noteItemCreated('w', 'New.json')
        expect(createdSince('w', 'New.json', load)).toBe(true)
        expect(createdSince('w', 'New.json', beginItemReload('w'))).toBe(false)
        endItemReload()
        endItemReload()
    })

    test('a reload keeps in history only the versions taken from its start on', () => {
        loadItemVersions('w', { 'Login.json': 'v1' })
        const entry = getItemEntry('w', 'Login.json')
        setItemVersion(entry, 'v2')
        entry.sortOrderMerged = true
        beginItemReload('w')
        setItemVersion(entry, 'v3')
        expect(entry.history).toEqual(['v2', 'v3'])
        expect(entry.sortOrderMerged).toBe(false)
        endItemReload()
    })

    test('a load or reload after another one began is seen by it', () => {
        const load = beginItemReload('w')
        expect(loadedSince(load)).toBe(false)
        loadItemVersions('w', {})
        expect(loadedSince(load)).toBe(true)
        endItemReload()
    })

    test('a rename moves entries, also when two items swap their ids', () => {
        loadItemVersions('w', { 'A.json': 'a1', 'B.json': 'b1', 'C.json': 'c1' })
        const a = getItemEntry('w', 'A.json')
        renameItemIds('w', new Map([['B.json', 'A.json'], ['A.json', 'B.json'], ['D.json', 'C.json']]))
        expect(getItemEntry('w', 'B.json')).toBe(a)
        expect(getItemVersion('w', 'A.json')).toBe('b1')
        expect(getItemVersion('w', 'D.json')).toBe('c1')
        expect(getItemVersion('w', 'C.json')).toBe(null)
        forgetItems('w', ['D.json'])
        expect(getItemVersion('w', 'D.json')).toBe(null)
    })

    test('writes of an item run one at a time, each given the entry it was asked for on', async() => {
        loadItemVersions('w', { 'Login.json': 'v1' })
        const entry = getItemEntry('w', 'Login.json')
        const first = held()
        const order: string[] = []
        enqueueItemWrite(entry, async() => {
            await first.promise
            order.push('first')
        })
        const second = enqueueItemWrite(entry, async(given) => {
            order.push('second')
            return given
        })
        renameItemIds('w', new Map([['New.json', 'Login.json']]))
        first.release()
        expect(await second).toBe(entry)
        await itemWritesSettled('w', 'New.json')
        expect(order).toEqual(['first', 'second'])
    })

    test('a write counts as pending until its data leaves the page, or until it ends', async() => {
        const entry = getItemEntry('pending', 'Login.json')
        const finish = held()
        let sendNow!: () => void
        enqueueItemWrite(entry, async(_entry, sent) => {
            sendNow = sent
            await finish.promise
        })
        await new Promise(resolve => setTimeout(resolve, 0))
        // still reading the request's body files, say
        expect(itemWritesPending()).toBe(true)
        sendNow()
        expect(itemWritesPending()).toBe(false)
        finish.release()
        await itemWritesSettled('pending', 'Login.json')

        enqueueItemWrite(entry, async() => undefined)
        expect(itemWritesPending()).toBe(true)
        await itemWritesSettled('pending', 'Login.json')
        expect(itemWritesPending()).toBe(false)
    })

    test('versions taken while no reload runs replace the history, and those during one add to it', () => {
        loadItemVersions('history', { 'Login.json': 'v1' })
        const entry = getItemEntry('history', 'Login.json')
        setItemVersion(entry, 'v2')
        setItemVersion(entry, 'v3')
        expect(entry.history).toEqual(['v3'])
        beginItemReload('history')
        setItemVersion(entry, 'v4')
        expect(entry.history).toEqual(['v3', 'v4'])
        endItemReload()
        setItemVersion(entry, 'v5')
        expect(entry.history).toEqual(['v5'])
    })

    test('a change waiting in the page for an item\'s writes, such as a rename, holds an unload while it waits', async() => {
        const wait = held()
        const holding = holdUnloadWhile(wait.promise)
        expect(itemWritesPending()).toBe(true)
        wait.release()
        await holding
        expect(itemWritesPending()).toBe(false)
    })

    test('all item writes settle only once a change held while it waits, such as a rename, has its answer', async() => {
        const rename = held()
        const holding = holdUnloadWhile(rename.promise)
        let settled = false
        const waiting = allItemWritesSettled().then(() => {
            settled = true
        })
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(settled).toBe(false)
        rename.release()
        await holding
        await waiting
        expect(settled).toBe(true)
    })

    test('a load waits for the writes of every item of its workspace', async() => {
        loadItemVersions('w', { 'A.json': 'a1', 'B.json': 'b1' })
        const running = held()
        enqueueItemWrite(getItemEntry('w', 'B.json'), () => running.promise)
        let settled = false
        const waiting = workspaceWritesSettled('w').then(() => {
            settled = true
        })
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(settled).toBe(false)
        running.release()
        await waiting
        expect(settled).toBe(true)
    })

    test('whole saves asked for while one waits are one save of the latest object, from the generation it was asked in', async() => {
        loadItemVersions('w', { 'Login.json': 'v1' })
        const entry = getItemEntry('w', 'Login.json')
        const running = held()
        enqueueItemWrite(entry, () => running.promise)
        const saved: [string, number][] = []
        const notSaved: string[] = []
        const save = async(object: { name: string }, generation: number) => {
            saved.push([object.name, generation])
        }
        const old = { name: 'old' }
        queueWholeItemSave(entry, old, save, object => notSaved.push(object.name))
        queueWholeItemSave(entry, old, save, object => notSaved.push(object.name))
        // a reload replaced the item for an outside change
        entry.generation++
        queueWholeItemSave(entry, { name: 'fresh' }, save, object => notSaved.push(object.name))
        running.release()
        await itemWritesSettled('w', 'Login.json')
        expect(saved).toEqual([['fresh', 1]])
        expect(notSaved).toEqual(['old'])
    })
})
