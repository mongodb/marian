/* eslint-env node, mocha */
'use strict'

const assert = require('assert')
const Pool = require('../src/pool.js').Pool

describe('Pool', () => {
    let i = 0
    const pool = new Pool(3, () => {
        i += 1
        return {
            backlog: i,
            i: i
        }
    })

    it('Should be idempotent', () => {
        assert.strictEqual(pool.get().i, 1)
        assert.strictEqual(pool.get().i, 1)
    })

    it('Should select the unsuspended element with the smallest backlog', () => {
        assert.deepStrictEqual(pool.getStatus(), [1, 2, 3])

        pool.pool[0].backlog += 3
        const x = pool.get()
        assert.strictEqual(x.i, 2)
        pool.suspend(x)
        assert.deepStrictEqual(pool.getStatus(), [4, 's', 3])
        assert.strictEqual(pool.get().i, 3)
        pool.resume(x)
        assert.deepStrictEqual(pool.getStatus(), [4, 2, 3])
        assert.strictEqual(pool.get().i, 2)

        pool.pool[0].backlog -= 2
        assert.strictEqual(pool.get().i, 1)

        pool.pool[2].backlog -= 2
        assert.strictEqual(pool.get().i, 3)
    })

    it('Should throw if no elements are available', () => {
        for (const worker of pool) {
            pool.suspend(worker)
        }

        assert.throws(() => {
            pool.get()
        }, /pool-unavailable/)
    })
})
