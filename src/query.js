const lunr = require('lunr')

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
 * @param {[string]} phraseComponents
 * @param {Map<string, [number]>} keywords
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

/** A parsed search query. */
class Query {
    /**
     * Create a new query.
     * @param {string} queryString
     */
    constructor(queryString) {
        this.terms = []
        this.phrases = []

        const parts = queryString.split(/((?:\s+|^)"[^"]+"(?:\s+|$))/)
        let inQuotes = false
        for (const part of parts) {
            inQuotes = !!(part.match(/^\s*"/))

            if (!inQuotes) {
                this.terms.push(...part.toLowerCase().split(/\W+/).filter((s) => s.length > 0))
            } else {
                const phraseMatch = part.match(/\s*"([^"]*)"?\s*/)
                if (!phraseMatch) {
                    // This is a phrase fragment
                    this.terms.push(...part.toLowerCase().split(/\W+/).filter((s) => s.length > 0))
                    continue
                }

                const phrase = phraseMatch[1].toLowerCase().trim()
                this.phrases.push(phrase)
                this.terms.push(...phrase.split(/\W+/))
            }
        }
    }

    /**
     * Return true if the exact phrases in the query appear in ANY of the fields
     * appearing in the match.
     * @param {array<string>} fields
     * @param {lunr.MatchData} match
     * @return {boolean}
     */
    checkPhrases(fields, match) {
        for (const phrase of this.phrases) {
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
}

exports.Query = Query
