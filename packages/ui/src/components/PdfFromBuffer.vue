<template>
    <object :data="pdfObjectUrl" type="application/pdf" style="width: 100%; height: 100%;">
        <div style="padding: 1rem;">
            <p>It appears your browser doesn't support PDF preview.</p>
            <a :href="pdfObjectUrl" download="response.pdf" class="button">Download the PDF</a>
        </div>
    </object>
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
            pdfObjectUrl: null
        }
    },
    created() {
        this.createPdfUrl()
    },
    watch: {
        buffer() {
            this.createPdfUrl()
        }
    },
    methods: {
        createPdfUrl() {
            if (this.pdfObjectUrl) {
                URL.revokeObjectURL(this.pdfObjectUrl)
            }

            const blob = new Blob([this.buffer], { type: 'application/pdf' })
            this.pdfObjectUrl = URL.createObjectURL(blob)
        }
    },
    beforeUnmount() {
        if (this.pdfObjectUrl) {
            URL.revokeObjectURL(this.pdfObjectUrl)
        }
    }
}
</script>
