import { colourWords, type HousePalette } from "./palette.ts";

/** Bumped whenever the shared style below changes, so every account's picture is made again in the new style.
 *  house-style-3 (L18, 22 Oct 2026): grounded placement, a named base, a feathered cut-out and a name check. */
export const HOUSE_STYLE_VERSION = "house-style-3";

/** What the business's picture shows: chosen per account from what its website says it does. */
export interface MomentSubject {
  /** One physical object, described plainly: shape, material, no brand names. */
  object: string;
  /** How the object carries its soft warm light. */
  light: string;
  placement: "hanging" | "standing";
  /** What it rests on upright (its own base, feet or stand), or its cord when it hangs. */
  base: string;
  /** Why the object stands for this business, for the operator. */
  why: string;
}

const words = (hex: string) => `${colourWords(hex)} (${hex})`;
const plain = (text: string) => text.trim().replace(/\.$/, "");

/** The image prompt: the one illustration style every account shares, with this account's object and palette.
 *  Only the object, its base and light, and the two colours change between accounts; the style, composition and
 *  exclusions never do. The object is drawn on pure white: the page multiplies it onto the account's stone band and
 *  draws the house light itself, so no account's picture can bring its own background colour, vignette or seam. */
export function momentPrompt(subject: MomentSubject, palette: HousePalette) {
  // The subject leads: with the style sample first, FLUX.2 [dev] sometimes drew the sample's lamp (Basecamp, 21 Oct).
  // A standing object names what it rests on: a rule alone was ignored for Sentry, the field was followed (L18).
  const opening = subject.placement === "hanging"
    ? [`${plain(subject.object)}, ${plain(subject.light)}.`, "It hangs on a thin straight cord that runs up to the top edge of the picture."]
    : [`${plain(subject.object)}, resting upright on ${plain(subject.base)}, ${plain(subject.light)}.`, "It rests in its natural position on an unseen surface, with only a faint soft shadow directly beneath it."];
  const details = palette.accent ? ` with small ${words(palette.accent)} details` : "";
  return [
    ...opening,
    "Draw it in exactly the manner of image 0: soft matte rendering, gentle shading, calm warm light, white ground. Image 0's lamp is only a sample of that manner: draw only the subject above, and no lamp, lampshade or light fixture unless the subject is one.",
    "Style: a calm, minimal still-life illustration, softly rendered with smooth matte surfaces, gentle shading and little fine detail, like a quiet editorial picture; not a photograph.",
    `Colours: the object mainly ${words(palette.ink)}${details}; where it glows, a soft warm light.`,
    "Background: pure white (#ffffff) everywhere, seamless, like a cut-out on white paper: no colour, no vignette, no gradient, no halo, no wall, floor, horizon, table or frame.",
    "Composition: the object is centred and fills about half of the picture's height, with clear white space on every side; nothing touches the edges.",
    "Nothing else in the picture: no text, letters, numbers, logos, symbols, people, hands, screens, plants or other objects.",
  ].join(" ");
}
