import { test, expect } from 'vitest'
import { nextTick, reactive, watch } from 'vue'
import { clearSkipPersistingActiveTabAfterUpdate } from './skip-persisting-active-tab'

// the tab's watcher as Tab.vue has it: a change to the same item saves unless a skip is set, which the save uses up
function watchActiveTab() {
    const state = reactive({ skipPersistingActiveTab: false, activeTab: { _id: 'First.json', url: '' } })
    const saved: string[] = []
    watch(() => state.activeTab, (newValue, oldValue) => {
        if(oldValue && newValue && oldValue._id === newValue._id) {
            if(state.skipPersistingActiveTab) {
                state.skipPersistingActiveTab = false
                return
            }
            saved.push(newValue.url)
        }
    }, { deep: true })
    return { state, saved }
}

test('a skip set for a tab that comes back under a new id, as after a rename in a file workspace, does not drop the next change', async() => {
    const { state, saved } = watchActiveTab()

    // the rename reloads the tab under its new id, which no save follows
    state.skipPersistingActiveTab = true
    state.activeTab = { _id: 'Renamed.json', url: '' }
    clearSkipPersistingActiveTabAfterUpdate(state)
    await nextTick()

    state.activeTab.url = 'http://example.com/after-rename'
    await nextTick()
    expect(saved).toEqual(['http://example.com/after-rename'])
})

test('a skip still skips the change it was set for', async() => {
    const { state, saved } = watchActiveTab()

    state.skipPersistingActiveTab = true
    state.activeTab.url = 'reloaded from disk'
    clearSkipPersistingActiveTabAfterUpdate(state)
    await nextTick()
    expect(saved).toEqual([])

    state.activeTab.url = 'typed by the user'
    await nextTick()
    expect(saved).toEqual(['typed by the user'])
})
