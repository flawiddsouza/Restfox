<template>
    <div width="600px" style="margin-left: 1rem; margin-right: 1rem; margin-top: 1rem;" v-if="collectionItem">
        <div style="padding-top: 1rem"></div>

        <div v-if="collectionItem._type === 'request_group'">
            <div style="padding-bottom: 1rem"></div>
            <hr style="border: none; height: 1px; background-color: var(--default-border-color);">
            <div style="padding-bottom: 1rem"></div>

            <div class="request-panel-tabs-context">
                <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Headers</div>
                <div>
                    <RequestPanelHeaders :collection-item="collectionItem" :collection-item-environment-resolved="envVariables"></RequestPanelHeaders>
                </div>
                <InfoTip/>
            </div>

            <div style="padding-bottom: 1rem"></div>

            <div class="request-panel-tabs-context">
                <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Auth</div>
                <div>
                    <RequestPanelAuth :collection-item="collectionItem" :collection-item-environment-resolved="envVariables"></RequestPanelAuth>
                </div>
                <InfoTip/>
            </div>
        </div>

        <div style="padding-bottom: 1rem"></div>
    </div>
</template>

<script>
import { flattenTree, sortTree, toTree, prependParentTitleToChildTitle } from '@/helpers'
import RequestPanelHeaders from '../../src/components/RequestPanelHeaders.vue'
import RequestPanelAuth from '../../src/components/RequestPanelAuth.vue'

export default {
    directives: {
        focus: {
            mounted(element) {
                element.focus()
            }
        }
    },
    props: {
        collectionItem: Object
    },
    components: {
        RequestPanelHeaders,
        RequestPanelAuth,
        InfoTip: {
            template: `
              <div style="margin-top: 0.5rem; color: var(--modal-tip-text-color); font-weight: normal; font-style: italic;">
                This will be applied to all requests in this folder and its subfolders
              </div>
            `
        }
    },
    data() {
        return {
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
    },
    watch: {
        collectionItem: {
            immediate: true,
            handler() {
                this.loadEnvVariables()
            }
        }
    },
    methods: {
        async loadEnvVariables() {
            try {
                if(this.collectionItem) {
                    const request = JSON.parse(JSON.stringify(this.collectionItem))
                    const { environment } = await this.$store.dispatch('getEnvironmentForRequest', { collectionItem: request, includeSelf: true })
                    this.envVariables = environment
                }
            } catch (error) {
                console.error('Error loading environment variables:', error)
            }
        },
    }
}
</script>
