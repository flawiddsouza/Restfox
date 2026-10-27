// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest'
import { reactive } from 'vue'

vi.mock('@/store', () => ({ store: { state: { activeWorkspace: { _id: 'w' }, collection: [{ _id: 'g', workspaceId: 'w', _type: 'grpc', grpc: { service: 'Demo', method: 'Stream' } }] } } }))
vi.mock('@/db', async(importOriginal) => ({ ...await importOriginal<object>(), getResponsesByCollectionId: vi.fn() }))

import RequestPanel from './RequestPanel.vue'
import { getResponsesByCollectionId } from '@/db'
import * as helpers from '@/helpers'

afterEach(() => vi.restoreAllMocks())

const tag = `{% response(request='g', attribute='body', path='$.token', behavior='never') %}`
const history = [{ grpc: { service: 'Demo', method: 'Stream', kind: 'serverStream', ended: 'completed' } }]

for(const field of ['url', 'name', 'value']) {
    for(const firstEndsFirst of [true, false]) {
        test(`a failed ${field} preview cannot replace a newer URL preview, first ends first: ${firstEndsFirst}`, async() => {
            let finishFirst!: (value: any) => void
            let historyStarted!: () => void
            const started = new Promise<void>(resolve => {
                historyStarted = resolve
            })
            vi.mocked(getResponsesByCollectionId).mockImplementationOnce(() => {
                historyStarted()
                return new Promise(resolve => {
                    finishFirst = resolve
                })
            })
            const panel: any = reactive({
                activeTab: { _id: 'http', workspaceId: 'w', url: field === 'url' ? `https://old.test/${tag}` : 'https://old.test/:id', pathParameters: field === 'url' ? [] : [{ name: field === 'name' ? tag : 'id', value: field === 'value' ? tag : 'old' }] },
                collectionItemEnvironmentResolved: {},
                urlPreview: '',
                urlPreviewLoad: 0,
            })
            const oldPreview = RequestPanel.methods!.getUrlPreview.call(panel)
            await started
            // Editing the address updates the path table too, as the URL editor does.
            panel.activeTab.url = 'https://new.test/literal'
            panel.activeTab.pathParameters = []
            let finishNew!: () => void
            let newStarted!: () => void
            const waitingNew = new Promise<void>(resolve => {
                newStarted = resolve
            })
            const newResult = new Promise<void>(resolve => {
                finishNew = resolve
            })
            const substitute = helpers.substituteEnvironmentVariables
            vi.spyOn(helpers, 'substituteEnvironmentVariables').mockImplementation(async(...args) => {
                const value = await substitute(...args)
                if(args[1] === 'https://new.test/literal') {
                    newStarted()
                    await newResult
                }
                return value
            })
            const newPreview = RequestPanel.methods!.getUrlPreview.call(panel)
            await waitingNew
            if(firstEndsFirst) {
                finishFirst(history)
                await oldPreview
                expect(panel.urlPreview).toBe('')
            }
            finishNew()
            await newPreview
            expect(panel.urlPreview).toBe('https://new.test/literal')
            if(!firstEndsFirst) {
                finishFirst(history)
                await oldPreview
            }
            expect(panel.urlPreview).toBe('https://new.test/literal')
        })
    }
}

test('the current failed URL preview still shows its placeholder', async() => {
    vi.mocked(getResponsesByCollectionId).mockResolvedValue(history as any)
    const panel: any = { activeTab: { workspaceId: 'w', url: `https://old.test/${tag}` }, collectionItemEnvironmentResolved: {}, urlPreview: '', urlPreviewLoad: 0 }
    await RequestPanel.methods!.getUrlPreview.call(panel)
    expect(panel.urlPreview).toBe('https://old.test/<no value found>')
})
