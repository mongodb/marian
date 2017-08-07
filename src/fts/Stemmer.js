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
    'get',
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
    'this',
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
    'when',
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
    'your'])

const stemmer = new Porter2()

function isStopWord(word) {
    return stopWords.has(word)
}

function tokenize(text) {
    return text.split(/[^\w]+/).
        map((token) => token.toLocaleLowerCase().trim()).
        filter((token) => token.length > 1)
}

exports.stem = stemmer.stemWord.bind(stemmer)
exports.isStopWord = isStopWord
exports.tokenize = tokenize
