import type { SocialNetwork } from "./networks";

export const SOCIAL_POST_LIMITS: Record<SocialNetwork, number> = { x: 280, bluesky: 300, mastodon: 500 };

/** Bluesky counts graphemes. X gives CJK and emoji a weight of two; counting
 * every non-Latin character twice and URLs at their literal length is
 * deliberately conservative. Mastodon permits at least 500 characters. */
function lengthFor(network: SocialNetwork, text: string): number {
  if (network === "bluesky") return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].length;
  if (network === "x") return [...text].reduce((length, character) => length + (character.codePointAt(0)! > 0x10ff ? 2 : 1), 0);
  return [...text].length;
}

/** Keep the owner's prefix, lifecycle and complete permalink. Shorten only the
 * impact statement, taking complete words; retries use these same frozen bytes. */
export function renderSocialPost(network: SocialNetwork, prefix: string, lifecycle: string, impact: string, url: string): string {
  const heading = [prefix.trim(), `${lifecycle}:`].filter(Boolean).join(" ");
  const limit = SOCIAL_POST_LIMITS[network];
  const render = (words: string[]) => `${heading}${words.length ? ` ${words.join(" ")}` : ""}\n${url}`;
  if (lengthFor(network, render([])) > limit) throw new Error("Social prefix and permalink exceed the network limit.");
  const words: string[] = [];
  for (const word of impact.trim().split(/\s+/).filter(Boolean)) {
    if (lengthFor(network, render([...words, word])) > limit) break;
    words.push(word);
  }
  return render(words);
}
