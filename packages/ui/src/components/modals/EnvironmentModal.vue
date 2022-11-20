<template>
    <form @submit.prevent="done" v-if="showModalComp">
        <modal :title="`Environment (JSON Format) — ${collectionItem ? collectionItem.name : workspace.name}`" v-model="showModalComp" height="70vh" width="55rem">
            <div style="display: grid; grid-template-columns: auto 1fr; height: 100%; overflow: auto;">
                <div style="display: grid; grid-template-rows: auto 1fr; height: 100%; overflow: auto; margin-right: 1rem; border-right: 1px solid var(--modal-border-color)">
                    <button class="button" type="button" style="margin-bottom: 0.5rem; margin-right: 0.5rem;" @click="addEnvironment">Add Environment</button>
                    <div style="overflow-y: auto;" class="environment-sidebar">
                        <div v-for="environment in environments" class="environment-sidebar-item" :class="{ 'environment-sidebar-item-active': environment.name === currentEnvironment }" @click="changeEnvironment(environment)" :ref="'environment-' + environment.name">
                            <div>{{ environment.name }}</div>
                            <div class="environment-sidebar-item-menu" :class="{ 'environment-sidebar-item-menu-disable-hide': environment.name === clickedContextMenuEnvironment.name && showEnvironmentContextMenuPopup === true }" @click.stop="showEnvironmentContextMenu($event, environment)">
                                <svg viewBox="0 0 24 24" focusable="false" style="pointer-events: none; display: block; width: 100%; height: 100%;">
                                    <g>
                                        <path d="M12,16.5c0.83,0,1.5,0.67,1.5,1.5s-0.67,1.5-1.5,1.5s-1.5-0.67-1.5-1.5S11.17,16.5,12,16.5z M10.5,12 c0,0.83,0.67,1.5,1.5,1.5s1.5-0.67,1.5-1.5s-0.67-1.5-1.5-1.5S10.5,11.17,10.5,12z M10.5,6c0,0.83,0.67,1.5,1.5,1.5 s1.5-0.67,1.5-1.5S12.83,4.5,12,4.5S10.5,5.17,10.5,6z"></path>
                                    </g>
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>
                <div style="display: grid; grid-template-rows: 1fr auto; overflow: auto;">
                    <CodeMirrorEditor v-model="environment" lang="json" style="overflow: auto;" :key="currentEnvironment"></CodeMirrorEditor>
                    <div style="margin-top: 1rem">
                        <div v-if="parseError" class="box">{{ parseError }}</div>
                        <div class="box box-hidden" v-else>
                            Spacer Text
                        </div>
                    </div>
                </div>
            </div>

            <template #footer>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 0.75rem; text-align: left; line-height: 1rem; margin-right: 0.5rem;" v-pre><span class="code">"key": "value"</span> pairs defined in the above JSON object can be referenced in any text input in the request panel using <span class="code">{{ key }}</span> for variable substitution</div>
                    <div>
                        <button class="button">Done</button>
                    </div>
                </div>
            </template>
        </modal>
        <template v-if="showEnvironmentContextMenuPopup">
            <div class="context-menu-background-overlay" @click="hideEnvironmentContextMenu()"></div>
            <div class="context-menu" :style="{ top: showEnvironmentContextMenuPopupCoords.y, left: showEnvironmentContextMenuPopupCoords.x }">
                <div @click="renameEnvironment">Rename</div>
                <div @click="deleteEnvironment">Delete</div>
            </div>
        </template>
    </form>
</template>

<script>
import Modal from '@/components/Modal.vue'
import CodeMirrorEditor from '@/components/CodeMirrorEditor.vue'
import { nextTick } from 'vue'

export default {
    props: {
        showModal: Boolean,
        collectionItem: Object,
        workspace: Object
    },
    components: {
        Modal,
        CodeMirrorEditor
    },
    data() {
        return {
            environment: '{}',
            environmentToSave: {},
            parseError: '',
            clickedContextMenuEnvironment: { name: '' },
            showEnvironmentContextMenuPopup: false,
            showEnvironmentContextMenuPopupCoords: {
                x: '',
                y: ''
            }
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
        },
        environments() {
            if(this.collectionItem) {
                return this.collectionItem.environments ?? [
                    {
                        name: 'Default',
                        environment: this.environmentToSave
                    }
                ]
            }

            if(this.workspace) {
                return this.workspace.environments ?? [
                    {
                        name: 'Default',
                        environment: this.environmentToSave
                    }
                ]
            }

            return undefined
        },
        currentEnvironment() {
            if(this.collectionItem) {
                return this.collectionItem.currentEnvironment ?? 'Default'
            }

            if(this.workspace) {
                return this.workspace.currentEnvironment ?? 'Default'
            }

            return undefined
        }
    },
    watch: {
        collectionItem() {
            this.environment = this.collectionItem.environment ? JSON.stringify(this.collectionItem.environment, null, 4) : '{}'
        },
        workspace() {
            this.environment = this.workspace.environment ? JSON.stringify(this.workspace.environment, null, 4) : '{}'
        },
        environment() {
            let environment = {}
            try {
                environment = JSON.parse(this.environment)
                this.parseError = ''
                this.environmentToSave = environment
                this.saveEnvironment()
            } catch(e) {
                this.parseError = e.message
            }
        },
        showModal() {
            if(this.showModal) {
                this.parseError = ''
                if(this.collectionItem) {
                    this.environment = this.collectionItem.environment ? JSON.stringify(this.collectionItem.environment, null, 4) : '{}'
                }
                if(this.workspace) {
                    this.environment = this.workspace.environment ? JSON.stringify(this.workspace.environment, null, 4) : '{}'
                }
                nextTick(() => {
                    this.$refs['environment-' + this.currentEnvironment][0].scrollIntoView({
                        behavior: 'auto',
                        block: 'center',
                        inline: 'center'
                    })
                })
            }
        }
    },
    methods: {
        async done() {
            this.showModalComp = false
        },
        async addEnvironment() {
            const newEnvironmentName = await window.createPrompt('Enter new environment name')

            if(!newEnvironmentName || newEnvironmentName.trim() === '') {
                return
            }

            if(this.environments.some(environment => environment.name === newEnvironmentName)) {
                alert('Given environment name already exists')
                return
            }

            const environment = { name: newEnvironmentName, environment: {} }

            if(this.collectionItem) {
                if('environments' in this.collectionItem === false) {
                    this.collectionItem.environments = [
                        {
                            name: 'Default',
                            environment: this.environmentToSave
                        }
                    ]
                }
                this.collectionItem.environments.push(environment)
            }

            if(this.workspace) {
                if('environments' in this.workspace === false) {
                    this.workspace.environments = [
                        {
                            name: 'Default',
                            environment: this.environmentToSave
                        }
                    ]
                }
                this.workspace.environments.push(environment)
            }

            this.changeEnvironment(environment)

            nextTick(() => {
                this.$refs['environment-' + environment.name][0].scrollIntoView({
                    behavior: 'auto',
                    block: 'center',
                    inline: 'center'
                })
            })
        },
        changeEnvironment(environment) {
            if(this.collectionItem) {
                this.collectionItem.currentEnvironment = environment.name
            }

            if(this.workspace) {
                this.workspace.currentEnvironment = environment.name
            }

            this.saveCurrentEnvironment()

            const environmentString = JSON.stringify(environment.environment, null, 4)

            let manuallyTriggerSave = false

            // environment watch doesn't trigger when value is same as before,
            // so we need to do this trick, to save the new environment
            if(environmentString === this.environment) {
                manuallyTriggerSave = true
            }

            this.environment = environmentString

            if(manuallyTriggerSave) {
                this.saveEnvironment()
            }
        },
        saveEnvironment() {
            if(this.collectionItem) {
                this.collectionItem.environment = this.environmentToSave
                this.$store.commit('updateCollectionItemEnvironment', { collectionId: this.collectionItem._id, environment: this.environmentToSave })
            }

            if(this.workspace) {
                this.workspace.environment = this.environmentToSave
                this.$store.commit('updateWorkspaceEnvironment',  { workspaceId: this.workspace._id, environment: this.environmentToSave })
            }

            const currentEnvironment = this.environments.find(environmentItem => environmentItem.name === this.currentEnvironment)
            currentEnvironment.environment = this.environmentToSave

            this.saveEnvironments()
        },
        saveEnvironments() {
            if(this.collectionItem) {
                this.$store.commit('updateCollectionItemEnvironments', { collectionId: this.collectionItem._id, environments: this.environments })
            }

            if(this.workspace) {
                this.$store.commit('updateWorkspaceEnvironments',  { workspaceId: this.workspace._id, environments: this.environments })
            }
        },
        saveCurrentEnvironment() {
            if(this.collectionItem) {
                this.$store.commit('updateCollectionItemCurrentEnvironment', { collectionId: this.collectionItem._id, currentEnvironment: this.currentEnvironment })
            }

            if(this.workspace) {
                this.$store.commit('updateWorkspaceCurrentEnvironment',  { workspaceId: this.workspace._id, currentEnvironment: this.currentEnvironment })
            }
        },
        showEnvironmentContextMenu(event, environment) {
            if(this.clickedContextMenuEnvironment.name === environment.name && this.showEnvironmentContextMenuPopup === true) {
                this.hideEnvironmentContextMenu()
                return
            }
            const menuElement = event.target
            var clientRect = menuElement.getBoundingClientRect()
            var clientX = clientRect.left
            var clientY = clientRect.top
            this.clickedContextMenuEnvironment = environment
            this.showEnvironmentContextMenuPopupCoords.x = clientX + 'px'
            this.showEnvironmentContextMenuPopupCoords.y = (clientY + clientRect.height + 5) + 'px'
            this.showEnvironmentContextMenuPopup = true
        },
        hideEnvironmentContextMenu(clearClickedContextMenuEnvironment = true) {
            if(this.showEnvironmentContextMenuPopup === false) {
                return
            }
            this.showEnvironmentContextMenuPopup = false
            if(clearClickedContextMenuEnvironment) {
                this.clickedContextMenuEnvironment = { name: '' }
            }
        },
        async renameEnvironment() {
            const newEnvironmentName = await window.createPrompt('Enter new environment name', this.clickedContextMenuEnvironment.name)

            if(!newEnvironmentName || newEnvironmentName.trim() === '') {
                this.hideEnvironmentContextMenu()
                return
            }

            if(this.clickedContextMenuEnvironment.name !== newEnvironmentName && this.environments.some(environment => environment.name === newEnvironmentName)) {
                alert('Given environment name already exists')
                this.hideEnvironmentContextMenu()
                return
            }

            // we need this to re set current environment if the changed
            // environment name is the current environment
            let changeCurrentEnvironment = false

            if(this.clickedContextMenuEnvironment.name === this.currentEnvironment) {
                changeCurrentEnvironment = true
            }

            this.clickedContextMenuEnvironment.name = newEnvironmentName

            if(this.workspace && 'environments' in this.workspace === false) {
                this.workspace.environments = this.environments
            }

            if(this.collectionItem && 'environments' in this.collectionItem === false) {
                this.collectionItem.environments = this.environments
            }

            this.saveEnvironments()

            if(changeCurrentEnvironment) {
                this.changeEnvironment(this.clickedContextMenuEnvironment)
            }

            this.hideEnvironmentContextMenu()
        },
        deleteEnvironment() {
            if(this.environments.length === 1) {
                alert('Cannot delete environment as there\'s only one environment left')
                this.hideEnvironmentContextMenu()
                return
            }

            if(!confirm('Are you sure you want to delete this environment?')) {
                this.hideEnvironmentContextMenu()
                return
            }

            if(this.collectionItem) {
                this.collectionItem.environments = this.environments.filter(environment => environment.name !== this.clickedContextMenuEnvironment.name)
            }

            if(this.workspace) {
                this.workspace.environments = this.environments.filter(environment => environment.name !== this.clickedContextMenuEnvironment.name)
            }

            this.saveEnvironments()

            if(this.clickedContextMenuEnvironment.name === this.currentEnvironment) {
                this.changeEnvironment(this.environments[0])
            }

            this.hideEnvironmentContextMenu()
        }
    }
}
</script>

<style scoped>
.box {
    padding: 0.6rem;
    border: 1px dotted #d04444;
    border-radius: 0.3rem;
}

.box-hidden {
    border: 1px dotted transparent;
    visibility: hidden;
}

.environment-sidebar-item {
    display: flex;
    padding-top: 0.3rem;
    padding-bottom: 0.3rem;
    padding-left: 0.3rem;
    padding-right: 0.3rem;
    cursor: pointer;
    justify-content: space-between;
    align-items: center;
}

.environment-sidebar-item-active {
    background-color: rgb(104 114 254 / 26%);
}

.environment-sidebar-item > .environment-sidebar-item-menu {
    visibility: hidden;
    border-radius: 10px;
    height: 1.4rem;
}

.environment-sidebar-item:hover > .environment-sidebar-item-menu,
.environment-sidebar-item > .environment-sidebar-item-menu.environment-sidebar-item-menu-disable-hide {
    visibility: visible;
}

.environment-sidebar-item.environment-sidebar-item-selected > .environment-sidebar-item-menu svg {
    fill: white;
}

.environment-sidebar-item > .environment-sidebar-item-menu:hover,
.environment-sidebar-item > .environment-sidebar-item-menu.environment-sidebar-item-menu-disable-hide {
    background-color: rgba(240, 248, 255, 0.233);
}

.environment-sidebar-item:not(.environment-sidebar-item-selected) > .environment-sidebar-item-menu:hover,
.environment-sidebar-item:not(.environment-sidebar-item-selected) > .environment-sidebar-item-menu.environment-sidebar-item-menu-disable-hide {
    background-color: rgb(108 194 197 / 20%);
}

.context-menu-background-overlay {
    position: fixed;
    z-index: 10;
    height: 100vh;
    width: 100vw;
    top: 0;
    left: 0;
}

.context-menu {
    position: fixed;
    z-index: 10;
    top: 0;
    left: 0;
    background-color: var(--modal-background-color);
    color: var(--modal-text-color);
    border-radius: 5px;
    box-shadow: 1px 1px 8px -4px black;
}

.context-menu > div {
    padding: 0.3rem 0.5rem;
    cursor: pointer;
}

.context-menu > div:hover {
    background-color: slateblue;
    color: white;
}
</style>
