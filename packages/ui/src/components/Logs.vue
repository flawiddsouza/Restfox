<template>
    <div>
        <h2>Logs</h2>
        <ul>
            <li v-for="(log, index) in logs" :key="index">
                {{ log }}
            </li>
        </ul>
    </div>
</template>

<script>
import {getCurrentTimestamp} from '@/helpers'

export default {
    data() {
        return {
            logs: ['Please make the requests to see the logs']
        }
    },
    mounted() {
        const originalConsoleLog = console.log
        const originalConsoleWarn = console.warn
        const originalConsoleError = console.error

        console.log = (...args) => {
            this.logs.push({ timestamp: getCurrentTimestamp(), type: 'log', message: args.join(' ') })
            originalConsoleLog?.apply(console, args)
        }

        console.warn = (...args) => {
            this.logs.push({ timestamp: getCurrentTimestamp(), type: 'warn', message: args.join(' ') })
            originalConsoleWarn?.apply(console, args)
        }

        console.error = (...args) => {
            this.logs.push({ timestamp: getCurrentTimestamp(), type: 'error', message: args.join(' ') })
            originalConsoleError?.apply(console, args)
        }
    }
}
</script>

