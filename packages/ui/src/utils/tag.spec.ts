// @vitest-environment edge-runtime

import { test, expect, vi, beforeEach } from 'vitest'

vi.mock('@/store', () => ({
    store: {
        state: { collection: [{ _id: 'login', _type: 'request', workspaceId: 'w', name: 'Login' }] },
        dispatch: vi.fn(),
    },
}))

vi.mock('@/db', () => ({
    getResponsesByCollectionId: vi.fn(),
}))

import { handleResponseTag } from './tag'
import { getResponsesByCollectionId } from '@/db'
import type { ParsedResult } from '@/parsers/tag'

const encoder = new TextEncoder()

function savedResponse(id: string, body: string, fields: Record<string, unknown> = {}) {
    return {
        _id: id,
        collectionId: 'login',
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'application/json']],
        buffer: encoder.encode(body).buffer,
        createdAt: Date.now(),
        ...fields,
    }
}

const tokenTag = {
    functionName: 'response',
    parameters: { attribute: 'body', request: 'login', path: '$.token', behavior: 'never', maxAge: 0 },
} as unknown as ParsedResult

beforeEach(() => {
    vi.mocked(getResponsesByCollectionId).mockReset()
})

test('a response cut short is passed over, the tag reads the newest whole one, as when only whole ones were saved', async() => {
    vi.mocked(getResponsesByCollectionId).mockResolvedValue([
        savedResponse('cut-short', '{"tok', { bodyIncomplete: 'timedOut' }),
        savedResponse('whole', '{"token":"abc123"}'),
    ] as any)

    expect(await handleResponseTag(tokenTag, false, undefined)).toBe('abc123')
})

test('with only responses cut short, no history means no value, as before', async() => {
    vi.mocked(getResponsesByCollectionId).mockResolvedValue([
        savedResponse('cut-short', '{"tok', { bodyIncomplete: 'failed' }),
    ] as any)

    expect(await handleResponseTag(tokenTag, false, undefined)).toBeUndefined()
})

test('when-expired with an expired response sends again and reads the response it just got', async() => {
    const expired = savedResponse('expired', '{"token":"old"}', { createdAt: Date.now() - 60_000 })
    const fresh = savedResponse('fresh', '{"token":"new"}')
    vi.mocked(getResponsesByCollectionId)
        .mockResolvedValueOnce([expired] as any)
        // newest first, as the database gives them
        .mockResolvedValueOnce([fresh, expired] as any)

    const whenExpired = { ...tokenTag, parameters: { ...tokenTag.parameters, behavior: 'when-expired', maxAge: 10 } } as unknown as ParsedResult

    expect(await handleResponseTag(whenExpired, true, undefined)).toBe('new')
})
