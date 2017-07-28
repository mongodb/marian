/* eslint camelcase: "off", complexity: "off", max-len: "off" */
/* Derived from the following: */
/* !
 * lunr.stopWordFilter
 * Copyright (C) 2017 Oliver Nightingale
 */
/* !
 * lunr.stemmer
 * Copyright (C) 2017 Oliver Nightingale
 * Includes code from - http://tartarus.org/~martin/PorterStemmer/js.txt
 */
'use strict'

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
    'in',
    'into',
    'is',
    'it',
    'its',
    'just',
    'least',
    'let',
    'like',
    'likely',
    'may',
    'me',
    'might',
    'most',
    'must',
    'my',
    'neither',
    'no',
    'nor',
    'not',
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
    'your'])

/**
 * Stemmer is an english language stemmer, this is a JavaScript
 * implementation of the PorterStemmer taken from http://tartarus.org/~martin
 */

class Stemmer {
    constructor() {
        const step2list = {
            'ational': 'ate',
            'tional': 'tion',
            'enci': 'ence',
            'anci': 'ance',
            'izer': 'ize',
            'bli': 'ble',
            'alli': 'al',
            'entli': 'ent',
            'eli': 'e',
            'ousli': 'ous',
            'ization': 'ize',
            'ation': 'ate',
            'ator': 'ate',
            'alism': 'al',
            'iveness': 'ive',
            'fulness': 'ful',
            'ousness': 'ous',
            'aliti': 'al',
            'iviti': 'ive',
            'biliti': 'ble',
            'logi': 'log'
        }

        const step3list = {
            'icate': 'ic',
            'ative': '',
            'alize': 'al',
            'iciti': 'ic',
            'ical': 'ic',
            'ful': '',
            'ness': ''
        }

        // consonant
        const c = '[^aeiou]'
        // vowel
        const v = '[aeiouy]'
        // consonant sequence
        const C = `${c}[^aeiouy]*`
        // vowel sequence
        const V = `${v}[aeiou]*`

        // [C]VC... is m>0
        const mgr0 = `^(${C})?${V}${C}`
        // [C]VC[V] is m=1
        const meq1 = `^(${C})?${V}${C}(${V})?$`
        // [C]VCVC... is m>1
        const mgr1 = `^(${C})?${V}${C}${V}${C}`
        // vowel in stem
        const s_v = `^(${C})?${v}`

        const re_mgr0 = new RegExp(mgr0)
        const re_mgr1 = new RegExp(mgr1)
        const re_meq1 = new RegExp(meq1)
        const re_s_v = new RegExp(s_v)

        const re_1a = /^(.+?)(ss|i)es$/
        const re2_1a = /^(.+?)([^s])s$/
        const re_1b = /^(.+?)eed$/
        const re2_1b = /^(.+?)(ed|ing)$/
        const re_1b_2 = /.$/
        const re2_1b_2 = /(at|bl|iz)$/
        const re3_1b_2 = new RegExp('([^aeiouylsz])\\1$')
        const re4_1b_2 = new RegExp(`^${C}${v}[^aeiouwxy]$`)

        const re_1c = /^(.+?[^aeiou])y$/
        const re_2 = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/

        const re_3 = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/

        const re_4 = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/
        const re2_4 = /^(.+?)(s|t)(ion)$/

        const re_5 = /^(.+?)e$/
        const re_5_1 = /ll$/
        const re3_5 = new RegExp(`^${C}${v}[^aeiouwxy]$`)

        this.porterStemmer = (w) => {
            let stem = null
            let suffix = null
            let re3 = null
            let re4 = null

            if (w.length < 3) { return w }

            const firstch = w.substr(0, 1)
            if (firstch === 'y') {
                w = firstch.toUpperCase() + w.substr(1)
            }

            // Step 1a
            let re = re_1a
            let re2 = re2_1a

            if (re.test(w)) { w = w.replace(re, '$1$2') }
            else if (re2.test(w)) { w = w.replace(re2, '$1$2') }

            // Step 1b
            re = re_1b
            re2 = re2_1b
            if (re.test(w)) {
                const fp = re.exec(w)
                re = re_mgr0
                if (re.test(fp[1])) {
                    re = re_1b_2
                    w = w.replace(re, '')
                }
            } else if (re2.test(w)) {
                const fp = re2.exec(w)
                stem = fp[1]
                re2 = re_s_v
                if (re2.test(stem)) {
                    w = stem
                    re2 = re2_1b_2
                    re3 = re3_1b_2
                    re4 = re4_1b_2
                    if (re2.test(w)) { w += 'e' }
                    else if (re3.test(w)) {
                        re = re_1b_2
                        w = w.replace(re, '')
                    } else if (re4.test(w)) {
                        w += 'e'
                    }
                }
            }

            // Step 1c - replace suffix y or Y by i if preceded by a non-vowel which is not the first
            // letter of the word (so cry -> cri, by -> by, say -> say)
            re = re_1c
            if (re.test(w)) {
                const fp = re.exec(w)
                stem = fp[1]
                w = `${stem}i`
            }

            // Step 2
            re = re_2
            if (re.test(w)) {
                const fp = re.exec(w)
                stem = fp[1]
                suffix = fp[2]
                re = re_mgr0
                if (re.test(stem)) {
                    w = stem + step2list[suffix]
                }
            }

            // Step 3
            re = re_3
            if (re.test(w)) {
                const fp = re.exec(w)
                stem = fp[1]
                suffix = fp[2]
                re = re_mgr0
                if (re.test(stem)) {
                    w = stem + step3list[suffix]
                }
            }

            // Step 4
            re = re_4
            re2 = re2_4
            if (re.test(w)) {
                const fp = re.exec(w)
                stem = fp[1]
                re = re_mgr1
                if (re.test(stem)) {
                    w = stem
                }
            } else if (re2.test(w)) {
                const fp = re2.exec(w)
                stem = fp[1] + fp[2]
                re2 = re_mgr1
                if (re2.test(stem)) {
                    w = stem
                }
            }

            // Step 5
            re = re_5
            if (re.test(w)) {
                const fp = re.exec(w)
                stem = fp[1]
                re = re_mgr1
                re2 = re_meq1
                re3 = re3_5
                if (re.test(stem) || (re2.test(stem) && !(re3.test(stem)))) {
                    w = stem
                }
            }

            re = re_5_1
            re2 = re_mgr1
            if (re.test(w) && re2.test(w)) {
                re = re_1b_2
                w = w.replace(re, '')
            }

            // and turn initial Y back to y

            if (firstch === 'y') {
                w = firstch.toLowerCase() + w.substr(1)
            }

            return w
        }
    }

    stem(word) {
        return this.porterStemmer(word)
    }
}

const stemmer = new Stemmer()

function isStopWord(word) {
    return stopWords.has(word)
}

function tokenize(text) {
    return text.split(/[\s-]+/).
        map((token) => token.toLocaleLowerCase().replace(/^\W+/, '').replace(/\W+$/, '')).
        filter((word) => !isStopWord(word)).
        map((token) => stemmer.stem(token))
}

exports.stemmer = stemmer
exports.isStopWord = isStopWord
exports.tokenize = tokenize
