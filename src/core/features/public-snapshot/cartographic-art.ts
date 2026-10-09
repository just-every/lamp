import mapDataUrl from "./cartographic-map.png?inline";

/**
 * The selected improve-kit contour artwork remains a single snapshot-owned R2
 * artifact, preserving the initial document and four-request budgets.
 */
export function cartographicMapSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="950" height="854" viewBox="0 0 950 854" role="img" aria-label="Cartographic illustration"><image href="${mapDataUrl}" width="950" height="854" preserveAspectRatio="xMidYMid meet"/></svg>`;
}
