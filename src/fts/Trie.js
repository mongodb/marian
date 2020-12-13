"use strict";

export default class Trie {
  constructor() {
    this.trie = new Map([[0, null]]);
  }

  insert(token, id) {
    let cursor = this.trie;

    for (let i = 0; i < token.length; i += 1) {
      const code = token.charCodeAt(i) + 1;
      if (!cursor.get(code)) {
        cursor.set(code, new Map([[0, null]]));
      }

      cursor = cursor.get(code);
    }

    if (cursor.get(0) === null) {
      cursor.set(0, new Set());
    }

    cursor.get(0).add(id);
  }

  // Return Map<String, Iterable<String>>
  search(token, prefixSearch) {
    let cursor = this.trie;
    for (let i = 0; i < token.length; i += 1) {
      const code = token.charCodeAt(i) + 1;
      if (!cursor.get(code)) {
        return new Map();
      }

      cursor = cursor.get(code);
    }

    const results = new Map();

    if (cursor.get(0)) {
      for (const id of cursor.get(0)) {
        results.set(id, new Set([token]));
      }
    }

    if (!prefixSearch) {
      return results;
    }

    const stack = [[cursor, token]];
    while (stack.length > 0) {
      const [currentNode, currentToken] = stack.pop();
      for (const key of currentNode.keys()) {
        if (key !== 0) {
          const nextCursor = currentNode.get(key);
          if (nextCursor) {
            stack.push(
              [nextCursor, currentToken + String.fromCharCode(key - 1)],
            );
          }
          continue;
        }

        if (currentNode.get(key) === null) {
          continue;
        }

        for (const value of currentNode.get(0)) {
          const arr = results.get(value);
          if (arr) {
            arr.add(currentToken);
          } else {
            results.set(value, new Set([currentToken]));
          }
        }

        continue;
      }
    }

    return results;
  }
}
