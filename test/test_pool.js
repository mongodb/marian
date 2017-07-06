'use strict'

const expect = require('chai').expect
const Pool = require('../src/pool.js').Pool

let i = 0
const pool = new Pool(3, () => {
    i += 1
    return {
        backlog: i + 5 % 3,
        i: i
    }
})

expect(pool.get().i).is.equal(1)
expect(pool.get().i).is.equal(1)
pool.pool[0].backlog += 3
expect(pool.get().i).is.equal(2)
pool.pool[0].backlog -= 2
expect(pool.get().i).is.equal(1)
pool.pool[2].backlog -= 2
expect(pool.get().i).is.equal(3)
