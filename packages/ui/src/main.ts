import { createApp } from 'vue'
import store from './store'
import App from './App.vue'
import VueToast from 'vue-toast-notification'
import 'vue-toast-notification/dist/theme-default.css'
import { getCurrentTimestamp } from '@/helpers'

const app = createApp(App)

app.use(store)
app.use(VueToast)

app.mount('#app')

const originalConsoleMethods = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
}

console.log = (...args) => {
    const timestampStyle = 'color: #4CAF50;'
    const logMessage = `%c${getCurrentTimestamp()} %c`
    const resetStyle = 'color: inherit;'

    originalConsoleMethods.log(logMessage, timestampStyle, resetStyle, ...args)
    store.commit('addConsoleLog', { type: 'log', message: `${getCurrentTimestamp()} - [LOG] - ${ argsMapping(args) }` })
}

console.warn = (...args) => {
    originalConsoleMethods.warn(...args)
    store.commit('addConsoleLog', { type: 'warn', message: `${getCurrentTimestamp()} - [WARN] - ${ argsMapping(args) }` })
}

console.error = (...args) => {
    originalConsoleMethods.error(...args)
    store.commit('addConsoleLog', { type: 'error', message: `${getCurrentTimestamp()} - [ERROR] - ${ argsMapping(args) }` })
}

console.info = (...args) => {
    originalConsoleMethods.info(...args)
    store.commit('addConsoleLog', { type: 'info', message: `${getCurrentTimestamp()} - [INFO] - ${ argsMapping(args) }` })
}

function argsMapping(args: any) :any {
    return args.map((arg: any) => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ')
}
