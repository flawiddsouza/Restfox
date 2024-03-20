<template>
    <form @submit.prevent="importFile" v-if="showImportModal">
        <modal title="Import" v-model="showImportModal">
            <label>
                <div style="font-weight: 500; margin-bottom: 0.25rem">Import From</div>
                <select class="full-width-input" v-model="importFrom">
                    <option>Restfox</option>
                    <option>Postman</option>
                    <option>Postman URL</option>
                    <option value="Insomnia">Insomnia / Insomnium</option>
                    <option>OpenAPI</option>
                    <option>OpenAPI URL</option>
                </select>
            </label>

            <div style="margin-top: 1rem">
                <template v-if="importFrom.endsWith(' URL') === false">
                    <input type="file" @change="filesToImport = Array.from($event.target.files)" accept=".json, .zip, .yml, .yaml" multiple required>
                </template>
                <template v-else>
                    <input type="url" v-model="urlToImport" required :placeholder="importUrlPlaceholder" class="full-width-input">
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
import { flattenTree, sortTree, toTree, prependParentTitleToChildTitle } from '../helpers'
import { mergeArraysByProperty } from '@/utils/array'

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
        },
        importUrlPlaceholder() {
            if(this.importFrom === 'Postman URL') {
                return 'https://postman.com/collections/{collectionId}'
            }

            if(this.importFrom === 'OpenAPI URL') {
                return 'https://openapi.spec/v3.yaml or https://openapi.spec/v3.json'
            }

            return ''
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
            let { collection: activeWorkspaceFolders } = await getCollectionForWorkspace(this.activeWorkspace._id, 'request_group')
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
                let plugins = []

                if(this.importFrom === 'Postman URL') {
                    const response = await fetch(this.urlToImport)
                    json = await response.json()

                    collectionTree = await convertPostmanExportToRestfoxCollection(json, false, this.activeWorkspace._id)
                } else if(this.importFrom === 'OpenAPI URL') {
                    const response = await fetch(this.urlToImport)
                    json = await response.text()

                    collectionTree = await convertOpenAPIExportToRestfoxCollection(json, this.activeWorkspace._id)
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
                            const { newCollectionTree, newPlugins } = convertRestfoxExportToRestfoxCollection(json, this.activeWorkspace._id)

                            collectionTree = collectionTree.concat(newCollectionTree)

                            if(json.environments) {
                                this.activeWorkspace.environments = mergeArraysByProperty(this.activeWorkspace.environments ?? [], json.environments, 'name')
                                this.$store.commit('updateWorkspaceEnvironments', {
                                    workspaceId: this.activeWorkspace._id,
                                    environments: this.activeWorkspace.environments
                                })
                                this.activeWorkspace.environment = this.activeWorkspace.environments.find(environment => environment.name === (this.activeWorkspace.currentEnvironment ?? 'Default')).environment
                                this.$store.commit('updateWorkspaceEnvironment', {
                                    workspaceId: this.activeWorkspace._id,
                                    environment: this.activeWorkspace.environment,
                                })
                            }

                            if(newPlugins.length > 0) {
                                plugins = plugins.concat(newPlugins)
                            }
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

                const oldIdNewIdMapping = generateNewIdsForTree(collectionTree)

                plugins.forEach(plugin => {
                    if(plugin.collectionId) {
                        plugin.collectionId = oldIdNewIdMapping[plugin.collectionId]
                    }
                })

                const result = await this.$store.dispatch('setCollectionTree', { collectionTree, parentId: this.selectedRequestGroupId, plugins })

                if(result.error) {
                    this.$toast.error('Import failed')
                    return
                }

                const importedFileCount = this.filesToImport.length

                this.urlToImport = ''
                this.filesToImport = []
                this.showImportModal = false

                if(this.importFrom.endsWith(' URL')) {
                    this.$toast.success('URL imported successfully')
                } else {
                    if(importedFileCount === 1) {
                        this.$toast.success('File imported successfully')
                    } else {
                        this.$toast.success(`${importedFileCount} files imported successfully`)
                    }
                }
            } catch(e) {
                console.log(e)
                if(this.importFrom === 'Postman URL') {
                    this.$toast.error(`Invalid import url given: ${this.urlToImport}`)
                } else {
                    this.$toast.error(`Invalid import file given: ${fileBeingImported}`)
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
