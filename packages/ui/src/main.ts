import { createApp } from 'vue'
import store from './store'
import App from './App.vue'
import VueToast from 'vue-toast-notification'
import 'vue-toast-notification/dist/theme-default.css'
import dayjs from 'dayjs'

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

const timestamp = dayjs().format('HH:mm:ss:SSS')
const timestampStyle = 'color: #4CAF50;'
const logMessage = `%c${timestamp} %c`
const resetStyle = 'color: inherit;'

console.log = (...args) => {
    originalConsoleMethods.log(logMessage, timestampStyle, resetStyle, ...args)
    store.commit('addConsoleLog', { type: 'log', message: `${timestamp} - ${ args.join(' ')}` })
}

console.warn = (...args) => {
    originalConsoleMethods.warn(...args)
    store.commit('addConsoleLog', { type: 'warn', message: `${timestamp} - ${ args.join(' ')}` })
}

console.error = (...args) => {
    originalConsoleMethods.error(...args)
    store.commit('addConsoleLog', { type: 'error', message: `${timestamp} - ${ args.join(' ')}` })
}

console.info = (...args) => {
    originalConsoleMethods.info(...args)
    store.commit('addConsoleLog', { type: 'info', message: `${timestamp} - ${ args.join(' ')}` })
}

