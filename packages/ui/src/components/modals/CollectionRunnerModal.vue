<template>
    <form @submit.prevent="startRun" v-if="showModalComp">
        <modal title="Collection Runner" v-model="showModalComp">
            <div>
                <p><strong>{{ sourceName }}</strong> - {{ allRequests.length }} request(s)</p>

                <!-- Request Selection Tree -->
                <div style="margin-top: 1rem; max-height: 300px; overflow-y: auto; border: 1px solid var(--default-border-color); padding: 0.5rem;">
                    <div style="margin-bottom: 0.5rem;">
                        <button type="button" class="button" style="margin-right: 0.5rem;" @click="selectAll">Select All</button>
                        <button type="button" class="button" @click="deselectAll">Deselect All</button>
                    </div>
                    <div v-for="item in treeItems" :key="item._id">
                        <TreeItem :item="item" :selected-ids="selectedRequestIds" @toggle="toggleRequest" />
                    </div>
                </div>
                <p style="margin-top: 0.5rem; font-size: 0.9em; color: var(--text-color-secondary);">
                    {{ selectedRequestIds.length }} of {{ allRequests.length }} selected
                </p>

                <!-- Iterations -->
                <label style="display: block; margin-top: 1rem;">
                    <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Iterations</div>
                    <input type="number" class="full-width-input" v-model.number="iterations" min="1" required>
                </label>

                <!-- Delay -->
                <label style="display: block; margin-top: 1rem;">
                    <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Delay between requests (ms)</div>
                    <input type="number" class="full-width-input" v-model.number="delayMs" min="0">
                </label>

                <!-- Continue on Error -->
                <label style="display: flex; align-items: center; margin-top: 1rem;">
                    <input type="checkbox" v-model="continueOnError">
                    <span style="margin-left: 0.5rem;">Continue execution on request failure</span>
                </label>
            </div>

            <template #footer>
                <button type="button" class="button" @click="showModalComp = false">Cancel</button>
                <button type="submit" class="button" style="margin-left: 1rem;" :disabled="selectedRequestIds.length === 0">Run</button>
            </template>
        </modal>
    </form>
</template>

<script>
import Modal from '@/components/Modal.vue'
import { getAllHttpRequestsInFolder } from '@/helpers'

const TreeItem = {
    name: 'TreeItem',
    props: ['item', 'selectedIds'],
    data() {
        return {
            collapsed: false
        }
    },
    computed: {
        isFolder() {
            return this.item._type === 'request_group'
        },
        isRequest() {
            return this.item._type === 'request'
        },
        isChecked() {
            return this.selectedIds.includes(this.item._id)
        },
        hasChildren() {
            return this.item.children && this.item.children.length > 0
        }
    },
    methods: {
        toggle() {
            if (this.isRequest) {
                this.$emit('toggle', this.item._id)
            }
        },
        toggleCollapse() {
            this.collapsed = !this.collapsed
        }
    },
    template: `
        <div>
            <div style="display: flex; align-items: center; padding: 0.25rem 0;">
                <span v-if="isFolder" @click="toggleCollapse" style="cursor: pointer; margin-right: 0.25rem;">
                    <i class="fa fa-caret-down" v-if="!collapsed && hasChildren"></i>
                    <i class="fa fa-caret-right" v-if="collapsed && hasChildren"></i>
                    <i class="fa fa-folder" style="margin-left: 0.25rem;"></i>
                </span>
                <label v-if="isRequest" style="display: flex; align-items: center; cursor: pointer; margin: 0;">
                    <input type="checkbox" :checked="isChecked" @change="toggle">
                    <span :class="'request-method--' + (item.method || 'GET')" style="margin-left: 0.5rem; margin-right: 0.5rem; font-size: 0.75rem;">
                        {{ item.method || 'GET' }}
                    </span>
                    <span>{{ item.name }}</span>
                </label>
                <span v-if="isFolder" @click="toggleCollapse" style="margin-left: 0.5rem; cursor: pointer;">{{ item.name }}</span>
            </div>
            <div v-if="isFolder && !collapsed && hasChildren" style="margin-left: 1.5rem;">
                <TreeItem v-for="child in item.children" :key="child._id" :item="child" :selected-ids="selectedIds" @toggle="$emit('toggle', $event)" />
            </div>
        </div>
    `
}

export default {
    components: { Modal, TreeItem },
    props: {
        showModal: Boolean,
        source: Object
    },
    data() {
        return {
            selectedRequestIds: [],
            iterations: 1,
            delayMs: 0,
            continueOnError: true
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
        sourceName() {
            return this.source?.name || 'Collection'
        },
        treeItems() {
            if (!this.source) {
                return []
            }
            if (this.source._type === 'collection') {
                return this.source.children || []
            }
            return this.source.children || []
        },
        allRequests() {
            if (!this.source) {
                return []
            }

            if (this.source._type === 'collection') {
                return getAllHttpRequestsInFolder({ children: this.source.children })
            }
            return getAllHttpRequestsInFolder(this.source)
        }
    },
    watch: {
        showModal(newVal) {
            if (newVal) {
                // Select all by default
                this.selectedRequestIds = this.allRequests.map(r => r._id)
                this.iterations = 1
                this.delayMs = 0
                this.continueOnError = true
            }
        }
    },
    methods: {
        selectAll() {
            this.selectedRequestIds = this.allRequests.map(r => r._id)
        },
        deselectAll() {
            this.selectedRequestIds = []
        },
        toggleRequest(requestId) {
            const index = this.selectedRequestIds.indexOf(requestId)
            if (index > -1) {
                this.selectedRequestIds.splice(index, 1)
            } else {
                this.selectedRequestIds.push(requestId)
            }
        },
        async startRun() {
            if (this.selectedRequestIds.length === 0) {
                return
            }

            const selectedRequests = this.allRequests.filter(r => this.selectedRequestIds.includes(r._id))

            try {
                await this.$store.dispatch('startCollectionRunner', {
                    source: this.source,
                    selectedRequests,
                    iterations: this.iterations,
                    delayMs: this.delayMs,
                    continueOnError: this.continueOnError
                })
                this.showModalComp = false
                this.$emit('started')
            } catch (error) {
                this.$toast.error(error.message)
            }
        }
    }
}
</script>
