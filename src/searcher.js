'use strict'

const dictionary = require('dictionary-en-us')
const nspell = require('nspell')
const Query = require('./fts/Query.js').Query
const fts = require('./fts/fts.js')
const correlations = require('./correlations.js').correlations

const MAXIMUM_TERMS = 10

function yieldToEventLoop() {
    return new Promise(resolve => setImmediate(resolve))
}

class Searcher {
    constructor() {
        this.spelling = null
        this.searchPropertyAliases = new Map()
        this.index = null
        this.documents = {}
    }

    /**
     * Search the index, and return results within the given searchProperty.
     * @param {string} queryString The query string.
     * @param {[string]} searchProperties The properties to search. If empty, all results are returned.
     * @return {{results: [{title: String, preview: String, url: String}], spellingCorrections: Object}}
     */
    search(queryString, searchProperties) {
        if (!this.index) {
            throw new Error('still-indexing')
        }

        searchProperties = searchProperties.map((property) => {
            if (this.searchPropertyAliases.has(property)) {
                return this.searchPropertyAliases.get(property)
            }

            return property
        })

        const parsedQuery = new Query(queryString)
        if (parsedQuery.terms.size > MAXIMUM_TERMS) {
            throw new Error('query-too-long')
        }

        if (searchProperties.length) {
            const properties = new Set(searchProperties)
            parsedQuery.filter = (_id) => properties.has(this.documents[_id].searchProperty)
        } else {
            parsedQuery.filter = (_id) => this.documents[_id].includeInGlobalSearch === true
        }

        let rawResults = this.index.search(parsedQuery, true)

        // If our results seem poor in quality, check if the query is misspelled
        const misspelled = {}
        if (this.spelling !== null && (rawResults.length === 0 || rawResults[0].score <= 0.6)) {
            for (const term of parsedQuery.terms) {
                const suggestions = this.spelling.suggest(term)
                if (suggestions.length > 0) {
                    misspelled[term] = suggestions[0]
                }
            }
        }

        rawResults = rawResults.map((match) => {
            const doc = this.documents[match._id]
            // console.log(doc.title, match.score, match.relevancyScore, match.authorityScore)
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

    setupSpellingDictionary(words) {
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

            this.spelling = newSpelling
        })
    }

    async sync(manifests) {
        const startTime = Date.now()
        const newSearchPropertyAliases = new Map()
        const newIndex = new fts.FTSIndex([
            ['text', 1],
            ['headings', 5],
            ['title', 10],
            ['tags', 75],
        ])

        for (const [term, synonymn, weight] of correlations) {
            newIndex.correlateWord(term, synonymn, weight)
        }

        const newManifests = []
        for (const manifest of manifests) {
            manifest.body = JSON.parse(manifest.body)
            const url = manifest.body.url.replace(/\/+$/, '')

            for (const alias of (manifest.body.aliases || [])) {
                newSearchPropertyAliases.set(alias, manifest.searchProperty)
            }

            manifest.body.documents = manifest.body.documents.map((doc) => {
                doc.slug = doc.slug.replace(/^\/+/, '')
                doc.url = `${url}/${doc.slug}`

                return doc
            })

            newManifests.push({
                documents: manifest.body.documents,
                searchProperty: manifest.searchProperty,
                includeInGlobalSearch: manifest.body.includeInGlobalSearch
            })

            await yieldToEventLoop()
        }

        const words = new Set()
        const newDocuments = Object.create(null)

        let batchCharactersIndexed = 0
        for (const manifest of newManifests) {
            for (const doc of manifest.documents) {
                const weight = doc.weight || 1
                const id = newIndex.add({
                    links: doc.links,
                    url: doc.url,

                    weight: weight,
                    text: doc.text,
                    tags: doc.tags,
                    headings: (doc.headings || []).join(' '),
                    title: doc.title}, (word) => words.add(word))

                newDocuments[id] = {
                    title: doc.title,
                    preview: doc.preview,
                    url: doc.url,
                    searchProperty: manifest.searchProperty,
                    includeInGlobalSearch: manifest.includeInGlobalSearch
                }

                // Yield every 100,000 characters indexed to handle requests
                batchCharactersIndexed += doc.text.length
                if (batchCharactersIndexed > 100000) {
                    await yieldToEventLoop()
                    batchCharactersIndexed = 0
                }
            }
        }

        this.setupSpellingDictionary(words)
        this.index = newIndex
        this.searchPropertyAliases = newSearchPropertyAliases
        this.documents = newDocuments

        return Date.now() - startTime
    }
}

exports.Searcher = Searcher
