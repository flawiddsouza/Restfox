<script setup>
import Modal from '@/components/Modal.vue'
</script>

<template>
    <form @submit.prevent="importFile" v-if="showImportModal">
        <modal title="Import" v-model="showImportModal">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Import From</div>
                <select style="width: 100%; border-color: var(--default-border-color); outline: 0; padding: 0.3rem;" v-model="importFrom">
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

export default {
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
        }
    },
    methods: {
        async importFile() {
            try {
                const json = await fileToJSON(this.fileToImport)

                if(this.importFrom === 'Postman') {
                    const collection = convertPostmanExportToRestfoxCollection(json)
                    this.$store.commit('setCollection', collection)

                }

                if(this.importFrom === 'Insomnia') {
                    const collection = convertInsomniaExportToRestfoxCollection(json)
                    this.$store.commit('setCollection', collection)
                }

                this.fileToImport = null
                this.showImportModal = false

                alert('File imported successfully')
            } catch(e) {
                alert('Invalid import file given')
            }
        }
    }
}
</script>
