/* eslint-env node, mocha */
'use strict'

const assert = require('assert')
const fs = require('fs')
const promisify = require('util').promisify
const {tokenize, stem} = require('../src/fts/Stemmer.js')

describe('Stemmer', () => {
    describe('#tokenize', () => {
        it('should split on whitespace', () => {
            assert.deepStrictEqual(tokenize('The qUick \tbrown\n\n\t fox'), ['the', 'quick', 'brown', 'fox'])
        })

        it('should handle code somewhat coherently', () => {
            assert.deepStrictEqual(
                tokenize('db.scores.find(\n   { results: { $elemMatch: { $gte: 80, $lt: 85 } } }\n)'),
                ['db', 'scores', 'find', 'results', '$elemmatch', '$gte', '80', '$lt', '85'])
        })

        it('should tokenize atomic phrases', () => {
            assert.deepStrictEqual(
                tokenize('ops manager configuration'),
                ['ops manager', 'configuration'])
            assert.strictEqual(stem('ops manager'), 'ops manager')
        })

        it('should pass the porter2 test vector', async function() {
            this.slow(250)

            const text = await promisify(fs.readFile)('test/stemmed-corpus.txt', {encoding: 'utf-8'})
            const lines = text.split('\n')
            for (let line of lines) {
                line = line.trim()
                if (!line) { continue }
                const [word, correctStemmed] = line.split(/\s+/, 2)
                const stemmed = stem(word)
                assert.strictEqual(stemmed, correctStemmed)
            }
        })
    })
})
