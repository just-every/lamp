import type { ComponentState } from "../../../shared/domain";

/** Line icons for the built-in templates, on the public page's 24px grid with 1.75px strokes. All are decorative:
 *  the text beside each one carries its meaning. */
const line = {
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5Z"/>',
  device: '<rect x="7" y="3" width="10" height="18" rx="2.25"/><path d="M11 17.5h2"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  people: '<circle cx="9" cy="8.5" r="3.25"/><path d="M3.5 19c.6-3 2.8-4.75 5.5-4.75s4.9 1.75 5.5 4.75"/><path d="M15.5 5.6a3.25 3.25 0 0 1 0 5.8"/><path d="M17.25 14.5c1.7.6 2.9 2.2 3.25 4.5"/>',
  feed: '<path d="M5 5.5a13.5 13.5 0 0 1 13.5 13.5"/><path d="M5 11a8 8 0 0 1 8 8"/><circle cx="6" cy="18" r="1.25"/>',
  link: '<path d="M10.25 13.75a3.75 3.75 0 0 0 5.3 0l3-3a3.75 3.75 0 0 0-5.3-5.3l-1 1"/><path d="M13.75 10.25a3.75 3.75 0 0 0-5.3 0l-3 3a3.75 3.75 0 0 0 5.3 5.3l1-1"/>',
  code: '<path d="m8.5 7.5-4.5 4.5 4.5 4.5"/><path d="m15.5 7.5 4.5 4.5-4.5 4.5"/>',
  database: '<ellipse cx="12" cy="6.5" rx="7" ry="2.75"/><path d="M5 6.5v11c0 1.5 3.1 2.75 7 2.75s7-1.25 7-2.75v-11"/><path d="M5 12c0 1.5 3.1 2.75 7 2.75s7-1.25 7-2.75"/>',
  server: '<rect x="4" y="4.5" width="16" height="6.5" rx="1.75"/><rect x="4" y="13" width="16" height="6.5" rx="1.75"/><path d="M7.5 7.75h.01"/><path d="M7.5 16.25h.01"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.25 10.5V8a3.75 3.75 0 0 1 7.5 0v2.5"/>',
  card: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M3.5 10h17"/><path d="M7 14.5h3"/>',
  chat: '<path d="M5 17.5V6.75A1.75 1.75 0 0 1 6.75 5h10.5A1.75 1.75 0 0 1 19 6.75v7.5A1.75 1.75 0 0 1 17.25 16H8.5Z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m15.5 15.5 4 4"/>',
  box: '<path d="m12 3.75 7.5 4.25v8L12 20.25 4.5 16V8Z"/><path d="m4.75 8.1 7.25 4.15 7.25-4.15"/><path d="M12 12.25v8"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v4.75l3 1.75"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  rss: '<path d="M5 5.5a13.5 13.5 0 0 1 13.5 13.5"/><path d="M5 11a8 8 0 0 1 8 8"/><circle cx="6" cy="18" r="1.25"/>',
  atom: '<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="8.5" ry="3.5" transform="rotate(120 12 12)"/>',
};

export type LineIcon = keyof typeof line;

export function lineIcon(name: LineIcon, className = "icon") {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${line[name]}</svg>`;
}

// A component's kind, read from its name; anything unrecognised keeps the neutral box.
const kinds: Array<[RegExp, LineIcon]> = [
  [/\b(e-?mail|mail|smtp|newsletter)/i, "mail"],
  [/\b(feed|rss|atom|badge|widget)/i, "feed"],
  [/\b(api|webhook|endpoint|integration|sdk)/i, "code"],
  [/\b(database|db|storage|backup|data)\b/i, "database"],
  [/\b(sign[- ]?in|log[- ]?in|auth|sso|identity|security)/i, "lock"],
  [/\b(payment|billing|checkout|invoice|card)/i, "card"],
  [/\b(chat|support|help ?desk|messag)/i, "chat"],
  [/\b(search)/i, "search"],
  [/\b(subscri|user|account|member|customer|team)/i, "people"],
  [/\b(app|mobile|ios|android|desktop)\b/i, "device"],
  [/\b(server|compute|host|infrastructure|cdn|network|edge|dns)/i, "server"],
  [/\.[a-z]{2,}\b|\b(website|domain|link|url)/i, "link"],
  [/\b(page|site|web|portal|dashboard|status)/i, "globe"],
];

export function componentIcon(name: string) {
  return lineIcon(kinds.find(([pattern]) => pattern.test(name))?.[1] ?? "box", "kind-icon");
}

// State glyphs: a filled disc in the state's colour around a white mark.
const marks: Record<ComponentState, string> = {
  "Operational": '<path d="m7.75 12.25 2.75 2.75 5.75-6"/>',
  "Degraded performance": '<path d="M12 7.5v5.25"/><path d="M12 16.25h.01"/>',
  "Partially unavailable": '<path d="M12 7.5v5.25"/><path d="M12 16.25h.01"/>',
  "Major outage": '<path d="m9 9 6 6"/><path d="m15 9-6 6"/>',
  "Under maintenance": '<path d="M12 8v4.25l2.5 1.5"/>',
};

export function stateGlyph(state: ComponentState, className = "state-glyph") {
  return `<svg class="${className} glyph-${state.toLowerCase().replaceAll(" ", "-")}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11"/><g fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${marks[state]}</g></svg>`;
}

/** Lamp's own mark, beside "Powered by Lamp" in the footer. Drawn inline, so the credit costs the page no request. */
export function lampMark() {
  return '<svg class="lamp-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path fill="#f4c25c" d="M.25 36A32 32 0 0 0 63.75 36Z"/><path fill="#17231c" d="M.25 36A32 32 0 1 1 63.75 36Z"/><path fill="#fff6df" d="M20 36A12 12 0 0 0 44 36Z"/></svg>';
}

export function pinIcon() {
  return '<svg class="pin-icon" viewBox="0 0 24 30" aria-hidden="true" focusable="false"><path d="M12 29c-.5 0-8.5-9.4-8.5-16.3a8.5 8.5 0 0 1 17 0C20.5 19.6 12.5 29 12 29Z"/><circle cx="12" cy="12.5" r="3.4"/></svg>';
}
