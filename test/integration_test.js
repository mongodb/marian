#!/usr/bin/env node
/* eslint-env node, mocha */
'use strict'

const assert = require('assert')
const child_process = require('child_process')
const http = require('http')
const process = require('process')
const readline = require('readline')

function get(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            res.setEncoding('utf8')
            let data = ''

            res.on('data', (chunk) => { data += chunk })
            res.on('end', () => {
                resolve({
                    response: res,
                    json: data ? JSON.parse(data) : undefined
                })
            })
            res.on('error', (err) => {
                reject(err)
            })
        })
    })
}

describe('integration', function() {
    this.slow(100)

    let child
    let port
    let rl

    before('starting server', function(done) {
        child = child_process.spawn('./src/index.js', ['dir:test/manifests/'], {
            stdio: [0, 'pipe', 2]
        })

        rl = readline.createInterface({
            input: child.stdout
        })

        rl.on('line', (line) => {
            const match = line.match(/Listening on port ([0-9]+)/)
            if (match) {
                port = parseInt(match[1])
            }

            if (line.match(/Loaded new index/)) {
                done()
            } else if (line.match(/Error/)) {
                throw new Error(line)
            }
        })

        rl.on('error', (err) => {
            throw err
        })

        rl.on('end', () => {
            rl.close()
        })
    })

    it('should print port to stdout', () => {
        assert.ok(port)
    })

    it('should return proper /status document', async () => {
        const result = await get(`http://localhost:${port}/status`)
        assert.strictEqual(result.response.statusCode, 200)
        assert.strictEqual(result.response.headers['content-type'], 'application/json')
        assert.ok(result.json.lastSync.finished)
        assert.deepStrictEqual(result.json.manifests.sort(), ['bi-connector-master', 'mongodb-ecosystem-master'])
    })

    it('should return proper results for a normal query', async () => {
        const result = await get(`http://localhost:${port}/search?q=${encodeURIComponent('"aggregation report" use cases')}`)
        assert.strictEqual(result.response.statusCode, 200)
        assert.strictEqual(result.response.headers['content-type'], 'application/json')
        assert.deepStrictEqual(result.json.spellingCorrections, {})
        assert.strictEqual(result.json.results.length, 6)
        assert.strictEqual(result.json.results[0].title, 'Use Cases')
    })

    // Test spelling correction
    it('should return spelling corrections', async () => {
        const result = await get(`http://localhost:${port}/search?q=quary`)
        assert.strictEqual(result.response.statusCode, 200)
        assert.strictEqual(result.response.headers['content-type'], 'application/json')
        assert.deepStrictEqual(result.json.spellingCorrections, {'quary': 'query'})
    })

    // Test variants of searchProperty
    it('should properly handle searchProperty', async () => {
        let result = await get(`http://localhost:${port}/search?q=aggregation`)
        assert.strictEqual(result.response.statusCode, 200)
        assert.strictEqual(result.response.headers['content-type'], 'application/json')
        assert.strictEqual(result.json.results.length, 18)

        const result2 = await get(`http://localhost:${port}/search?q=aggregation&searchProperty=mongodb-ecosystem-master,bi-connector-master`)
        assert.deepStrictEqual(result.json, result2.json)

        result = await get(`http://localhost:${port}/search?q=aggregation&searchProperty=mongodb-ecosystem-master`)
        assert.strictEqual(result.response.statusCode, 200)
        assert.strictEqual(result.response.headers['content-type'], 'application/json')
        assert.strictEqual(result.json.results.length, 12)
    })

    it('should return 304 if index hasn\'t changed', async () => {
        const result = await get({
            port: port,
            path: `/search?q=${encodeURIComponent('quary')}`,
            headers: {
                'If-Modified-Since': new Date().toUTCString()
            }})
        assert.strictEqual(result.response.statusCode, 304)
    })

    it('should NOT return 304 if index has changed', async () => {
        const result = await get({
            port: port,
            path: `/search?q=${encodeURIComponent('quary')}`,
            headers: {
                'If-Modified-Since': new Date(0).toUTCString()
            }})
        assert.strictEqual(result.response.statusCode, 200)
    })

    after('shutting down', function() {
        process.kill(child.pid, 'SIGINT')
    })
})
