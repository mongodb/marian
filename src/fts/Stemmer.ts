"use strict";

/* Derived from the following: */
/* !
 * lunr.stopWordFilter
 * Copyright (C) 2017 Oliver Nightingale
 */

import { Porter2 } from "./Porter2.js";

const stopWords = new Set([
  "a",
  "able",
  "about",
  "across",
  "after",
  "all",
  "almost",
  "also",
  "am",
  "among",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "but",
  "by",
  "can",
  "cannot",
  "could",
  "dear",
  "did",
  "do",
  "does",
  "either",
  "else",
  "ever",
  "every",
  "for",
  "from",
  "got",
  "had",
  "has",
  "have",
  "he",
  "her",
  "hers",
  "him",
  "his",
  "how",
  "however",
  "i",
  "i.e.",
  "if",
  "important",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "may",
  "me",
  "might",
  "most",
  "must",
  "my",
  "neither",
  "no",
  "nor",
  "of",
  "off",
  "often",
  "on",
  "only",
  "or",
  "other",
  "our",
  "own",
  "rather",
  "said",
  "say",
  "says",
  "she",
  "should",
  "since",
  "so",
  "some",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "tis",
  "to",
  "too",
  "twas",
  "us",
  "wants",
  "was",
  "we",
  "were",
  "what",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "yet",
  "you",
  "your",
  "e.g.",
]);

const atomicPhraseMap: Record<string, string> = {
  "ops": "manager",
  "cloud": "manager",
  "real": "time",
};
const atomicPhrases = new Set(
  Object.entries(atomicPhraseMap).map((kv) => kv.join(" ")),
);

const wordCache: Map<string, string> = new Map();
const stemmer = new Porter2();
export function stem(word: string): string {
  if (atomicPhrases.has(word)) {
    return word;
  }

  const cachedStemmed = wordCache.get(word);
  let stemmed;
  if (!cachedStemmed) {
    stemmed = stemmer.stemWord(word);
    wordCache.set(word, stemmed);
  } else {
    stemmed = cachedStemmed;
  }

  return stemmed;
}

export function isStopWord(word: string): boolean {
  return stopWords.has(word);
}

export function tokenize(text: string, fuzzy = false): string[] {
  const components = text.split(/[^\w$%.]+/).map((token) => {
    return token.toLocaleLowerCase().replace(/(?:^\.)|(?:\.$)/g, "");
  });

  const tokens = [];
  for (let i = 0; i < components.length; i += 1) {
    const token = components[i];

    if (token == "$") {
      tokens.push("positional");
      tokens.push("operator");
      continue;
    }

    const nextToken = components[i + 1];
    if (nextToken !== undefined && atomicPhraseMap[token] === nextToken) {
      i += 1;
      tokens.push(`${token} ${atomicPhraseMap[token]}`);
      continue;
    }

    if (token.length > 1) {
      tokens.push(token);
    }

    const subtokens = token.split(".");
    if (fuzzy && subtokens.length > 1) {
      for (const subtoken of subtokens) {
        if (subtoken.length > 1) {
          tokens.push(subtoken);
        }
      }
    }
  }

  return tokens;
}
