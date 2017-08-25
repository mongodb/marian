/* eslint-env node, mocha */
'use strict'

const assert = require('assert')
const Query = require('../src/fts/query.js').Query

describe('Query', () => {
    it('should parse a single term', () => {
        const query = (new Query('foo'))
        assert.deepStrictEqual(query.terms, new Set(['foo']))
        assert.deepStrictEqual(query.phrases, [])
    })

    it('should delimit terms with any standard whitespace characters', () => {
        const query = (new Query('foo   \t  bar'))
        assert.deepStrictEqual(query.terms, new Set(['foo', 'bar']))
        assert.deepStrictEqual(query.phrases, [])
    })

    it('should parse multi-word phrases', () => {
        const query = (new Query('foo "one phrase" bar "second phrase"'))
        assert.deepStrictEqual(query.terms, new Set(['foo', 'one', 'phrase', 'bar', 'second']))
        assert.deepStrictEqual(query.phrases, ['one phrase', 'second phrase'])
    })

    it('should handle adjacent phrases', () => {
        const query = (new Query('"introduce the" "officially supported"'))
        assert.deepStrictEqual(query.terms, new Set(['introduce', 'the', 'officially', 'supported']))
        assert.deepStrictEqual(query.phrases, ['introduce the', 'officially supported'])
        assert.deepStrictEqual(query.stemmedPhrases, [['introduc'], ['offici', 'support']])
    })

    it('should handle a phrase fragment as a single phrase', () => {
        const query = (new Query('"officially supported'))
        assert.deepStrictEqual(query.terms, new Set(['officially', 'supported']))
        assert.deepStrictEqual(query.phrases, ['officially supported'])
    })

    describe('#checkPhrases', () => {
        it('should match phrases with adjacent words', () => {
            const query = (new Query('"Quoth the raven"'))
            const tokenPositions = new Map([
                ['quoth', [0, 5]],
                ['raven', [8, 1]]])
            assert.ok(query.checkPhrases(tokenPositions))
        })

        it('should refuse phrases without adjacent words', () => {
            const query = (new Query('"Quoth the raven"'))
            const tokenPositions = new Map([
                ['quoth', [0, 3]],
                ['raven', [2, 5]]])
            assert.ok(!query.checkPhrases(tokenPositions))
        })
    })
})
