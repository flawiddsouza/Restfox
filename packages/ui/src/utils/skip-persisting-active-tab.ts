import { nextTick } from 'vue'
import type { State } from '@/global'

// A skip of the active tab's save is set right before the change it is for. Clearing it once Vue has run the tab's
// watchers keeps a skip that no save used, such as for a tab whose id changed, from dropping a later change
export function clearSkipPersistingActiveTabAfterUpdate(state: Pick<State, 'skipPersistingActiveTab'>) {
    nextTick(() => {
        state.skipPersistingActiveTab = false
    })
}
