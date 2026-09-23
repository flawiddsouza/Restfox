import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./db', () => ({
    getResponsesByCollectionId: vi.fn(),
    getCollectionForWorkspace: vi.fn(),
    getAllWorkspaces: vi.fn(),
    putWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    getAllCollectionIdsForGivenWorkspace: vi.fn(),
    createCollection: vi.fn(),
    createCollections: vi.fn(),
    updateCollection: vi.fn(),
    createResponse: vi.fn(),
    updateResponse: vi.fn(),
    deleteResponsesByCollectionIds: vi.fn(),
    deleteResponsesByCollectionId: vi.fn(),
    deleteResponse: vi.fn(),
    deleteResponsesByIds: vi.fn(),
    deletePluginsByWorkspace: vi.fn(),
    deletePluginsByCollectionIds: vi.fn(),
    modifyCollections: vi.fn(),
    deleteCollectionsByWorkspaceId: vi.fn(),
    getGlobalPlugins: vi.fn(),
    getWorkspacePlugins: vi.fn(),
    deleteCollectionsByIds: vi.fn(),
    createPlugin: vi.fn(),
    updatePlugin: vi.fn(),
    deletePlugin: vi.fn(),
    createPlugins: vi.fn(),
}))

import { createPlugin, deletePlugin, updatePlugin } from './db'
import type { Plugin, Workspace } from './global'
import { store } from './store'

function scriptPlugin(id: string, code: { pre_request: string, post_request: string }): Plugin {
    return {
        _id: id,
        type: 'script',
        name: null,
        code,
        workspaceId: null,
        collectionId: 'request-id',
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
    }
}

describe('saveRequestScript', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        store.state.activeWorkspace = {
            _id: 'workspace-id',
            _type: 'file',
            name: 'Workspace',
        } as Workspace
        store.state.plugins.workspace = []
    })

    test('updates the primary script and removes stale duplicates', async() => {
        const primary = scriptPlugin('primary', {
            pre_request: '',
            post_request: '',
        })
        const duplicate = scriptPlugin('duplicate', {
            pre_request: '',
            post_request: 'throw new Error("stale")',
        })
        store.state.plugins.workspace = [primary, duplicate]

        await store.dispatch('saveRequestScript', {
            collectionId: 'request-id',
            code: {
                pre_request: '',
                post_request: '',
            },
        })

        expect(store.state.plugins.workspace).toHaveLength(1)
        expect(store.state.plugins.workspace[0]._id).toBe('primary')
        expect(store.state.plugins.workspace[0].code).toEqual({
            pre_request: '',
            post_request: '',
        })
        expect(updatePlugin).toHaveBeenCalledOnce()
        expect(deletePlugin).toHaveBeenCalledWith(
            'duplicate',
            'workspace-id',
            'request-id',
        )
    })

    test('reserves a new script before persistence to prevent duplicate creation', async() => {
        let finishCreate: (() => void) | undefined
        vi.mocked(createPlugin).mockImplementationOnce(() => new Promise<void>(resolve => {
            finishCreate = resolve
        }))

        const firstSave = store.dispatch('saveRequestScript', {
            collectionId: 'request-id',
            code: {
                pre_request: 'first',
                post_request: '',
            },
        })
        const secondSave = store.dispatch('saveRequestScript', {
            collectionId: 'request-id',
            code: {
                pre_request: 'second',
                post_request: '',
            },
        })

        finishCreate?.()
        await Promise.all([firstSave, secondSave])

        expect(createPlugin).toHaveBeenCalledOnce()
        expect(updatePlugin).toHaveBeenCalledOnce()
        expect(store.state.plugins.workspace).toHaveLength(1)
        expect(store.state.plugins.workspace[0].code).toEqual({
            pre_request: 'second',
            post_request: '',
        })
    })
})
