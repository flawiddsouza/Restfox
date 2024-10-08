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
        I.createRequest(requestName)
        await I.isActiveSidebarItem(`GET${requestName}`)
        await I.isActiveTab(`GET ${requestName}`)
    }
})

Scenario('Add GraphQL requests', async() => {
    const requestName = `GraphQL Request`
    I.createGraphQLRequest(requestName)
    await I.isActiveSidebarItem(`GQL${requestName}`)
    await I.isActiveTab(`POST ${requestName}`)
})

Scenario('type url with query params', async() => {
    const queryTab = '[data-testid="request-panel-tab-Query"]'

    I.createRequest('Request 1')
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

Scenario('Send GET request', async() => {
    const host = 'https://httpbin.org'
    const path = '/get'
    const queryString = '?hello=there'

    I.createRequest('Request 1')
    I.typeInRequestPanelAddressBar(`${host}${path}${queryString}`)
    I.click('[data-testid="request-panel-address-bar__send-button"]')
    I.waitForElement('//*[@class="response-panel-tab"][text() = "Timeline "]')
    I.click('//*[@class="response-panel-tab"][text() = "Timeline "]')
    const text = await I.grabTextFrom('[data-testid="response-panel-tab-Timeline__preview"]')
    I.expectContain(text, `* Preparing request to ${host}${path}${queryString}`)
    I.expectContain(text, `GET ${path}${queryString}`)
})
