const { I } = inject()

Feature('App')

Before(() => {
    I.amOnPage('/')
})

After(() => {
    I.usePlaywrightTo('clean up DB', async({ page }) => {
        await page.evaluate(() => {
            window.indexedDB.deleteDatabase('Restfox')
        })
    })
})

Scenario('Check page title', () => {
    I.seeTitleEquals('Restfox')
})

Scenario('Add requests', async() => {
    for(let i = 1; i <= 10; i++) {
        const requestName = `Request ${i}`
        I.creatRequest(requestName)
        await I.isActiveSidebarItem(`GET${requestName}`)
        await I.isActiveTab(`GET ${requestName}x`)
    }
})

Scenario('type url with query params', async() => {
    const queryTab = '[data-testid="request-panel-tab-Query"]'

    I.creatRequest('Request 1')
    I.typeInRequestPanelAddressBar('test?p1=v1&p2=v2')
    I.click({ pw: queryTab })
    let text = await I.grabTextFrom(queryTab)
    I.expectEqual(text.trim(), 'Query (2)')

    const getInput = (row: number, column: number) => {
        return locate(`.request-panel-tabs-context > table:nth-of-type(1) > tr:nth-of-type(${row}) > td:nth-of-type(${column})`)
    }

    const checkIfRowHasValues = async(row: number, values: string[]) => {
        for(let i = 1; i <= values.length; i++) {
            I.expectContain(await I.grabTextFrom(getInput(row, i)), values[i - 1])
        }
    }

    await checkIfRowHasValues(1, ['p1', 'v1'])
    await checkIfRowHasValues(2, ['p2', 'v2'])

    I.typeInRequestPanelAddressBar('', true)
    text = await I.grabTextFrom(queryTab)
    I.expectEqual(text.trim(), 'Query')
})
