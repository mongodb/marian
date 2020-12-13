"use strict";

export const CORRELATIONS: [string, string, number][] = [
  ["regexp", "regex", 0.8],
  ["regular expression", "regex", 0.8],
  ["ip", "address", 0.1],
  ["address", "ip", 0.1],
  ["join", "lookup", 0.6],
  ["join", "sql", 0.25],
  ["aggregation", "sql", 0.1],
  ["aggregation", "pipeline", 0.1],
  ["least", "min", 0.6],
  ["set security", "keyfile", 1.0],
  ["cluster security", "keyfile", 1.0],
  ["x509", "x.509", 1.0],
  ["auth", "authentication", 0.25],
];

// Words that, if given in the query, are required to exist in the output results.
// Users can simulate this by wrapping terms in double-quotes to get the same result.
export const MANDATORY = new Set(["realm", "atlas", "compass"]);
