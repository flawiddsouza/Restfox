<template>
    <iframe :sandbox="sandboxValues" :src="src"></iframe>
</template>

<script>
export default {
    props: {
        buffer: {
            type: [ArrayBuffer, Uint8Array],
            required: true
        }
    },
    data() {
        return {
            src: ''
        }
    },
    watch: {
        buffer() {
            if(this.src) {
                URL.revokeObjectURL(this.src)
            }
            this.src = URL.createObjectURL(new Blob([this.buffer], { type: 'text/html' }))
        }
    },
    mounted() {
        this.src = URL.createObjectURL(new Blob([this.buffer], { type: 'text/html' }))
    },
    computed: {
        sandboxValues() {
            return this.$store.state.flags.disableIframeSandbox ? 'allow-same-origin allow-scripts allow-popups allow-forms' : ''
        }
    },
    beforeUnmount() {
        if(this.src) {
            URL.revokeObjectURL(this.src)
        }
    }
}
</script>
