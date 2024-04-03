<template>
    <div v-if="open">
        <slot />
    </div>
</template>

<script>
function copyStyles(sourceDoc, targetDoc) {
    Array.from(sourceDoc.styleSheets).forEach(styleSheet => {
        if (styleSheet.cssRules) {
            // for <style> elements
            const newStyleEl = sourceDoc.createElement('style')

            Array.from(styleSheet.cssRules).forEach(cssRule => {
                // write the text of each rule into the body of the style element
                newStyleEl.appendChild(sourceDoc.createTextNode(cssRule.cssText))
            })

            targetDoc.head.appendChild(newStyleEl)
        } else if (styleSheet.href) {
            // for <link> elements loading CSS from a URL
            const newLinkEl = sourceDoc.createElement('link')

            newLinkEl.rel = 'stylesheet'
            newLinkEl.href = styleSheet.href
            targetDoc.head.appendChild(newLinkEl)
        }
    })
}

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
        }
    },
    data() {
        return {
            windowRef: null,
        }
    },
    watch: {
        open(newOpen) {
            if(newOpen) {
                this.openPortal()
            } else {
                this.closePortal()
            }
        }
    },
    methods: {
        openPortal() {
            this.windowRef = window.open('', '', `width=${screen.width},height=${screen.height}`)
            this.windowRef.document.body.appendChild(this.$el)
            copyStyles(window.document, this.windowRef.document)
            // close portal when the child window is closed
            this.windowRef.addEventListener('beforeunload', this.closePortal)
            // close portal when the child window is reloaded
            this.windowRef.addEventListener('unload', this.closePortal)
            // close portal when the parent window is closed
            window.addEventListener('unload', this.closePortal)
        },
        closePortal() {
            if(this.windowRef) {
                this.windowRef.close()
                this.windowRef = null
                this.$emit('close')
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
