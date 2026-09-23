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
import type { CollectionItem, Plugin, Workspace } from './global'
import { store } from './store'
import { INHERITED_AUTHENTICATION_TYPE } from './helpers'

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

describe('getEnvironmentForRequest', () => {
    const folder = (id: string, parentId: string | null, authentication: CollectionItem['authentication']): CollectionItem => ({
        _id: id,
        _type: 'request_group',
        name: id,
        parentId,
        workspaceId: 'workspace-id',
        authentication,
    })
    const request: CollectionItem = { _id: 'request-id', _type: 'request', name: 'Request', parentId: 'child', workspaceId: 'workspace-id' }
    const rootAuthentication = { type: 'bearer', token: 'root-token' }

    const resolve = async(childAuthentication: CollectionItem['authentication']) => {
        store.state.activeWorkspace = { _id: 'workspace-id', _type: 'file', name: 'Workspace', dotEnv: {} } as Workspace
        store.state.collection = [folder('root', null, rootAuthentication), folder('child', 'root', childAuthentication), request]
        const { parentAuthentication } = await store.dispatch('getEnvironmentForRequest', { collectionItem: request })
        return parentAuthentication
    }

    test('a folder set to No Auth stops the auth of the folders above it', async() => {
        expect(await resolve({ type: 'none' })).toBeUndefined()
    })

    test('a folder set to Inherit, or without an authentication object, passes the auth of the folder above it through', async() => {
        expect(await resolve({ type: INHERITED_AUTHENTICATION_TYPE })).toEqual(rootAuthentication)
        expect(await resolve(undefined)).toEqual(rootAuthentication)
    })

    test('a folder whose own auth is unticked passes the auth of the folder above it through, as it always has', async() => {
        expect(await resolve({ type: 'bearer', token: 'child-token', disabled: true })).toEqual(rootAuthentication)
    })

    test('a folder with an auth of its own wins over the folder above it', async() => {
        expect(await resolve({ type: 'basic', username: 'u', password: 'p' })).toEqual({ type: 'basic', username: 'u', password: 'p' })
    })
})
