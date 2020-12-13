"use strict";
import { isStopWord, stem, tokenize } from "./Stemmer.ts";

/**
 * Return true if there is a configuration of numbers in the tree that
 * appear in sequential order.
 * @param {Array<Array<number>>} tree The tree
 * @param {number|undefined} lastCandidate Recursive state.
 * @return {boolean} True if there is a configuration of numbers in the
 * tree that appear in sequential order.
 */
function haveContiguousPath(tree: number[][], lastCandidate?: number): boolean {
  if (tree.length === 0) {
    return true;
  }

  for (const element of tree[0]) {
    if (lastCandidate === undefined || element === lastCandidate + 1) {
      if (haveContiguousPath(tree.slice(1), element)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if the given phraseComponents appear in contiguous positions
 * within the keywords map.
 * @param {string[]} phraseComponents List of stems that must appear sequentially.
 * @param {Map<string, number[]>} keywords Keywords
 * @return {boolean} True if there's a contiguous configuration of phrase components.
 */
function haveContiguousKeywords(
  phraseComponents: string[],
  keywords: Map<string, number[]>,
): boolean {
  const path = [];
  for (const component of phraseComponents) {
    const positions = keywords.get(component);
    if (positions === undefined) {
      return false;
    }
    path.push(positions);
  }

  return haveContiguousPath(path);
}

function processPart(part: string): string[] {
  return tokenize(part, false);
}

/** A parsed search query. */
export default class Query {
  terms: Set<string>;
  phrases: string[];
  stemmedPhrases: string[][];
  filter: (docID: number) => boolean;

  /**
     * Create a new query.
     * @param {string} queryString The query to parse
     */
  constructor(queryString: string) {
    this.terms = new Set();
    this.phrases = [];
    this.stemmedPhrases = [];
    this.filter = (_id) => true;

    const parts = queryString.split(/((?:\s+|^)"[^"]+"(?:\s+|$))/);
    let inQuotes = false;
    for (const part of parts) {
      inQuotes = Boolean(part.match(/^\s*"/));

      if (!inQuotes) {
        this.addTerms(processPart(part));
      } else {
        const phraseMatch = part.match(/\s*"([^"]*)"?\s*/);
        if (!phraseMatch) {
          // This is a phrase fragment
          this.addTerms(processPart(part));
          continue;
        }

        const phrase = phraseMatch[1].toLowerCase().trim();
        this.phrases.push(phrase);

        const phraseParts = processPart(phrase);
        this.stemmedPhrases.push(
          phraseParts.filter((term) => !isStopWord(term)).map((term) =>
            stem(term)
          ),
        );
        this.addTerms(phraseParts);
      }
    }
  }

  /**
     * Return true if the exact phrases in the query appear in ANY of the fields
     * appearing in the match.
     * @param {Map<String, Number[]>} tokens Token positions
     * @return {boolean} True if the given match contains this query's phrases.
     */
  checkPhrases(tokens: Map<string, number[]>): boolean {
    for (const phraseTokens of this.stemmedPhrases) {
      if (!haveContiguousKeywords(phraseTokens, tokens)) {
        return false;
      }
    }

    return true;
  }

  addTerms(terms: Iterable<string>): void {
    for (const term of terms) {
      this.terms.add(term);
    }
  }
}
