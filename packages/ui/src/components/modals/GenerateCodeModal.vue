<template>
    <div v-if="showModalComp">
        <modal :title="title" v-model="showModalComp" height="70vh" width="55rem">
            <div class="generate-code-modal-container">
                <label>
                    <div style="font-weight: 500; margin-bottom: 0.25rem;">Select Language</div>
                    <select v-model="selectedLanguage" @change="selectedLanguageChanged" class="full-width-input">
                        <option value="" disabled>Select language</option>
                        <option v-for="target in availableTargets" :value="target.key">{{ target.title }}</option>
                    </select>
                </label>
                <label v-if="selectedLanguage" style="margin-top: 1rem;">
                    <div style="font-weight: 500; margin-bottom: 0.25rem;">Select Client</div>
                    <select v-model="selectedClient" @change="selectedClientChanged" class="full-width-input">
                        <option value="" disabled>Select client</option>
                        <option v-for="client in selectedLanguageClients" :value="client.key">{{ client.title }}</option>
                    </select>
                </label>
                <div v-if="generatedCode" style="margin-top: 1rem; overflow: auto;">
                    <div style="font-weight: 500; margin-bottom: 0.25rem;">Code</div>
                    <CodeMirrorEditor :model-value="generatedCode" lang="javascript" :readonly="true" class="code-editor" />
                </div>
            </div>
            <template #footer>
                <button class="button" @click="copyCode" :disabled="!generatedCode">Copy Code</button>
            </template>
        </modal>
    </div>
</template>

<script>
import Modal from '@/components/Modal.vue'
import { generateCode, getAvailableTargets } from '@/utils/generate-code'
import CodeMirrorEditor from '../CodeMirrorEditor.vue'
import constants from '@/constants'

export default {
    props: {
        showModal: Boolean,
        collectionItem: {
            type: Object,
            required: false
        }
    },
    components: {
        Modal,
        CodeMirrorEditor,
    },
    data() {
        return {
            selectedLanguage: '',
            selectedClient: '',
            generatedCode: '',
        }
    },
    computed: {
        title() {
            let title = 'Generate Code'

            if(this.collectionItem) {
                title = `${title} — ${this.collectionItem.name}`
            }

            return title
        },
        showModalComp: {
            get() {
                return this.showModal
            },
            set(value) {
                this.$emit('update:showModal', value)
            }
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        },
        availableTargets() {
            return getAvailableTargets()
        },
        selectedLanguageClients() {
            if(this.selectedLanguage) {
                return this.availableTargets.find(target => target.key === this.selectedLanguage).clients
            } else {
                return []
            }
        }
    },
    watch: {
        collectionItem() {
            this.generateCode()
        }
    },
    methods: {
        selectedLanguageChanged() {
            this.selectedClient = ''
            this.generatedCode = ''

            if(this.selectedLanguage) {
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.GENERATE_CODE_LANGUAGE, this.selectedLanguage)
            } else {
                localStorage.removeItem(constants.LOCAL_STORAGE_KEY.GENERATE_CODE_LANGUAGE)
            }

            localStorage.removeItem(constants.LOCAL_STORAGE_KEY.GENERATE_CODE_CLIENT)
        },
        selectedClientChanged() {
            this.generateCode()

            if(this.selectedClient) {
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.GENERATE_CODE_CLIENT, this.selectedClient)
            } else {
                localStorage.removeItem(constants.LOCAL_STORAGE_KEY.GENERATE_CODE_CLIENT)
            }
        },
        async generateCode() {
            if(this.selectedClient) {
                try {
                    const request = JSON.parse(JSON.stringify(this.collectionItem))
                    const { environment, parentHeaders, parentAuthentication } = await this.$store.dispatch('getEnvironmentForRequest', request)
                    const code = await generateCode(request, environment, parentHeaders, parentAuthentication, this.selectedLanguage, this.selectedClient)
                    this.generatedCode = code
                } catch(e) {
                    this.generatedCode = e.message
                }
            } else {
                this.generatedCode = ''
            }
        },
        async copyCode() {
            await navigator.clipboard.writeText(this.generatedCode)
            this.$toast.success('Copied to clipboard')
        },
    },
    async mounted() {
        const selectedLanguage = localStorage.getItem(constants.LOCAL_STORAGE_KEY.GENERATE_CODE_LANGUAGE)
        const selectedClient = localStorage.getItem(constants.LOCAL_STORAGE_KEY.GENERATE_CODE_CLIENT)

        if(selectedLanguage) {
            const selectedLanguageFound = this.availableTargets.find(target => target.key === selectedLanguage)
            if(selectedLanguageFound) {
                this.selectedLanguage = selectedLanguageFound.key
            }
        }

        if(selectedClient) {
            const selectedClientFound = this.selectedLanguageClients.find(client => client.key === selectedClient)
            if(selectedClientFound) {
                this.selectedClient = selectedClientFound.key
            }
        }
    }
}
</script>

<style scoped>
.generate-code-modal-container {
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
