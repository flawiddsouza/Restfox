<template>
    <div>
        <div>
            <CodeMirrorResponsePanelPreview :model-value="timelineViewer(response)" data-testid="response-panel-tab-Timeline__preview"></CodeMirrorResponsePanelPreview>
        </div>
    </div>
</template>

<script>
import CodeMirrorResponsePanelPreview from '@/components/CodeMirrorResponsePanelPreview.vue'
import { dateFormat, getStatusText, humanFriendlySize, uriParse } from '@/helpers'
import { bufferToString } from '@/utils/response'

export default {
    components: { CodeMirrorResponsePanelPreview },
    props: {
        response: Object,
    },
    data() {
        return {
            isLoading: false,
            timelineData: [],
        }
    },
    methods: {
        timelineViewer(response) {
            try {
                const uri = response.request.query ? response.url + response.request.query : response.url
                const preparationInfo = `* Preparing request to ${ uri }\n* Current time is ${new Date(dateFormat(response.createdAt, true)).toISOString()}\n`
                const uriInfo = uriParse(uri)

                let requestInfo = `> ${response.request.method} ${uriInfo.search !== '' ? uriInfo.pathname + uriInfo.search : uriInfo.pathname}\n> Host: ${uriInfo.host}\n`

                for (const [key, value] of Object.entries(response.request.headers)) {
                    if (key && value) {
                        requestInfo += `> ${key}: ${value}\n`
                    }
                }

                if(response.request.body) {
                    requestInfo += `\n${this.addPipeToEachLine(response.request.body)}\n`
                }

                let responseInfo = `< ${response.status} ${response.statusText === '' ? getStatusText(response.status) : response.statusText}\n`
                responseInfo += `< Date: ${new Date(dateFormat(response.createdAt, true)).toISOString()}\n`

                for (const [key, value] of Object.entries(response.headers)) {
                    if (key && value) {
                        responseInfo += `< ${value.toString().split(',').join(': ')}\n`
                    }
                }

                responseInfo += `\n${this.addPipeToEachLine(bufferToString(response.buffer))}\n`

                return `${preparationInfo}\n${requestInfo}\n${responseInfo}\n* Received ${humanFriendlySize(response.buffer.byteLength)}`
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
