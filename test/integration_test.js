#!/usr/bin/env node
/* eslint-env node, mocha */
'use strict'

const assert = require('assert')
const child_process = require('child_process')
const http = require('http')
const process = require('process')
const readline = require('readline')

function request(url) {
    return new Promise((resolve, reject) => {
        http.request(url, (res) => {
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
        }).end()
    })
}

describe('integration', function() {
    this.slow(100)

    let child
    let port
    let rl

    before('starting server', function(done) {
        let isDone = false
        child = child_process.spawn('./src/index.js', ['dir:test/manifests/'], {
            stdio: [0, 'pipe', 2]
        })

        rl = readline.createInterface({
            input: child.stdout
        })

        rl.on('line', (line) => {
            if (isDone) { return }

            const match = line.match(/Listening on port ([0-9]+)/)
            if (match) {
                port = parseInt(match[1])
            }

            if (line.match(/Loaded new index/)) {
                isDone = true
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

    let lastSync
    function testFunctionality() {
        it('should return proper /status document', async () => {
            const result = await request(`http://localhost:${port}/status`)
            assert.strictEqual(result.response.statusCode, 200)
            assert.strictEqual(result.response.headers['content-type'], 'application/json')
            assert.ok(result.json.lastSync.finished)
            lastSync = result.json.lastSync.finished
            assert.deepStrictEqual(result.json.manifests.sort(), ['atlas-master', 'bi-connector-master'])
        })

        it('should return proper results for a normal query', async () => {
            const result = await request(`http://localhost:${port}/search?q=${encodeURIComponent('"connect dialog" compass')}`)
            assert.strictEqual(result.response.statusCode, 200)
            assert.strictEqual(result.response.headers['content-type'], 'application/json')
            assert.deepStrictEqual(result.json, {'results':[{'title':'Connect via Compass — MongoDB Atlas','preview':'The Connect dialog for a cluster provides the details to connect to a cluster via Compass.','url':'https://docs.atlas.mongodb.com/compass-connection/index.html'},{'title':'Connect via Driver — MongoDB Atlas','preview':'The Connect dialog for a cluster provides the details to connect to a cluster with an application using a MongoDB driver.','url':'https://docs.atlas.mongodb.com/driver-connection/index.html'},{'title':'Connect via mongo Shell — MongoDB Atlas','preview':'The Connect dialog for a cluster provides the details to connect to a cluster via the mongo shell.','url':'https://docs.atlas.mongodb.com/mongo-shell-connection/index.html'},{'title':'Connect to a Cluster — MongoDB Atlas','preview':'Atlas provides instructions on connecting to a cluster via the mongo shell, a MongoDB driver, or MongoDB Compass via the Atlas UI.','url':'https://docs.atlas.mongodb.com/connect-to-cluster/index.html'},{'title':'Set up VPC Peering Connection — MongoDB Atlas','preview':'For Atlas clusters deployed on Google Cloud Platform or Microsoft Azure, add the IP addresses of your GCP or Azure services to Atlas group IP whitelist to grant those services access to the cluster.','url':'https://docs.atlas.mongodb.com/security-vpc-peering/index.html'},{'title':'Connect from Tableau Desktop — MongoDB Connector for BI 2.2','preview':'The MongoDB Connector for BI is a named connector in Tableau.','url':'https://docs.mongodb.com/bi-connector/current/connect/tableau/index.html'},{'title':'Load File with mongoimport — MongoDB Atlas','preview':'You can use mongoimport to import data from a JSON or a CSV file into MongoDB Atlas cluster.','url':'https://docs.atlas.mongodb.com/import/mongoimport/index.html'},{'title':'MongoDB Atlas — MongoDB Atlas','preview':'MongoDB Atlas is a cloud service for running, monitoring, and maintaining MongoDB deployments, including the provisioning of dedicated servers for the MongoDB instances. In addition, Atlas provides the ability to introspect collections, query backups, and migrate data from existing MongoDB replica set into an Atlas cluster.','url':'https://docs.atlas.mongodb.com/index.html'},{'title':'Migrate with mongomirror — MongoDB Atlas','preview':'mongomirror is a utility for migrating data from an existing MongoDB replica set to a MongoDB Atlas replica set. mongomirror does not require you to shut down your existing replica set or applications.','url':'https://docs.atlas.mongodb.com/import/mongomirror/index.html'}],'spellingCorrections':{}})
        })

        // Test spelling correction
        it('should return spelling corrections', async () => {
            const result = await request(`http://localhost:${port}/search?q=quary`)
            assert.strictEqual(result.response.statusCode, 200)
            assert.strictEqual(result.response.headers['content-type'], 'application/json')
            assert.deepStrictEqual(result.json.spellingCorrections, {'quary': 'query'})
        })

        // Test variants of searchProperty
        it('should properly handle searchProperty', async () => {
            let result = await request(`http://localhost:${port}/search?q=aggregation`)
            assert.strictEqual(result.response.statusCode, 200)
            assert.strictEqual(result.response.headers['content-type'], 'application/json')
            assert.deepStrictEqual(result.json, {'results':[{'title':'Schema Configuration — MongoDB Connector for BI 2.2','preview':'Business intelligence tools connect to a data source and, given a fixed tabular schema, allow the user to visually explore their data. As MongoDB uses a flexible schema, these tools currently cannot use MongoDB as a native data source.','url':'https://docs.mongodb.com/bi-connector/current/schema-configuration/index.html'},{'title':'Supported SQL Functions and Operators — MongoDB Connector for BI 2.2','preview':'MongoDB Connector for BI Version 2.2 is compatible with SQL-99 SELECT statements.','url':'https://docs.mongodb.com/bi-connector/current/supported-operations/index.html'},{'title':'mongosqld — MongoDB Connector for BI 2.2','preview':'The mongosqld command man page.','url':'https://docs.mongodb.com/bi-connector/current/reference/mongosqld/index.html'},{'title':'mongodrdl — MongoDB Connector for BI 2.2','preview':'The mongodrdl command man page.','url':'https://docs.mongodb.com/bi-connector/current/reference/mongodrdl/index.html'},{'title':'Create a Cluster — MongoDB Atlas','preview':'Atlas-managed MongoDB deployments, or “clusters”, can be either a replica set or a sharded cluster.','url':'https://docs.atlas.mongodb.com/create-new-cluster/index.html'},{'title':'FAQ: The MongoDB Connector for BI — MongoDB Connector for BI 2.2','preview':'Changed in version 2.0: Prior to version 2.0, the MongoDB Connector for BI stored its own separate set of credentials.','url':'https://docs.mongodb.com/bi-connector/current/faq/index.html'},{'title':'MongoDB Reference — MongoDB Atlas','preview':'For a comprehensive documentation of MongoDB, refer to the MongoDB Manual. The following sections in the manual provide some starting points for developing with MongoDB.','url':'https://docs.atlas.mongodb.com/mongodb-reference/index.html'},{'title':'Monitor a Cluster — MongoDB Atlas','preview':'Atlas collects and displays metrics for your servers, databases, and MongoDB processes. Atlas displays three charts in the Clusters view and additional charts in the Metrics view.','url':'https://docs.atlas.mongodb.com/monitor-cluster-metrics/index.html'},{'title':'Command Limitations in Free Tier Clusters — MongoDB Atlas','preview':'Atlas Free Tier clusters do not support all functionality available to other clusters.','url':'https://docs.atlas.mongodb.com/unsupported-commands/index.html'},{'title':'Query a Backup Snapshot — MongoDB Atlas','preview':'Atlas provides queryable backups. This functionality allows you to query specific backup snapshot. You can use the queryable backups to:','url':'https://docs.atlas.mongodb.com/query-backup/index.html'},{'title':'Release Notes for MongoDB Connector for BI — MongoDB Connector for BI 2.2','preview':'Supports authenticating directly against MongoDB using the new C and JDBC authentication plugins. These plugins support SCRAM-SHA-1 and PLAIN mechanisms and remove the SSL requirement for authentication. The authentication plugins can be found on GitHub:','url':'https://docs.mongodb.com/bi-connector/current/release-notes/index.html'}],'spellingCorrections':{}})

            const result2 = await request(`http://localhost:${port}/search?q=aggregation&searchProperty=atlas-master,bi-connector-master`)
            assert.deepStrictEqual(result.json, result2.json)

            result = await request(`http://localhost:${port}/search?q=aggregation&searchProperty=bi-connector-master`)
            assert.strictEqual(result.response.statusCode, 200)
            assert.strictEqual(result.response.headers['content-type'], 'application/json')
            assert.deepStrictEqual(result.json, {'results':[{'title':'Schema Configuration — MongoDB Connector for BI 2.2','preview':'Business intelligence tools connect to a data source and, given a fixed tabular schema, allow the user to visually explore their data. As MongoDB uses a flexible schema, these tools currently cannot use MongoDB as a native data source.','url':'https://docs.mongodb.com/bi-connector/current/schema-configuration/index.html'},{'title':'Supported SQL Functions and Operators — MongoDB Connector for BI 2.2','preview':'MongoDB Connector for BI Version 2.2 is compatible with SQL-99 SELECT statements.','url':'https://docs.mongodb.com/bi-connector/current/supported-operations/index.html'},{'title':'mongosqld — MongoDB Connector for BI 2.2','preview':'The mongosqld command man page.','url':'https://docs.mongodb.com/bi-connector/current/reference/mongosqld/index.html'},{'title':'mongodrdl — MongoDB Connector for BI 2.2','preview':'The mongodrdl command man page.','url':'https://docs.mongodb.com/bi-connector/current/reference/mongodrdl/index.html'},{'title':'FAQ: The MongoDB Connector for BI — MongoDB Connector for BI 2.2','preview':'Changed in version 2.0: Prior to version 2.0, the MongoDB Connector for BI stored its own separate set of credentials.','url':'https://docs.mongodb.com/bi-connector/current/faq/index.html'},{'title':'Release Notes for MongoDB Connector for BI — MongoDB Connector for BI 2.2','preview':'Supports authenticating directly against MongoDB using the new C and JDBC authentication plugins. These plugins support SCRAM-SHA-1 and PLAIN mechanisms and remove the SSL requirement for authentication. The authentication plugins can be found on GitHub:','url':'https://docs.mongodb.com/bi-connector/current/release-notes/index.html'}],'spellingCorrections':{}})

            const result3 = await request(`http://localhost:${port}/search?q=aggregation&searchProperty=bi-connector-alias`)
            assert.deepStrictEqual(result.json, result3.json)
        })

        it('should return 304 if index hasn\'t changed', async () => {
            const result = await request({
                port: port,
                path: `/search?q=${encodeURIComponent('quary')}`,
                headers: {
                    'If-Modified-Since': new Date().toUTCString()
                }})
            assert.strictEqual(result.response.statusCode, 304)
        })

        it('should NOT return 304 if index has changed', async () => {
            const result = await request({
                port: port,
                path: `/search?q=${encodeURIComponent('quary')}`,
                headers: {
                    'If-Modified-Since': new Date(0).toUTCString()
                }})
            assert.strictEqual(result.response.statusCode, 200)
        })
    }

    it('should print port to stdout', () => {
        assert.ok(port)
    })

    testFunctionality()

    it('should return 200 to /refresh', async function() {
        this.slow(5000)
        const result = await request({
            method: 'post',
            port: port,
            path: '/refresh'})
        assert.strictEqual(result.response.statusCode, 200)

        await new Promise((resolve, reject) => {
            const intervalID = setInterval(async () => {
                const result = await request({
                    port: port,
                    path: '/status'})

                try {
                    assert.strictEqual(result.response.statusCode, 200)
                } catch (err) {
                    reject(err)
                    return
                }

                if (result.json.lastSync.finished > lastSync) {
                    clearInterval(intervalID)
                    resolve()
                }
            }, 100)
        })
    })

    after('shutting down', function() {
        process.kill(child.pid, 'SIGINT')
    })
})
