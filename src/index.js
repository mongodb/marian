#!/usr/bin/env node
'use strict'

const { Buffer } = require('buffer')
const fs = require('fs')
const http = require('http')
const process = require('process')
const url = require('url')
const util = require('util')
const zlib = require('zlib')

const { Searcher } = require('./searcher.js')
const dive = require('dive')
const iltorb = require('iltorb')
const Logger = require('basic-logger')
const S3 = require('aws-sdk/clients/s3')
const stitch = require('mongodb-stitch')

process.title = 'marian'

const MAXIMUM_QUERY_LENGTH = 100

const STANDARD_HEADERS = {
    'X-Content-Type-Options': 'nosniff'
}

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

class Index {
    constructor(manifestSource) {
        this.manifestSource = manifestSource
        this.manifests = []
        this.searcher = new Searcher()
        this.errors = []

        this.lastSyncDate = null
        this.rebuildRequests = []
    }

    getStatus() {
        return {
            manifests: this.manifests,
            lastSync: {
                errors: this.errors,
                finished: this.lastSyncDate ? this.lastSyncDate.toISOString() : null
            },
            rebuildRequests: this.rebuildRequests
        }
    }

    search(queryString, searchProperty) {
        const searchProperties = (searchProperty || '').split(',').filter((x) => x)
        return this.searcher.search(queryString, searchProperties)
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
            const data = await util.promisify(s3.makeUnauthenticatedRequest.bind(s3))('getObject', {
                Bucket: bucketName,
                Key: bucketEntry.Key
            })

            manifests.push({
                body: data.Body.toString('utf-8'),
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
                    body: fs.readFileSync(path, {encoding: 'utf-8'}),
                    lastModified: stats.mtime,
                    searchProperty: searchProperty
                })
            }, () => {
                resolve(manifests)
            })})
    }

    async getManifests() {
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

        return manifests
    }

    load() {
        this.rebuildRequests.push(new Date())
        if (this.rebuildRequests.length > 1) {
            return
        }

        setImmediate(async () => {
            while (this.rebuildRequests.length > 0) {
                if (this.rebuildRequests.length > 1) {
                    this.rebuildRequests = this.rebuildRequests.slice(-1)
                }

                let manifests
                try {
                    manifests = await this.getManifests()
                } catch (err) {
                    this.errors.push(err)
                    throw err
                }

                this.errors = []
                const enlapsedMs = await this.searcher.sync(manifests)
                this.lastSyncDate = new Date()
                this.manifests = manifests.map((manifest) => manifest.searchProperty)
                log.info(`Loaded new index in ${enlapsedMs}ms`)

                this.rebuildRequests = this.rebuildRequests.slice(1)
            }
        })
    }
}

class Marian {
    constructor(bucket, loggingConfig) {
        this.index = new Index(bucket)

        this.queryLoggingClient = null

        if (loggingConfig) {
            let queryLoggingClient
            stitch.StitchClientFactory.create(loggingConfig.serviceName).then((client) => {
                queryLoggingClient = client
                return queryLoggingClient.authenticate('apiKey', loggingConfig.apiKey)
            }).then(() => {
                log.info('Signed into logging service')
                this.queryLoggingClient = queryLoggingClient
            }).catch((err) => {
                log.error(`Failed to login to query logging database: ${err}`)
            })
        }

        this.index.load()
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

        Object.assign(headers, STANDARD_HEADERS)

        this.index.load()
        res.writeHead(200, headers)
        res.end('')
    }

    async handleStatus(parsedUrl, req, res) {
        const headers = {
            'Content-Type': 'application/json',
            'Vary': 'Accept-Encoding',
            'Pragma': 'no-cache'
        }
        Object.assign(headers, STANDARD_HEADERS)

        const status = this.index.getStatus()
        let body = JSON.stringify(status)
        body = await compress(req, headers, body)

        const statusCode = this.index.errors.length > 0 ? 500 : 200
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
        Object.assign(headers, STANDARD_HEADERS)

        if (req.headers['if-modified-since'] && this.index.lastSyncDate) {
            const lastSyncDateNoMilliseconds = new Date(this.index.lastSyncDate)
            // HTTP dates truncate the milliseconds.
            lastSyncDateNoMilliseconds.setMilliseconds(0)

            const ifModifiedSince = new Date(req.headers['if-modified-since'])
            if (ifModifiedSince >= lastSyncDateNoMilliseconds) {
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
            if (err.message === 'still-indexing' || err.message === 'backlog-exceeded' || err.message === 'pool-unavailable') {
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

        // Now that we've responded, try to log the search query
        if (this.queryLoggingClient) {
            this.queryLoggingClient.executeFunction('docsSearchTerms', parsedUrl.query.q).catch((err) => {
                log.error(`Failed to log query: ${err}`)
            })
        }
    }
}

async function main() {
    Logger.setLevel('info', true)

    let loggingConfig = null
    const loggingConfigComponents = (process.env.LOGGING_CONFIG || ':').split(':')
    if (loggingConfigComponents.length != 2) {
        throw new Error(`Invalid LOGGING_CONFIG: "${process.env.LOGGING_CONFIG}"`)
    }

    if (loggingConfigComponents[0]) {
        loggingConfig = {}
        loggingConfig.serviceName = loggingConfigComponents[0]
        loggingConfig.apiKey = loggingConfigComponents[1]
    }

    const server = new Marian(process.argv[2], loggingConfig)
    server.start(8000)
}

main()
