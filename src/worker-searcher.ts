"use strict";

import Query from "./fts/Query.ts";
import {
  Document,
  RawManifest,
  RawResult,
  Result,
  WorkerRequest,
} from "./types.ts";
import * as fts from "./fts/fts.ts";
import { CORRELATIONS } from "./correlations.ts";

const MAXIMUM_TERMS = 10;

let searchPropertyAliases = new Map();
let index: fts.FTSIndex | null = null;
let documents: Record<number, Document> = {};

/**
 * Search the index, and return results within the given searchProperty.
 * @param {string} queryString The query string.
 * @param {[string]} searchProperties The properties to search. If empty, all results are returned.
 * @param {boolean} useHits True if HITS link analysis should be performed.
 * @return {{results: [{title: String, preview: String, url: String}]}}
 */
function search(
  queryString: string,
  searchProperties: string[],
  useHits: boolean,
): Result[] {
  if (!index) {
    throw new Error("still-indexing");
  }

  searchProperties = searchProperties.map((property) => {
    if (searchPropertyAliases.has(property)) {
      return searchPropertyAliases.get(property);
    }

    return property;
  });

  const parsedQuery = new Query(queryString);
  if (parsedQuery.terms.size > MAXIMUM_TERMS) {
    throw new Error("query-too-long");
  }

  if (searchProperties.length) {
    const properties = new Set(searchProperties);
    parsedQuery.filter = (_id) => properties.has(documents[_id].searchProperty);
  } else {
    parsedQuery.filter = (_id) => documents[_id].includeInGlobalSearch === true;
  }

  const rawResults = index.search(parsedQuery, useHits);

  const results: Result[] = rawResults.map((match) => {
    const doc = documents[match._id];
    // console.log(doc.title, match.score, match.relevancyScore, match.authorityScore)
    return {
      title: doc.title,
      preview: doc.preview,
      url: doc.url,
    };
  });

  return results;
}

interface Manifest {
  documents: Document[];
  searchProperty: string;
  includeInGlobalSearch: boolean;
}

function sync(rawManifests: RawManifest[]): void {
  const newSearchPropertyAliases = new Map();
  const newIndex = new fts.FTSIndex([
    ["text", 1],
    ["headings", 5],
    ["title", 10],
    ["tags", 10],
  ]);

  for (const [term, synonymn, weight] of CORRELATIONS) {
    newIndex.correlateWord(term, synonymn, weight);
  }

  const manifests: Manifest[] = rawManifests.map((manifest) => {
    const body = JSON.parse(manifest.body);
    const url = body.url.replace(/\/+$/, "");

    for (const alias of (body.aliases || [])) {
      newSearchPropertyAliases.set(alias, manifest.searchProperty);
    }

    const documents = body.documents.map((doc: Document) => {
      doc.slug = doc.slug.replace(/^\/+/, "");
      doc.url = `${url}/${doc.slug}`;

      return doc;
    });

    return {
      documents: documents,
      searchProperty: manifest.searchProperty,
      includeInGlobalSearch: body.includeInGlobalSearch,
    };
  });

  const newDocuments = Object.create(null);

  for (const manifest of manifests) {
    for (const doc of manifest.documents) {
      const weight = doc.weight || 1;
      const id = newIndex.add(manifest.searchProperty, {
        _id: -1,
        links: doc.links,
        url: doc.url,

        weight: weight,
        text: doc.text,
        tags: doc.tags,
        headings: (doc.headings || []).join(" "),
        title: doc.title,
      });

      newDocuments[id] = {
        title: doc.title,
        preview: doc.preview,
        url: doc.url,
        searchProperty: manifest.searchProperty,
        includeInGlobalSearch: manifest.includeInGlobalSearch,
      };
    }
  }

  index = newIndex;
  searchPropertyAliases = newSearchPropertyAliases;
  documents = newDocuments;
}

self.onmessage = function (event: MessageEvent) {
  const message: WorkerRequest = event.data.message;
  const messageId: number = event.data.messageId;

  try {
    if (message.search !== undefined) {
      const properties = (message.search.searchProperty || "").split(",")
        .filter((x) => x);

      const results = search(
        message.search.queryString,
        properties,
        message.search.useHits,
      );

      self.postMessage({ results: results, messageId: messageId });
    } else if (message.sync !== undefined) {
      sync(message.sync);
      self.postMessage({ ok: true, messageId: messageId });
    } else {
      throw new Error("Unknown command");
    }
  } catch (err) {
    self.postMessage({ error: err.message, messageId: messageId });
  }
};
