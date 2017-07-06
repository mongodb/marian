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
        let in_quotes = false
        for (const part of parts) {
            in_quotes = !!(part.match(/^\s*"/))

            if (!in_quotes) {
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
}

exports.Query = Query
