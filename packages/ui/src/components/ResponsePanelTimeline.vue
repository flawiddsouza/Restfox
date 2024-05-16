<template>
    <div>
        <div>
            <CodeMirrorResponsePanelPreview :model-value="timelineViewer(response)"></CodeMirrorResponsePanelPreview>
        </div>
    </div>
</template>

<script>
import CodeMirrorResponsePanelPreview from '@/components/CodeMirrorResponsePanelPreview.vue'
import { bufferToString, dateFormat, getStatusText, humanFriendlySize, uriParse } from '@/helpers'

export default {
    components: { CodeMirrorResponsePanelPreview },
    props: {
        response: Response,
    },
    data() {
        return {
            isLoading: false,
            timelineData: [],
        }
    },
    methods: {
        timelineViewer(response) {
            const preparationInfo = `* Preparing request to ${response.url}\n* Current time is ${new Date(dateFormat(response.createdAt, true)).toISOString()}\n`
            const uriInfo = uriParse(response.url)

            let requestInfo = `> ${response.request.method} ${uriInfo.pathname}\n> Host: ${uriInfo.host}\n`

            for (const [key, value] of Object.entries(response.request.headers)) {
                if (key && value) {
                    requestInfo += `> ${key}: ${value}\n`
                }
            }

            let responseInfo = `${this.addPipeToEachLine(bufferToString(response.buffer))}\n\n`

            responseInfo += `< ${response.status} ${response.statusText === '' ? getStatusText(response.status) : response.statusText}\n`
            responseInfo += `< Date: ${new Date(dateFormat(response.createdAt, true)).toISOString()}\n`

            for (const [key, value] of Object.entries(response.headers)) {
                if (key && value) {
                    responseInfo += `< ${value.toString().split(',').join(': ')}\n`
                }
            }

            try {
                return `${preparationInfo}\n${requestInfo}\n${responseInfo}\n\n* Received ${humanFriendlySize(response.buffer.byteLength)}`
            } catch (error) {
                console.error('Error fetching timeline data:', error)
            }
        },
        dateFormat,
        addPipeToEachLine(inputString) {
            const lines = inputString.trim().split('\n')
            const linesWithPipe = lines.map(line => '|' + line)
            const resultString = linesWithPipe.join('\n')
            return resultString
        }
    }
}
</script>
