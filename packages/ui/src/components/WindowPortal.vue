<template>
    <div v-if="open" style="height: 100%">
        <slot v-if="renderSlot" />
    </div>
</template>

<script>
import { applyTheme } from '@/helpers'

export default {
    name: 'WindowPortal',
    model: {
        prop: 'open',
        event: 'close'
    },
    props: {
        open: {
            type: Boolean,
            default: false,
        },
        title: {
            type: String,
            default: '',
        }
    },
    data() {
        return {
            windowRef: null,
            renderSlot: false,
        }
    },
    computed: {
        theme() {
            return this.$store.state.theme
        }
    },
    watch: {
        open(newOpen) {
            if(newOpen) {
                this.openPortal()
            } else {
                this.closePortal()
            }
        },
        title(newTitle) {
            if(this.windowRef) {
                this.windowRef.document.title = newTitle
            }
        },
        theme(newTheme) {
            if(this.windowRef) {
                applyTheme(newTheme, this.windowRef.document)
            }
        },
    },
    methods: {
        openPortal() {
            this.windowRef = window.open('', '', `width=${screen.width},height=${screen.height}`)
            this.windowRef.document.write('<!DOCTYPE html>') // this is essential, otherwise the document will be in quirks mode
            this.windowRef.document.close()
            this.windowRef.document.head.innerHTML = window.document.head.innerHTML
            this.windowRef.document.title = this.title
            applyTheme(this.theme, this.windowRef.document)
            this.windowRef.document.body.appendChild(this.$el)
            this.renderSlot = true
            // close portal when the child window is reloaded
            this.windowRef.addEventListener('unload', this.closePortal)
            // close portal when the parent window is closed
            window.addEventListener('unload', this.closePortal)
        },
        closePortal() {
            if(this.windowRef) {
                this.windowRef.close()
                if(this.windowRef.closed) {
                    this.windowRef = null
                    this.renderSlot = false
                    this.$emit('close')
                }
            }
            window.removeEventListener('unload', this.closePortal)
        },
    },
    mounted() {
        if(this.open) {
            this.openPortal()
        }
    },
    beforeUnmount() {
        if (this.windowRef) {
            this.closePortal()
        }
    }
}
</script>
