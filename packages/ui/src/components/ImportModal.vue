<template>
    <form @submit.prevent="importFile" v-if="showImportModal">
        <modal title="Import" v-model="showImportModal">
            <label>
                <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Import From</div>
                <select class="full-width-input" v-model="importFrom" :disabled="importing">
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
                    <div
                        class="drop-zone"
                        @click="triggerFileInput"
                        @dragover.prevent="onDragOver"
                        @dragleave.prevent="onDragLeave"
                        @drop.prevent="onFileDrop"
                        :class="{ 'dragging': dragging }"
                    >
                        <p v-if="!filesToImport.length">Drag & Drop files here or click to browse</p>
                        <p v-else>
                            {{ filesToImport.length }} file(s) selected: <br>
                            <span v-for="fileName in fileNames" :key="fileName">{{ fileName }}<br></span>
                        </p>

                        <input
                            type="file"
                            ref="fileInput"
                            @change="onFileSelect"
                            accept=".json, .zip, .yml, .yaml, .postman_collection, .postman_environment, .postman_globals, .postman_dump"
                            multiple
                            :disabled="importing"
                            class="hidden-file-input"
                        />
                    </div>
                </template>
                <template v-else>
                    <input type="url" v-model="urlToImport" required :placeholder="importUrlPlaceholder" class="full-width-input" :disabled="importing">
                </template>
            </div>

            <div style="margin-top: 1.5rem">
                <label>
                    <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Import Into</div>
                    <select class="full-width-input" v-model="selectedRequestGroupId" :disabled="importing">
                        <option :value="null">Root of the workspace</option>
                        <option v-for="activeWorkspaceFolder in activeWorkspaceFolders" :value="activeWorkspaceFolder._id">{{ activeWorkspaceFolder.name }}</option>
                    </select>
                </label>
            </div>

            <template #footer>
                <button class="button" v-if="!importing">Import</button>
                <button class="button" disabled v-else>Importing...</button>
            </template>
        </modal>
    </form>

    <form @submit.prevent="importFromCurl(inputString)" v-if="showImportAsCurlModal">
        <modal title="Import from cURL" v-model="showImportAsCurlModal">
            <textarea
                type="text"
                class="full-width-input"
                v-model="inputString"
                placeholder="Paste curl request here"
                style="min-height: 20rem;"
                spellcheck="false"
                v-focus
            />

            <p v-if="inputString && !startsWithCurl">
                ❌ The provided cURL is not valid
            </p>

            <template #footer>
                <button class="button" v-if="!importing">Import</button>
            </template>
        </modal>
    </form>
</template>

<script>
import {
    fileToJSON,
    fileToString,
    convertInsomniaFileToRestfoxCollection,
    convertRestfoxExportToRestfoxCollection,
    convertOpenAPIExportToRestfoxCollection,
    generateNewIdsForTree,
    convertCurlCommandToRestfoxCollection,
    fetchWrapper,
    getSavedRequestTimeout
} from '@/helpers'
import { convertPostmanExportToRestfoxCollection, isPostmanDataDump, isPostmanVariablesFile, mergePostmanGlobals } from '@/parsers/postman'
import yaml from 'js-yaml'
import Modal from '@/components/Modal.vue'
import { getCollectionForWorkspace } from '@/db'
import { emitter } from '@/event-bus'
import { flattenTree, sortTree, toTree, prependParentTitleToChildTitle } from '../helpers'
import { mergeArraysByProperty } from '@/utils/array'
import constants from '@/constants'

export default {
    components: {
        Modal
    },
    directives: {
        focus: {
            mounted(element) {
                element.focus()
                element.select()
            }
        }
    },
    data() {
        return {
            activeWorkspaceFolders: [],
            filesToImport: [],
            urlToImport: '',
            importFrom: 'Restfox',
            importing: false,
            dragging: false,
            fileNames: [],
            inputString: ''
        }
    },
    computed: {
        showImportModal: {
            get() {
                return this.$store.state.showImportModal
            },
            set(value) {
                if(this.importing) {
                    return
                }
                this.$store.commit('showImportModal', value)
            }
        },
        showImportAsCurlModal: {
            get() {
                return this.$store.state.showImportAsCurlModal
            },
            set(value) {
                if(this.importing) {
                    return
                }
                this.$store.commit('showImportAsCurlModal', value)
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
        },
        startsWithCurl() {
            return this.inputString.trim().toLowerCase().startsWith('curl')
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

        onDragOver() {
            this.dragging = true
        },
        onDragLeave() {
            this.dragging = false
        },
        onFileDrop(event) {
            this.dragging = false
            const files = event.dataTransfer.files
            this.filesToImport = Array.from(files)

            this.fileNames = this.filesToImport.map(file => file.name)
        },

        triggerFileInput() {
            this.$refs.fileInput.click()
        },

        onFileSelect(event) {
            this.filesToImport = Array.from(event.target.files)
            this.fileNames = this.filesToImport.map(file => file.name)

            this.filesToImport.forEach(async(file) => {
                let jsonContent
                try {
                    if (/\.ya?ml$/i.test(file.name)) {
                        jsonContent = yaml.load(await file.text())
                    } else if (!file.name.endsWith('.zip')) { // older Postman exports end in .postman_collection and the like
                        jsonContent = await fileToJSON(file)
                    }
                } catch {
                    // a file that does not parse is reported by the import itself
                }

                // a zip or a file that is not an object gives nothing to detect from, the choice made stays
                if (jsonContent === null || typeof jsonContent !== 'object') {
                    return
                }

                const detectedType = this.detectFileType(jsonContent)
                this.importFrom = detectedType
            })
        },

        detectFileType(jsonContent) {
            if (jsonContent.info && jsonContent.info.schema && (jsonContent.info.schema === constants.POSTMAN_SCHEMA['v2.0'] || jsonContent.info.schema === constants.POSTMAN_SCHEMA['v2.1'])) {
                return 'Postman'
            } else if (isPostmanDataDump(jsonContent) || isPostmanVariablesFile(jsonContent)) {
                return 'Postman'
            } else if (jsonContent.__export_format || jsonContent.resources || /^(collection|spec)\.insomnia\.rest\/5/.test(jsonContent.type)) {
                return 'Insomnia'
            } else if (jsonContent.openapi || jsonContent.swagger) {
                return 'OpenAPI'
            } else {
                return 'Restfox'
            }
        },

        async fetchUrl(url, responseType = 'json') {
            const savedDisableSSLVerification = localStorage.getItem(constants.LOCAL_STORAGE_KEY.DISABLE_SSL_VERIFICATION)
            const flags = {
                electronSwitchToChromiumFetch: false,
                disableSSLVerification: savedDisableSSLVerification === 'true' ? true : false,
                requestTimeout: getSavedRequestTimeout(),
            }

            const abortController = new AbortController()
            const response = await fetchWrapper(
                new URL(url),
                'GET',
                {},
                null,
                abortController.signal,
                flags
            )

            if (responseType === 'json') {
                return JSON.parse(new TextDecoder().decode(response.buffer))
            } else if (responseType === 'text') {
                return new TextDecoder().decode(response.buffer)
            } else {
                return response
            }
        },

        // an environment with the name of an existing one is merged into it, the imported values winning. A workspace
        // without a list of environments has only the Default one, which is kept
        importEnvironments(environments) {
            const existingEnvironments = this.activeWorkspace.environments ?? [
                {
                    name: constants.DEFAULT_ENVIRONMENT.name,
                    environment: this.activeWorkspace.environment ?? {},
                    color: constants.DEFAULT_ENVIRONMENT.color
                }
            ]

            this.activeWorkspace.environments = mergeArraysByProperty(existingEnvironments, environments, 'name')
            this.$store.commit('updateWorkspaceEnvironments', {
                workspaceId: this.activeWorkspace._id,
                environments: this.activeWorkspace.environments
            })

            let foundEnvironment = this.activeWorkspace.environments.find(environment => environment.name === (this.activeWorkspace.currentEnvironment ?? 'Default'))

            if(!foundEnvironment) {
                foundEnvironment = this.activeWorkspace.environments[0]

                this.activeWorkspace.currentEnvironment = foundEnvironment.name
                this.$store.commit('updateWorkspaceCurrentEnvironment',  {
                    workspaceId: this.activeWorkspace._id,
                    currentEnvironment: this.activeWorkspace.currentEnvironment
                })
            }

            this.activeWorkspace.environment = foundEnvironment.environment
            this.$store.commit('updateWorkspaceEnvironment', {
                workspaceId: this.activeWorkspace._id,
                environment: this.activeWorkspace.environment,
            })
        },

        async importFile() {
            this.importing = true

            let fileBeingImported = ''

            try {
                let json = null
                let collectionTree = []
                let plugins = []
                // Postman globals from one file apply to the environments from another file of the same import
                let postmanEnvironments = []
                let postmanGlobals = null

                if(this.importFrom === 'Postman URL') {
                    json = await this.fetchUrl(this.urlToImport, 'json')

                    const { collection, plugins: newPlugins, environments, globals } = await convertPostmanExportToRestfoxCollection(json, false, this.activeWorkspace._id)

                    collectionTree = collection
                    postmanEnvironments = environments
                    postmanGlobals = globals

                    if(newPlugins.length > 0) {
                        plugins = plugins.concat(newPlugins)
                    }
                } else if(this.importFrom === 'OpenAPI URL') {
                    json = await this.fetchUrl(this.urlToImport, 'text')
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
                            const isZip = fileToImport.name.endsWith('.zip')

                            // older Postman exports end in .postman_collection and the like
                            if(!isZip && json instanceof File) {
                                json = await fileToJSON(fileToImport)
                            }

                            const { collection, plugins: newPlugins, environments, globals } = await convertPostmanExportToRestfoxCollection(json, isZip, this.activeWorkspace._id)

                            collectionTree = collectionTree.concat(collection)
                            postmanEnvironments = postmanEnvironments.concat(environments)

                            if(globals !== null) {
                                postmanGlobals = { ...postmanGlobals, ...globals }
                            }

                            if(newPlugins.length > 0) {
                                plugins = plugins.concat(newPlugins)
                            }

                        } else if(this.importFrom === 'Insomnia') {
                            collectionTree = collectionTree.concat(await convertInsomniaFileToRestfoxCollection(json, this.activeWorkspace._id))

                        } else if(this.importFrom === 'Restfox') {
                            const { newCollectionTree, newPlugins } = convertRestfoxExportToRestfoxCollection(json, this.activeWorkspace._id)

                            collectionTree = collectionTree.concat(newCollectionTree)

                            if(json.environments) {
                                this.importEnvironments(json.environments)
                            }

                            if(newPlugins.length > 0) {
                                plugins = plugins.concat(newPlugins)
                            }

                        } else if(this.importFrom === 'OpenAPI') {
                            const exportAsString = await fileToString(fileToImport)

                            collectionTree = collectionTree.concat(await convertOpenAPIExportToRestfoxCollection(exportAsString, this.activeWorkspace._id))
                        }
                    }
                }

                const postmanEnvironmentsWithGlobals = mergePostmanGlobals(postmanEnvironments, postmanGlobals)

                if(postmanEnvironmentsWithGlobals.length > 0) {
                    this.importEnvironments(postmanEnvironmentsWithGlobals)
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
                this.importing = false
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
            } finally {
                this.importing = false
            }
        },

        async importFromCurl(command) {
            try {
                if(this.startsWithCurl) {
                    this.importing = true
                    const result = await convertCurlCommandToRestfoxCollection(command, this.activeWorkspace._id)

                    if(result.length) {
                        await this.$store.dispatch('createCollectionItem', {
                            type: 'request',
                            name: 'New request',
                            method: result[0].method,
                            parentId: this.selectedRequestGroupId,
                            headers: result[0].headers,
                            url: result[0].url,
                            body: result[0].body,
                        })

                        this.$toast.success('Imported successfully')
                    }
                }
            } catch (e) {
                console.log(e)
                this.$toast.error('Import failed')
            } finally {
                this.importing = false
                this.showImportAsCurlModal = false
                this.inputString = ''
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

<style scoped>
.drop-zone {
    border: 2px dashed #ccc;
    padding: 20px;
    text-align: center;
    cursor: pointer;
}

.drop-zone.dragging {
    background-color: var(--background-color);
}

.hidden-file-input {
    display: none;
}
</style>
