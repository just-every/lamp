import type { ComponentState } from "../../shared/domain";

import { escapeXml } from "./format";

export interface BrandSnapshot {
  settings: { logoKey: string | null; pageName: string };
  overall: ComponentState;
  logoDataUrl: string | null;
}

function stateColor(state: ComponentState) {
  return state === "Operational" ? "#16794c" : state === "Under maintenance" ? "#4565c5" : "#d66a1f";
}

export function renderBrandSvg(model: BrandSnapshot, kind: "favicon" | "og") {
  const { settings, overall } = model;
  const width = kind === "favicon" ? 128 : 1200;
  const height = kind === "favicon" ? 128 : 630;
  if (settings.logoKey && !model.logoDataUrl) throw new Error("Configured logo data is unavailable for public branding.");
  const mark = model.logoDataUrl
    ? `<image href="${escapeXml(model.logoDataUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity=".95"/>`
    : `<rect width="100%" height="100%" fill="#0e2238"/><text x="${kind === "favicon" ? 18 : 70}" y="${kind === "favicon" ? 80 : 300}" fill="white" font-family="system-ui,sans-serif" font-size="${kind === "favicon" ? 62 : 120}" font-weight="700">${escapeXml(settings.pageName.slice(0, 1).toUpperCase())}</text>`;
  const label = kind === "favicon" ? "" : `<rect x="50" y="${height - 156}" width="1100" height="106" rx="18" fill="#0e2238" fill-opacity=".9"/><text x="88" y="${height - 88}" fill="white" font-family="system-ui,sans-serif" font-size="50" font-weight="700">${escapeXml(`${settings.pageName}: ${overall}`)}</text>`;
  const radius = kind === "favicon" ? 23 : 62;
  const cx = kind === "favicon" ? 101 : 1090;
  const cy = kind === "favicon" ? 27 : 110;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`${settings.pageName}: ${overall}`)}">${mark}<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${stateColor(overall)}" stroke="white" stroke-width="${kind === "favicon" ? 7 : 14}"/>${label}</svg>`;
}
