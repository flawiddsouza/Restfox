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
                        @tagClick="onTagClick"
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
                        @tagClick="onTagClick"
                    />
                </div>
                <InfoTip />
            </div>
        </div>

        <div style="padding-bottom: 1rem"></div>

        <EditTagModal
            v-if="editTagModalShow"
            v-model:showModal="editTagModalShow"
            :parsed-func="editTagParsedFunc"
            :update-func="editTagUpdateFunc"
        />
    </div>
</template>

<script>
import { resolveEnvironmentForRequest } from '@/utils/environment'
import RequestPanelHeaders from '@/components/RequestPanelHeaders.vue'
import RequestPanelAuth from '@/components/RequestPanelAuth.vue'
import EditTagModal from '@/components/modals/EditTagModal.vue'
import { deepClone } from '@/helpers'
import { toRaw } from 'vue'
import { setOAuthTokens } from '@/utils/oauth-tokens'

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
        EditTagModal,
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
            editTagModalShow: false,
            editTagParsedFunc: null,
            editTagUpdateFunc: null,
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
                // not reactive, read only by takeOAuthTokens
                this.collectionItemToEditFrom = toRaw(this.collectionItem)
            }
        },
        collectionItemToEdit: {
            deep: true,
            handler() {
                if(this.collectionItemToEdit) {
                    this.updateCollectionItem(this.collectionItemToEdit)
                }
            }
        },
        'collectionItem.authentication.token'() {
            this.takeOAuthTokens()
        },
        'collectionItem.authentication.refreshToken'() {
            this.takeOAuthTokens()
        },
    },
    methods: {
        // the tokens of a Get Token or Refresh Token reply, which the store sets on the folder's objects, not on this copy
        // the panel edits, whichever panel the click came from. Only into a copy of the object given now: when another
        // folder is opened, or a reload replaces this one, the copy is made again, and these watchers can run first.
        // And only a folder's: the panel stays mounted, hidden, while a request is shown, and its copy of that request,
        // never edited, would otherwise save the request's old auth
        takeOAuthTokens() {
            const saved = this.collectionItem?.authentication
            const edited = this.collectionItemToEdit?.authentication
            if(toRaw(this.collectionItem) !== this.collectionItemToEditFrom || this.collectionItem?._type !== 'request_group' || saved?.type !== 'oauth2' || edited?.type !== 'oauth2') {
                return
            }
            setOAuthTokens(edited, { token: saved.token, refreshToken: saved.refreshToken ?? null })
        },
        async loadEnvVariables() {
            const load = {}
            this.envLoad = load
            const isCurrent = () => this.envLoad === load
            try {
                if(this.collectionItem) {
                    const request = JSON.parse(JSON.stringify(this.collectionItem))
                    const { environment } = await resolveEnvironmentForRequest(this.$store, request, 'display', { includeSelf: true, noError: true, responseTagErrors: 'placeholder' })
                    if(isCurrent()) {
                        this.envVariables = environment
                    }
                }
            } catch (error) {
                if(isCurrent()) {
                    console.error('Error loading environment variables:', error)
                }
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
        onTagClick(parsedFunc, updateFunc) {
            this.editTagParsedFunc = parsedFunc
            this.editTagUpdateFunc = updateFunc
            this.editTagModalShow = true
        },
    }
}
</script>
