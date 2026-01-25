<template>
    <modal v-if="showModalComp" title="Collection Runner" v-model="showModalComp" width="600px">
        <div class="runner-progress">
            <!-- Progress Header -->
            <div class="progress-header">
                <div class="progress-stats">
                    <span v-if="totalIterations > 1" class="stat-item">
                        <strong>Iteration {{ currentIteration }}</strong> of {{ totalIterations }}
                    </span>
                    <span class="stat-item">
                        <strong>{{ completedCount }}</strong> / {{ totalRequests }}
                    </span>
                    <span class="stat-item success">
                        ✓ {{ successCount }} passed
                    </span>
                    <span class="stat-item error" v-if="errorCount > 0">
                        ✗ {{ errorCount }} failed
                    </span>
                </div>

                <!-- Progress Bar -->
                <div class="progress-bar-container">
                    <div class="progress-bar" :style="{ width: progressPercentage + '%' }"></div>
                </div>
            </div>

            <!-- Request List -->
            <div class="request-list" ref="requestList">
                <div
                    v-for="(result, index) in results"
                    :key="index"
                    class="request-item"
                    :class="result.status"
                >
                    <div class="request-icon">
                        <i v-if="result.status === 'pending'" class="fa fa-circle-o"></i>
                        <i v-if="result.status === 'running'" class="fa fa-spinner fa-spin"></i>
                        <i v-if="result.status === 'success'" class="fa fa-check-circle"></i>
                        <i v-if="result.status === 'error'" class="fa fa-times-circle"></i>
                    </div>

                    <div class="request-details">
                        <div class="request-name">
                            <span v-if="result.method" class="request-method" :class="'request-method--' + result.method">
                                {{ result.method }}
                            </span>
                            <span class="request-name-text">
                                <span v-if="result.parentPath" class="parent-path">{{ result.parentPath }} /</span>
                                {{ result.requestName }}
                                <span v-if="totalIterations > 1" class="request-iteration">(#{{ result.iteration }})</span>
                            </span>
                        </div>
                        <div v-if="result.url" class="request-url">
                            {{ truncateUrl(result.url) }}
                        </div>
                        <div class="request-meta">
                            <div v-if="result.statusCode" class="tag" :class="getStatusColorClass(result)">
                                <span class="bold">{{ result.statusCode }}</span> {{ getStatusText(result.statusCode) }}
                            </div>
                            <div v-if="result.timeTaken" class="tag">
                                {{ humanFriendlyTime(result.timeTaken) }}
                            </div>
                            <div v-if="result.responseSize" class="tag">
                                {{ humanFriendlySize(result.responseSize) }}
                            </div>
                            <div v-if="result.error" class="request-error">
                                {{ result.error }}
                            </div>
                        </div>
                        <div v-if="result.testResults && result.testResults.length > 0" class="test-details">
                            <div v-for="(test, idx) in result.testResults" :key="idx" class="test-item" :class="{ 'test-passed': test.passed, 'test-failed': !test.passed }">
                                <i :class="test.passed ? 'fa fa-check' : 'fa fa-times'"></i>
                                {{ test.description }}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Time Elapsed -->
            <div class="time-elapsed" v-if="!isComplete">
                Time elapsed: {{ timeElapsed }}
            </div>

            <!-- Summary -->
            <div class="summary" v-if="isComplete">
                <h4>Run Complete</h4>
                <div class="summary-stats">
                    <p>Total: {{ totalRequests }} requests</p>
                    <p class="success">Passed: {{ successCount }}</p>
                    <p class="error" v-if="errorCount > 0">Failed: {{ errorCount }}</p>
                    <p>Total time: {{ totalTime }}</p>
                </div>
            </div>
        </div>

        <template #footer>
            <button v-if="!isComplete" class="button" @click="cancel" type="button">
                Cancel
            </button>
            <template v-if="isComplete">
                <button class="button" @click="rerun" type="button">
                    Rerun
                </button>
                <button class="button" @click="close" type="button" style="margin-left: 1rem;">
                    Close
                </button>
            </template>
        </template>
    </modal>
</template>

<script>
import Modal from '@/components/Modal.vue'
import { mapState } from 'vuex'
import { humanFriendlyTime, humanFriendlySize, getStatusText, responseStatusColorMapping, findItemInTreeById } from '@/helpers'

export default {
    components: { Modal },
    props: {
        showModal: Boolean
    },
    data() {
        return {
            currentTime: Date.now(),
            lastRunningIndex: -1
        }
    },
    computed: {
        ...mapState({
            collectionRunner: state => state.collectionRunner
        }),
        showModalComp: {
            get() {
                return this.showModal
            },
            set(value) {
                // Prevent closing while running
                if (value === false && this.isRunning) {
                    return
                }
                this.$emit('update:showModal', value)
            }
        },
        isRunning() {
            return this.collectionRunner.isRunning
        },
        isComplete() {
            return !this.isRunning && this.results.length > 0
        },
        results() {
            return this.collectionRunner.results || []
        },
        currentIteration() {
            return this.collectionRunner.currentIteration || 1
        },
        totalIterations() {
            return this.collectionRunner.totalIterations || 1
        },
        totalRequests() {
            return this.results.length
        },
        completedCount() {
            return this.results.filter(r => r.status === 'success' || r.status === 'error').length
        },
        successCount() {
            return this.results.filter(r => r.status === 'success').length
        },
        errorCount() {
            return this.results.filter(r => r.status === 'error').length
        },
        progressPercentage() {
            if (this.totalRequests === 0) {
                return 0
            }
            return (this.completedCount / this.totalRequests) * 100
        },
        timeElapsed() {
            if (!this.collectionRunner.startTime) {
                return '0s'
            }
            const elapsed = Math.max(0, Math.floor((this.currentTime - this.collectionRunner.startTime) / 1000))
            return `${elapsed}s`
        },
        totalTime() {
            const total = this.results.reduce((sum, r) => sum + (r.timeTaken || 0), 0)
            return `${(total / 1000).toFixed(2)}s`
        }
    },
    watch: {
        showModal(newVal) {
            if (newVal) {
                this.lastRunningIndex = -1
            }
        },
        'collectionRunner.results': {
            handler(newResults) {
                const runningIndex = newResults.findIndex(r => r.status === 'running')

                // Scroll when a new request starts running
                if (runningIndex !== -1 && runningIndex !== this.lastRunningIndex) {
                    this.scrollToRequest(runningIndex)
                    this.lastRunningIndex = runningIndex
                } else if (runningIndex === -1 && this.lastRunningIndex !== -1) {
                    // Scroll to last completed request when done
                    this.scrollToRequest(this.lastRunningIndex)
                    this.lastRunningIndex = -1
                }
            },
            deep: true
        }
    },
    methods: {
        scrollToRequest(index) {
            this.$nextTick(() => {
                const requestList = this.$refs.requestList
                if (!requestList) {
                    return
                }

                const requestItems = requestList.querySelectorAll('.request-item')
                const item = requestItems[index]
                if (item) {
                    item.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
            })
        },
        humanFriendlyTime,
        humanFriendlySize,
        getStatusText,
        cancel() {
            this.$store.dispatch('cancelCollectionRunner')
        },
        close() {
            this.$store.commit('resetCollectionRunner')
            this.showModalComp = false
        },
        async rerun() {
            const runner = this.collectionRunner

            // Reconstruct the source object
            let source
            if (runner.sourceId === this.$store.state.activeWorkspace._id) {
                // It's a collection run
                source = {
                    _id: runner.sourceId,
                    _type: 'collection',
                    name: runner.sourceName,
                    children: this.$store.state.collectionTree
                }
            } else {
                // It's a folder run - find the folder in the tree
                source = findItemInTreeById(this.$store.state.collectionTree, runner.sourceId)
                if (!source) {
                    this.$toast.error('Cannot find the original folder to rerun')
                    return
                }
            }

            try {
                await this.$store.dispatch('startCollectionRunner', {
                    source,
                    selectedRequests: runner.selectedRequests,
                    iterations: runner.totalIterations,
                    delayMs: runner.delayMs,
                    continueOnError: runner.continueOnError
                })
            } catch (error) {
                this.$toast.error(error.message)
            }
        },
        getStatusColorClass(result) {
            return responseStatusColorMapping({ status: result.statusCode, statusText: result.error || '' })
        },
        truncateUrl(url) {
            try {
                const urlObj = new URL(url)
                const path = urlObj.pathname + urlObj.search
                if (path.length > 50) {
                    return path.substring(0, 47) + '...'
                }
                return path
            } catch {
                return url
            }
        }
    },
    mounted() {
        this.currentTime = Date.now()
        this.timer = setInterval(() => {
            this.currentTime = Date.now()
        }, 1000)
    },
    beforeUnmount() {
        if (this.timer) {
            clearInterval(this.timer)
        }
    }
}
</script>

<style scoped>
.runner-progress {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.progress-header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.progress-stats {
    display: flex;
    gap: 1rem;
    font-size: 0.9em;
    flex-wrap: wrap;
}

.stat-item.success {
    color: var(--base-color-success);
}

.stat-item.error {
    color: var(--base-color-error);
}

.progress-bar-container {
    width: 100%;
    height: 8px;
    background-color: var(--default-border-color);
    border-radius: 4px;
    overflow: hidden;
}

.progress-bar {
    height: 100%;
    background-color: var(--base-color-success);
    transition: width 0.3s ease;
}

.request-list {
    max-height: 400px;
    overflow-y: auto;
    border: 1px solid var(--default-border-color);
    border-radius: 4px;
}

.request-item {
    display: flex;
    align-items: center;
    padding: 0.75rem;
    border-bottom: 1px solid var(--default-border-color);
}

.request-item:last-child {
    border-bottom: none;
}

.request-item.running {
    background-color: var(--sidebar-item-active-color);
}

.request-icon {
    margin-right: 0.75rem;
    width: 20px;
    text-align: center;
}

.request-icon .fa-circle-o {
    color: var(--text-color-secondary);
}

.request-icon .fa-spinner {
    color: var(--text-color);
}

.request-icon .fa-check-circle {
    color: var(--base-color-success);
}

.request-icon .fa-times-circle {
    color: var(--base-color-error);
}

.request-details {
    flex: 1;
}

.request-name {
    font-weight: 500;
    display: flex;
    align-items: center;
}

.request-method {
    min-width: 2.5rem;
    font-size: 0.75rem;
    text-align: left;
}

.request-name-text {
    flex: 1;
    min-width: 0;
}

.parent-path {
    color: var(--text-color-secondary);
    font-weight: normal;
    font-size: 0.9em;
}

.request-iteration {
    font-weight: normal;
    color: var(--text-color-secondary);
    font-size: 0.9em;
}

.request-url {
    color: var(--text-color-secondary);
    margin-top: 0.125rem;
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.request-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    margin-top: 0.25rem;
}

.request-meta .tag {
    padding: 0.2rem 0.6rem;
    white-space: nowrap;
    user-select: none;
}

.request-meta > div:not(:first-child) {
    margin-left: 0.6rem;
}

.request-error {
    color: var(--base-color-error);
}

.test-details {
    margin-top: 0.5rem;
}

.test-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    font-size: 0.9em;
}

.test-item i {
    width: 1rem;
}

.test-item.test-passed {
    color: var(--base-color-success);
}

.test-item.test-failed {
    color: var(--base-color-error);
}

.time-elapsed {
    font-size: 0.9em;
    color: var(--text-color-secondary);
    text-align: center;
}

.summary {
    text-align: center;
    padding: 1rem;
    background-color: var(--background-color);
    border-radius: 4px;
}

.summary h4 {
    margin: 0 0 1rem 0;
}

.summary-stats p {
    margin: 0.5rem 0;
}

.summary-stats .success {
    color: var(--base-color-success);
}

.summary-stats .error {
    color: var(--base-color-error);
}
</style>
