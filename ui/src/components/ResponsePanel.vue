<template>
    <div class="loading-overlay" v-if="status === 'loading'">
        <h2 style="font-variant-numeric: tabular-nums; font-weight: 500">Loading...</h2>
        <div class="pad">
            <i class="fas fa-sync fa-spin"></i>
        </div>
        <div class="pad">
            <button class="btn btn--clicky">Cancel Request</button>
        </div>
    </div>
    <div v-else>
        {{ response }}
    </div>
</template>


<script>
export default {
    data() {
        return {
            requestPanelTabs: [
                {
                    name: 'Body'
                },
                {
                    name: 'Query'
                },
                {
                    name: 'Header'
                }
            ],
            activeRequestPanelTab: 'Body',
            methods: [
                'GET',
                'POST',
                'PUT',
                'PATCH',
                'DELETE',
                'OPTIONS',
                'HEAD'
            ]
        }
    },
    computed: {
        activeTab() {
            return this.$store.state.activeTab
        },
        status() {
            if(this.activeTab && this.activeTab._id in this.$store.state.requestResponseStatus) {
                return this.$store.state.requestResponseStatus[this.activeTab._id]
            }

            return 'not loaded'
        },
        response() {
            if(this.activeTab && this.activeTab._id in this.$store.state.requestResponses) {
                return this.$store.state.requestResponses[this.activeTab._id]
            }

            return null
        }
    },
    methods: {
        cancelRequest() {
            // this.$store.commit('cancelRequest', this.activeTab)
        }
    }
}
</script>

<style scoped>
.loading-overlay {
    background-color: #29292969;
    color: #292929;
    opacity: 1;
    transition: opacity 200ms ease-out;
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    bottom: 0;
    z-index: 9;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    text-align: center;
}

.loading-overlay .pad {
    padding: calc(1rem * 1.2);
}

.loading-overlay .fas {
    font-size: 4rem;
}
</style>
