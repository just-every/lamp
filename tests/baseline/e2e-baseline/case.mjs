import { test } from "node:test";

/**
 * Gives a real Node test its immutable baseline-clause provenance.  The
 * baseline reporter accepts these labels only from the shared-pack paths.
 */
export function baseline(id, title, body) {
  return test(`[baseline:${id}] ${title}`, body);
}
