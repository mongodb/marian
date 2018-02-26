'use strict'

const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const process = require('process')

const PAT_CONSTRUCTOR = /constructor\s*\(\) \{([^}]+)\}/
const PAT_START = /r_prelude\s*\(\)/
const PAT_END_START = /^([^\n\S]*)stem\s*\(\)\s*\n/m

const source_path = process.argv[2]
const output_path = process.argv[3]
const result = spawnSync('snowball', [source_path, '-o', '.stemmer', '-n', 'Porter2', '-js'])
if (result.status !== 0) {
    throw new Error('Error running snowball')
}

let oldJS = fs.readFileSync(output_path, {encoding: 'utf-8'})
const updatedJS = fs.readFileSync('.stemmer.js', {encoding: 'utf-8'})
fs.unlinkSync('.stemmer.js')

// Replace the constructor, containing Among definitions
const newConstructor = updatedJS.match(PAT_CONSTRUCTOR)[0].replace(/\n[^\n\S]*\}[^\n\S]*$/, `
        this.B_Y_found = false;
        this.I_p2 = 0;
        this.I_p1 = 0;
    }`)
oldJS = oldJS.replace(PAT_CONSTRUCTOR, newConstructor)

// Replace the methods. This is... tricky.
function getMethodsStartEnd(js) {
    const startMatch = js.match(PAT_START)
    const startIndex = startMatch.index
    const endStartMatch = js.match(PAT_END_START)
    const endStartIndex = endStartMatch.index
    const endStartIndentation = endStartMatch[1]

    const endIndex = endStartIndex + js.slice(endStartIndex).indexOf('\n' + endStartIndentation + '}')
    assert(endIndex > endStartIndex, '"stem() {}" block end not found')
    return [startIndex, endIndex]
}

const [oldMethodsStart, oldMethodsEnd] = getMethodsStartEnd(oldJS)
const [newMethodsStart, newMethodsEnd] = getMethodsStartEnd(updatedJS)
const newMethods = updatedJS.slice(newMethodsStart, newMethodsEnd)

oldJS = oldJS.slice(0, oldMethodsStart) + newMethods + oldJS.slice(oldMethodsEnd)
fs.writeFileSync(output_path, oldJS)
