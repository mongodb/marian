'use strict'

require('process').title = 'marian-worker'
const pathModule = require('path')

const dictionary = require('dictionary-en-us')
const nspell = require('nspell')
const Query = require(pathModule.join(__dirname, './src/fts/Query.js')).Query
const fts = require(pathModule.join(__dirname, './src/fts/fts.js'))

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
    if (parsedQuery.terms.size > MAXIMUM_TERMS) {
        throw new Error('query-too-long')
    }

    if (searchProperties.length) {
        const properties = new Set(searchProperties)
        parsedQuery.filter = (_id) => properties.has(documents[_id].searchProperty)
    } else {
        parsedQuery.filter = (_id) => documents[_id].includeInGlobalSearch === true
    }

    let rawResults = index.search(parsedQuery).slice(0, 100)

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

    rawResults = rawResults.map((match) => {
        const doc = documents[match._id]
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
            return words.has(w.split('/', 1)[0])
        })
        const newSpelling = nspell(dict.aff, newWords.join('\n'))
        for (const word of words) {
            newSpelling.add(word)
        }

        spelling = newSpelling
    })
}

function sync(manifests) {
    const newIndex = new fts.FTSIndex({
        text: 1,
        headings: 3,
        title: 10
    })

    newIndex.correlateWord('regexp', 'regex', 0.6)
    newIndex.correlateWord('regular', 'regex', 0.4)
    newIndex.correlateWord('expression', 'regex', 0.25)
    newIndex.correlateWord('ip', 'address', 0.1)
    newIndex.correlateWord('join', 'lookup', 0.6)
    newIndex.correlateWord('least', 'min', 0.6)

    const words = new Set()
    const newDocuments = Object.create(null)
    let id = 0
    for (const manifest of manifests) {
        for (const doc of manifest.documents) {
            const weight = doc.weight || 1
            newIndex.add({
                _id: id,
                weight: weight,
                text: doc.text,
                headings: (doc.headings || []).join(' '),
                title: doc.title}, (word) => words.add(word))

            newDocuments[id] = {
                title: doc.title,
                preview: doc.preview,
                url: doc.url,
                searchProperty: manifest.searchProperty,
                includeInGlobalSearch: manifest.includeInGlobalSearch
            }

            id += 1
        }
    }

    setupSpellingDictionary(words)
    index = newIndex
    documents = newDocuments
}

self.onmessage = function(event) {
    const message = event.data.message
    const messageId = event.data.messageId

    try {
        if (message.search !== undefined) {
            const properties = (message.search.searchProperty || '').split(',').filter((x) => x)
            const results = search(message.search.queryString, properties)
            self.postMessage({results: results, messageId: messageId})
        } else if (message.sync !== undefined) {
            sync(message.sync)
            self.postMessage({ok: true, messageId: messageId})
        } else {
            throw new Error('Unknown command')
        }
    } catch (err) {
        self.postMessage({error: err.message, messageId: messageId})
    }
}
