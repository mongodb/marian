/* eslint-env node, mocha */
'use strict'

const assert = require('assert')
const TaskWorker = require('../src/TaskWorker.js').TaskWorker
TaskWorker.MIN_RESTART_INTERVAL = 200
TaskWorker.MIN_RESTART_TIMEOUT = 10
TaskWorker.MAX_RESTART_TIMEOUT = 10

function promiseTimeout(time) {
    return new Promise(resolve => setTimeout(resolve, time))
}

describe('TaskWorker', function() {
    this.slow(1000)

    const workerPath = 'test/worker.js'
    const worker = new TaskWorker(workerPath)

    it('Should work', async () => {
        assert.equal((await worker.send('ping')).message, 'pong')
        assert.equal((await worker.send('ping')).message, 'pong')
    })

    it('Should restart and reject stale requests', async () => {
        await promiseTimeout(200)
        await assert.rejects(async () => await worker.send('die'), new Error('Worker terminated'))
        await promiseTimeout(50)
        assert.equal((await worker.send('ping')).message, 'pong')
    })

    it('Should avoid restarting too much', async () => {
        assert.strictEqual(worker.dead, false)
        await assert.rejects(async () => await worker.send('die'), new Error('Worker terminated'))
        await promiseTimeout(10)
        await assert.rejects(async () => await worker.send('ping'), new Error('Worker not running'))
        assert.strictEqual(worker.dead, true)
    })

    after(() => {
        worker.stop()
    })
})
