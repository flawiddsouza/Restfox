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

interface ConsoleMethod {
    (...args: any[]): void;
}

interface OriginalConsoleMethods {
    log: ConsoleMethod;
    warn: ConsoleMethod;
    error: ConsoleMethod;
    info: ConsoleMethod;
}

type LogType = 'log' | 'warn' | 'error' | 'info';

const originalConsoleMethods: OriginalConsoleMethods = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
}

function interceptConsole(type: LogType): ConsoleMethod {
    return (...args: any[]) => {
        const timestampStyle = 'color: #4CAF50;';
        const logMessage = `%c${getCurrentTimestamp()} - [${type.toUpperCase()}] - %c${ type === 'error' ? args.join(' ') : argsMapping(args)}`;
        const resetStyle = 'color: inherit;';

        originalConsoleMethods[type](logMessage, timestampStyle, resetStyle);
        storeLog(type, args);
    }
}

console.log = interceptConsole('log');
console.warn = interceptConsole('warn');
console.error = interceptConsole('error');
console.info = interceptConsole('info');

function storeLog(type: LogType, args: any[]): void {
    try {
        store.commit('addConsoleLog', { type, message: `${getCurrentTimestamp()} - [${type.toUpperCase()}] - ${argsMapping(args)}` });
    } catch (error) {
        console.error('Failed to store log:', error);
    }
}

function argsMapping(args: any[]): string {
    return args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
}