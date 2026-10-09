// Local stand-in for seed-spec's shared `contract()` helper, which does not exist
// yet. It prefixes the test name with the clause ID so a later pass can map every
// test to a clause in CONTRACT.md. Delete this file when seed-spec ships the real
// one; the call sites should not have to change.
import { test } from "node:test";

export function contract(id, nameOrFn, maybeFn) {
  const fn = typeof nameOrFn === "function" ? nameOrFn : maybeFn;
  const name = typeof nameOrFn === "function" ? "" : ` — ${nameOrFn}`;
  return test(`${id}${name}`, fn);
}
