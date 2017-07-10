/* eslint-env node, mocha */
'use strict'

const assert = require('assert')
const Query = require('../src/query.js').Query

describe('Query', () => {
    it('should parse a single term', () => {
        const query = (new Query('foo'))
        assert.deepStrictEqual(query.terms, ['foo'])
        assert.deepStrictEqual(query.phrases, [])
    })

    it('should delimit terms with any standard whitespace characters', () => {
        const query = (new Query('foo   \t  bar'))
        assert.deepStrictEqual(query.terms, ['foo', 'bar'])
        assert.deepStrictEqual(query.phrases, [])
    })

    it('should parse multi-word phrases', () => {
        const query = (new Query('foo "one phrase" bar "second phrase"'))
        assert.deepStrictEqual(query.terms, ['foo', 'one', 'phrase', 'bar', 'second', 'phrase'])
        assert.deepStrictEqual(query.phrases, ['one phrase', 'second phrase'])
    })

    it('should handle adjacent phrases', () => {
        const query = (new Query('"introduce the" "officially supported"'))
        assert.deepStrictEqual(query.terms, ['introduce', 'the', 'officially', 'supported'])
        assert.deepStrictEqual(query.phrases, ['introduce the', 'officially supported'])
    })

    it('should handle a phrase fragment as a single phrase', () => {
        const query = (new Query('"officially supported'))
        assert.deepStrictEqual(query.terms, ['officially', 'supported'])
        assert.deepStrictEqual(query.phrases, ['officially supported'])
    })
})
