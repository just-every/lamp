import { tokenizeUpdateLinks } from "../../shared/update-links";
const gsm = new Set(Array.from("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"));
const extended = new Set(Array.from("^{}\\[~]|€"));
function units(text: string, unicode: boolean) {
  return unicode ? text.length : Array.from(text).reduce((sum, character) => sum + (extended.has(character) ? 2 : 1), 0);
}
/** Never submit an overlength control message. Consent and HELP wording cannot
 * be truncated because their full page identity and carrier wording matter. */
export function assertSmsWithinTwoSegments(text: string) {
  const unicode=Array.from(text).some(character=>!gsm.has(character)&&!extended.has(character));
  if(units(text,unicode)>(unicode?134:306))throw new Error("The SMS page name or support contact makes this message longer than two segments. Shorten them before enabling SMS.");
}
/** Reserve the complete permanent link first. HTTPS tokens are indivisible;
 * literal text is the only material which can be shortened. */
export function renderSmsMessage(text: string, permanentLink: string): string {
  const unicode = Array.from(text + permanentLink).some(character => !gsm.has(character) && !extended.has(character));
  const maximum = unicode ? 134 : 306;
  const suffix = `\n${permanentLink}`;
  if (units(suffix, unicode) > maximum) throw new Error("The permanent SMS link exceeds two segments.");
  let result = "";
  const budget = maximum - units(suffix, unicode);
  for (const token of tokenizeUpdateLinks(text)) {
    if (units(result + token.text, unicode) <= budget) { result += token.text; continue; }
    if (token.kind === "text") for (const character of token.text) {
      if (units(result + character, unicode) > budget) break;
      result += character;
    }
    break;
  }
  return result.trimEnd() + suffix;
}
