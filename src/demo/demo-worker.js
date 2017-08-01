/* eslint-env worker */
'use strict'

const Query = require('../fts/Query.js').Query
const fts = require('../fts/fts.js')
const correlations = require('../correlations.js').correlations

let index = null
let documents = Object.create(null)

function search(queryString, options) {
    const query = new Query(queryString)
    const rawResults = index.search(query, options)

    return rawResults.map((match) => {
        const doc = documents[match._id]
        return {
            title: doc.title,
            preview: doc.preview,
            url: doc.url
        }
    })
}

function sync(manifest) {
    const newDocuments = Object.create(null)
    const newIndex = new fts.FTSIndex({
        text: 1,
        headings: 3,
        title: 10
    })

    for (const [term, [synonymn, weight]] of correlations) {
        newIndex.correlateWord(term, synonymn, weight)
    }

    const baseUrl = manifest.url.replace(/\/+$/, '')

    let id = 0
    for (const doc of manifest.documents) {
        const weight = doc.weight || 1
        doc.slug = doc.slug.replace(/^\/+/, '')
        doc.url = `${baseUrl}/${doc.slug}`

        newIndex.add({
            _id: id,

            links: doc.links,
            url: doc.url,

            weight: weight,
            text: doc.text,
            headings: (doc.headings || []).join(' '),
            title: doc.title}, () => {})

        newDocuments[id] = {
            title: doc.title,
            preview: doc.preview,
            url: doc.url
        }

        id += 1
    }

    index = newIndex
    documents = newDocuments
}

self.onmessage = (event) => {
    if (event.data.query) {
        const results = search(event.data.query, event.data)
        self.postMessage({results: results, query: event.data.query})
    } else if (event.data.sync) {
        sync(event.data.sync)
        self.postMessage({sync: true})
    }
}
