// Loaded before the tests of this package (vitest's setupFiles) and of web-standalone (its npm test). Tests send to
// made-up hosts under the domains reserved for tests and examples, which no DNS server knows. Asked anyway, the
// machine's DNS server takes as long as it likes to say so, on some networks longer than a test's time limit, so a
// lookup of such a name fails here at once, with the error the system resolver gives
import dns from 'node:dns'
import process from 'node:process'

const reservedHost = /\.(test|invalid|example)\.?$/i
const replaced = Symbol.for('restfox.reservedTestHosts')

function notFound(hostname) {
    return Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { errno: -3008, code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname })
}

// a test runner that reuses its process for the next file loads this again
if (!dns.lookup[replaced]) {
    const lookup = dns.lookup
    dns.lookup = function(hostname, options, callback) {
        if (typeof hostname === 'string' && reservedHost.test(hostname)) {
            const done = typeof options === 'function' ? options : callback
            process.nextTick(() => done(notFound(hostname)))
            return {}
        }
        return lookup.apply(this, arguments)
    }
    dns.lookup[replaced] = true

    const promisesLookup = dns.promises.lookup
    dns.promises.lookup = function(hostname) {
        if (typeof hostname === 'string' && reservedHost.test(hostname)) {
            return Promise.reject(notFound(hostname))
        }
        return promisesLookup.apply(this, arguments)
    }
}
