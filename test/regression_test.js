#!/usr/bin/env node
/* eslint-env node, mocha */
'use strict'

const assert = require('assert')
const process = require('process')

const testUtil = require('./util.js')

async function search(query, port) {
    const result = await testUtil.request(`http://localhost:${port}/search?q=${encodeURIComponent(query)}&searchProperty=manual-current`)
    assert.strictEqual(result.response.statusCode, 200)
    assert.strictEqual(result.response.headers['content-type'], 'application/json')
    return result.json.results
}

describe('regression', function() {
    this.slow(120000)

    let ctx = null

    before('starting server', function(done) {
        ctx = testUtil.startServer('bucket:docs-mongodb-org-prod/search-indexes/', done)
    })

    it('should be relevant for "find"', async () => {
        const result = (await search('find', ctx.port))[0].url
        assert.strictEqual(result, 'https://docs.mongodb.com/manual/reference/method/db.collection.find/index.html')
    })

    it('should be relevant for "mongod.conf"', async () => {
        const result = (await search('mongod.conf', ctx.port))[0].url
        assert.strictEqual(result, 'https://docs.mongodb.com/manual/reference/configuration-options/index.html')
    })

    it('should be relevant for "$in"', async () => {
        const results = (await search('$in', ctx.port)).slice(0, 2).map((d) => d.url).sort()
        assert.deepStrictEqual(results, [
            'https://docs.mongodb.com/manual/reference/operator/aggregation/in/index.html',
            'https://docs.mongodb.com/manual/reference/operator/query/in/index.html'])

        const results2 = (await search('in', ctx.port)).slice(0, 2).map((d) => d.url).sort()
        assert.deepStrictEqual(results, results2)
    })

    after('shutting down', function() {
        process.kill(ctx.child.pid, 'SIGINT')
    })
})
