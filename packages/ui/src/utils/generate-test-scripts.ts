import dedent from 'dedent'

export async function generateTestScripts() {
    return dedent`
        test('Status code is 200', () => {
            expect(rf.response.getStatusCode()).to.eql(200)
        })

        test('Response time is less than 500ms', () => {
            expect(rf.response.getResponseTime()).to.below(600)
        })

        test('Body is not empty', () => {
            expect(rf.response.getBodyJSON()).to.not.be.empty
        })

        test('headers are not empty', () => {
            expect(rf.response.getHeaders()).to.not.be.empty
        })
    `
}
