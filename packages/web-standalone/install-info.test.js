import test from 'node:test'
import assert from 'node:assert/strict'
import app from './app.js'

function listenApp() {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server))
    })
}

async function getInstallInfo(server) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/getInstallInfo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    })
    return response.json()
}

test('getInstallInfo reports node, or the install kind the Docker image sets', async(t) => {
    const server = await listenApp()
    const savedInstallKind = process.env.RESTFOX_INSTALL_KIND
    t.after(() => {
        if(savedInstallKind === undefined) {
            delete process.env.RESTFOX_INSTALL_KIND
        } else {
            process.env.RESTFOX_INSTALL_KIND = savedInstallKind
        }
        server.closeAllConnections?.()
        server.close()
    })

    delete process.env.RESTFOX_INSTALL_KIND
    assert.deepEqual(await getInstallInfo(server), { result: { installKind: 'node' } })

    process.env.RESTFOX_INSTALL_KIND = 'docker'
    assert.deepEqual(await getInstallInfo(server), { result: { installKind: 'docker' } })
})
