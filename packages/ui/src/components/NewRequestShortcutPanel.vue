<template>
    <div class="outer-container">
        <div class="inner-container">
            <div class="workspace-overview">
                <img src="/favicon.png" alt="Restfox Logo" class="logo" />
            </div>

            <div class="create-request">
                <p>Create a new request</p>
                <div class="icons">
                    <img :src="`images/${constants.REQUESTS[key].type}-icon.png`" :alt="constants.REQUESTS[key].alt" :title="constants.REQUESTS[key].title" @click="createRequest(constants.REQUESTS[key].type)" v-for="key in Object.keys(constants.REQUESTS)">
                </div>
            </div>
        </div>
    </div>
    <AddRequestModal v-model:showModal="addRequestModalShow" :parent-id="addRequestModalParentId" />
    <AddGraphQLRequestModal v-model:showModal="addGraphQLRequestModalShow" :parent-id="addRequestModalParentId" />
    <AddSocketModal v-model:showModal="addSocketModalShow" :parent-id="addSocketModalParentId" />
</template>

<script>
import AddRequestModal from '@/components/modals/AddRequestModal.vue'
import AddGraphQLRequestModal from '@/components/modals/AddGraphQLRequestModal.vue'
import AddSocketModal from '@/components/modals/AddSocketModal.vue'
import constants from '@/constants'

export default {
    computed: {
        constants() {
            return constants
        }
    },
    data() {
        return {
            addRequestModalShow: false,
            addRequestModalParentId: null,
            addGraphQLRequestModalShow: false,
            addSocketModalShow: false,
            addSocketModalParentId: null,
        }
    },
    components: {
        AddSocketModal,
        AddGraphQLRequestModal,
        AddRequestModal
    },
    methods: {
        createRequest(type) {
            if(type === constants.REQUESTS.http.type) {
                this.addRequestModalParentId = this.activeSidebarItemForContextMenu ? this.activeSidebarItemForContextMenu._id : null
                this.addRequestModalShow = true
            }
            if(type === constants.REQUESTS.graphql.type) {
                this.addGraphQLRequestModalShow = this.activeSidebarItemForContextMenu ? this.activeSidebarItemForContextMenu._id : null
                this.addGraphQLRequestModalShow = true
            }

            if(type === constants.REQUESTS.websocket.type) {
                this.addRequestModalParentId = this.activeSidebarItemForContextMenu ? this.activeSidebarItemForContextMenu._id : null
                this.addSocketModalShow = true
            }
        }
    }
}
</script>

<style scoped>
.outer-container {
    display: grid;
    place-items: center;
    width: 100%;
}

.inner-container {
    text-align: center;
}

.workspace-overview {
    margin-bottom: 20px;
}

.logo {
    width: 250px;
    height: 250px;
    background-color: var(--background-color);
    margin-bottom: 10px;
}

.create-request p {
    margin-bottom: 10px;
}

.icons {
    display: flex;
    justify-content: center;
}

.icons img {
    width: 3rem;
    height: 3rem;
    margin: 0 10px;
    cursor: pointer;
    background: var(--background-color);
}

.icons img:hover {
    color: var(--default-border-color);
}
</style>
