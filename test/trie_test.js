"use strict";

import { equal } from "https://deno.land/std@0.80.0/testing/asserts.ts";
import Trie from "../src/fts/Trie.js";

const trie = new Trie();

Deno.test("Should be idempotent", () => {
  trie.insert("foobar", 0);
  trie.insert("foobar", 0);

  equal(
    trie.search("foobar", true),
    new Map([[0, new Set(["foobar"])]]),
  );

  equal(
    trie.search("foobar", false),
    new Map([[0, new Set(["foobar"])]]),
  );
});

Deno.test("Should be additive", () => {
  trie.insert("foobar", 1);

  equal(
    trie.search("foobar", true),
    new Map([[0, new Set(["foobar"])], [1, new Set(["foobar"])]]),
  );

  equal(
    trie.search("foobar", false),
    new Map([[0, new Set(["foobar"])], [1, new Set(["foobar"])]]),
  );
});

Deno.test("Should handle prefix matching", () => {
  trie.insert("foobaz", 0);

  equal(
    trie.search("foo", true),
    new Map([
      [0, new Set(["foobar", "foobaz"])],
      [1, new Set(["foobar"])],
    ]),
  );

  equal(
    trie.search("foo", false),
    new Map(),
  );
});
