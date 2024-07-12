<template>
    <div v-if="showModalComp">
        <modal title="HTTP Custom Method" v-model="showModalComp">
            <div>
                <div style="margin-bottom: var(--label-margin-bottom);">Name</div>
                <input type="text" v-model="methodValue" class="full-width-input" placeholder="Some custom method" v-focus>
            </div>
            <div style="margin-top: 1rem">Common examples are
                <span
                    v-for="(methodItem, methodItemIndex) in commonCustomHttpMethods"
                    :key="methodItemIndex"
                    @click="methodValue = methodItem"
                    style="cursor: pointer;"
                >
                    <span v-if="methodItemIndex !== commonCustomHttpMethods.length - 1">{{ methodItem }}, </span>
                    <span v-else>{{ methodItem }}</span>
                </span>
            </div>
            <template #footer>
                <button class="button" @click="saveMethod" style="margin-left: 1rem; cursor: pointer">Done</button>
            </template>
        </modal>
    </div>

</template>

<script>
import Modal from '@/components/Modal.vue'

export default {
    directives: {
        focus: {
            mounted(element) {
                element.focus()
                element.select()
            }
        }
    },
    components: {
        Modal
    },
    props: {
        showModal: Boolean,
        method: String,
    },
    data() {
        return {
            methodValue: '',
            commonCustomHttpMethods: [
                'PROPFIND',
                'PROPPATCH',
                'MKCOL',
                'COPY',
                'MOVE',
                'LOCK',
                'UNLOCK',
                'LINK',
                'UNLINK',
                'FIND',
                'PURGE',
            ],
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
        }
    },
    watch: {
        method() {
            this.methodValue = this.method
        }
    },
    methods: {
        saveMethod() {
            this.showModalComp = false
            if (this.methodValue.trim() === '') {
                this.methodValue = 'GET'
            }
            this.$emit('customHttpMethod', this.methodValue)
        }
    },
    mounted() {
        this.methodValue = this.method
    },
}
</script>
