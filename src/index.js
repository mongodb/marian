#!/usr/bin/env node
'use strict'

const { Buffer } = require('buffer')
const fs = require('fs')
const http = require('http')
const os = require('os')
const pathModule = require('path')
const process = require('process')
const url = require('url')
const util = require('util')
const zlib = require('zlib')

const Pool = require('./pool.js').Pool
const dive = require('dive')
const iltorb = require('iltorb')
const Logger = require('basic-logger')
const S3 = require('aws-sdk/clients/s3')
const Worker = require('tiny-worker')

process.title = 'marian'

const MAXIMUM_QUERY_LENGTH = 100

// If a worker's backlog rises above this threshold, reject the request.
// This prevents the server from getting bogged down for unbounded periods of time.
const MAXIMUM_BACKLOG = 10
const WARNING_BACKLOG = 8

const log = new Logger({
    showTimestamp: true,
})

/**
 * Find an acceptable compression format for the client, and return a compressed
 * version of the content if possible. Otherwise return the original input text.
 *
 * Supports Brotli and gzip.
 *
 * @param {http.IncomingMessage} req The HTTP request object.
 * @param {map} headers The headers object which will be used in the response.
 * @param {string} content The text to compress.
 * @return {Buffer|string}
 */
function compress(req, headers, content) {
    const acceptEncoding = (req.headers['accept-encoding'] || '').split(',').map((e) => e.trim())
    if (acceptEncoding.indexOf('br') > -1) {
        headers['Content-Encoding'] = 'br'
        return util.promisify(iltorb.compress)(Buffer.from(content), {
            quality: 4
        })
    } else if (acceptEncoding.indexOf('gzip') > -1) {
        headers['Content-Encoding'] = 'gzip'
        return util.promisify(zlib.gzip)(content)
    }

    return new Promise((resolve) => resolve(content))
}

/**
 * If the request method does not match the method parameter, return false
 * and write a 405 status code. Otherwise return true.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} method
 * @return {boolean}
 */
function checkMethod(req, res, method) {
    if (req.method !== method) {
        res.writeHead(405, {})
        res.end('')
        return false
    }

    return true
}

/** A web worker with a promise-oriented message-call interface. */
class TaskWorker {
    /**
     * Create a new TaskWorker.
     * @param {string} scriptPath - A path to a JS file to execute.
     */
    constructor(scriptPath) {
        this.worker = new Worker(scriptPath)
        this.worker.onmessage = this.onmessage.bind(this)

        this.backlog = 0
        this.pending = new Map()
        this.messageId = 0
    }

    /**
     * Send a message to this TaskWorker.
     * @param {map} message - An object to send to the worker.
     * @return {Promise}
     */
    send(message) {
        if (this.backlog > MAXIMUM_BACKLOG) {
            throw new Error('backlog-exceeded')
        }

        return new Promise((resolve, reject) => {
            const messageId = this.messageId
            this.messageId += 1
            this.backlog += 1

            this.worker.postMessage({message: message, messageId: messageId})
            this.pending.set(messageId, [resolve, reject])
        })
    }

    /**
     * Handler for messages received from the worker.
     * @private
     * @param {MessageEvent} event
     * @return {Promise<?, Error>}
     */
    onmessage(event) {
        const pair = this.pending.get(event.data.messageId)
        if (!pair) {
            log.error(`Got unknown message ID ${event.data.messageId}`)
            return
        }

        this.backlog -= 1
        this.pending.delete(event.data.messageId)
        const [resolve, reject] = pair
        if (event.data.error) {
            reject(new Error(event.data.error))
            return
        }

        resolve(event.data)
    }
}

function workerIndexer() {
    require('process').title = 'marian-indexer'
    const lunr = require('lunr')

    const words = new Set()

    function tokenPositionPlugin(builder) {
        // Define a pipeline function that stores the token offset as metadata

        var pipelineFunction = function (token, pos) {
            token.metadata['pos'] = pos
            words.add(token.str)
            return token
        }

        // Register the pipeline function so the index can be serialised
        lunr.Pipeline.registerFunction(pipelineFunction, 'tokenPositionMetadata')

        // Add the pipeline function to the indexing pipeline
        builder.pipeline.before(lunr.stemmer, pipelineFunction)

        // Whitelist the pos metadata key
        builder.metadataWhitelist.push('pos')
    }

    this.onmessage = function(event) {
        const manifests = event.data

        const documents = {}
        const index = lunr(function() {
            this.use(tokenPositionPlugin)
            this.field('title')
            this.field('text')

            for (const manifest of manifests) {
                for (const doc of manifest.documents) {
                    this.add({
                        id: doc.url,
                        title: doc.title,
                        text: doc.text,
                    })

                    documents[doc.url] = doc
                }
            }
        })

        postMessage({
            index: index.toJSON(),
            documents: documents,
            words: Array.from(words)
        })

        words.clear()
    }
}

class Index {
    constructor(manifestSource) {
        this.manifestSource = manifestSource
        this.manifestSyncDates = new Map()
        this.errors = []

        this.lastSyncDate = null

        this.workers = new Pool(os.cpus().length, () => new TaskWorker(pathModule.join(__dirname, 'worker-searcher.js')))

        this.workerIndexer = new Worker(workerIndexer)
        this.workerIndexer.onmessage = async (event) => {
            for (const worker of this.workers.pool) {
                await worker.send({sync: event.data})
            }

            this.lastSyncDate = new Date()
            // This date will be used to compare against incoming request HTTP dates,
            // which truncate the milliseconds.
            this.lastSyncDate.setMilliseconds(0)

            log.info('Loaded new index')
        }
    }

    getStatus() {
        return {
            manifests: Array.from(this.manifestSyncDates.keys()),
            lastSync: {
                errors: this.errors,
                finished: this.lastSyncDate ? this.lastSyncDate.toISOString() : null
            },
            workers: this.workers.pool.map((worker) => worker.backlog)
        }
    }

    search(queryString, searchProperty) {
        return this.workers.get().send({search: {
            queryString: queryString,
            searchProperty: searchProperty
        }}).then((message) => message.results)
    }

    async getManifestsFromS3(bucketName, prefix) {
        const s3 = new S3({apiVersion: '2006-03-01'})
        const result = await util.promisify(s3.makeUnauthenticatedRequest.bind(s3))('listObjectsV2', {
            Bucket: bucketName,
            Prefix: prefix
        })

        if (result.IsTruncated) {
            // This would indicate something awry, since we shouldn't
            // ever have more than 1000 properties. And if we ever did,
            // everything would need to be rearchitected.
            throw new Error('Got truncated response from S3')
        }

        const manifests = []
        for (const bucketEntry of result.Contents) {
            if (bucketEntry.Size === 0) {
                continue
            }

            const matches = bucketEntry.Key.match(/([^/]+).json$/)
            if (matches === null) {
                this.errors.push(`Got weird filename in manifest listing: "${bucketEntry.Key}"`)
                continue
            }

            const searchProperty = matches[1]
            let data
            try {
                data = await util.promisify(s3.makeUnauthenticatedRequest.bind(s3))('getObject', {
                    Bucket: bucketName,
                    Key: bucketEntry.Key,
                    IfModifiedSince: this.manifestSyncDates.get(searchProperty)
                })
            } catch(err) {
                if (err.code === 'NotModified') { continue }
                throw err
            }

            manifests.push({
                body: JSON.parse(data.Body),
                lastModified: data.LastModified,
                searchProperty: searchProperty
            })
        }

        return manifests
    }

    getManifestsFromDirectory(prefix) {
        return new Promise((resolve, reject) => {
            const manifests = []

            dive(prefix, (err, path, stats) => {
                if (err) { reject(err) }
                const matches = path.match(/([^/]+).json$/)
                if (!matches) { return }
                const searchProperty = matches[1]

                manifests.push({
                    body: JSON.parse(fs.readFileSync(path, {encoding: 'utf-8'})),
                    lastModified: stats.mtime,
                    searchProperty: searchProperty
                })
            }, () => {
                resolve(manifests)
            })})
    }

    async load() {
        this.errors = []

        const parsedSource = this.manifestSource.match(/((?:bucket)|(?:dir)):(.+)/)
        if (!parsedSource) {
            throw new Error('Bad manifest source')
        }

        let manifests
        if (parsedSource[1] === 'bucket') {
            const parts = parsedSource[2].split('/', 2)
            const bucketName = parts[0].trim()
            const prefix = parts[1].trim()
            if (!bucketName.length || !prefix.length) {
                throw new Error('Bad bucket manifest source')
            }
            manifests = await this.getManifestsFromS3(bucketName, prefix)
        } else if (parsedSource[1] === 'dir') {
            manifests = await this.getManifestsFromDirectory(parsedSource[2])
        } else {
            throw new Error('Unknown manifest source protocol')
        }

        manifests = manifests.map((manifest) => {
            const documents = []
            for (const doc of manifest.body.documents) {
                manifest.url = manifest.body.url.replace(/\/+$/, '')
                doc.searchProperty = manifest.searchProperty
                doc.includeInGlobalSearch = manifest.body.includeInGlobalSearch
                doc.slug = doc.slug.replace(/^\/+/, '')
                doc.url = `${manifest.body.url}/${doc.slug}`
                documents.push(doc)
            }

            this.manifestSyncDates.set(manifest.searchProperty, manifest.lastModified)

            return {
                documents: documents,
                searchProperty: manifest.searchProperty
            }
        })

        this.workerIndexer.postMessage(manifests)
    }
}

class Marian {
    constructor(bucket) {
        this.index = new Index(bucket)
    }

    start(port) {
        const server = http.createServer(async (req, res) => {
            try {
                await this.handle(req, res)
            } catch(err) {
                log.error(err)
                res.writeHead(500, {})
                res.end('')
            }
        })

        server.listen(port, () => {
            log.info(`Listening on port ${port}`)
        })
    }

    handle(req, res) {
        const parsedUrl = url.parse(req.url, true)

        const pathname = parsedUrl.pathname.replace(/\/+$/, '')
        if (pathname === '/search') {
            if (checkMethod(req, res, 'GET')) {
                this.handleSearch(parsedUrl, req, res)
            }
        } else if (pathname === '/refresh') {
            if (checkMethod(req, res, 'POST')) {
                this.handleRefresh(parsedUrl, req, res)
            }
        } else if (pathname === '/status') {
            if (checkMethod(req, res, 'GET')) {
                this.handleStatus(parsedUrl, req, res)
            }
        } else {
            res.writeHead(400, {})
            res.end('')
        }
    }

    async handleRefresh(parsedUrl, req, res) {
        const headers = {
            'Vary': 'Accept-Encoding'
        }

        try {
            await this.index.load()
        } catch(err) {
            headers['Content-Type'] = 'application/json'
            const body = await compress(req, headers, JSON.stringify({'errors': [err]}))
            res.writeHead(500, headers)
            res.end(body)
            return
        }

        if (this.index.errors.length > 0) {
            headers['Content-Type'] = 'application/json'
            const body = await compress(req, headers, JSON.stringify({'errors': this.index.errors}))
            res.writeHead(200, headers)
            res.end(body)
            return
        }

        res.writeHead(200, headers)
        res.end('')
    }

    async handleStatus(parsedUrl, req, res) {
        const headers = {
            'Content-Type': 'application/json',
            'Vary': 'Accept-Encoding',
            'Pragma': 'no-cache'
        }

        const status = this.index.getStatus()
        let body = JSON.stringify(status)
        body = await compress(req, headers, body)

        // If all workers are overloaded, return 503
        let statusCode = 200
        if (status.workers.filter((n) => n <= WARNING_BACKLOG).length === 0) {
            statusCode = 503
        }

        res.writeHead(statusCode, headers)
        res.end(body)
    }

    async handleSearch(parsedUrl, req, res) {
        const headers = {
            'Content-Type': 'application/json',
            'Vary': 'Accept-Encoding',
            'Cache-Control': 'public,max-age=120,must-revalidate',
            'Access-Control-Allow-Origin': '*',
        }

        if (req.headers['if-modified-since'] && this.index.lastSyncDate) {
            const ifModifiedSince = new Date(req.headers['if-modified-since'])
            if (ifModifiedSince >= this.index.lastSyncDate) {
                res.writeHead(304, headers)
                res.end('')
                return
            }
        }

        if (parsedUrl.query.length > MAXIMUM_QUERY_LENGTH) {
            res.writeHead(400, headers)
            res.end('[]')
            return
        }

        const query = parsedUrl.query.q
        if (!query) {
            res.writeHead(400, headers)
            res.end('[]')
            return
        }

        let results
        try {
            results = await this.index.search(query, parsedUrl.query.searchProperty)
        } catch (err) {
            if (err.message === 'still-indexing' || err.message === 'backlog-exceeded') {
                // Search index isn't yet loaded, or our backlog is out of control
                res.writeHead(503, headers)
                res.end('[]')
                return
            } else if (err.message === 'query-too-long') {
                res.writeHead(400, headers)
                res.end('[]')
                return
            }

            log.error(err)
        }

        headers['Last-Modified'] = this.index.lastSyncDate.toUTCString()
        let responseBody = JSON.stringify(results)

        responseBody = await compress(req, headers, responseBody)
        res.writeHead(200, headers)
        res.end(responseBody)
    }
}

async function main() {
    Logger.setLevel('info', true)
    const server = new Marian(process.argv[2])

    try {
        await server.index.load()
    } catch (err) {
        log.error('Error while initially loading index')
        log.error(err)
        return
    }

    // Warn about nonfatal error conditions
    if (server.index.errors.length) {
        log.error('Got errors while initially loading index')
        log.error(server.index.errors)
    }

    server.start(8000)
}

main()
