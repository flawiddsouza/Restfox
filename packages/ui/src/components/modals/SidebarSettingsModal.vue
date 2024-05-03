<template>
    <form @submit.prevent="showModalComp = false" v-if="showModalComp">
        <modal :title="title" v-model="showModalComp" width="600px">
            <label>
                <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Name <span style="color: #7b7a7a; font-weight: normal; font-style: italic;" v-if="collectionItem._type === 'request' || collectionItem._type === 'socket'">(also rename by double-clicking in sidebar)</span></div>
                <input type="text" class="full-width-input" v-model="collectionItem.name" :placeholder="placeholder" spellcheck="false" required v-focus>
            </label>

            <div style="padding-top: 1rem"></div>

            <div>
                <label>
                    <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Folder</div>
                    <select class="full-width-input" v-model="collectionItem.parentId" required>
                        <option :value="null">Root of the workspace</option>
                        <option v-for="activeWorkspaceFolder in activeWorkspaceFolders" :value="activeWorkspaceFolder._id">{{ activeWorkspaceFolder.name }}</option>
                    </select>
                </label>
            </div>

            <div v-if="collectionItem._type === 'request_group'">
                <div style="padding-bottom: 1rem"></div>
                <hr style="border: none; height: 1px; background-color: var(--default-border-color);">
                <div style="padding-bottom: 1rem"></div>
                <div class="request-panel-tabs-context">
                    <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Headers</div>
                    <div>
                        <RequestPanelHeaders :collection-item="collectionItem" :collection-item-environment-resolved="envVariables"></RequestPanelHeaders>
                    </div>
                    <div style="margin-top: 0.5rem; color: #7b7a7a; font-weight: normal; font-style: italic;">These will be applied to all requests in this folder and its subfolders</div>
                </div>

                <div style="padding-bottom: 1rem"></div>
                <div class="request-panel-tabs-context">
                    <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Auth</div>
                    <div>
                        <RequestPanelAuth :collection-item="collectionItem" :collection-item-environment-resolved="envVariables"></RequestPanelAuth>
                    </div>
                    <div style="margin-top: 0.5rem; color: #7b7a7a; font-weight: normal; font-style: italic;">This will be applied to all requests in this folder and its subfolders</div>
                </div>
            </div>

            <div style="padding-bottom: 1rem"></div>

            <template #footer>
                <button>Done</button>
            </template>
        </modal>
    </form>
</template>

<script>
import Modal from '@/components/Modal.vue'
import { getCollectionForWorkspace } from '@/db'
import { flattenTree, sortTree, toTree, prependParentTitleToChildTitle } from '@/helpers'
import RequestPanelHeaders from '../RequestPanelHeaders.vue'
import RequestPanelAuth from '../RequestPanelAuth.vue'

export default {
    directives: {
        focus: {
            mounted(element) {
                element.focus()
            }
        }
    },
    props: {
        showModal: Boolean,
        collectionItem: Object
    },
    components: {
        Modal,
        RequestPanelHeaders,
        RequestPanelAuth,
    },
    data() {
        return {
            activeWorkspaceFolders: [],
            envVariables: {},
        }
    },
    computed: {
        showModalComp: {
            get() {
                return this.showModal
            },
            set(value) {
                if (value === false) {
                    this.$emit('update:collectionItem', this.collectionItem)
                } else {
                    this.$emit('update:showModal', value)
                }
            }
        },
        title() {
            if(this.collectionItem._type === 'request_group') {
                return 'Folder Properties'
            }

            if(this.collectionItem._type === 'request') {
                return 'Request Properties'
            }

            if(this.collectionItem._type === 'socket') {
                return 'Socket Properties'
            }

            return ''
        },
        placeholder() {
            if(this.collectionItem._type === 'request_group') {
                return 'Folder Name'
            }

            if(this.collectionItem._type === 'request') {
                return 'Request Name'
            }

            if(this.collectionItem._type === 'socket') {
                return 'Socket Name'
            }

            return ''
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        },
    },
    watch: {
        showModal() {
            if(this.showModal) {
                this.getAllFolders()

                if(this.collectionItem._type === 'request_group') {
                    this.loadEnvVariables()
                }
            }
        }
    },
    methods: {
        async getAllFolders() {
            let { collection: activeWorkspaceFolders } = await getCollectionForWorkspace(this.activeWorkspace._id, 'request_group')
            activeWorkspaceFolders = toTree(activeWorkspaceFolders)
            sortTree(activeWorkspaceFolders)

            // prevent moving parent into child folders, so exclude child folders from dropdown if collection item type is request_group
            if(this.collectionItem._type === 'request_group') {
                const filterChildFolders = (folders, parentId) => {
                    return folders.filter(folder => {
                        // Keep the folder if it's not a child of the parentId and it's not the parentId itself
                        if(folder.parentId !== parentId && folder._id !== parentId) {
                            if(folder.children) {
                                folder.children = filterChildFolders(folder.children, parentId)
                            }
                            return true
                        }
                        return false
                    })
                }
                activeWorkspaceFolders = filterChildFolders(activeWorkspaceFolders, this.collectionItem._id)
            }

            prependParentTitleToChildTitle(activeWorkspaceFolders)
            activeWorkspaceFolders = flattenTree(activeWorkspaceFolders)
            this.activeWorkspaceFolders = activeWorkspaceFolders
        },
        async loadEnvVariables() {
            const request = JSON.parse(JSON.stringify(this.collectionItem))
            const { environment } = await this.$store.dispatch('getEnvironmentForRequest', { collectionItem: request, includeSelf: true })
            this.envVariables = environment
        },
    }
}
</script>
