"use strict";

import { equal } from "https://deno.land/std@0.80.0/testing/asserts.ts";
import { stem, tokenize } from "../src/fts/Stemmer.ts";

Deno.test("should split on whitespace", () => {
  equal(
    tokenize("The qUick \tbrown\n\n\t fox."),
    ["the", "quick", "brown", "fox"],
  );
});

Deno.test("should handle code somewhat coherently", () => {
  equal(
    tokenize(
      "db.scores.find(\n   { results: { $elemMatch: { $gte: 80, $lt: 85 } } }\n)",
    ),
    ["db.scores.find", "results", "$elemmatch", "$gte", "80", "$lt", "85"],
  );
});

Deno.test("should tokenize atomic phrases", () => {
  equal(
    tokenize("ops manager configuration"),
    ["ops manager", "configuration"],
  );
  equal(stem("ops manager"), "ops manager");
});

Deno.test('should replace a standalone $ with "positional operator"', () => {
  equal(
    tokenize("$ operator"),
    ["positional", "operator", "operator"],
  );

  equal(
    tokenize("$max operator"),
    ["$max", "operator"],
  );
});

Deno.test("should pass the porter2 test vector", () => {
  const decoder = new TextDecoder("utf-8");
  const text = decoder.decode(Deno.readFileSync("test/stemmed-corpus.txt"));
  const lines = text.split("\n");
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const [word, correctStemmed] = line.split(/\s+/, 2);
    const stemmed = stem(word);
    equal(stemmed, correctStemmed);
  }
});
