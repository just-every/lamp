/** Component regions as owners type them, compared without case, accents or punctuation, so "Asia-Pacific" and
 *  "asia pacific" are one region on the public page and in Settings alike. */
export function regionKey(region: string | null | undefined) {
  return (region ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

/** A map of one place navigates nowhere: the Regions map template needs public components in two regions or more. */
export const MIN_MAP_REGIONS = 2;

export function regionCount(regions: ReadonlyArray<string | null | undefined>) {
  return new Set(regions.map(regionKey).filter(Boolean)).size;
}
