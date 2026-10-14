<template>
    <div style="height: 100%">
        <div style="height: 100%">
            <CodeMirrorResponsePanelPreview :model-value="timelineViewer(response)" data-testid="response-panel-tab-Timeline__preview"></CodeMirrorResponsePanelPreview>
        </div>
    </div>
</template>

<script>
import CodeMirrorResponsePanelPreview from '@/components/CodeMirrorResponsePanelPreview.vue'
import { dateFormat, describeMaskedPromptOmitted, getStatusText, humanFriendlySize, uriParse } from '@/helpers'
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

                const maskedPromptOmitted = response.request.maskedPromptOmitted

                let requestInfo = ''

                if(maskedPromptOmitted) {
                    requestInfo += `* ${describeMaskedPromptOmitted(maskedPromptOmitted)}\n`
                }

                if(!response.request.headersSent) {
                    requestInfo += '* Request headers below are as configured, headers the transport adds or drops are not shown\n'
                }

                // a url saved as written may not parse, such as {{ BASE_URL }}/items
                const uriInfo = maskedPromptOmitted && (maskedPromptOmitted.reason === 'script-read' || maskedPromptOmitted.url === 'written') ? null : uriParse(uri)

                requestInfo += `> ${response.request.method} ${uriInfo === null ? uri : uriInfo.search !== '' ? uriInfo.pathname + uriInfo.search : uriInfo.pathname}\n`

                if(response.request.headersSent) {
                    // the transport reported the headers it put on the wire, host and anything it added are in this list
                    for (const [name, value] of response.request.headersSent) {
                        requestInfo += `> ${name}: ${value}\n`
                    }
                } else {
                    if(uriInfo !== null) {
                        requestInfo += `> Host: ${uriInfo.host}\n`
                    }

                    for (const [key, value] of Object.entries(response.request.headers)) {
                        if (key && value) {
                            requestInfo += `> ${key}: ${value}\n`
                        }
                    }
                }

                for (const name of maskedPromptOmitted?.reason === 'masked-field' ? maskedPromptOmitted.headerNames : []) {
                    requestInfo += `> ${name}: (left out)\n`
                }

                if(response.request.body) {
                    requestInfo += `\n${this.addPipeToEachLine(response.request.body)}\n`
                }

                let responseInfo = `< ${response.status} ${response.statusText === '' ? getStatusText(response.status) : response.statusText}\n`

                // response.headers is an array of [name, value] pairs, listed as received
                // no Date line is added here, the server's own Date header shows up if it sent one
                for (const [name, value] of response.headers) {
                    if (name && value) {
                        responseInfo += `< ${name}: ${value}\n`
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
