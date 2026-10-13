import assert from "node:assert/strict";
import { visibleText } from "./visible-text.mjs";

const units = new Map([
  ["week", 604800000], ["w", 604800000], ["wk", 604800000],
  ["day", 86400000], ["d", 86400000],
  ["hour", 3600000], ["hr", 3600000], ["h", 3600000],
  ["minute", 60000], ["min", 60000], ["m", 60000],
  ["second", 1000], ["sec", 1000], ["s", 1000],
  ["millisecond", 1], ["msec", 1], ["ms", 1],
]);
const quantities = /([+−-]?\s*(?:\d+(?:\.\d+)?|\.\d+))\s*([a-z]+)\b/gi;
const presentationLabel = text => text.replace(quantities, "").replace(/\band\b/gi, "").replace(/[^a-z]/gi, "").toLowerCase();
const withoutTimes = html => html.replace(/<time\b[^>]*>[\s\S]*?<\/time>/gi, " ");

// Read contiguous phrasing content together: an inline duration inside a customer
// sentence is prose, while an isolated span is still a visible presentation.
function presentationRuns(html) {
  const blocks = /^(?:address|article|aside|blockquote|br|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)$/i;
  const runs = [];
  let current = "";
  // Skip hidden source tokens without joining fragments into new markup.
  for (const [token, hidden] of html.matchAll(/(<!--[^]*?-->|<(script|style|template|head)\b[^>]*>[^]*?<\/\2>)|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/gi)) {
    if (hidden) continue;
    const tag = token.match(/^<\/?\s*([a-z][\w-]*)/i)?.[1];
    if (tag && blocks.test(tag)) {
      if (current.trim()) runs.push(current);
      current = "";
    } else current += token;
  }
  if (current.trim()) runs.push(current);
  return runs;
}

function durationValue(text) {
  return text.replace(quantities, "").replace(/\band\b/gi, "").replace(/[\s,;:().+·–—-]/g, "") === "";
}

function labelledDuration(text) {
  // Metadata has an elapsed-time label followed only by quantities. Punctuation
  // alone is insufficient: a customer sentence can also end with ": 30 seconds".
  const firstAmount = text.search(/[+−-]?\s*(?:\d+(?:\.\d+)?|\.\d+)\s*[a-z]+\b/i);
  if (firstAmount <= 0 || !durationValue(text.slice(firstAmount))) return false;
  // Punctuation at the label/value boundary is structural. Keep the label's
  // words intact so ordinary customer sentences do not become elapsed metadata.
  const label = text.slice(0, firstAmount).replace(/[\s\p{P}=|]+$/u, '').trim();
  return /^(?:(?:total|overall|actual|incident|outage|elapsed|resolution|recovery)\s+)*(?:duration|elapsed(?:\s+time)?|time(?:\s+(?:taken|spent|elapsed)|\s+(?:to|until)\s+(?:resolution|recovery|resolve|recover))?|(?:resolved|recovered|restored)\s+(?:in|after))$/i.test(label);
}

function elapsed(text) {
  const parts = [...text.matchAll(quantities)];
  assert.ok(parts.length > 0, "elapsed duration is readable in time units");
  assert.ok(!/\d/.test(text.replace(quantities, "")), "every elapsed amount has a time unit");
  return parts.reduce((total, [, amount, label]) => {
    const unit = label.toLowerCase();
    const scale = units.get(unit) ?? units.get(unit.replace(/s$/, ""));
    assert.ok(scale !== undefined, "every elapsed quantity has a supported time unit");
    assert.ok(!/[−-]/.test(amount), "elapsed duration is not negative");
    return total + Number(amount.replace(/\s/g, "")) * scale;
  }, 0);
}

export function assertResolvedDuration(html, openedAt, resolvedAt) {
  const regions = [...html.matchAll(/<p\b[^>]*\bclass\s*=\s*(["'])([^"']*)\1[^>]*>([\s\S]*?)<\/p>/gi)]
    .filter(([, , classes]) => classes.split(/\s+/).includes("incident-resolution"));
  assert.equal(regions.length, 1, "one resolved-duration region is visible");
  const region = regions[0];
  const text = visibleText(withoutTimes(region[3]));
  const expected = Date.parse(resolvedAt) - Date.parse(openedAt);
  assert.ok(Number.isFinite(expected) && expected >= 0, "reference elapsed duration is valid");
  assert.equal(elapsed(text), expected, "visible elapsed duration matches opening and resolution instants");

  // Repeated resolution blocks or standalone durations are second presentations.
  // Customer sentences mentioning time units are not resolution metadata.
  const remainder = html.slice(0, region.index) + html.slice(region.index + region[0].length);
  for (const body of presentationRuns(remainder)) {
    const content = visibleText(withoutTimes(body));
    if (![...content.matchAll(quantities)].some(([, , unit]) => units.has(unit.toLowerCase()) || units.has(unit.toLowerCase().replace(/s$/, "")))) continue;
    const sameResolution = presentationLabel(content) === presentationLabel(text) || [...body.matchAll(/<time\b[^>]*datetime\s*=\s*(["'])([^"']+)\1/gi)].some(([, , value]) => Date.parse(value) === Date.parse(resolvedAt));
    assert.ok(!durationValue(content) && !labelledDuration(content) && !sameResolution, "elapsed duration appears only once as a resolved presentation");
  }
}
