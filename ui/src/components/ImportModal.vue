<template>
    <form @submit.prevent="importFile" v-if="showImportModal">
        <modal title="Import" v-model="showImportModal">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Import From</div>
                <select style="width: 100%; border: 1px solid var(--default-border-color); outline: 0; padding: 0.3rem; background: inherit;" v-model="importFrom">
                    <option>Restfox</option>
                    <option>Postman</option>
                    <option>Postman URL</option>
                    <option>Insomnia</option>
                </select>
            </label>

            <div style="margin-top: 1rem">
                <template v-if="importFrom !== 'Postman URL'">
                    <input type="file" @change="fileToImport = $event.target.files[0]" accept=".json, .zip" required>
                </template>
                <template v-else>
                    <input type="url" v-model="urlToImport" required placeholder="https://postman.com/collections/{collectionId}" style="width: 100%; border: 1px solid var(--default-border-color); outline: 0px; padding: 0.3rem; background: inherit;">
                </template>
            </div>

            <div style="margin-top: 1.5rem">
                <label>
                    <div style="font-weight: 500; margin-bottom: 0.25rem">Import Into</div>
                    <select style="width: 100%; border: 1px solid var(--default-border-color); outline: 0; padding: 0.3rem; background: inherit;" v-model="selectedRequestGroupId">
                        <option :value="null">Root of the workspace</option>
                        <option v-for="activeWorkspaceFolder in activeWorkspaceFolders" :value="activeWorkspaceFolder._id">{{ activeWorkspaceFolder.name }}</option>
                    </select>
                </label>
            </div>

            <template #footer>
                <button>Import</button>
            </template>
        </modal>
    </form>
</template>

<script>
import {
    fileToJSON,
    convertInsomniaExportToRestfoxCollection,
    convertPostmanExportToRestfoxCollection,
    convertRestfoxExportToRestfoxCollection,
    generateNewIdsForTree
} from '@/helpers'
import Modal from '@/components/Modal.vue'
import { getCollectionForWorkspace } from '@/db'

export default {
    components: {
        Modal
    },
    data() {
        return {
            activeWorkspaceFolders: [],
            fileToImport: null,
            urlToImport: '',
            importFrom: 'Restfox'
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
        selectedRequestGroupId: {
            get() {
                return this.$store.state.showImportModalSelectedRequestGroupId
            },
            set(value) {
                this.$store.commit('showImportModalSelectedRequestGroupId', value)
            }
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        },
        collectionTree() {
            return this.$store.state.collectionTree
        }
    },
    watch: {
        activeWorkspace() {
            if(this.activeWorkspace) {
                this.handleActiveWorkspace()
            }
        },
        collectionTree() {
            if(this.activeWorkspace) {
                this.handleActiveWorkspace()
            }
        }
    },
    methods: {
        async handleActiveWorkspace() {
            this.activeWorkspaceFolders = await getCollectionForWorkspace(this.activeWorkspace._id, 'request_group')
            this.activeWorkspaceFolders.sort((a, b) => a.name.localeCompare(b.name))
            this.selectedRequestGroupId = null
        },
        async importFile() {
            try {
                let json = null

                if(this.fileToImport && this.fileToImport.name.endsWith('.json')) {
                    json = await fileToJSON(this.fileToImport)
                } else {
                    json = this.fileToImport
                }

                let collectionTree = []

                if(this.importFrom === 'Postman') {
                    collectionTree = await convertPostmanExportToRestfoxCollection(json, this.fileToImport.name.endsWith('.zip'), this.activeWorkspace._id)
                }

                if(this.importFrom === 'Postman URL') {
                    const response = await fetch(this.urlToImport)
                    json = await response.json()

                    collectionTree = await convertPostmanExportToRestfoxCollection(json, false, this.activeWorkspace._id)
                }

                if(this.importFrom === 'Insomnia') {
                    collectionTree = convertInsomniaExportToRestfoxCollection(json, this.activeWorkspace._id)
                }

                if(this.importFrom === 'Restfox') {
                    collectionTree = convertRestfoxExportToRestfoxCollection(json, this.activeWorkspace._id)
                }

                if(this.selectedRequestGroupId) {
                    collectionTree.forEach(collection => {
                        collection.parentId = this.selectedRequestGroupId
                    })
                }

                generateNewIdsForTree(collectionTree)

                this.$store.dispatch('setCollectionTree', { collectionTree, parentId: this.selectedRequestGroupId })

                this.fileToImport = null
                this.showImportModal = false

                alert('File imported successfully')
            } catch(e) {
                console.log(e)
                alert('Invalid import file given')
            }
        }
    },
    created() {
        this.handleActiveWorkspace()
    }
}
</script>
