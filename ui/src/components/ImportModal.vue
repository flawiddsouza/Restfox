<template>
    <form @submit.prevent="importFile" v-if="showImportModal">
        <modal title="Import" v-model="showImportModal">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Import From</div>
                <select style="width: 100%; border: 1px solid var(--default-border-color); outline: 0; padding: 0.3rem; background: inherit;" v-model="importFrom">
                    <option>Postman</option>
                    <option>Insomnia</option>
                </select>
            </label>

            <div style="margin-top: 1rem">
                <input type="file" @change="fileToImport = $event.target.files[0]" required>
            </div>

            <template #footer>
                <button>Import</button>
            </template>
        </modal>
    </form>
</template>

<script>
import { fileToJSON, convertInsomniaExportToRestfoxCollection, convertPostmanExportToRestfoxCollection } from '@/helpers'
import Modal from '@/components/Modal.vue'

export default {
    components: {
        Modal
    },
    data() {
        return {
            fileToImport: null,
            importFrom: 'Postman'
        }
    },
    computed: {
        showImportModal: {
            get() {
                return this.$store.state.showImportModal
            },
            set(value) {
                this.$store.commit('showImportModal', value)
            }
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        }
    },
    methods: {
        async importFile() {
            try {
                let json = null

                if(this.fileToImport.name.endsWith('.json')) {
                    json = await fileToJSON(this.fileToImport)
                } else {
                    json = this.fileToImport
                }

                if(this.importFrom === 'Postman') {
                    const collection = await convertPostmanExportToRestfoxCollection(json, this.fileToImport.name.endsWith('.zip'), this.activeWorkspace._id)
                    this.$store.commit('setCollectionTree', collection)
                }

                if(this.importFrom === 'Insomnia') {
                    const collection = convertInsomniaExportToRestfoxCollection(json, this.activeWorkspace._id)
                    this.$store.commit('setCollectionTree', collection)
                }

                this.fileToImport = null
                this.showImportModal = false

                alert('File imported successfully')
            } catch(e) {
                console.log(e)
                alert('Invalid import file given')
            }
        }
    }
}
</script>
