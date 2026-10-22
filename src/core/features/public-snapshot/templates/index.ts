import type { PublicSnapshotModel, SnapshotArtifact } from "../renderer";
import { MIN_MAP_REGIONS } from "../../../shared/regions";
import { calmPage } from "./calm";
import { historyLedPage } from "./history-led";
import { regionGroups, regionsPage } from "./regions";
import { housePage } from "./house";
import { templateScript, templateStyles } from "./assets";
import { templateShell, type TemplateName, type TemplateParts } from "./parts";

export type { TemplateParts } from "./parts";

/** The layout the public page shows. Regions map needs public components in two regions or more; without them the
 *  page quietly shows Calm headline, and Settings says why. House style needs a stored house style; until one is
 *  made the page shows Calm headline, and its foot says why (house-style/showing.ts). */
export function effectiveTemplate(model: PublicSnapshotModel): TemplateName | "default" {
  const chosen = model.settings.template ?? "default";
  if (chosen === "house") return model.house.showing.shown ? "house" : "calm";
  if (chosen === "regions" && regionGroups(model.visibleComponents).length < MIN_MAP_REGIONS) return "calm";
  return chosen;
}

const pages: Record<TemplateName, (model: PublicSnapshotModel, parts: TemplateParts) => string> = {
  calm: calmPage,
  uptime: historyLedPage,
  regions: regionsPage,
  house: housePage,
};

export function renderTemplatePage(template: TemplateName, model: PublicSnapshotModel, parts: TemplateParts) {
  return templateShell(template, model, parts, pages[template](model, parts));
}

/** A built-in template's own stylesheet and script. Only a page showing a template links them, so the default page
 *  and its shared assets stay exactly as they are. */
export function templateArtifacts(model: PublicSnapshotModel): SnapshotArtifact[] {
  const template = effectiveTemplate(model);
  if (template === "default") return [];
  return [
    { key: "assets/template.css", body: templateStyles(template, model), contentType: "text/css; charset=utf-8" },
    { key: "assets/template.js", body: templateScript, contentType: "application/javascript; charset=utf-8" },
  ];
}
