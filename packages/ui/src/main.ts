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

const originalConsoleLog = console.log
console.log = (...args) => {
    const timestamp = dayjs().format('HH:mm:ss:SSS')
    const timestampStyle = 'color: #4CAF50;'
    const logMessage = `%c${timestamp} %c`
    const resetStyle = 'color: inherit;'

    originalConsoleLog(logMessage, timestampStyle, resetStyle, ...args)
}
