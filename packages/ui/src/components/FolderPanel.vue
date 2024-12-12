<template>
    <div style="margin-left: 1rem; margin-right: 1rem; margin-top: 1rem; max-width: 600px;" v-if="collectionItemToEdit">
        <div v-if="collectionItemToEdit._type === 'request_group'">
            <div style="padding-bottom: 1rem"></div>
            <div class="request-panel-tabs-context">
                <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Headers</div>
                <div>
                    <RequestPanelHeaders
                        :collection-item="collectionItemToEdit"
                        :collection-item-environment-resolved="envVariables"
                    />
                </div>
                <InfoTip />
            </div>

            <div style="padding-bottom: 1rem"></div>

            <div class="request-panel-tabs-context">
                <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Auth</div>
                <div>
                    <RequestPanelAuth
                        :collection-item="collectionItemToEdit"
                        :collection-item-environment-resolved="envVariables"
                        :flags="flags"
                    />
                </div>
                <InfoTip />
            </div>
        </div>

        <div style="padding-bottom: 1rem"></div>
    </div>
</template>

<script>
import RequestPanelHeaders from '../../src/components/RequestPanelHeaders.vue'
import RequestPanelAuth from '../../src/components/RequestPanelAuth.vue'
import { deepClone } from '@/helpers'
import { toRaw } from 'vue'

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
            collectionItemToEdit: null,
        }
    },
    computed: {
        flags() {
            return this.$store.state.flags
        },
    },
    watch: {
        collectionItem: {
            immediate: true,
            handler() {
                this.loadEnvVariables()
                this.collectionItemToEdit = deepClone(this.collectionItem)
            }
        },
        collectionItemToEdit: {
            deep: true,
            handler() {
                if(this.collectionItemToEdit) {
                    this.updateCollectionItem(this.collectionItemToEdit)
                }
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
        async updateCollectionItem(collectionItem) {
            const result = await this.$store.dispatch('updateCollectionItem', {
                collectionId: collectionItem._id,
                name: collectionItem.name,
                parentId: collectionItem.parentId,
                headers: structuredClone(toRaw(collectionItem.headers)),
                authentication: structuredClone(toRaw(collectionItem.authentication)),
            })

            if(result.error) {
                return
            }
        },
    }
}
</script>
