/* eslint-env node, mocha */
'use strict'

const assert = require('assert')
const Pool = require('../src/pool.js').Pool

describe('Pool', () => {
    let i = 0
    const pool = new Pool(3, () => {
        i += 1
        return {
            backlog: i + 5 % 3,
            i: i
        }
    })

    it('Should be idempotent', () => {
        assert.strictEqual(pool.get().i, 1)
        assert.strictEqual(pool.get().i, 1)
    })

    it('Should select the element with the smallest backlog', () => {
        pool.pool[0].backlog += 3
        assert.strictEqual(pool.get().i, 2)

        pool.pool[0].backlog -= 2
        assert.strictEqual(pool.get().i, 1)

        pool.pool[2].backlog -= 2
        assert.strictEqual(pool.get().i, 3)
    })
})
