'use strict'

const { Buffer } = require('buffer')
const http = require('http')
const url = require('url')
const util = require('util')
const zlib = require('zlib')

const iltorb = require('iltorb')
const lunr = require('lunr')
const S3 = require('aws-sdk/clients/s3')
const Worker = require('tiny-worker')

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
async function compress(req, headers, content) {
    const acceptEncoding = (req.headers['accept-encoding'] || '').split(',').map((e) => e.trim())
    if (acceptEncoding.indexOf('br') > -1) {
        headers['Content-Encoding'] = 'br'
        return await (util.promisify(iltorb.compress)(new Buffer(content), {
            quality: 4
        }))
    } else if (acceptEncoding.indexOf('gzip') > -1) {
        headers['Content-Encoding'] = 'gzip'
        return await (util.promisify(zlib.gzip)(content))
    }

    return content
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

class Manifest {
    constructor(searchProperty, manifestUrl, options) {
        this.searchProperty = searchProperty
        this.manifestUrl = manifestUrl

        this.baseUrl = options.url
        this.documents = options.documents

        this.lastSync = null
    }

    getStatus() {
        return {
            'searchProperty': this.searchProperty,
            'url': this.url,
            'nDocuments': this.documents.length
        }
    }
}

function workerIndexer() {
    const lunr = require('lunr')

    this.onmessage = function(event) {
        const manifests = event.data

        const index = lunr(function() {
            this.field('searchProperty')
            this.field('title')
            this.field('text')

            for (const manifest of manifests) {
                for (const doc of manifest.documents) {
                    this.add({
                        id: doc.url,
                        searchProperty: manifest.searchProperty,
                        title: doc.title,
                        text: doc.text,
                    })
                }
            }
        })


        postMessage(index.toJSON())
    }
}

class Index {
    constructor(bucket) {
        this.bucket = bucket
        this.documents = new Map()
        this.manifests = {}
        this.errors = []

        this.index = null

        this.workerIndexer = new Worker(workerIndexer)
        this.workerIndexer.onmessage = (event) => {
            this.index = lunr.Index.load(event.data)
        }
    }

    getStatus() {
        return {
            manifests: Object.values(this.manifests).map((m) => m.getStatus()),
            lastSyncErrors: this.errors
        }
    }

    search(query) {
        if (!this.index) {
            throw new Error('Search index not yet ready')
        }

        const rawResults = this.index.search(query).slice(0, 100).map((match) => {
            const doc = this.documents.get(match.ref)
            return {
                title: doc.title,
                preview: doc.preview,
                url: doc.url
            }
        })

        return rawResults
    }

    async load() {
        this.errors = []

        const s3 = new S3({apiVersion: '2006-03-01'})
        const result = await util.promisify(s3.listObjectsV2.bind(s3))({
            Bucket: this.bucket,
            Prefix: 'search-indexes/'
        })

        if (result.IsTruncated) {
            // This would indicate something awry, since we shouldn't
            // ever have more than 1000 properties. And if we ever did,
            // everything would need to be rearchitected.
            throw new Error('Got truncated response from S3')
        }

        for (const bucketEntry of result.Contents) {
            if (bucketEntry.Size === 0) {
                continue
            }

            const matches = bucketEntry.Key.match(/([^/]+).json$/)
            if (matches === null) {
                this.errors.push(`Got weird filename in manifest listing: "${bucketEntry.Key}"`)
                continue
            }

            const projectName = matches[1]
            const manifest = this.manifests[projectName]
            let lastSync = null
            if (manifest !== undefined) {
                lastSync = manifest.lastSync
            }

            let data
            try {
                data = await util.promisify(s3.getObject.bind(s3))({
                    Bucket: this.bucket,
                    Key: bucketEntry.Key,
                    IfModifiedSince: lastSync
                })
            } catch(err) {
                if (err.code === 'NotModified') { continue }
                throw err
            }

            const parsedManifestData = JSON.parse(data.Body)
            for (const doc of parsedManifestData.documents) {
                parsedManifestData.url = parsedManifestData.url.replace(/\/+$/, '')
                doc.slug = doc.slug.replace(/^\/+/, '')
                doc.url = `${parsedManifestData.url}/${doc.slug}`
                this.documents.set(doc.url, doc)
            }

            const newManifest = new Manifest(projectName, url, parsedManifestData)
            newManifest.lastSync = data.LastModified
            this.manifests[projectName] = newManifest
        }

        this.workerIndexer.postMessage(Object.values(this.manifests))
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
                console.error(err)
                res.writeHead(500, {})
                res.end('')
                return
            }
        })

        console.log(`Listening on port ${port}`)
        server.listen(port)
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
            'Vary': 'Accept-Encoding'
        }

        let body = JSON.stringify(this.index.getStatus())
        body = await compress(req, headers, body)

        res.writeHead(200, headers)
        res.end(body)
    }

    async handleSearch(parsedUrl, req, res) {
        const query = parsedUrl.query.q
        if (!query) {
            res.writeHead(400, {})
            res.end('')
            return
        }

        let results
        try {
            results = this.index.search(query)
        } catch(err) {
            // Search index isn't yet loaded; try again later
            res.writeHead(503, {})
            res.end('')
            return
        }

        let responseBody = JSON.stringify(results)

        const headers = {
            'Content-Type': 'application/json',
            'Vary': 'Accept-Encoding'
        }

        responseBody = await compress(req, headers, responseBody)
        res.writeHead(200, headers)
        res.end(responseBody)
    }
}

async function main() {
    const server = new Marian('docs-mongodb-org-prod')

    try {
        await server.index.load()
    } catch(err) {
        console.error('Error while initially loading index')
        console.error(err)
        return
    }

    // Warn about nonfatal error conditions
    if (server.index.errors.length) {
        console.error('Got errors while initially loading index')
        console.error(server.index.errors)
    }

    server.start(8000)
}

main()