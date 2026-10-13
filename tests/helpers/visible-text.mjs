// These public HTML readers need text and whitespace, not a second HTML renderer.
export function visibleText(html) {
  return html.replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|ensp|emsp|thinsp);/gi, " ")
    .replace(/&minus;/gi, "−")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)))
    .replace(/\s+/g, " ").trim();
}
