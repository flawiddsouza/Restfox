module.exports = class TaskQueue {
    constructor() {
        this.queue = []
        this.running = false
    }

    async runNext() {
        if (this.running || this.queue.length === 0) {
            return
        }
        this.running = true
        const {task, resolve, reject} = this.queue.shift()
        try {
            const result = await task()
            resolve(result)
        } catch (error) {
            reject(error)
            console.error('Error executing task', error)
        } finally {
            this.running = false
            this.runNext()
        }
    }

    enqueue(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({task, resolve, reject})
            this.runNext()
        })
    }
}
