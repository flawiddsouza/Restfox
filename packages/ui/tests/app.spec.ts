import { test, expect } from '@playwright/test'
import { creatRequest, isActiveSidebarItem, isActiveTab } from './helpers'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
    expect(await page.title()).toBe('Restfox')
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
