import { publicThemeStyles } from "../theme";
import type { PublicSnapshotModel } from "../renderer";
import foundationSource from "../styles/foundation.css?raw";
import sharedSource from "./styles/shared.css?raw";
import calmSource from "./styles/calm.css?raw";
import historyLedSource from "./styles/history-led.css?raw";
import regionsSource from "./styles/regions.css?raw";
import script from "./script.js?raw";
import { localPublicPageFonts } from "../local-fonts";
import { accentInk } from "../../../shared/accent-ink";
import { historyLedStyles } from "./history-led";
import { regionsMapStyles } from "./regions";
import type { TemplateName } from "./parts";

const sources: Record<TemplateName, string> = { calm: calmSource, uptime: historyLedSource, regions: regionsSource };

/** One stylesheet per published page: the bundled face, Lamp's public tokens in the business's accent, the shared
 *  template pieces and the chosen layout. The map's marker positions and the heatmap's date thinning travel here, as
 *  the page allows no inline style. */
export function templateStyles(template: TemplateName, model: PublicSnapshotModel) {
  const { accentColor } = model.settings;
  const foundation = foundationSource.replace("__LAMP_ACCENT_COLOR__", accentColor).replace("__LAMP_ACCENT_INK__", accentInk(accentColor));
  const generated = template === "regions" ? regionsMapStyles(model) : template === "uptime" ? historyLedStyles(model) : "";
  return `${localPublicPageFonts}${foundation}${sharedSource}${sources[template]}${generated}${publicThemeStyles(model.theme, model.origin)}`;
}

export const templateScript = script;
