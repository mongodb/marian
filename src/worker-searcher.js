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
 * Return true if there is a configuration of numbers in the tree that
 * appear in sequential order.
 * @param {Array<Array<number>>} tree
 * @param {number|undefined} lastCandidate
 * @return {boolean}
 */
function haveContiguousPath(tree, lastCandidate) {
    if (tree.length === 0) {
        return true
    }

    for (const element of tree[0]) {
        if (lastCandidate === undefined || element === lastCandidate + 1) {
            if (haveContiguousPath(tree.slice(1), element)) {
                return true
            }
        }
    }

    return false
}

/**
 * Check if the given phraseComponents appear in contiguous positions
 * within the keywords map.
 * @param {Array<string>} phraseComponents
 * @param {Map<string, Array<number>} keywords
 * @return {boolean}
 */
function haveContiguousKeywords(phraseComponents, keywords) {
    const path = []
    for (const component of phraseComponents) {
        if (!lunr.stopWordFilter(component)) { continue }
        const stemmed = lunr.stemmer(new lunr.Token(component)).str
        const positions = keywords.get(stemmed)
        if (positions === undefined) {
            return false
        }
        path.push(positions)
    }

    return haveContiguousPath(path)
}

/**
 * Return true if the exact phrases in the query appear in ANY of the fields
 * appearing in the match.
 * @param {Query} query
 * @param {array<string>} fields
 * @param {lunr.MatchData} match
 * @return {boolean}
 */
function checkPhrases(query, fields, match) {
    for (const phrase of query.phrases) {
        const parts = phrase.split(/\W+/)
        let haveMatch = false

        for (const field of fields) {
            const keywordPositions = new Map()
            for (const keyword of Object.keys(match.matchData.metadata)) {
                const metadata = match.matchData.metadata[keyword][field]
                if (!metadata) { continue }
                const positions = metadata.pos
                keywordPositions.set(keyword, positions)
            }

            if (haveContiguousKeywords(parts, keywordPositions)) {
                haveMatch = true
                break
            }
        }

        if (!haveMatch) { return false }
    }

    return true
}

/**
 * Search the index, and return results within the given searchProperty.
 * @param {string} queryString The query string.
 * @param {string} searchProperty The property to search. If empty, all results are returned.
 */
function search(queryString, searchProperty) {
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

        if (searchProperty) {
            query.term(searchProperty, {usePipeline: false, fields: ['searchProperty']})
        }
    })

    if (searchProperty) {
        rawResults = rawResults.filter((match) => {
            return documents[match.ref].searchProperty === searchProperty
        })
    } else {
        rawResults = rawResults.filter((match) => {
            return documents[match.ref].includeInGlobalSearch === true
        })
    }

    if (parsedQuery.phrases.length > 0) {
        rawResults = rawResults.filter((match) => {
            return checkPhrases(parsedQuery, ['title', 'text'], match)
        })
    }

    rawResults = rawResults.slice(0, 100)

    // If our results seem poor in quality, check if the query is misspelled
    const misspelled = {}
    if (spelling !== null && (rawResults.length === 0 || rawResults[0].score <= 0.4)) {
        for (const term of parsedQuery.terms) {
            const suggestions = spelling.suggest(term)
            if (suggestions.length > 0) {
                misspelled[term] = suggestions[0]
            }
        }
    }

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
            const results = search(message.search.queryString, message.search.searchProperty)
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
