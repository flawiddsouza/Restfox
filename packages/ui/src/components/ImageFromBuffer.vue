<template>
    <img :src="src">
</template>

<script>
export default {
    props: {
        buffer: {
            type: ArrayBuffer,
            required: true
        },
        isSvg: {
            type: Boolean,
            default: false
        }
    },
    methods: {
        arrayBufferToBase64(buffer) {
            const uint8Array = new Uint8Array(buffer)

            let string = ''
            for (let i = 0; i < uint8Array.length; i++) {
                string += String.fromCharCode(uint8Array[i])
            }

            return btoa(string)
        }
    },
    computed: {
        src() {
            return `data:image/${this.isSvg ? 'svg+xml' : 'png'};base64,${this.arrayBufferToBase64(this.buffer)}`
        }
    }
}
</script>
