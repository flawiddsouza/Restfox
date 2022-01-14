<template>
    <div class="workspace-container">
        <div class="workspace" v-for="workspace in workspaces" @click="setActiveWorkspace(workspace)">
            <div class="workspace-settings-button-container">
                <div class="workspace-settings-button" @click.stop="handleContextMenu($event, workspace)">
                    <svg width="1em" height="1em" viewBox="0 0 14 3" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M1.5 3a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM7 3a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM12.5 3a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" fill=""></path>
                    </svg>
                </div>
            </div>
            <div class="workspace-name">{{ workspace.name }}</div>
            <div class="workspace-timestamp">{{ new Date(workspace.createdAt) }}</div>
        </div>
        <ContextMenu :options="options" v-model:show="showContextMenu" @click="handleContextMenuClick" :element="contextMenuElement" />
    </div>
</template>

<script>
import ContextMenu from './ContextMenu.vue'

export default {
    components: {
        ContextMenu
    },
    data() {
        return {
            showContextMenu: false,
            contextMenuElement: null,
            contextMenuWorkspace: null
        }
    },
    computed: {
        workspaces() {
            return this.$store.state.workspaces
        },
        options() {
            return [
                {
                    'type': 'option',
                    'label': 'Duplicate',
                    'value': 'Duplicate'
                },
                {
                    'type': 'option',
                    'label': 'Rename',
                    'value': 'Rename'
                },
                {
                    'type': 'separator'
                },
                {
                    'type': 'option',
                    'label': 'Delete',
                    'value': 'Delete'
                }
        ]
        }
    },
    methods: {
        setActiveWorkspace(workspaceId) {
            this.$store.commit('setActiveWorkspace', workspaceId)
        },
        handleContextMenu(event, workspace) {
            this.contextMenuElement = event.target.closest('.workspace-settings-button')
            this.contextMenuWorkspace = workspace
            this.showContextMenu = true
        },
        handleContextMenuClick(clickedContextMenuItem) {
            alert(clickedContextMenuItem)
        }
    }
}
</script>

<style scoped>
.workspace-container {
    display: flex;
    align-items: flex-start;
    margin: 1rem;
}

.workspace {
    border: 1px solid var(--default-border-color);
    cursor: pointer;
    height: 15rem;
    width: 15rem;
    border-radius: 4px;
    user-select: none;
    word-break: break-all;
    display: grid;
    grid-template-rows: auto auto 1fr;
}

.workspace:hover {
    border: 1px solid var(--base-color-info);
}

.workspace svg {
    fill: black;
    color: black;
}

.workspace-settings-button-container {
    text-align: right;
}

.workspace-settings-button {
    display: inline-block;
    padding: 1rem;
}

.workspace-name, .workspace-timestamp {
    padding-left: 1rem;
    padding-right: 1rem;
}

.workspace-timestamp {
    margin-bottom: 1rem;
    display: grid;
    place-items: self-end;
}

.workspace-settings-button:hover {
    background-color: #dbedff;
}
</style>
