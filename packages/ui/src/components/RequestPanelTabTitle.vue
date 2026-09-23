<template>
    <span>{{ requestPanelTab.name }}<i class="fa fa-circle active-script" v-if="scriptIndicator && requestPanelTab.name === 'Script'" style="margin-left: 0.2rem"></i></span>
    <i class="fa fa-circle active-script" v-if="docIndicator && requestPanelTab.name === 'Docs'" style="margin-left: 0.2rem"></i>
    <template v-if="requestPanelTab.name === 'Body'">
        <template v-if="activeTab.body.mimeType === 'application/x-www-form-urlencoded'">
            <template v-if="'params' in activeTab.body && activeTab.body.params.filter(item => item.disabled === undefined || item.disabled === false).length > 0">
                <span> ({{ activeTab.body.params.filter(item => item.disabled === undefined || item.disabled === false).length }})</span>
            </template>
        </template>
        <template v-if="activeTab.body.mimeType === 'multipart/form-data'">
            <template v-if="'params' in activeTab.body && activeTab.body.params.filter(item => item.disabled === undefined || item.disabled === false).length > 0">
                <span> ({{ activeTab.body.params.filter(item => item.disabled === undefined || item.disabled === false).length }})</span>
            </template>
        </template>
        <template v-if="activeTab.body.mimeType === 'text/plain'"> (Plain)</template>
        <template v-if="activeTab.body.mimeType === 'application/json'"> (JSON)</template>
        <template v-if="activeTab.body.mimeType === 'application/graphql'"> (GraphQL)</template>
        <template v-if="activeTab.body.mimeType === 'application/octet-stream'"> (File)</template>
    </template>
    <template v-if="requestPanelTab.name === 'Query'">
        <template v-if="'parameters' in activeTab && activeTab.parameters.filter(item => item.disabled === undefined || item.disabled === false).length > 0">
            <span> ({{ activeTab.parameters.filter(item => item.disabled === undefined || item.disabled === false).length }})</span>
        </template>
    </template>
    <template v-if="requestPanelTab.name === 'Header'">
        <template v-if="'headers' in activeTab && activeTab.headers.filter(item => item.disabled === undefined || item.disabled === false).length > 0">
            <span> ({{ activeTab.headers.filter(item => item.disabled === undefined || item.disabled === false).length }})</span>
        </template>
    </template>
    <template v-if="requestPanelTab.name === 'Auth'">
        <template v-if="getAuthenticationType(activeTab.authentication) !== 'inherit'">
            <span> ({{ getAuthenticationTypeLabel(getAuthenticationType(activeTab.authentication)) }})</span>
        </template>
    </template>
</template>

<script>
import { getAuthenticationType } from '@/helpers'

export default {
    props: {
        requestPanelTab: {
            type: Object,
            required: true
        },
        activeTab: {
            type: Object,
            required: true
        },
        scriptIndicator: {
            type: Boolean
        },
        docIndicator: {
            type: Boolean
        }
    },
    methods: {
        getAuthenticationType,
        getAuthenticationTypeLabel(authenticationType) {
            switch(authenticationType) {
                case 'none':
                    return 'No Auth'
                case 'basic':
                    return 'Basic'
                case 'bearer':
                    return 'Bearer'
                case 'oauth2':
                    return 'OAuth 2.0'
            }
        }
    }
}
</script>
