export = function() {
    return actor({

        createRequest(requestName: string) {
            this.rightClick('.sidebar')
            this.waitForText('HTTP Request')
            this.click('HTTP Request')
            this.fillField('input[placeholder="My Request"]', requestName)
            this.click('Create')
        },

        createGraphQLRequest(requestName: string) {
            this.rightClick('.sidebar')
            this.waitForText('GraphQL Request')
            this.click('GraphQL Request')
            this.fillField('input[placeholder="My GraphQL Request"]', requestName)
            this.click('Create')
        },

        async isActiveSidebarItem(name: string) {
            const text = await this.grabTextFrom('.sidebar-item.sidebar-item-active')
            this.expectEqual(text.trim() === name, true)
        },

        async isActiveTab(name: string) {
            const text = await this.grabTextFrom('.tab.tab-active')
            this.expectEqual(text.trim() === name, true)
        },

        typeInRequestPanelAddressBar(url: string, clear = false) {
            this.click({ pw: '[data-testid="request-panel-address-bar"]' })

            if(clear) {
                this.pressKey(['CommandOrControl', 'A'])
                this.pressKey('Backspace')
            }

            this.type(url)
        }
    })
}
