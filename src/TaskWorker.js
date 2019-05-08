'use strict'

const Worker = require('tiny-worker')
const log = require('./log').log

const MAXIMUM_BACKLOG = 20

/** A web worker with a promise-oriented message-call interface. */
class TaskWorker {
    /**
     * Create a new TaskWorker.
     * @param {string} scriptPath - A path to a JS file to execute.
     */
    constructor(scriptPath) {
        this.scriptPath = scriptPath
        this.backlog = 0
        this.pending = new Map()
        this.messageId = 0
        this.lastStarted = null
        this.dead = false
        this.worker = null
        this.start()
    }

    /**
     * Send a message to this TaskWorker.
     * @param {map} message - An object to send to the worker.
     * @return {Promise}
     */
    send(message) {
        if (this.backlog > MAXIMUM_BACKLOG) {
            throw new Error('backlog-exceeded')
        }

        if (!this.worker) {
            throw new Error('Worker not running')
        }

        return new Promise((resolve, reject) => {
            const messageId = this.messageId
            this.messageId += 1
            this.backlog += 1

            this.worker.postMessage({message: message, messageId: messageId})
            this.pending.set(messageId, [resolve, reject])
        })
    }

    /**
     * Handler for messages received from the worker.
     * @private
     * @param {MessageEvent} event
     * @return {Promise<?, Error>}
     */
    onmessage(event) {
        const pair = this.pending.get(event.data.messageId)
        if (!pair) {
            log.error(`Got unknown message ID ${event.data.messageId}`)
            return
        }

        this.backlog -= 1
        this.pending.delete(event.data.messageId)
        const [resolve, reject] = pair
        if (event.data.error) {
            reject(new Error(event.data.error))
            return
        }

        resolve(event.data)
    }

    /**
     * Start the worker process.
     * @return {number}
     */
    start() {
        // Do nothing if the child is still running
        if (this.worker && this.worker.child.connected) {
            return this.worker.child.pid
        }

        // If we died within the past hour, don't restart. Something is wrong
        if (this.lastStarted && ((new Date()) - this.lastStarted) < TaskWorker.MIN_RESTART_INTERVAL) {
            this.dead = true
        }

        if (this.dead) {
            return -1
        }

        const worker = new Worker(this.scriptPath)
        worker.onmessage = this.onmessage.bind(this)
        worker.child.addListener('exit', (code, signal) => {
            log.warning(`Worker exited: code=${code} signal=${signal}`)
            this.stop()

            // Don't restart if graceful or due to SIGINT
            if (code === 0 || signal === 'SIGINT') {
                return
            }

            // Wait a random interval up to a minute before restarting
            // This might help prevent a thundering herd problem
            const randomFactor = (
                TaskWorker.MAX_RESTART_TIMEOUT - TaskWorker.MIN_RESTART_TIMEOUT) +
                TaskWorker.MIN_RESTART_TIMEOUT
            setTimeout(() => this.start(), (Math.random() * randomFactor))
        })


        this.stop()
        this.worker = worker

        this.lastStarted = new Date()
        return this.worker.child.pid
    }

    stop() {
        for (const pair of this.pending.values()) {
            pair[1](new Error('Worker terminated'))
        }

        this.backlog = 0
        this.pending.clear()
        this.messageId = 0

        if (this.worker && this.worker.child.connected) {
            this.worker.terminate()
        }

        this.worker = null
    }
}

// Configurable knobs
// If a restart happens less than this number of ms from the last restart, flag the worker as dead
// Default: 1 hour
TaskWorker.MIN_RESTART_INTERVAL = 1000 * 60 * 60

// We wait a random amount of time before restarting a stopped worker. Default: 1-10 seconds
TaskWorker.MIN_RESTART_TIMEOUT = 1000
TaskWorker.MAX_RESTART_TIMEOUT = 1000 * 9

exports.TaskWorker = TaskWorker
