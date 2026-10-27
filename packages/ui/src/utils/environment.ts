import type { Dispatch } from 'vuex'
import type { CollectionItem, RequestAuthentication, ResolutionMode, ResolutionOptions } from '@/global'

export interface RequestEnvironment {
    environment: any
    parentHeaders: Record<string, string[]>
    parentAuthentication?: RequestAuthentication
    requestParentArray: CollectionItem[]
}

export function resolveEnvironmentForRequest(
    store: { dispatch: Dispatch },
    collectionItem: CollectionItem,
    mode: ResolutionMode,
    options: ResolutionOptions & { includeSelf?: boolean } = {},
): Promise<RequestEnvironment> {
    return store.dispatch('getEnvironmentForRequest', { ...options, collectionItem, mode })
}
