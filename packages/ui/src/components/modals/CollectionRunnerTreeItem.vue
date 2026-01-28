<template>
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
</template>

<script>
export default {
    name: 'TreeItem',
    props: {
        item: {
            type: Object,
            required: true
        },
        selectedIds: {
            type: Array,
            required: true
        }
    },
    emits: ['toggle'],
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
    }
}
</script>
