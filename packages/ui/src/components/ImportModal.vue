<template>
    <form @submit.prevent="importFile" v-if="showImportModal">
        <modal title="Import" v-model="showImportModal">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Import From</div>
                <select class="full-width-input" v-model="importFrom">
                    <option>Restfox</option>
                    <option>Postman</option>
                    <option>Postman URL</option>
                    <option>Insomnia</option>
                    <option>OpenAPI</option>
                </select>
            </label>

            <div style="margin-top: 1rem">
                <template v-if="importFrom !== 'Postman URL'">
                    <input type="file" @change="filesToImport = Array.from($event.target.files)" accept=".json, .zip, .yml, .yaml" multiple required>
                </template>
                <template v-else>
                    <input type="url" v-model="urlToImport" required placeholder="https://postman.com/collections/{collectionId}" class="full-width-input">
                </template>
            </div>

            <div style="margin-top: 1.5rem">
                <label>
                    <div style="font-weight: 500; margin-bottom: 0.25rem">Import Into</div>
                    <select class="full-width-input" v-model="selectedRequestGroupId">
                        <option :value="null">Root of the workspace</option>
                        <option v-for="activeWorkspaceFolder in activeWorkspaceFolders" :value="activeWorkspaceFolder._id">{{ activeWorkspaceFolder.name }}</option>
                    </select>
                </label>
            </div>

            <template #footer>
                <button class="button">Import</button>
            </template>
        </modal>
    </form>
</template>

<script>
import {
    fileToJSON,
    fileToString,
    convertInsomniaExportToRestfoxCollection,
    convertPostmanExportToRestfoxCollection,
    convertRestfoxExportToRestfoxCollection,
    convertOpenAPIExportToRestfoxCollection,
    generateNewIdsForTree
} from '@/helpers'
import Modal from '@/components/Modal.vue'
import { getCollectionForWorkspace } from '@/db'
import { emitter } from '@/event-bus'
import { flattenTree, sortTree, toTree } from '../helpers'

function prependParentTitleToChildTitle(array, prepend = '') {
    array.forEach(item => {
        item.name = `${prepend ? prepend + ' ' : ''}${item.name}`
        if('children' in item) {
            prependParentTitleToChildTitle(item.children, item.name + ' → ')
        }
    })
}

export default {
    components: {
        Modal
    },
    data() {
        return {
            activeWorkspaceFolders: [],
            filesToImport: [],
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
        }
    },
    methods: {
        async handleActiveWorkspace() {
            let activeWorkspaceFolders = await getCollectionForWorkspace(this.activeWorkspace._id, 'request_group')
            activeWorkspaceFolders = toTree(activeWorkspaceFolders)
            sortTree(activeWorkspaceFolders)
            prependParentTitleToChildTitle(activeWorkspaceFolders)
            activeWorkspaceFolders = flattenTree(activeWorkspaceFolders)
            this.activeWorkspaceFolders = activeWorkspaceFolders
            this.selectedRequestGroupId = null
        },
        async importFile() {
            let fileBeingImported = ''

            try {
                let json = null

                let collectionTree = []

                if(this.importFrom === 'Postman URL') {
                    const response = await fetch(this.urlToImport)
                    json = await response.json()

                    collectionTree = await convertPostmanExportToRestfoxCollection(json, false, this.activeWorkspace._id)
                } else {
                    for(const fileToImport of this.filesToImport) {
                        fileBeingImported = fileToImport.name

                        if(fileToImport.name.endsWith('.json')) {
                            json = await fileToJSON(fileToImport)
                        } else {
                            json = fileToImport
                        }

                        if(this.importFrom === 'Postman') {
                            collectionTree = collectionTree.concat(await convertPostmanExportToRestfoxCollection(json, fileToImport.name.endsWith('.zip'), this.activeWorkspace._id))
                        }

                        if(this.importFrom === 'Insomnia') {
                            collectionTree = collectionTree.concat(convertInsomniaExportToRestfoxCollection(json, this.activeWorkspace._id))
                        }

                        if(this.importFrom === 'Restfox') {
                            collectionTree = collectionTree.concat(convertRestfoxExportToRestfoxCollection(json, this.activeWorkspace._id))
                        }

                        if(this.importFrom === 'OpenAPI') {
                            const exportAsString = await fileToString(fileToImport)
                            collectionTree = collectionTree.concat(await convertOpenAPIExportToRestfoxCollection(exportAsString, this.activeWorkspace._id))
                        }
                    }
                }

                if(this.selectedRequestGroupId) {
                    collectionTree.forEach(collection => {
                        collection.parentId = this.selectedRequestGroupId
                    })
                }

                generateNewIdsForTree(collectionTree)

                this.$store.dispatch('setCollectionTree', { collectionTree, parentId: this.selectedRequestGroupId })

                const importedFileCount = this.filesToImport.length

                this.urlToImport = ''
                this.filesToImport = []
                this.showImportModal = false

                if(this.importFrom === 'Postman URL') {
                    alert('URL imported successfully')
                } else {
                    if(importedFileCount === 1) {
                        alert('File imported successfully')
                    } else {
                        alert(`${importedFileCount} files imported successfully`)
                    }
                }
            } catch(e) {
                console.log(e)
                if(this.importFrom === 'Postman URL') {
                    alert(`Invalid import url given: ${this.urlToImport}`)
                } else {
                    alert(`Invalid import file given: ${fileBeingImported}`)
                }
            }
        }
    },
    created() {
        this.handleActiveWorkspace()

        emitter.on('request_group', this.handleActiveWorkspace)
    },
    beforeUnmount() {
        emitter.off('request_group', this.handleActiveWorkspace)
    }
}
</script>
