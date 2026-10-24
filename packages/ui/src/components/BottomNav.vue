<template>
    <nav class="bottom-nav">
        <div
            class="nav-item"
            :class="{ active: activeMobilePanel === 'collections' }"
            @click="toggleCollections"
        >
            <i class="nav-icon fa fa-folder"></i>
            <span class="nav-label">Collections</span>
        </div>
        <div
            v-if="activeTab && !isSocket"
            class="nav-item"
            :class="{ active: activeMobilePanel === 'content' }"
            @click="setPanel('content')"
        >
            <i class="nav-icon fa fa-pencil"></i>
            <span class="nav-label">Request</span>
        </div>
        <div
            v-if="isSocket"
            class="nav-item"
            :class="{ active: activeMobilePanel === 'content' }"
            @click="setPanel('content')"
        >
            <i class="nav-icon fa fa-plug"></i>
            <span class="nav-label">Socket</span>
        </div>
        <div
            v-if="hasResponsePanel"
            class="nav-item"
            :class="{ active: activeMobilePanel === 'response' }"
            @click="setPanel('response')"
        >
            <i class="nav-icon fa fa-inbox"></i>
            <span class="nav-label">Response</span>
        </div>
        <div class="nav-item" @click="showMore = true">
            <i class="nav-icon fa fa-ellipsis-h"></i>
            <span class="nav-label">More</span>
        </div>

        <MobileBottomSheet
            v-model:show="showMore"
            title="More"
            :items="moreItems"
            @select="handleMoreSelect"
        />

        <MobileBottomSheet
            v-model:show="showEnvSelector"
            title="Select Environment"
            :items="envSelectorItems"
            @select="handleEnvSelect"
        />
    </nav>
</template>

<script>
import MobileBottomSheet from './MobileBottomSheet.vue'
import { applyTheme } from '@/helpers'
import constants from '@/constants'

export default {
    components: { MobileBottomSheet },
    data() {
        return {
            showMore: false,
            showEnvSelector: false,
        }
    },
    computed: {
        activeMobilePanel() {
            return this.$store.state.activeMobilePanel
        },
        activeTab() {
            return this.$store.state.activeTab
        },
        hasResponsePanel() {
            return this.activeTab?._type === 'request' || this.activeTab?._type === 'grpc'
        },
        isSocket() {
            return this.activeTab?._type === 'socket'
        },
        theme: {
            get() {
                return this.$store.state.theme
            },
            set(value) {
                this.$store.state.theme = value
                localStorage.setItem(constants.LOCAL_STORAGE_KEY.THEME, value)
                applyTheme(value)
            }
        },
        activeWorkspace() {
            return this.$store.state.activeWorkspace
        },
        environments() {
            if(!this.activeWorkspace) {
                return []
            }
            return this.activeWorkspace.environments ?? [
                {
                    name: constants.DEFAULT_ENVIRONMENT.name,
                    environment: this.activeWorkspace.environment,
                    color: constants.DEFAULT_ENVIRONMENT.color
                }
            ]
        },
        currentEnvironment() {
            return this.activeWorkspace?.currentEnvironment ?? constants.DEFAULT_ENVIRONMENT.name
        },
        moreItems() {
            return [
                { type: 'section-header', label: 'Environment', icon: 'fa-layer-group' },
                { label: 'Active Environment: ' + this.currentEnvironment, value: 'selectEnvironment', icon: 'fa-circle' },
                { label: 'Edit Environments', value: 'environments', icon: 'fa-code' },
                { type: 'section-header', label: 'Workspace', icon: 'fa-briefcase' },
                { label: 'Switch Workspace', value: 'workspace', icon: 'fa-exchange-alt' },
                { type: 'section-header', label: 'App', icon: 'fa-cog' },
                { label: 'Theme: ' + this.theme.charAt(0).toUpperCase() + this.theme.slice(1), value: 'theme', icon: 'fa-palette' },
                { label: 'Import', value: 'import', icon: 'fa-file-import' },
                { label: 'Plugins', value: 'plugins', icon: 'fa-puzzle-piece' },
                { label: 'Settings', value: 'settings', icon: 'fa-cog' },
                { label: 'Logs', value: 'logs', icon: 'fa-file-lines' },
            ]
        },
        envSelectorItems() {
            return this.environments.map(env => ({
                label: env.name,
                value: env.name,
                icon: 'fa-circle',
            }))
        },
    },
    watch: {
        hasResponsePanel(val) {
            if(!val && this.activeMobilePanel === 'response') {
                this.$store.commit('setActiveMobilePanel', 'content')
            }
        },
    },
    methods: {
        setPanel(panel) {
            this.$store.commit('setActiveMobilePanel', panel)
        },
        toggleCollections() {
            if(this.activeMobilePanel === 'collections') {
                this.$store.commit('setActiveMobilePanel', 'content')
            } else {
                this.$store.commit('setActiveMobilePanel', 'collections')
            }
        },
        handleMoreSelect(value) {
            if(value === 'selectEnvironment') {
                this.showEnvSelector = true
            }
            if(value === 'environments') {
                this.$store.commit('showEnvironmentModal', true)
            }
            if(value === 'settings') {
                this.$store.commit('showSettingsModal', true)
            }
            if(value === 'plugins') {
                this.$store.commit('showPluginManagerModal', true)
            }
            if(value === 'import') {
                this.$store.commit('showImportModal', true)
            }
            if(value === 'workspace') {
                this.$store.commit('setActiveWorkspace', null)
            }
            if(value === 'logs') {
                this.$store.commit('showLogsModal', true)
            }
            if(value === 'theme') {
                const themes = ['light', 'dark', 'dracula']
                const currentIndex = themes.indexOf(this.theme)
                const nextTheme = themes[(currentIndex + 1) % themes.length]
                this.theme = nextTheme
            }
        },
        handleEnvSelect(envName) {
            const workspace = this.activeWorkspace
            workspace.currentEnvironment = envName
            this.$store.commit('updateWorkspaceCurrentEnvironment', {
                workspaceId: workspace._id,
                currentEnvironment: envName
            })
            const selectedEnvironment = this.environments.find(e => e.name === envName)
            if(!selectedEnvironment) {
                return
            }
            workspace.environment = selectedEnvironment.environment
            this.$store.commit('updateWorkspaceEnvironment', {
                workspaceId: workspace._id,
                environment: selectedEnvironment.environment
            })
            this.$store.dispatch('reloadTabEnvironmentResolved')
        },
    }
}
</script>

<style scoped>
.bottom-nav {
    grid-area: bottom-nav;
    display: flex;
    border-top: 1px solid var(--default-border-color);
    background: var(--background-color);
    padding-bottom: env(safe-area-inset-bottom, 0px);
}

.nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8px 0;
    cursor: pointer;
    color: var(--text-color);
    gap: 3px;
    user-select: none;
}

.nav-item:active {
    background: var(--sidebar-item-active-color);
}

.nav-item.active .nav-icon,
.nav-item.active .nav-label {
    color: var(--nav-active-color);
}

.nav-icon {
    font-size: 1.2rem;
}

.nav-label {
    font-size: 0.65rem;
}

/* Hide on desktop */
@media (min-width: 769px) {
    .bottom-nav {
        display: none;
    }
}
</style>
