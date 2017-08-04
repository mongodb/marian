'use strict'

const Query = require('./Query.js').Query
const Trie = require('./Trie.js').Trie
const {isStopWord, stem, tokenize} = require('./Stemmer.js')

const MAX_MATCHES = 100

function computeScore(match, maxRelevancyScore, maxAuthorityScore) {
    const normalizedRelevancyScore = match.relevancyScore / maxRelevancyScore + 1
    const normalizedAuthorityScore = match.authorityScore / maxAuthorityScore + 1
    return (Math.log2(normalizedRelevancyScore) * 2) + (Math.log2(normalizedAuthorityScore) * 2)
}

/**
 * We want to penalize the final score of any matches that are in the bottom
 * standard deviation of relevancy. Return that minimum relevancy score.
 * @param {[Match]} matches The matches over which to compute a relevancy threshold.
 * @return {number} The relevancy threshold.
 */
function computeRelevancyThreshold(matches) {
    let meanScore = 0
    for (const match of matches) {
        meanScore += match.relevancyScore
    }
    meanScore /= matches.length

    let sum = 0
    for (const match of matches) {
        sum += (match.relevancyScore - meanScore) ** 2
    }

    return Math.sqrt((1 / (matches.length - 1) * sum))
}

function capLength(array, maxLength) {
    return array.length > maxLength ? array.slice(0, maxLength) : array
}

function hits(matches, converganceThreshold, maxIterations) {
    let lastAuthorityNorm = 0
    let lastHubNorm = 0
    for (let i = 0; i < maxIterations; i += 1) {
        let authorityNorm = 0
        // Update all authority scores
        for (const match of matches) {
            match.authorityScore = 0
            for (const incomingMatch of match.incomingNeighbors) {
                match.authorityScore += incomingMatch.hubScore
            }
            authorityNorm += match.authorityScore ** 2
        }

        // Normalise the authority scores
        authorityNorm = Math.sqrt(authorityNorm)
        for (const match of matches) {
            match.authorityScore /= authorityNorm
        }

        // Update all hub scores
        let hubNorm = 0
        for (const match of matches) {
            match.hubScore = 0
            for (const outgoingMatch of match.outgoingNeighbors) {
                match.hubScore += outgoingMatch.authorityScore
            }
            hubNorm += match.hubScore ** 2
        }

        // Normalise the hub scores
        hubNorm = Math.sqrt(hubNorm)
        for (const match of matches) {
            match.hubScore /= hubNorm
        }

        if (Math.abs(authorityNorm - lastAuthorityNorm) < converganceThreshold &&
            Math.abs(hubNorm - lastHubNorm) < converganceThreshold) {
            break
        }

        lastAuthorityNorm = authorityNorm
        lastHubNorm = hubNorm
    }

    matches = capLength(matches, MAX_MATCHES)

    let maxRelevancyScore = 0
    let maxAuthorityScore = 0
    for (const match of matches) {
        if (match.relevancyScore > maxRelevancyScore) { maxRelevancyScore = match.relevancyScore }
        if (match.authorityScore > maxAuthorityScore) { maxAuthorityScore = match.authorityScore }
    }

    // Compute the final ranking score
    const relevancyScoreThreshold = computeRelevancyThreshold(matches)
    for (const match of matches) {
        match.score = computeScore(match, maxRelevancyScore, maxAuthorityScore)

        // Penalize anything with especially poor relevancy
        if (match.relevancyScore < relevancyScoreThreshold) {
            match.score -= 1
        }
    }

    matches = matches.sort((a, b) => {
        if (a.score < b.score) {
            return 1
        }
        if (a.score > b.score) {
            return -1
        }

        return 0
    })

    return matches
}

/* Yuanhua Lv and ChengXiang Zhai. 2011. Lower-bounding term frequency
 * normalization. In Proceedings of the 20th ACM international
 * conference on Information and knowledge management (CIKM '11), Bettina
 * Berendt, Arjen de Vries, Wenfei Fan, Craig Macdonald, Iadh Ounis, and
 * Ian Ruthven (Eds.). ACM, New York, NY, USA, 7-16. DOI: https://doi.org/10.1145/2063576.2063584
 */
function dirichletPlus(termFrequencyInQuery, termFrequencyInDoc,
    termProbabilityInLanguage, docLength, queryLength) {
    const delta = 0.05

    // In the range suggested by A Study of Smoothing Methods for Language Models
    // Applied to Ad Hoc Information Retrieval [Zhai, Lafferty]
    const mu = 2000

    // In some fields, the query may never exist, making its probability 0.
    // This is... weird. Return 0 to avoid NaN since while dirichlet+
    // prefers rare words, a nonexistent word should probably be ignored.
    if (termProbabilityInLanguage === 0) { return 0 }

    let term2 = Math.log2(1 + (termFrequencyInDoc / (mu * termProbabilityInLanguage)))
    term2 += Math.log2(1 + (delta / (mu * termProbabilityInLanguage)))

    const term3 = queryLength * Math.log2(mu / (docLength + mu))

    return (termFrequencyInQuery * term2) + term3
}

class TermEntry {
    constructor() {
        this.docs = []
        this.positions = new Map()
        this.timesAppeared = new Map()
    }

    register(fieldName, docID, tokenID) {
        this.docs.push(docID)
        this.timesAppeared.set(fieldName, (this.timesAppeared.get(fieldName) || 0) + 1)
        this.addTokenPosition(docID, tokenID)
    }

    addTokenPosition(docID, tokenID) {
        const positions = this.positions.get(docID)
        if (!positions) {
            this.positions.set(docID, [tokenID])
        } else {
            positions.push(tokenID)
        }
    }
}

class DocumentEntry {
    constructor(len, termFrequencies, weight) {
        this.len = len
        this.termFrequencies = termFrequencies
        this.weight = weight
    }
}

class Match {
    constructor(docID, relevancyScore, initialTerms) {
        this._id = docID
        this.relevancyScore = relevancyScore
        this.terms = new Set(initialTerms)

        this.score = 0.0
        this.authorityScore = 1.0
        this.hubScore = 1.0
        this.incomingNeighbors = new Set()
        this.outgoingNeighbors = new Set()
    }
}

class Field {
    constructor(weight) {
        this.documents = new Map()
        this.weight = weight
        this.totalTokensSeen = 0

        this._lengthWeight = null
    }

    /** Return the inverse average number of unique terms per document.
     * This makes no fscking sense, but is useful as a weighting factor
     * in my testing. */
    get lengthWeight() {
        if (!this._lengthWeight) {
            let nTerms = 0
            for (const doc of this.documents.values()) {
                nTerms += doc.termFrequencies.size
            }

            this._lengthWeight = this.documents.size / nTerms
        }

        return this._lengthWeight
    }
}

class FTSIndex {
    constructor(fields) {
        this.fields = new Map()
        for (const field of Object.keys(fields)) {
            this.fields.set(field, new Field(fields[field]))
        }

        this.trie = new Trie()
        this.terms = new Map()
        this.termID = 0
        this.documentWeights = new Map()

        this.linkGraph = new Map()
        this.inverseLinkGraph = new Map()
        this.urlToId = new Map()
        this.idToUrl = new Map()

        this.wordCorrelations = new Map()
    }

    // word can be multiple tokens. synonym must be a single token.
    correlateWord(word, synonym, closeness) {
        word = tokenize(word).map((w) => stem(w)).join(' ')
        synonym = stem(synonym)

        const correlationEntry = this.wordCorrelations.get(word)
        if (!correlationEntry) {
            this.wordCorrelations.set(word, [[synonym, closeness]])
        } else {
            correlationEntry.push([synonym, closeness])
        }
    }

    collectCorrelations(terms) {
        const stemmedTerms = new Map(terms.map((term) => [stem(term), 1]))

        for (let i = 0; i < terms.length; i += 1) {
            const pair = [stem(terms[i])]

            if (i < terms.length - 1) {
                pair.push(`${pair[0]} ${stem(terms[i+1])}`)
            }

            for (const term of pair) {
                const correlations = this.wordCorrelations.get(term)
                if (!correlations) { continue }

                for (const [correlation, weight] of correlations) {
                    const newWeight = Math.max(stemmedTerms.get(correlation) || 0, weight)
                    stemmedTerms.set(correlation, newWeight)
                }
            }
        }

        return stemmedTerms
    }

    add(document, onToken) {
        if (document.links !== undefined && document.url !== undefined) {
            this.linkGraph.set(document.url, document.links || [])
            for (const href of document.links || []) {
                let incomingLinks = this.inverseLinkGraph.get(href)
                if (!incomingLinks) {
                    incomingLinks = []
                    this.inverseLinkGraph.set(href, incomingLinks)
                }

                incomingLinks.push(document.url)
            }
            this.urlToId.set(document.url, document._id)
            this.idToUrl.set(document._id, document.url)
        }

        for (const [fieldName, field] of this.fields.entries()) {
            field._lengthWeight = null
            const termFrequencies = new Map()

            const text = document[fieldName]
            if (!text) { continue }
            let tokens = tokenize(text)
            for (const token of tokens) { onToken(token) }
            tokens = tokens.filter((word) => !isStopWord(word)).map((token) => stem(token))
            const len = tokens.length
            field.totalTokensSeen += tokens.length

            for (const token of tokens) {
                if (onToken) { onToken(token) }

                this.termID += 1

                let indexEntry = this.terms.get(token)
                if (!indexEntry) {
                    this.terms.set(token, new TermEntry())
                    indexEntry = this.terms.get(token)
                }

                const count = termFrequencies.get(token) || 0
                termFrequencies.set(token, count + 1)
                if (count === 0) {
                    this.trie.insert(token, document._id)
                    indexEntry.register(fieldName, document._id, this.termID)
                } else {
                    indexEntry.addTokenPosition(document._id, this.termID)
                }
            }

            // After each field, bump by one to prevent accidental adjacency.
            this.termID += 1

            this.fields.get(fieldName).documents.set(document._id, new DocumentEntry(len, termFrequencies))
            this.documentWeights.set(document._id, document.weight || 1)
        }
    }

    collectMatchesFromTrie(terms) {
        const resultSet = []
        for (const term of terms) {
            const matches = this.trie.search(term, true)
            for (const match of matches.entries()) {
                resultSet.push(match)
            }
        }

        return resultSet
    }

    search(query, useHits) {
        if (typeof query === 'string') {
            query = new Query(query)
        }

        const matchSet = new Map()
        const originalTerms = new Set(query.terms)
        const stemmedTerms = this.collectCorrelations(Array.from(query.terms))

        for (const term of stemmedTerms.keys()) {
            const correlations = this.wordCorrelations.get(term)
            if (!correlations) { continue }

            for (const [correlation, weight] of correlations) {
                const newWeight = Math.max(stemmedTerms.get(correlation) || 0, weight)
                stemmedTerms.set(correlation, newWeight)
            }
        }

        for (const tuple of this.collectMatchesFromTrie(stemmedTerms.keys())) {
            const [docID, terms] = tuple
            if (!query.filter(docID)) { continue }

            for (const term of terms) {
                const termEntry = this.terms.get(term)

                let termRelevancyScore = 0
                for (const [fieldName, field] of this.fields.entries()) {
                    const docEntry = field.documents.get(docID)
                    if (!docEntry) { continue }

                    const termWeight = stemmedTerms.get(term) || 0.1
                    const termFrequencyInDoc = docEntry.termFrequencies.get(term) || 0
                    const termProbability = (termEntry.timesAppeared.get(fieldName) || 0) / field.totalTokensSeen

                    // Larger fields yield larger scores, but we want fields to have roughly
                    // equal weight. field.lengthWeight is stupid, but yields good results.
                    termRelevancyScore += dirichletPlus(termWeight, termFrequencyInDoc, termProbability, docEntry.len,
                        originalTerms.size) * field.weight * field.lengthWeight *
                        this.documentWeights.get(docID)
                }

                const match = matchSet.get(docID)
                if (match) {
                    match.relevancyScore += termRelevancyScore
                    match.terms.add(term)
                } else {
                    matchSet.set(docID, new Match(docID, termRelevancyScore, [term]))
                }
            }
        }

        // Create a root set of the core relevant results
        let rootSet = Array.from(matchSet.values())
        if (query.phrases.length) {
            rootSet = rootSet.filter((match) => {
                const tokens = new Map()
                for (const term of match.terms) {
                    const termEntry = this.terms.get(term)
                    if (!termEntry) { return false }

                    const positions = termEntry.positions.get(match._id)
                    if (!positions) { return false }

                    tokens.set(term, positions)
                }
                return query.checkPhrases(tokens)
            })
        }

        rootSet = rootSet.sort((a, b) => {
            if (a.relevancyScore < b.relevancyScore) {
                return 1
            }
            if (a.relevancyScore > b.relevancyScore) {
                return -1
            }

            return 0
        })

        if (!useHits) {
            return capLength(rootSet, MAX_MATCHES)
        }

        // Expand our root set's neighbors to create a base set: the set of all
        // relevant pages, as well as pages that link TO or are linked FROM those pages.
        const baseSet = new Map(rootSet.map((match) => [match._id, match]))
        for (const match of Array.from(baseSet.values())) {
            const url = this.idToUrl.get(match._id)
            for (const _id of (this.linkGraph.get(url) || []).map((url) => this.urlToId.get(url))) {
                if (_id === null || _id === undefined) {
                    continue
                }

                match.outgoingNeighbors.add(_id)

                if (baseSet.has(_id)) { continue }
                baseSet.set(_id, new Match(_id, 0, []))
            }

            for (const _id of (this.inverseLinkGraph.get(url) || []).map((url) => this.urlToId.get(url))) {
                if (_id === null || _id === undefined) {
                    continue
                }

                match.incomingNeighbors.add(_id)

                if (baseSet.has(_id)) { continue }
                baseSet.set(_id, new Match(_id, 0, []))
            }
        }

        for (const match of baseSet.values()) {
            match.outgoingNeighbors = new Set(Array.from(match.outgoingNeighbors).map((_id) => baseSet.get(_id)).filter((match) => Boolean(match)))
            match.incomingNeighbors = new Set(Array.from(match.incomingNeighbors).map((_id) => baseSet.get(_id)).filter((match) => Boolean(match)))
        }

        // Run HITS to re-sort our results based on authority
        return hits(Array.from(baseSet.values()), 0.00001, 200)
    }
}

exports.FTSIndex = FTSIndex
