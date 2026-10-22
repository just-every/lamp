// Writes src/core/platform/site-reader/public-suffix-list.ts from the Public Suffix List, the maintained list of the
// suffixes under which anyone can register a name (co.uk) or a platform gives each customer a site of its own
// (netlify.app, github.io). Only its rules are kept, in the ASCII form URL host names use.
// Refresh: node scripts/public-suffix-list.mjs [a downloaded public_suffix_list.dat]
import { readFile, writeFile } from "node:fs/promises";
import { domainToASCII } from "node:url";

const SOURCE = "https://publicsuffix.org/list/public_suffix_list.dat";
const TARGET = new URL("../src/core/platform/site-reader/public-suffix-list.ts", import.meta.url);

const text = process.argv[2] ? await readFile(process.argv[2], "utf8") : await (await fetch(SOURCE)).text();
const version = text.match(/^\/\/ VERSION: (\S+)$/m)?.[1];
const commit = text.match(/^\/\/ COMMIT: ([0-9a-f]{40})$/m)?.[1];
if (!version || !commit || !text.includes("// ===BEGIN ICANN DOMAINS===") || !text.includes("// ===BEGIN PRIVATE DOMAINS===")) throw new Error("That is not the Public Suffix List.");

// A rule is a line's first word: a suffix (com.au), a wildcard over one label (*.ck) or an exception to one (!www.ck).
const rules = text.split("\n").map((line) => line.trim().split(/\s/)[0]).filter((rule) => rule && !rule.startsWith("//")).map((rule) => {
  const [mark, name] = rule.startsWith("!") ? ["!", rule.slice(1)] : rule.startsWith("*.") ? ["*.", rule.slice(2)] : ["", rule];
  const ascii = domainToASCII(name);
  if (!ascii || name.includes("*")) throw new Error(`Unexpected rule: ${rule}`);
  return mark + ascii;
});

await writeFile(TARGET, `// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The rules of the Public Suffix List, ${SOURCE}
// (VERSION ${version}, COMMIT ${commit}), in ASCII form. Written by scripts/public-suffix-list.mjs:
// run it to refresh this file, never edit it by hand.

/** One rule per line: a suffix (com.au), a wildcard over one label (*.ck) or an exception to one (!www.ck). */
export const PUBLIC_SUFFIX_RULES = \`${rules.join("\n")}\`;
`);
console.log(`${rules.length} rules from the Public Suffix List ${version} (${commit}).`);
