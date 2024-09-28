<template>
    <form @submit.prevent="showModalComp = false" v-if="showModalComp">
        <modal :title="title" v-model="showModalComp" width="600px">
            <label>
                <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Name <span style="color: var(--modal-tip-text-color); font-weight: normal; font-style: italic;" v-if="collectionItem._type === 'request' || collectionItem._type === 'socket'">(also rename by double-clicking in sidebar)</span></div>
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

            <div style="padding-bottom: 1rem"></div>

            <template #footer>
                <button class="button">Done</button>
            </template>
        </modal>
    </form>
</template>

<script>
import Modal from '@/components/Modal.vue'
import { getCollectionForWorkspace } from '@/db'
import { flattenTree, sortTree, toTree, prependParentTitleToChildTitle } from '@/helpers'

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
    },
    data() {
        return {
            activeWorkspaceFolders: [],
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
    }
}
</script>
