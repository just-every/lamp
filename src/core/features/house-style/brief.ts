import type { SiteRead } from "../../platform/site-reader/index.ts";
import { HOUSE_STYLE_VERSION } from "./style.ts";
import type { BusinessSummary } from "./subject.ts";

/** The brand fields a house style is made from: the page's own settings and the website they were read from. */
export interface BrandInputs {
  pageName: string;
  tagline: string;
  accentColor: string;
  website: string | null;
}

/** Changes when anything the house style is made from changes; a stored style with another signature is made again. */
export function brandSignature(inputs: BrandInputs, model: string) {
  return JSON.stringify([HOUSE_STYLE_VERSION, model, inputs.pageName.trim(), inputs.tagline.trim(), inputs.accentColor.toLowerCase(), inputs.website ?? ""]);
}

/** What the subject model is told about the business: the site's own words when Lamp can read it, else the page's. */
export function businessSummary(inputs: BrandInputs, site: SiteRead | null, componentNames: string[]): BusinessSummary {
  const fromPage = inputs.pageName.replace(/\s+status\s*$/i, "").trim() || inputs.pageName;
  return {
    name: site?.name ?? fromPage,
    host: site?.host.replace(/^www\./, "") ?? (inputs.website ? new URL(inputs.website).hostname.replace(/^www\./, "") : ""),
    title: site?.title ?? null,
    description: site?.description ?? (inputs.tagline || null),
    components: site?.components.length ? site.components.map((component) => component.name) : componentNames,
  };
}
