/* eslint no-unused-vars: "off" */
'use strict'

const Query = require('./Query.js').Query
const {isStopWord, stem, tokenize} = require('./Stemmer.js')

function hits(matches, iterations) {
    for (let i = 0; i < iterations; i += 1) {
        let norm = 0
        // Update all authority scores
        for (const match of matches) {
            match.authorityScore = 0
            for (const incomingMatch of match.incomingNeighbors) {
                match.authorityScore += incomingMatch.hubScore
            }
            norm += match.authorityScore ** 2
        }

        // normalise the authority scores
        norm = Math.sqrt(norm)
        for (const match of matches) {
            match.authorityScore /= norm
        }

        // Update all hub scores
        norm = 0
        for (const match of matches) {
            match.hubScore = 0
            for (const outgoingMatch of match.outgoingNeighbors) {
                match.hubScore += outgoingMatch.authorityScore
            }
            norm += match.hubScore ** 2
        }

        // Normalise the hub scores
        norm = Math.sqrt(norm)
        for (const match of matches) {
            match.hubScore /= norm
        }
    }

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

    // Suggested by A Study of Smoothing Methods for Language Models
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

class Trie {
    constructor() {
        this.trie = new Map([[0, null]])
    }

    insert(token, id) {
        let cursor = this.trie
        let i = 0

        for (; i < token.length; i += 1) {
            const code = token.charCodeAt(i) + 1
            if (!cursor.get(code)) {
                cursor.set(code, new Map([[0, null]]))
            }

            cursor = cursor.get(code)
        }

        if (cursor.get(0) === null) {
            cursor.set(0, new Set())
        }

        cursor.get(0).add(id)
    }

    remove(token, id) {
        let cursor = this.trie
        for (let i = 0; i < token.length; i += 1) {
            const code = token.charCodeAt(i) + 1
            if (!cursor.get(code)) {
                return
            }

            cursor = cursor.get(code)
        }

        cursor.get(0).delete(id)
    }

    // Return Map<String, Iterable<String>>
    search(token, prefixSearch) {
        let cursor = this.trie
        for (let i = 0; i < token.length; i += 1) {
            const code = token.charCodeAt(i) + 1
            if (!cursor.get(code)) {
                return new Map()
            }

            cursor = cursor.get(code)
        }

        if (!prefixSearch) {
            return new Map(cursor.get(0), [token])
        }

        const results = new Map()
        if (cursor.get(0)) {
            for (const id of cursor.get(0)) {
                results.set(id, new Set([token]))
            }
        }

        const stack = [[cursor, token]]
        while (stack.length > 0) {
            const [currentNode, currentToken] = stack.pop()
            for (const key of currentNode.keys()) {
                if (key !== 0) {
                    const nextCursor = currentNode.get(key)
                    if (nextCursor) {
                        stack.push([nextCursor, currentToken + String.fromCharCode(key - 1)])
                    }
                    continue
                }

                if (currentNode.get(key) === null) {
                    continue
                }

                for (const value of currentNode.get(0)) {
                    const arr = results.get(value)
                    if (arr) {
                        arr.add(currentToken)
                    } else {
                        results.set(value, new Set([currentToken]))
                    }
                }

                continue
            }
        }

        return results
    }
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
    constructor(docID, score, initialTerms) {
        this._id = docID
        this.score = score
        this.terms = new Set(initialTerms)
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
    }

    add(document, onToken) {
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

    collectMatchesFromTrie(query) {
        const resultSet = []
        for (const term of query) {
            const matches = this.trie.search(term, true)
            for (const match of matches.entries()) {
                resultSet.push(match)
            }
        }

        return resultSet
    }

    search(query) {
        if (typeof query === 'string') {
            query = new Query(query)
        }

        const matchSet = new Map()
        const stemmedTerms = new Set(query.terms.map((term) => stem(term)))

        for (const tuple of this.collectMatchesFromTrie(stemmedTerms)) {
            const [docID, terms] = tuple
            if (!query.filter(docID)) { continue }

            for (const term of terms) {
                const termEntry = this.terms.get(term)

                const exactMatchMultiplier = stemmedTerms.has(term) ? 10 : 1

                let termScore = 0
                for (const [fieldName, field] of this.fields.entries()) {
                    const docEntry = field.documents.get(docID)
                    if (!docEntry) { continue }

                    const termFrequencyInDoc = docEntry.termFrequencies.get(term) || 0
                    const termProbability = (termEntry.timesAppeared.get(fieldName) || 0) / field.totalTokensSeen

                    // Larger fields yield larger scores, but we want fields to have roughly
                    // equal weight. field.lengthWeight is stupid, but yields good results.
                    termScore += dirichletPlus(1, termFrequencyInDoc, termProbability, docEntry.len,
                        stemmedTerms.size) * field.weight * exactMatchMultiplier * field.lengthWeight *
                        this.documentWeights.get(docID)
                }

                const match = matchSet.get(docID)
                if (match) {
                    match.score += termScore
                    match.terms.add(term)
                } else {
                    matchSet.set(docID, new Match(docID, termScore, [term]))
                }
            }
        }

        let results = Array.from(matchSet.values())
        if (query.phrases.length) {
            results = results.filter((match) => {
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

        results = results.sort((a, b) => {
            if (a.score < b.score) {
                return 1
            }
            if (a.score > b.score) {
                return -1
            }

            return 0
        })

        return results
        // matches = hits(matches.slice(0, 200), this.documents.size)
    }
}

exports.FTSIndex = FTSIndex
