'use strict'

require('process').title = 'marian-worker'
const pathModule = require('path')

const dictionary = require('dictionary-en-us')
const lunr = require('lunr')
const nspell = require('nspell')
const Query = require(pathModule.join(__dirname, './src/query.js')).Query

const MAXIMUM_TERMS = 10

let spelling = null
let index = null
let documents = {}

/**
 * Search the index, and return results within the given searchProperty.
 * @param {string} queryString The query string.
 * @param {[string]} searchProperties The properties to search. If empty, all results are returned.
 * @return {{results: [{title: String, preview: String, url: String}], spellingCorrections: Object}}
 */
function search(queryString, searchProperties) {
    if (!index) {
        throw new Error('still-indexing')
    }

    const parsedQuery = new Query(queryString)
    if (parsedQuery.terms.length > MAXIMUM_TERMS) {
        throw new Error('query-too-long')
    }

    let rawResults = index.query((query) => {
        for (const term of parsedQuery.terms) {
            query.term(term, {usePipeline: true, boost: 100})
            query.term(term, {usePipeline: false, boost: 10, wildcard: lunr.Query.wildcard.TRAILING})
            query.term(term, {usePipeline: false, boost: 1, editDistance: 1})
        }
    })

    if (searchProperties.length) {
        const properties = new Set(searchProperties)
        rawResults = rawResults.filter((match) => {
            return properties.has(documents[match.ref].searchProperty)
        })
    } else {
        rawResults = rawResults.filter((match) => {
            return documents[match.ref].includeInGlobalSearch === true
        })
    }

    if (parsedQuery.phrases.length > 0) {
        rawResults = rawResults.filter((match) => {
            return parsedQuery.checkPhrases(['title', 'text'], match)
        })
    }

    rawResults = rawResults.slice(0, 100)

    // If our results seem poor in quality, check if the query is misspelled
    const misspelled = {}
    if (spelling !== null && (rawResults.length === 0 || rawResults[0].score <= 0.6)) {
        for (const term of parsedQuery.terms) {
            const suggestions = spelling.suggest(term)
            if (suggestions.length > 0) {
                misspelled[term] = suggestions[0]
            }
        }
    }

    // Apply weightings AFTER we slice out the first 100 and check spelling. We
    // want this to be cheap and have minimal impact on anything except order.
    for (const match of rawResults) {
        const doc = documents[match.ref]
        if (doc.weight !== undefined) {
            match.score *= doc.weight
        }
    }
    rawResults = rawResults.sort((a, b) => {
        if (a.score > b.score) {
            return -1
        }

        if (a.score < b.score) {
            return 1
        }

        return 0
    })

    rawResults = rawResults.map((match) => {
        const doc = documents[match.ref]
        return {
            title: doc.title,
            preview: doc.preview,
            url: doc.url
        }
    })

    return {
        results: rawResults,
        spellingCorrections: misspelled
    }
}

function setupSpellingDictionary(words) {
    dictionary((err, dict) => {
        if (err) {
            console.error(err)
        }

        const newWords = dict.dic.utf8Slice().split('\n').filter((w) => {
            return Object.prototype.hasOwnProperty.call(words, w.split('/', 1))
        })
        const newSpelling = nspell(dict.aff, newWords.join('\n'))
        for (const word of words) {
            newSpelling.add(word)
        }

        spelling = newSpelling
    })
}

self.onmessage = function(event) {
    const message = event.data.message
    const messageId = event.data.messageId

    try {
        if (message.search !== undefined) {
            const properties = (message.search.searchProperty || '').split(',')
            const results = search(message.search.queryString, properties)
            self.postMessage({results: results, messageId: messageId})
        } else if (message.sync !== undefined) {
            documents = message.sync.documents
            index = lunr.Index.load(message.sync.index)
            setupSpellingDictionary(message.sync.words)
            self.postMessage({ok: true, messageId: messageId})
        } else {
            throw new Error('Unknown command')
        }
    } catch (err) {
        self.postMessage({error: err.message, messageId: messageId})
    }
}
