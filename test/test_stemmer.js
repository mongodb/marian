/* eslint-env node, mocha */
'use strict'

const assert = require('assert')
const {tokenize} = require('../src/fts/Stemmer.js')

describe('Stemmer', () => {
    describe('#tokenize', () => {
        it('should split on whitespace', () => {
            assert.deepStrictEqual(tokenize('The qUick \tbrown\n\n\t fox'), ['the', 'quick', 'brown', 'fox'])
        })

        it('should handle sigils', () => {
            assert.deepStrictEqual(tokenize('The $elemMatch operator'), ['the', 'elemmatch', 'operator'])
        })

        it('should handle code somewhat coherently', () => {
            assert.deepStrictEqual(
                tokenize('db.scores.find(\n   { results: { $elemMatch: { $gte: 80, $lt: 85 } } }\n)'),
                ['db', 'scores', 'find', 'results', 'elemmatch', 'gte', '80', 'lt', '85'])
        })

        it('should skip single-character tokens', () => {
            assert.deepStrictEqual(tokenize('a fox\'s brush'), ['fox', 'brush'])
        })
    })
})
