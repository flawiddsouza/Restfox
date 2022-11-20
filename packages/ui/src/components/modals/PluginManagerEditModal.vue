<template>
    <form @submit.prevent="savePlugin" v-if="showModalComp">
        <modal :title="(type === 'Add' ? 'Add' : 'Edit') + ' Plugin'" v-model="showModalComp" height="70vh" width="55rem" :full-height="true">
            <div class="plugin-manager-edit-modal-container">
                <label>
                    <div style="font-weight: 500; margin-bottom: 0.25rem">Name</div>
                    <input type="text" class="full-width-input" v-model="name" placeholder="My Plugin" required spellcheck="false" v-focus>
                </label>
                <div style="padding-bottom: 1rem"></div>
                <label style="overflow: auto;">
                    <div style="font-weight: 500; margin-bottom: 0.25rem">Code</div>
                    <CodeMirrorEditor v-model="code" lang="javascript" class="code-editor"></CodeMirrorEditor>
                </label>
            </div>
            <template #footer>
                <button class="button">Save</button>
            </template>
        </modal>
    </form>
</template>

<script>
import Modal from '@/components/Modal.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'

const examplePluginCode =
`// Available methods:
// context.request.getMethod()
// context.request.getEnvironmentVariable('<ENVIRONMENT_VARIABLE_NAME>')
// context.request.setEnvironmentVariable('<ENVIRONMENT_VARIABLE_NAME>', '<ENVIRONMENT_VARIABLE_VALUE>')
// context.request.getBody()
// context.request.setBody(<REQUEST_BODY_OBJECT>)
// context.request.getQueryParams()
// context.request.setQueryParams(<REQUEST_QUERY_PARAMS_ARRAY>)
// context.response.getEnvironmentVariable('<ENVIRONMENT_VARIABLE_NAME>')
// context.response.setEnvironmentVariable('<ENVIRONMENT_VARIABLE_NAME>', '<ENVIRONMENT_VARIABLE_VALUE>')
// context.response.getBody() - returns ArrayBuffer
// context.response.setBody(<RESPONSE_BODY_ARRAY_BUFFER>)
// context.response.getBodyText() - returns context.response.getBody() ArrayBuffer as text
// context.response.setBodyText(<RESPONSE_BODY_TEXT>) - sets given text as context.response.setBody(<RESPONSE_BODY_ARRAY_BUFFER>)
// console.log(...)

function handleRequest() {
    console.log(context.request.getBody())
}

function handleResponse() {
    console.log(context.response.getBody())
}

if('request' in context) {
    handleRequest()
}

if('response' in context) {
    handleResponse()
}
`

export default {
    directives: {
        focus: {
            mounted(element) {
                element.focus()
            }
        }
    },
    props: {
        showModal: {
            type: Boolean,
            required: true
        },
        type: {
            type: String,
            required: true
        },
        plugin: {
            type: [Object, null],
            required: true
        }
    },
    components: {
        Modal,
        CodeMirrorEditor
    },
    data() {
        return {
            name: '',
            code: examplePluginCode
        }
    },
    computed: {
        showModalComp: {
            get() {
                return this.showModal
            },
            set(value) {
                this.$emit('update:showModal', value)
            }
        }
    },
    watch: {
        plugin() {
            if(this.plugin) {
                this.name = this.plugin.name
                this.code = this.plugin.code
            } else {
                this.name = ''
                this.code = examplePluginCode
            }
        }
    },
    methods: {
        savePlugin() {
            this.$emit('savePlugin', {
                type: this.type,
                _id: this.plugin ? this.plugin._id : null,
                name: this.name,
                code: this.code
            })
            this.showModalComp = false
        }
    }
}
</script>

<style scoped>
.plugin-manager-edit-modal-container {
    display: grid;
    grid-template-rows: auto auto 1fr;
    height: 100%;
}

.code-editor {
    height: calc(100% - 1.2rem);
    overflow-y: auto;
    border: 1px solid var(--modal-border-color);
}
</style>
