#!/usr/bin/env node
/* eslint-env node, mocha */
'use strict'

const assert = require('assert')
const fs = require('fs')
const { URL } = require('url')
const process = require('process')
const testUtil = require('./util.js')

const MANIFEST_SOURCE = process.env.MANIFEST_SOURCE
if (!MANIFEST_SOURCE) {
    throw new Error('Missing manifest source')
}

// https://en.wikipedia.org/wiki/Discounted_cumulative_gain
function computeDcg(relevancies) {
    let result = 0
    for (let i = 0; i < relevancies.length; i += 1) {
        result += (Math.pow(2, relevancies[i]) - 1) / Math.log2(i + 2)
    }

    return result
}

async function search(query, port) {
    const result = await testUtil.request(`http://localhost:${port}/search?q=${encodeURIComponent(query)}&searchProperty=manual-current`)
    assert.strictEqual(result.response.statusCode, 200)
    assert.strictEqual(result.response.headers['content-type'], 'application/json')
    return result.json.results
}

async function computeScore(queries, port) {
    let total = 0.0
    let min = Infinity
    const entries = Object.entries(queries)
    for (const [query, scores] of entries) {
        const results = (await search(query, port)).slice(0, 5).map((result) => {
            return new URL(result.url).pathname.replace(/^\/manual\//, '').replace(/\/(?:index.html)?$/, '')
        })

        const relevancyList = results.map((pathname) => {
            if (scores[pathname] !== undefined) {
                return scores[pathname]
            }

            console.error(`Unknown result: "${pathname}" for query: "${query}"`)
            return 0
        })

        const idealizedRelevancyList = Object.values(scores).filter(x => x > 0).sort()
        const dcg = computeDcg(relevancyList)
        const idealizedDcg = computeDcg(idealizedRelevancyList)
        const normalizedDcg = dcg / idealizedDcg
        total += normalizedDcg
        if (normalizedDcg < min) {
            min = normalizedDcg
        }

        if (normalizedDcg === 0) {
            console.warn(`Nothing relevant found in the top 5 results for "${query}"`)
        }
    }

    return [min, total / entries.length]
}

describe('regression', function() {
    this.slow(120000)

    let ctx = null

    before('starting server', function(done) {
        ctx = testUtil.startServer(MANIFEST_SOURCE, done)
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

    it('should not reduce relevancy score', async () => {
        const queries = fs.readFileSync('test/queries.json')
        const [minScore, meanScore] = await computeScore(JSON.parse(queries), ctx.port)
        console.log(`Minimum nDCG@5: ${minScore}`)
        console.log(`Mean    nDCG@5: ${meanScore}`)
        assert(meanScore > 0.56)
    })

    after('shutting down', function() {
        process.kill(ctx.child.pid, 'SIGINT')
    })
})
