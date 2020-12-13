"use strict";

import { equal } from "https://deno.land/std@0.80.0/testing/asserts.ts";
import Query from "../src/fts/Query.ts";

Deno.test("should parse a single term", () => {
  const query = (new Query("foo"));
  equal(query.terms, new Set(["foo"]));
  equal(query.phrases, []);
});

Deno.test("should delimit terms with any standard whitespace characters", () => {
  const query = (new Query("foo   \t  bar"));
  equal(query.terms, new Set(["foo", "bar"]));
  equal(query.phrases, []);
});

Deno.test("should parse multi-word phrases", () => {
  const query = (new Query('foo "one phrase" bar "second phrase"'));
  equal(query.terms, new Set(["foo", "one", "phrase", "bar", "second"]));
  equal(query.phrases, ["one phrase", "second phrase"]);
});

Deno.test("should handle adjacent phrases", () => {
  const query = (new Query('"introduce the" "officially supported"'));
  equal(query.terms, new Set(["introduce", "the", "officially", "supported"]));
  equal(query.phrases, ["introduce the", "officially supported"]);
  equal(query.stemmedPhrases, [["introduc"], ["offici", "support"]]);
});

Deno.test("should handle a phrase fragment as a single phrase", () => {
  const query = (new Query('"officially supported'));
  equal(query.terms, new Set(["officially", "supported"]));
  equal(query.phrases, ["officially supported"]);
});

Deno.test("should match phrases with adjacent words", () => {
  const query = (new Query('"Quoth the raven"'));
  const tokenPositions: Map<string, number[]> = new Map([
    ["quoth", [0, 5]],
    ["raven", [8, 1]],
  ]);
  equal(query.checkPhrases(tokenPositions), true);
});

Deno.test("should refuse phrases without adjacent words", () => {
  const query = (new Query('"foo bar" "Quoth the raven"'));
  const tokenPositions = new Map([
    ["quoth", [0, 3]],
    ["raven", [2, 5]],
    ["foo", [6]],
    ["bar", [7]],
  ]);
  equal(query.checkPhrases(tokenPositions), false);
});
