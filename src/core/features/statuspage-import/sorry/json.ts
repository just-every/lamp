import { parseJson } from "../../../../../modules/import-kit/src/readers/json.ts";
import { decodedCredentialText, reflectedCredentialMatcher } from "../../../../../modules/import-kit/src/provenance/credentials.ts";
import type { Json } from "../../../../../modules/import-kit/src/types.ts";

/** Validate duplicate keys before preserving integer ID lexemes. No numeric ID
 * passes through Number, including IDs larger than Number.MAX_SAFE_INTEGER. */
export function parseSorryJson(text: string): Json {
  parseJson(text, { artifact: "Sorry response" });
  let index = 0;
  const replacements: { start: number; end: number }[] = [];
  const space = () => { while (index < text.length && /\s/u.test(text[index])) index++; };
  const string = () => { const start = index++; while (text[index] !== '"') { if (text[index] === "\\") index++; index++; } index++; return JSON.parse(text.slice(start, index)) as string; };
  function visit(key = "", depth = 0): void {
    if (depth > 64) throw new Error("Sorry response exceeds the supported JSON nesting depth.");
    space();
    if (text[index] === '"') { string(); return; }
    if (text[index] === "{" || text[index] === "[") {
      const isObject = text[index++] === "{", end = isObject ? "}" : "]";
      space();
      while (text[index] !== end) {
        let childKey = key;
        if (isObject) { childKey = string(); space(); index++; }
        visit(childKey, depth + 1); space();
        if (text[index] !== ",") break;
        index++; space();
      }
      index++; return;
    }
    const start = index;
    while (index < text.length && !/[\s,\]}]/u.test(text[index])) index++;
    if (/^(?:id|parent_id|page_id|component_ids)$/u.test(key) && /^-?\d+(?:[.eE][+\-\d]*)?$/u.test(text.slice(start, index))) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(text.slice(start, index))) throw new Error("Sorry numeric identities must be nonnegative decimal integers.");
      replacements.push({ start, end: index });
    }
  }
  visit();
  let last = 0, transformed = "";
  for (const entry of replacements) { transformed += text.slice(last, entry.start) + JSON.stringify(text.slice(entry.start, entry.end)); last = entry.end; }
  return JSON.parse(transformed + text.slice(last)) as Json;
}

const capability = /(?:token|secret|password|authorization|cookie|api.?key|webhook|secure.?link|manage.?url|unsubscribe.?url|confirmation.?url|microsoft.?teams.?url|google.?chat.?space)/iu;
/** A capability-bearing original is refused, never redacted and relabelled as
 * original custody. Empty documented integration fields carry no capability. */
export function assertSorrySafe(value: unknown, key?: string): void {
  const reflected = reflectedCredentialMatcher(key ? [key] : []);
  function visit(item: unknown): void {
    if (typeof item === "string" && reflected(item)) throw new Error("Sorry returned credential material; nothing was retained.");
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (item && typeof item === "object") for (const [name, child] of Object.entries(item)) {
      if (reflected(name)) throw new Error("Sorry returned credential material; nothing was retained.");
      if (capability.test(decodedCredentialText(name)) && child != null && child !== "" && typeof child !== "boolean") throw new Error("Sorry returned an access capability; save responses without operational credentials before importing.");
      visit(child);
    }
  }
  visit(value);
}

export function retainedSorry(value: unknown): Json {
  if (Array.isArray(value)) return value.map(retainedSorry);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !capability.test(decodedCredentialText(key))).map(([key, child]) => [key, retainedSorry(child)])) as Json;
  return value as Json;
}
