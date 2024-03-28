import { Page } from "@playwright/test"

export async function isActiveSidebarItem(page: Page, name: string) {
    return (await page.locator('.sidebar-item.sidebar-item-active').textContent())?.trim() === name
}

export async function isActiveTab(page: Page, name: string) {
    return (await page.locator('.tab.tab-active').textContent())?.trim() === name
}

export async function creatRequest(page: Page, requestName: string) {
    await page.locator('.sidebar').click({ button: 'right' })
    await page.getByRole('button', { name: 'New Request' }).click()
    await page.getByPlaceholder('My Request').fill(requestName)
    await page.getByRole('button', { name: 'Create' }).click()
}
