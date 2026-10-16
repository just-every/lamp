// A suggestion goes to customers once the operator publishes it, so the words
// carry no internal handles: brief refs (A1, C2, U1, Q-...), incident references
// and machine timestamps. The model is told so (platform/ai/instructions.ts);
// this keeps a slip from reaching the composer.
const ref = String.raw`(?:[ACU]\d+|Q-[a-z-]+|INC-\d+|SCH-\d+)`;
const citation = new RegExp(String.raw`\s*[\(\[]\s*(?:(?:refs?|sources?|see)\s*:?\s*)?${ref}(?:\s*[,;/&]\s*${ref})*\s*[\)\]]`, "gu");
const bareRef = new RegExp(String.raw`\b(?:component|alert|update|incident|monitor)\s+${ref}\b`, "giu");
const isoTime = /\b(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/gu;
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function customerText(text: string) {
  return text
    .replace(citation, "")
    .replace(bareRef, (match) => match.split(/\s+/u)[0]!)
    .replace(isoTime, (match) => {
      const at = new Date(match);
      if (Number.isNaN(at.getTime())) return match;
      return `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")} UTC on ${at.getUTCDate()} ${months[at.getUTCMonth()]}`;
    })
    .replace(/\s+([.,;:])/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}
