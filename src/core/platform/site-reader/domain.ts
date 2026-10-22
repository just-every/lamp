import { PUBLIC_SUFFIX_RULES } from "./public-suffix-list.ts";

let rules: Set<string> | null = null;

/** The registrable part of a host name, by the Public Suffix List: getharvest.com, example.co.uk, and
 * astro-paper.netlify.app, because netlify.app is a suffix its sites share, so each is a site of its own and never
 * the platform's. A host that is itself a suffix, or an IP address, is its own. */
export function siteDomain(host: string) {
  const name = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (name.includes(":") || /^[\d.]+$/.test(name)) return name;
  rules ??= new Set(PUBLIC_SUFFIX_RULES.split("\n"));
  const labels = name.split(".");
  // The longest rule that matches is the suffix; an exception ends it one label short; no rule leaves the last label.
  let suffix = 1;
  for (let index = 0; index < labels.length; index += 1) {
    const candidate = labels.slice(index).join(".");
    if (rules.has(`!${candidate}`)) { suffix = labels.length - index - 1; break; }
    if (rules.has(candidate) || rules.has(`*.${labels.slice(index + 1).join(".")}`)) { suffix = labels.length - index; break; }
  }
  return labels.length > suffix ? labels.slice(-suffix - 1).join(".") : name;
}
