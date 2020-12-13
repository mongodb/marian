"use strict";

import {
  assertThrows,
  equal,
} from "https://deno.land/std@0.80.0/testing/asserts.ts";
import { Pool } from "../src/pool.ts";

let i = 0;
const pool = new Pool(3, () => {
  i += 1;
  return {
    backlog: i,
    i: i,
  };
});

Deno.test("Should be idempotent", () => {
  equal(pool.get().i, 1);
  equal(pool.get().i, 1);
});

Deno.test("Should select the unsuspended element with the smallest backlog", () => {
  equal(pool.getStatus(), [1, 2, 3]);

  pool.pool[0].backlog += 3;
  const x = pool.get();
  equal(x.i, 2);
  pool.suspend(x);
  equal(pool.getStatus(), [4, "s", 3]);
  equal(pool.get().i, 3);
  pool.resume(x);
  equal(pool.getStatus(), [4, 2, 3]);
  equal(pool.get().i, 2);

  pool.pool[0].backlog -= 2;
  equal(pool.get().i, 1);

  pool.pool[2].backlog -= 2;
  equal(pool.get().i, 3);
});

Deno.test("Should throw if no elements are available", () => {
  for (const worker of pool.pool) {
    pool.suspend(worker);
  }

  assertThrows(
    () => {
      pool.get();
    },
    Error,
    "pool-unavailable",
  );
});
