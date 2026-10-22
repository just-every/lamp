import type { PublicSnapshotModel } from "../renderer";
import foundationSource from "../styles/foundation.css?raw";
import sharedSource from "./styles/shared.css?raw";
import calmSource from "./styles/calm.css?raw";
import historyLedSource from "./styles/history-led.css?raw";
import regionsSource from "./styles/regions.css?raw";
import houseSource from "./styles/house.css?raw";
import script from "./script.js?raw";
import { localPublicPageFonts } from "../local-fonts";
import { accentInk } from "../../../shared/accent-ink";
import { historyLedStyles } from "./history-led";
import { regionsMapStyles } from "./regions";
import { houseStyles } from "./house-styles";
import type { TemplateName } from "./parts";

const sources: Record<TemplateName, string> = { calm: calmSource, uptime: historyLedSource, regions: regionsSource, house: houseSource };

/** One stylesheet per published page: the bundled face, Lamp's public tokens in the business's accent, the shared
 *  template pieces and the chosen layout. The map's marker positions, the heatmap's date thinning and the house
 *  style's palette and picture geometry travel here, as the page allows no inline style. */
export function templateStyles(template: TemplateName, model: PublicSnapshotModel) {
  const { accentColor } = model.settings;
  const foundation = foundationSource.replace("__LAMP_ACCENT_COLOR__", accentColor).replace("__LAMP_ACCENT_INK__", accentInk(accentColor));
  const made = model.house.record?.made;
  const generated = template === "regions" ? regionsMapStyles(model) : template === "uptime" ? historyLedStyles(model) : template === "house" && made ? houseStyles(made) : "";
  return `${localPublicPageFonts}${foundation}${sharedSource}${sources[template]}${generated}`;
}

export const templateScript = script;
