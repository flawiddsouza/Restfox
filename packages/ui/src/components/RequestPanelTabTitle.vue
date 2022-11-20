<template>
    <span>{{ requestPanelTab.name }}</span>
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
        <template v-if="'authentication' in activeTab && activeTab.authentication.type !== 'No Auth'">
            <span> ({{ getAuthenticationTypeLabel(activeTab.authentication.type) }})</span>
        </template>
    </template>
</template>

<script>
export default {
    props: {
        requestPanelTab: {
            type: Object,
            required: true
        },
        activeTab: {
            type: Object,
            required: true
        }
    },
    methods: {
        getAuthenticationTypeLabel(authenticationType) {
            switch(authenticationType) {
                case 'basic':
                    return 'Basic'
                case 'bearer':
                    return 'Bearer'
            }
        }
    }
}
</script>
