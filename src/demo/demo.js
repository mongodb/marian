/* eslint-env browser */
'use strict'

const defaultQuery = 'aggregation, sharded cluster, config servers, find, regex, regular expression, date, count, joins, views'
const defaultRanking =
`// relevancy, maxRelevancy, authorityScore, maxAuthority, hubScore, maxHubScore
const normalizedRelevancy = relevancy / maxRelevancy + 1
const normalizedAuthorityScore = authorityScore / maxAuthorityScore + 1
return (Math.log2(normalizedRelevancy) * 2) + (Math.log2(normalizedAuthorityScore) * 2)
`

const defaults = {
    ranking: defaultRanking,
    mu: 2000,
    delta: 0.05,
    useHits: true,
    nResults: 8
}

class Results {
    constructor(resultsElement) {
        this.resultsElement = resultsElement
        this.queries = []
        this.queriesMap = new Map()
        this.goodResults = new Map()
        this.badResults = new Map()

        this.goodResults.set('aggregation', new Set([
            'aggregate',
            'db.collection.aggregate()',
            'Aggregation Pipeline'
        ]))
        this.goodResults.set('sharded cluster', new Set([
            'Sharding'
        ]))
        this.goodResults.set('config servers', new Set([
            'Config Servers'
        ]))
        this.goodResults.set('find', new Set([
            'db.collection.find()',
            'find',
            'Bulk.find()'
        ]))
        this.goodResults.set('regex', new Set([
            '$regex'
        ]))
        this.goodResults.set('regular expression', new Set([
            '$regex'
        ]))
        this.goodResults.set('date', new Set([
            'Date()',
            'Date Aggregation Operators',
            '$dateToString (aggregation)'
        ]))
        this.goodResults.set('count', new Set([
            'count',
            'cursor.count()',
            'db.collection.count()',
            '$count (aggregation)'
        ]))
        this.goodResults.set('joins', new Set([
            '$lookup (aggregation)',
            'Pipeline Aggregation Stages'
        ]))
        this.goodResults.set('views', new Set([
            'Views'
        ]))

        this.options = Object.assign({}, defaults)

        this.pending = 0
        this.onload = () => {}
        this.worker = new Worker('demo-worker.js')
        this.worker.onmessage = (event) => {
            if (event.data.sync) {
                this.onload()
                return
            }

            if (!this.queriesMap.has(event.data.query)) { return }

            this.queriesMap.get(event.data.query)[1] = event.data.results

            for (const tuple of this.queries) {
                if (!this.queriesMap.has(tuple[0])) {
                    this.queriesMap.delete(tuple[0])
                }
            }

            this.pending -= 1
            if (this.pending === 0) {
                this.redraw()
            }
        }
    }

    load(manifest) {
        this.worker.postMessage({sync: manifest})
        this.onload()
    }

    updateQuery(query) {
        this.queriesMap.clear()
        this.queries = query.split(/,\W*/).map((query) => {
            const tuple = [query, null]
            this.queriesMap.set(query, tuple)
            return tuple
        })

        for (const tuple of this.queries) {
            const message = Object.assign({}, this.options)
            message.query = tuple[0]
            this.worker.postMessage(message)
            this.pending += 1
        }
    }

    markAsGood(query, title) {
        let results = this.goodResults.get(query)
        if (!results) {
            results = new Set()
            this.goodResults.set(query, results)
        }

        results.add(title)
    }

    markAsBad(query, title) {
        let results = this.badResults.get(query)
        if (!results) {
            results = new Set()
            this.badResults.set(query, results)
        }

        results.add(title)
    }

    removeMark(query, title) {
        const badResults = this.badResults.get(query) || new Set()
        const goodResults = this.goodResults.get(query) || new Set()

        badResults.delete(title)
        goodResults.delete(title)
    }

    redraw() {
        this.resultsElement.innerText = ''
        for (const tuple of this.queries) {
            const row = document.createElement('tr')
            const firstColumn = document.createElement('td')
            firstColumn.innerText = tuple[0]
            const secondColumn = document.createElement('td')
            const resultsList = document.createElement('ul')
            secondColumn.appendChild(resultsList)
            for (const result of (tuple[1] || []).slice(0, this.options.nResults)) {
                const query = tuple[0]
                const title = result.title.replace(/ — .*$/, '')

                const resultElement = document.createElement('li')
                resultElement.innerText = title
                resultElement.dataset.title = title
                resultElement.dataset.query = query
                if ((this.goodResults.get(query) || new Set()).has(title)) {
                    resultElement.className = 'good'
                }
                if ((this.badResults.get(query) || new Set()).has(title)) {
                    resultElement.className = 'bad'
                }

                resultElement.onclick = (ev) => {
                    if (ev.target.className === 'good') {
                        this.removeMark(ev.target.dataset.query, ev.target.dataset.title)
                        ev.target.className = ''
                    } else {
                        this.markAsGood(ev.target.dataset.query, ev.target.dataset.title)
                        ev.target.className = 'good'
                    }
                    return false
                }

                resultElement.oncontextmenu = (ev) => {
                    if (ev.target.className === 'bad') {
                        this.removeMark(ev.target.dataset.query, ev.target.dataset.title)
                        ev.target.className = ''
                    } else {
                        this.markAsBad(ev.target.dataset.query, ev.target.dataset.title)
                        ev.target.className = 'bad'
                    }
                    return false
                }

                resultsList.appendChild(resultElement)
            }
            row.appendChild(firstColumn)
            row.appendChild(secondColumn)
            this.resultsElement.appendChild(row)
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const searchElement = document.querySelector('.search')
    searchElement.value = defaultQuery

    const useHitsElement = document.querySelector('.use-hits')
    const muElement = document.querySelector('.mu')
    const deltaElement = document.querySelector('.delta')
    const rankingElement = document.querySelector('.ranking')
    const updateElement = document.querySelector('.update')
    const resultsElement = document.querySelector('.results')
    const results = new Results(resultsElement)
    results.onload = () => {
        results.onload = () => {}
        searchElement.disabled = false
    }

    muElement.value = results.options.mu
    deltaElement.value = results.options.delta
    rankingElement.value = results.options.ranking
    useHitsElement.checked = results.options.useHits

    const response = await fetch('manual-master.json')
    const manifest = await response.json()
    results.load(manifest)

    updateElement.onclick = () => {
        if (searchElement.disabled) { return }
        results.updateQuery(searchElement.value)
    }

    useHitsElement.onclick = () => {
        results.options.useHits = useHitsElement.checked
    }

    muElement.onchange = () => {
        results.options.mu = parseFloat(muElement.value)
    }

    deltaElement.onchange = () => {
        results.options.delta = parseFloat(deltaElement.value)
    }

    rankingElement.oninput = () => {
        results.options.ranking = rankingElement.value
    }
    rankingElement.onkeydown = function(ev) {
        if(ev.keyCode === 9 || ev.which === 9) {
            ev.preventDefault()
            const s = this.selectionStart
            this.value = this.value.substring(0, this.selectionStart) + '    ' + this.value.substring(this.selectionEnd)
            this.selectionEnd = s + 4
        }
    }
})
