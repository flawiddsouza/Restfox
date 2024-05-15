<template>
    <div>
        <button @click="fetchTimelineData">Fetch Timeline Data</button>

        <div v-if="isLoading">Loading...</div>
        <div v-else-if="timelineData.length > 0">
            <h2>Timeline</h2>
            <ul>
                <li v-for="event in timelineData" :key="event.id">
                    <strong>{{ event.timestamp }}</strong>: {{ event.description }}
                </li>
            </ul>
        </div>
        <div v-else>
            <p>No timeline data available</p>
        </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            isLoading: false,
            timelineData: [],
        }
    },
    methods: {
        async fetchTimelineData() {
            this.isLoading = true
            try {
                // Make fetch request to fetch timeline data
                const response = await fetch('https://httpbin.org/get')
                if (!response.ok) {
                    throw new Error('Failed to fetch timeline data')
                }
                const data = await response.json()
                console.log(data)
                this.timelineData = data // Assuming data is an array of timeline events
            } catch (error) {
                console.error('Error fetching timeline data:', error)
                // Handle error
            } finally {
                this.isLoading = false
            }
        },
    },
}
</script>
