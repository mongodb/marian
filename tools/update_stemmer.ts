"use strict";

import { assert } from "https://deno.land/std@0.80.0/testing/asserts.ts";

const PAT_CONSTRUCTOR = /constructor\s*\(\) \{([^}]+)\}/;
const PAT_START = /r_prelude\s*\(\)/;
const PAT_END_START = /^([^\n\S]*)stem\s*\(\)\s*\n/m;

const textDecoder = new TextDecoder("utf-8");
const textEncoder = new TextEncoder();

const sourcePath = Deno.args[0];
const outputPath = Deno.args[1];
const process = Deno.run({
  cmd: ["snowball", sourcePath, "-o", ".stemmer", "-n", "Porter2", "-js"],
});
const status = await process.status();
if (status.code !== 0) {
  throw new Error("Error running snowball");
}

let oldJS = textDecoder.decode(Deno.readFileSync(outputPath));
const updatedJS = textDecoder.decode(Deno.readFileSync(".stemmer.js"));

Deno.removeSync(".stemmer.js");

// Replace the constructor, containing Among definitions
const newConstructor = updatedJS.match(PAT_CONSTRUCTOR)![0].replace(
  /\n[^\n\S]*\}[^\n\S]*$/,
  `
        this.B_Y_found = false;
        this.I_p2 = 0;
        this.I_p1 = 0;
    }`,
);
oldJS = oldJS.replace(PAT_CONSTRUCTOR, newConstructor);

// Replace the methods. This is... tricky.
function getMethodsStartEnd(js: string): [number, number] {
  const startMatch = js.match(PAT_START);
  const startIndex = startMatch!.index!;
  const endStartMatch = js.match(PAT_END_START);
  const endStartIndex = endStartMatch!.index!;
  const endStartIndentation = endStartMatch![1];

  const endIndex = endStartIndex +
    js.slice(endStartIndex).indexOf("\n" + endStartIndentation + "}");
  assert(endIndex > endStartIndex, '"stem() {}" block end not found');
  return [startIndex, endIndex];
}

const [oldMethodsStart, oldMethodsEnd] = getMethodsStartEnd(oldJS);
const [newMethodsStart, newMethodsEnd] = getMethodsStartEnd(updatedJS);
const newMethods = updatedJS.slice(newMethodsStart, newMethodsEnd);

oldJS = oldJS.slice(0, oldMethodsStart) + newMethods +
  oldJS.slice(oldMethodsEnd);
Deno.writeFileSync(outputPath, textEncoder.encode(oldJS));
