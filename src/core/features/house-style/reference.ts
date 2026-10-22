import dataUrl from "./house-reference.png?inline";

/** The house style's one style sample: Lamp's own hanging lamp (study 12) on white. Every account's picture is drawn
 *  in its manner; the prompt says to take its drawing, never its lamp. Smaller than 512×512, as FLUX.2 requires. */
export function houseReference() {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  return { bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)), contentType: "image/png", width: 448, height: 448 };
}
