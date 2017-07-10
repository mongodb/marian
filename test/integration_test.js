#!/usr/bin/env node
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

async function test(port) {
    assert.ok(port)

    let result = await get(`http://localhost:${port}/status`)
    assert.strictEqual(result.response.statusCode, 200)
    assert.strictEqual(result.response.headers['content-type'], 'application/json')
    assert.ok(result.json.lastSync.finished)
    assert.deepStrictEqual(result.json.manifests.sort(), ['bi-connector-master', 'mongodb-ecosystem-master'])

    // Test normalish query
    result = await get(`http://localhost:${port}/search?q=${encodeURIComponent('"aggregation report" use cases')}`)
    assert.strictEqual(result.response.statusCode, 200)
    assert.strictEqual(result.response.headers['content-type'], 'application/json')
    assert.deepStrictEqual(result.json.spellingCorrections, {})

    // Test spelling correction
    result = await get(`http://localhost:${port}/search?q=${encodeURIComponent('quary')}`)
    assert.strictEqual(result.response.statusCode, 200)
    assert.strictEqual(result.response.headers['content-type'], 'application/json')
    assert.deepStrictEqual(result.json.spellingCorrections, {'quary': 'query'})

    // Test If-Modified-Since
    result = await get({
        port: port,
        path: `/search?q=${encodeURIComponent('quary')}`,
        headers: {
            'If-Modified-Since': new Date().toUTCString()
        }})
    assert.strictEqual(result.response.statusCode, 304)
    result = await get({
        port: port,
        path: `/search?q=${encodeURIComponent('quary')}`,
        headers: {
            'If-Modified-Since': new Date(0).toUTCString()
        }})
    assert.strictEqual(result.response.statusCode, 200)
}

function main() {
    let port = null
    const child = child_process.spawn(process.argv[2], {
        shell: true,
        stdio: [0, 'pipe', 2]
    })

    const rl = readline.createInterface({
        input: child.stdout
    })

    rl.on('line', async (line) => {
        const match = line.match(/Listening on port ([0-9]+)/)
        if (match) {
            port = parseInt(match[1])
        }

        if (line.match(/Loaded new index/)) {
            try {
                await test(port)
            } catch (err) {
                console.error(err)
            } finally {
                process.kill(child.pid, 'SIGINT')
            }
        }
    })

    rl.on('end', () => {
        rl.close()
    })
}

main()
