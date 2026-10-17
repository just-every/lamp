import { tokenizeUpdateLinks } from "../../shared/update-links";

export type WordingRule = "resolution-time" | "internal-hostname" | "ip-address" | "email-address" | "blocked-term" | "friendly-length";

export interface WordingFinding<Field extends string = string> {
  id: string;
  field: Field;
  rule: WordingRule;
  message: string;
  span: { start: number; end: number; text: string };
}

export interface WordingCheckSettings<Field extends string = string> {
  blockedTerms: readonly string[];
  /** Unicode code points; a field-specific setting may omit fields with no advisory limit. */
  friendlyLength: number | Partial<Record<Field, number>>;
}

const RULE_MESSAGES: Record<WordingRule, string> = {
  "resolution-time": "Resolution-time promise: give the next update time instead of promising when the issue will be fixed.",
  "internal-hostname": "Internal hostname: check whether this infrastructure name belongs in a customer update.",
  "ip-address": "IP address: check whether this infrastructure address belongs in a customer update.",
  "email-address": "Email address: check whether this person's or team's address should be public.",
  "blocked-term": "Blocked term: this wording contains a term on the owner's list.",
  "friendly-length": "Reader-friendly length: shorten this field to make the update easier to scan.",
};

// A next-update commitment is intentionally absent from these resolution verbs.
const RESOLUTION_PROMISE = /\b(?:(?:(?:will|should|expect(?:ed)?\s+to|going\s+to)\s+)?(?:be\s+)?(?:fixed|resolved|restored|recovered|back\s+(?:up|online|to\s+normal)|fully\s+operational)|(?:fix|resolve|restore|recover)(?:\s+(?:it|this|the\s+(?:issue|problem|service)))?)\s+(?:in|within|by|before|at)\s+(?:(?:about|approximately|around|the\s+next)\s+)?(?:\d+(?:\.\d+)?\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\b|(?:one|two|three|four|five|ten|fifteen|thirty|sixty|an?|half\s+an?)\s+(?:minutes?|hours?|days?)\b|\d{1,2}(?::\d{2})?\s*(?:am|pm|UTC|GMT)\b|\d{1,2}:\d{2}\b|noon\b|midnight\b|tomorrow\b|tonight\b|end\s+of\s+(?:the\s+)?day\b)/giu;
const EMAIL = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?/giu;
const HOSTNAME = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:internal|local|localhost|lan|corp|intranet|private|localdomain)\b|\blocalhost\b/giu;
const IPV4 = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?!\w|\.\d)/gu;
const IPV6 = /(?<![\w:])(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.]*(?:%[a-z0-9]+)?(?![\w:])/giu;

function isIp(host: string) {
  const value = host.replace(/^\[|\]$/gu, "");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(value)) return value.split(".").every(part => Number(part) <= 255);
  if (!value.includes(":")) return false;
  try { return new URL(`https://[${value}]`).hostname.startsWith("["); }
  catch { return false; }
}

function internalHost(host: string) {
  return host === "localhost" || !host.includes(".") || /\.(?:internal|local|localhost|lan|corp|intranet|private|localdomain)$/iu.test(host);
}

/** Advisory only: deterministic findings never alter text or make publishing conditional. */
export function checkUpdateWording<Field extends string>(fields: Readonly<Record<Field, string>>, settings: WordingCheckSettings<Field>): WordingFinding<Field>[] {
  const findings: WordingFinding<Field>[] = [];
  for (const field of Object.keys(fields).sort() as Field[]) {
    const text = fields[field];
    const perField: WordingFinding<Field>[] = [];
    const add = (rule: WordingRule, start: number, end: number, message = RULE_MESSAGES[rule]) => {
      const matched = text.slice(start, end);
      if (perField.some(finding => finding.rule === rule && finding.span.start < end && finding.span.end > start)) return;
      perField.push({ id: `${field}:${rule}:${start}:${JSON.stringify(matched)}`, field, rule, message, span: { start, end, text: matched } });
    };
    const matches = (pattern: RegExp, rule: WordingRule, valid: (value: string) => boolean = () => true) => {
      for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) if (valid(match[0])) add(rule, match.index!, match.index! + match[0].length);
    };
    matches(RESOLUTION_PROMISE, "resolution-time");
    matches(EMAIL, "email-address");
    matches(HOSTNAME, "internal-hostname");
    matches(IPV4, "ip-address", isIp);
    matches(IPV6, "ip-address", isIp);
    for (const token of tokenizeUpdateLinks(text)) {
      if (token.kind !== "https") continue;
      const hostname = token.hostname;
      const rule = isIp(hostname) ? "ip-address" : internalHost(hostname) ? "internal-hostname" : null;
      if (!rule) continue;
      // Locate the hostname in the authority, after any user information.
      const authority = token.text.slice(8).split(/[/?#]/u)[0]!;
      const rawHost = authority.slice(authority.lastIndexOf("@") + 1);
      const hostLength = rawHost.startsWith("[") ? rawHost.indexOf("]") + 1 : rawHost.split(":")[0]!.length;
      const start = token.start + 8 + authority.lastIndexOf("@") + 1;
      add(rule, start, start + hostLength);
    }
    for (const term of new Set(settings.blockedTerms.map(term => term.trim()).filter(Boolean))) {
      const literal = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const pattern = new RegExp(literal, "giu");
      for (const match of text.matchAll(pattern)) {
        const start = match.index!;
        const end = start + match[0].length;
        // Terms match complete words or phrases, not a fragment of a customer's name.
        const word = /[\p{L}\p{N}_]/u;
        if (word.test(term[0]!) && start > 0 && word.test(text[start - 1]!)) continue;
        if (word.test(term[term.length - 1]!) && end < text.length && word.test(text[end]!)) continue;
        add("blocked-term", start, end);
      }
    }
    const limit = typeof settings.friendlyLength === "number" ? settings.friendlyLength : settings.friendlyLength[field];
    const characters = Array.from(text);
    if (limit !== undefined && Number.isInteger(limit) && limit >= 0 && characters.length > limit) {
      const start = characters.slice(0, limit).join("").length;
      add("friendly-length", start, text.length, `${RULE_MESSAGES["friendly-length"]} This field has ${characters.length} characters; the preferred maximum is ${limit}.`);
    }
    findings.push(...perField.sort((left, right) => left.span.start - right.span.start || left.rule.localeCompare(right.rule) || left.span.end - right.span.end));
  }
  return findings;
}
