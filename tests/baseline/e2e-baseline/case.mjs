import { test } from "node:test";

/**
 * Gives a real Node test its immutable baseline-clause provenance.  The
 * baseline reporter accepts these labels only from the shared-pack paths.
 */
export function baseline(id, title, body) {
  const provenance = (Array.isArray(id) ? id : [id]).map(clause => `[baseline:${clause}]`).join(" ");
  return test(`${provenance} ${title}`, body);
}
