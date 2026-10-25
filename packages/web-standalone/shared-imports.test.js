import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

test('standalone loads shared modules without Electron npm dependencies', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
        import fs from 'node:fs'
        import path from 'node:path'
        import { isBuiltin, registerHooks } from 'node:module'
        import { pathToFileURL } from 'node:url'

        const standaloneUrl = pathToFileURL(process.cwd() + path.sep)
        const sharedUrl = new URL('../electron/shared/', standaloneUrl)
        const electronNodeModulesUrl = new URL('../electron/node_modules/', standaloneUrl)

        registerHooks({
            resolve(specifier, context, nextResolve) {
                const resolved = nextResolve(specifier, context)
                if(context.parentURL?.startsWith(sharedUrl.href) && !isBuiltin(resolved.url) && !resolved.url.startsWith(sharedUrl.href)) {
                    throw new Error('Shared modules must import only Node builtins or other shared modules: ' + specifier + ' from ' + context.parentURL)
                }
                if(resolved.url.startsWith(electronNodeModulesUrl.href)) {
                    throw new Error('Standalone must not resolve Electron npm dependencies: ' + specifier + ' from ' + context.parentURL)
                }
                return resolved
            },
        })

        async function loadModules(directory) {
            for(const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
                if(entry.isDirectory()) {
                    await loadModules(url)
                } else if(entry.name.endsWith('.js')) {
                    await import(url.href)
                }
            }
        }

        await loadModules(new URL('src/', standaloneUrl))
        await import(new URL('app.js', standaloneUrl).href)
        // also the shared modules only Electron loads
        await loadModules(sharedUrl)
    `], { cwd: import.meta.dirname, encoding: 'utf8' })

    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr || result.stdout)
})

// loading a module runs only its top level, so a dependency loaded later, when a function runs, is checked here.
// Shared modules load only through static imports, which the test above resolves. ESM has no require, so a require
// in a shared module is one an adapter passed in, unless the module made its own
test('shared modules load nothing later, only through static imports', () => {
    const sharedDirectory = path.join(import.meta.dirname, '../electron/shared')

    for(const name of fs.readdirSync(sharedDirectory, { recursive: true }).filter(name => name.endsWith('.js'))) {
        const source = fs.readFileSync(path.join(sharedDirectory, name), 'utf8')
        assert.doesNotMatch(source, /\bimport\s*\(/, `${name} has a dynamic import()`)
        assert.doesNotMatch(source, /\bcreateRequire\b|\bgetBuiltinModule\s*\(\s*['"`](node:)?module['"`]/, `${name} makes its own require`)
    }
})
