export type UpdateTextToken = {
  kind: "text";
  text: string;
  start: number;
  end: number;
} | {
  kind: "https";
  text: string;
  href: string;
  hostname: string;
  start: number;
  end: number;
};

/** Offsets throughout this module are UTF-16 indices into the original text. */
function literalTagEnd(text: string, start: number) {
  if (!/^<(?:\/?[A-Za-z]|!|\?)/u.test(text.slice(start))) return start;
  let quote = "";
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]!;
    if (quote) { if (character === quote) quote = ""; }
    else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index + 1;
  }
  return text.length;
}

function trimPunctuation(candidate: string) {
  let value = candidate;
  for (;;) {
    const previous = value;
    value = value.replace(/[.,;:!?]+$/u, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
      while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1);
    }
    if (value === previous) return value;
  }
}

/** Only bare HTTPS URLs become tokens; tag-shaped text and attributes stay literal. */
export function tokenizeUpdateLinks(text: string): UpdateTextToken[] {
  const tokens: UpdateTextToken[] = [];
  let literalStart = 0;
  for (let index = 0; index < text.length;) {
    if (text[index] === "<") {
      const end = literalTagEnd(text, index);
      if (end > index) { index = end; continue; }
    }
    const previous = index > 0 ? text[index - 1]! : "";
    if (!text.startsWith("https://", index) || /[\p{L}\p{N}_/:@=]/u.test(previous)) { index += 1; continue; }
    const candidate = /^[^\s<>"'`]+/u.exec(text.slice(index))?.[0] ?? "";
    const value = trimPunctuation(candidate);
    let url: URL;
    try { url = new URL(value); }
    catch { index += Math.max(candidate.length, 1); continue; }
    if (url.protocol !== "https:" || !url.hostname || /[\\\u0000-\u001f\u007f]/u.test(value)) { index += Math.max(candidate.length, 1); continue; }
    if (index > literalStart) tokens.push({ kind: "text", text: text.slice(literalStart, index), start: literalStart, end: index });
    const end = index + value.length;
    tokens.push({ kind: "https", text: value, href: value, hostname: url.hostname, start: index, end });
    literalStart = end;
    index = end;
  }
  if (literalStart < text.length) tokens.push({ kind: "text", text: text.slice(literalStart), start: literalStart, end: text.length });
  return tokens;
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function renderUpdateHtml(text: string) {
  return tokenizeUpdateLinks(text).map(token => token.kind === "https"
    ? `<a href="${escapeHtml(token.href)}" rel="nofollow noopener ugc">${escapeHtml(token.text)}</a>`
    : escapeHtml(token.text)).join("");
}

function escapeSlack(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** For Slack mrkdwn text objects; callers must disable automatic link/mention parsing. */
export function renderUpdateSlack(text: string) {
  return tokenizeUpdateLinks(text).map(token => token.kind === "https"
    ? `<${escapeSlack(token.href.replaceAll("|", "%7C"))}>`
    : escapeSlack(token.text)).join("");
}

function escapeTeamsText(text: string) {
  return escapeHtml(text).replace(/[\\`*_{}\[\]()#+.!|~-]/gu, "\\$&");
}

/** Adaptive Card TextBlock Markdown, with literal prose and explicit URL labels. */
export function renderUpdateTeams(text: string) {
  return tokenizeUpdateLinks(text).map(token => token.kind === "https"
    ? `[${escapeTeamsText(token.text)}](${escapeHtml(token.href).replaceAll("(", "%28").replaceAll(")", "%29").replaceAll("[", "%5B").replaceAll("]", "%5D")})`
    : escapeTeamsText(token.text)).join("");
}
