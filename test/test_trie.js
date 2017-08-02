/* eslint-env node, mocha */
'use strict'

const assert = require('assert')
const Trie = require('../src/fts/Trie.js').Trie

describe('Trie', () => {
    const trie = new Trie()

    it('Should be idempotent', () => {
        trie.insert('foobar', 0)
        trie.insert('foobar', 0)

        assert.deepStrictEqual(
            trie.search('foobar', true),
            new Map([[0, new Set(['foobar'])]]))

        assert.deepStrictEqual(
            trie.search('foobar', false),
            new Map([[0, new Set(['foobar'])]]))
    })

    it('Should be additive', () => {
        trie.insert('foobar', 1)

        assert.deepStrictEqual(
            trie.search('foobar', true),
            new Map([[0, new Set(['foobar'])], [1, new Set(['foobar'])]]))

        assert.deepStrictEqual(
            trie.search('foobar', false),
            new Map([[0, new Set(['foobar'])], [1, new Set(['foobar'])]]))
    })

    it('Should handle prefix matching', () => {
        trie.insert('foobaz', 0)

        assert.deepStrictEqual(
            trie.search('foo', true),
            new Map([
                [0, new Set(['foobar', 'foobaz'])],
                [1, new Set(['foobar'])]]))

        assert.deepStrictEqual(
            trie.search('foo', false),
            new Map())
    })
})
