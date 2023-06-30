<template>
    <iframe sandbox :src="src"></iframe>
</template>

<script>
export default {
    props: {
        buffer: {
            type: ArrayBuffer,
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
    beforeUnmount() {
        if(this.src) {
            URL.revokeObjectURL(this.src)
        }
    }
}
</script>
