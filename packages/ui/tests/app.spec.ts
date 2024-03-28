import { test, expect } from '@playwright/test'
import { creatRequest, isActiveSidebarItem, isActiveTab, typeInRequestPanelAddressBar } from './helpers'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    expect(await page.title()).toBe('Restfox')
})

test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
        window.indexedDB.deleteDatabase('Restfox')
    })
})

test.describe('Collection', () => {
    test('add requests', async ({ page }) => {
        for(let i = 1; i <= 10; i++) {
            const requestName = `Request ${i}`
            await creatRequest(page, requestName)
            expect(await isActiveSidebarItem(page, `GET${requestName}`)).toBe(true)
            expect(await isActiveTab(page, `GET ${requestName}x`)).toBe(true)
        }
    })
})

test.describe('Request > Request Panel > URL + Query tab sync', () => {
    test('type url with query params', async ({ page }) => {
        await creatRequest(page, 'Request 1')

        await typeInRequestPanelAddressBar(page, 'test?p1=v1&p2=v2', false)

        const requestPanelQueryTab = page.getByTestId('request-panel-tab-Query')

        requestPanelQueryTab.click()
        const tabText = await requestPanelQueryTab.textContent()
        expect(tabText).toBe('Query (2)')

        const getInput = (row: number, column: number) => {
            return page.locator(`.request-panel-tabs-context > table:nth-of-type(1) > tr:nth-of-type(${row}) > td:nth-of-type(${column})`)
        }

        const checkIfRowHasValues = async(row: number, values: string[]) => {
            for(let i = 1; i <= values.length; i++) {
                await expect(getInput(row, i)).toHaveText(values[i - 1])
            }
        }

        await checkIfRowHasValues(1, ['p1', 'v1'])
        await checkIfRowHasValues(2, ['p2', 'v2'])

        await typeInRequestPanelAddressBar(page, '', true)

        expect

        const tabText2 = await requestPanelQueryTab.textContent()
        expect(tabText2).toBe('Query')
    })
})
