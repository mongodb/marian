'use strict'

require('chai').should()
const Query = require('../src/query.js').Query

let query = (new Query('foo'))
query.terms.should.have.all.members(['foo'])
query.phrases.should.have.all.members([])

query = (new Query('foo   \t  bar'))
query.terms.should.have.all.members(['foo', 'bar'])
query.phrases.should.have.all.members([])

query = (new Query('foo "one phrase" bar "second phrase"'))
query.terms.should.have.all.members(['foo', 'one', 'phrase', 'bar', 'second', 'phrase'])
query.phrases.should.have.all.members(['one phrase', 'second phrase'])

query = (new Query('"introduce the" "officially supported"'))
query.terms.should.have.all.members(['introduce', 'the', 'officially', 'supported'])
query.phrases.should.have.all.members(['introduce the', 'officially supported'])

// Query fragment
query = (new Query('"officially supported'))
query.terms.should.have.all.members(['officially', 'supported'])
query.phrases.should.have.all.members(['officially supported'])
