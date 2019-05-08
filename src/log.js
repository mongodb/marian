'use strict'

const Logger = require('basic-logger')
Logger.setLevel('info', true)

exports.log = new Logger({
    showTimestamp: true,
})
