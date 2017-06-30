'use strict'

const lunr = require('lunr')

let index = null
let manifests = {}
let documents = {}

/**
 * Search the index, and return results within the given searchProperty.
 * @param {string} queryString The query string.
 * @param {string} searchProperty The property to search. If empty, all results are returned.
 */
function search(queryString, searchProperty) {
    if (!index) {
        throw new Error('still-indexing')
    }

    let rawResults = index.query((query) => {
        const terms = queryString.toLowerCase().split(/\W+/)
        for (const term of terms) {
            query.term(term, {usePipeline: true, boost: 100})
            query.term(term, {usePipeline: false, boost: 10, wildcard: lunr.Query.wildcard.TRAILING})
            query.term(term, {usePipeline: false, boost: 1, editDistance: 1 })
        }

        if (searchProperty) {
            query.term(searchProperty, {usePipeline: false, fields: ['searchProperty']})
        }
    })

    if (searchProperty) {
        rawResults = rawResults.filter((match) => {
            const doc = documents[match.ref]
            const manifest = manifests[doc.projectName]
            return manifest.searchProperty === searchProperty
        })
    }

    rawResults = rawResults.slice(0, 100).map((match) => {
        const doc = documents[match.ref]
        return {
            title: doc.title,
            preview: doc.preview,
            url: doc.url
        }
    })

    return rawResults
}

self.onmessage = function(event) {
    const message = event.data.message
    const messageId = event.data.messageId

    try {
        if (message.search !== undefined) {
            const results = search(message.search.queryString, message.search.searchProperty)
            self.postMessage({results: results, messageId: messageId})
        } else if (message.sync !== undefined) {
            manifests = message.sync.manifests
            documents = message.sync.documents
            index = lunr.Index.load(message.sync.index)
            self.postMessage({ok: true, messageId: messageId})
        } else {
            throw new Error('Unknown command')
        }
    } catch (err) {
        self.postMessage({error: err.message, messageId: messageId})
    }
}
