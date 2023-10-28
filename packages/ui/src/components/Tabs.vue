<template>
    <div class="d-f flex-ai-c">
        <div class="d-f o-a">
            <div
                v-for="tab in tabs"
                class="tab"
                :ref="element => tabRefs[tab.id] = element"
                :class="{ 'tab-active': tab.id === currentTabId }"
                @click="$emit('change-tab', tab)"
                @click.middle="closeTab(tab)"
            >
                {{ tab.name !== '' ? tab.name : 'Untitled' }}
                <button class="icon" @click.stop="closeTab(tab)">
                    x
                </button>
            </div>
        </div>
        <div class="ml-0_5rem">
            <slot></slot>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'

interface tab {
    id: string,
    name: string
}

export default defineComponent({
    props: {
        tabs: {
            type: Array as PropType<tab[]>,
            required: true
        },
        currentTabId: {
            type: String,
            required: true
        }
    },
    data() {
        return {
            tabRefs: {} as any
        }
    },
    watch: {
        currentTabId() {
            this.$nextTick(() => {
                this.tabRefs[this.currentTabId].scrollIntoView({
                    behavior: 'auto',
                    block: 'center'
                })
            })
        }
    },
    methods: {
        closeTab(tabToClose: tab) {
            let tabToOpen: tab | null = null

            if(this.currentTabId === tabToClose.id) {
                const tabIndex = this.tabs.findIndex(tab => tab.id === tabToClose.id)

                const tabIndexLeft = tabIndex - 1
                const tabIndexRight = tabIndex + 1

                tabToOpen = tabIndexLeft >= 0 ? this.tabs[tabIndexLeft] : (tabIndexRight <= this.tabs.length - 1 ? this.tabs[tabIndexRight] : null)
            }

            this.$emit('close-tab', { tabToClose, tabToOpen })
        }
    },
    mounted() {
        this.$nextTick(() => {
            this.tabRefs[this.currentTabId].scrollIntoView({
                behavior: 'auto',
                block: 'center'
            })
        })
    }
})
</script>

<style scoped>
.tab {
    border-top: 1px solid var(--default-border-color);
    border-bottom: 1px solid var(--default-border-color);
    border-right: 1px solid var(--default-border-color);
    padding: 0.3rem;
    cursor: pointer;
    white-space: nowrap;
    display: flex;
    align-items: center;
    padding: 0 0.2rem;
    padding-left: 0.5rem;
}

.tab:first-child {
    border-left: 1px solid var(--default-border-color);
}

.tab:not(:first-child) {
    border-left: 0;
}

.tab-active {
    border-top: 1px solid red;
}

/* functional classes */

.d-b {
    display: block;
}

.d-f {
    display: flex;
}

.flex-jc-sb {
    justify-content: space-between;
}

.flex-ai-c {
    align-items: center;
}

.ml-0_5rem {
    margin-left: 0.5rem;
}

.mr-0_5rem {
    margin-right: 0.5rem;
}

.mb-0_5rem {
    margin-bottom: 0.5rem;
}

.mt-0_5rem {
    margin-top: 0.5rem;
}

.mt-1rem {
    margin-top: 1rem;
}

.ml-1rem {
    margin-left: 1rem;
}

.p-0_5rem {
    padding: 0.5rem;
}

.align-right {
    display: grid;
    place-items: end;
}

.bc-primary {
    background-color: #edf2f7;
}

.w-100p {
    width: 100%;
}

.h-100p {
    height: 100%;
}

.oy-a {
    overflow-y: auto;
}

.o-a {
    overflow: auto;
}

.c-p-i {
    cursor: pointer !important;
}

/* base styles */

table {
    width: 100%;
    border-collapse: collapse;
}

table td {
    border: 1px solid var(--default-border-color);
    vertical-align: top;
    padding: 0.3rem;
}

button {
    cursor: pointer;
    background-color: cadetblue;
    border: 1px solid rgb(64, 107, 109);
    border-radius: 0.25rem;
    padding: 0.3rem 0.6rem;
    color: white;
    outline: 0;
}

button:hover {
    filter: brightness(1.1);
}

button:active {
    filter: brightness(1.15);
}

button:disabled,
button.disabled {
    filter: grayscale(1);
    cursor: default;
}

button.icon {
    background-color: transparent;
    border: 0;
    color: var(--text-color);
}

button.icon:hover {
    background-color: transparent;
    border: 0;
}

button.icon > svg {
    display: block;
}

textarea,
input,
select {
    outline: 0;
    border: 1px solid var(--default-border-color);
    border-radius: 0.25rem;
    padding: 0.5rem;
    font: inherit;
}

textarea {
    resize: vertical;
}

input:disabled {
    background-color: #f4f4f4;
}

select {
    padding: 0.2rem 0.6rem;
}
</style>
