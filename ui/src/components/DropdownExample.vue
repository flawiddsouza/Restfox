<template>
    <Dropdown :options="options" v-model="selectedOption" x="303.422px" y="140.672px" v-model:show="showDropdown" />
</template>

<script>
import Dropdown from './Dropdown.vue'

export default {
    components: {
        Dropdown
    },
    data() {
        return {
            showDropdown: true,
            selectedOption: {
                label: 'Form URL Encoded',
                value: 'application/x-www-form-urlencoded'
            },
            options: [
                {
                    label: 'Structured',
                    icon: 'fa fa-bars',
                    options: [
                        {
                            label: 'Multipart Form',
                            value: 'multipart/form-data'
                        },
                        {
                            label: 'Form URL Encoded',
                            value: 'application/x-www-form-urlencoded'
                        },
                        {
                            label: 'GraphQL Query',
                            value: 'application/graphql'
                        }
                    ]
                },
                {
                    label: 'Text',
                    icon: 'fa fa-code',
                    options: [
                        {
                            label: 'JSON',
                            value: 'application/json'
                        },
                        {
                            label: 'XML',
                            value: 'application/xml'
                        },
                        {
                            label: 'YAML',
                            value: 'text/yaml'
                        },
                        {
                            label: 'EDN',
                            value: 'application/edn'
                        },
                        {
                            label: 'Plain',
                            value: 'text/plain'
                        },
                        {
                            label: 'Other',
                            value: ''
                        }
                    ]
                },
                {
                    label: 'Other',
                    icon: 'fa fa-ellipsis-h',
                    options: [
                        {
                            label: 'Binary File',
                            value: 'application/octet-stream'
                        },
                        {
                            label: 'No Body',
                            value: ''
                        }
                    ]
                }
            ]
        }
    }
}
</script>
