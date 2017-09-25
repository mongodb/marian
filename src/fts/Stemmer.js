'use strict'

/* Derived from the following: */
/* !
 * lunr.stopWordFilter
 * Copyright (C) 2017 Oliver Nightingale
 */

const Porter2 = require('./Porter2').Porter2

const stopWords = new Set([
    'a',
    'able',
    'about',
    'across',
    'after',
    'all',
    'almost',
    'also',
    'am',
    'among',
    'an',
    'and',
    'any',
    'are',
    'as',
    'at',
    'be',
    'because',
    'been',
    'but',
    'by',
    'can',
    'cannot',
    'could',
    'dear',
    'did',
    'do',
    'does',
    'either',
    'else',
    'ever',
    'every',
    'for',
    'from',
    'got',
    'had',
    'has',
    'have',
    'he',
    'her',
    'hers',
    'him',
    'his',
    'how',
    'however',
    'i',
    'if',
    'important',
    'in',
    'into',
    'is',
    'it',
    'its',
    'just',
    'may',
    'me',
    'might',
    'most',
    'must',
    'my',
    'neither',
    'no',
    'nor',
    'of',
    'off',
    'often',
    'on',
    'only',
    'or',
    'other',
    'our',
    'own',
    'rather',
    'said',
    'say',
    'says',
    'she',
    'should',
    'since',
    'so',
    'some',
    'than',
    'that',
    'the',
    'their',
    'them',
    'then',
    'there',
    'these',
    'they',
    'tis',
    'to',
    'too',
    'twas',
    'us',
    'wants',
    'was',
    'we',
    'were',
    'what',
    'where',
    'which',
    'while',
    'who',
    'whom',
    'why',
    'will',
    'with',
    'would',
    'yet',
    'you',
    'your',
    'i.e.',
    'e.g.'])

const atomicPhraseMap = {
    'ops': 'manager',
    'cloud': 'manager'
}
const atomicPhrases = new Set(Object.entries(atomicPhraseMap).map((kv) => kv.join(' ')))

const wordCache = new Map()
const stemmer = new Porter2()
function stem(word) {
    if (atomicPhrases.has(word)) {
        return word
    }

    let stemmed = wordCache.get(word)
    if (!stemmed) {
        stemmed = stemmer.stemWord(word)
        wordCache.set(word, stemmed)
    }

    return stemmed
}

function isStopWord(word) {
    return stopWords.has(word)
}

function tokenize(text, fuzzy) {
    const components = text.split(/[^\w$.]+/).map((token) => {
        return token.toLocaleLowerCase().replace(/(?:^\.)|(?:\.$)/g, '')
    })

    const tokens = []
    for (let i = 0; i < components.length; i += 1) {
        const token = components[i]
        const nextToken = components[i + 1]
        if (nextToken !== undefined && atomicPhraseMap[token] === nextToken) {
            i += 1
            tokens.push(`${token} ${atomicPhraseMap[token]}`)
            continue
        }

        if (token.length > 1) {
            tokens.push(token)
        }

        if (fuzzy) {
            for (const subtoken of token.split('.')) {
                if (subtoken.length > 1) {
                    tokens.push(subtoken)
                }
            }
        }
    }

    return tokens
}

exports.stem = stem
exports.isStopWord = isStopWord
exports.tokenize = tokenize
