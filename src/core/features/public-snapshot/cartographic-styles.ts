import foundationSource from "./cartographic-foundation.css?raw";
import componentSource from "./cartographic-components.css?raw";
import responsiveSource from "./cartographic-responsive.css?raw";
import timelineSource from "./cartographic-timeline.css?raw";
import { localPublicPageFonts } from "./local-fonts";

/** Styles for the owner-selected cartographic public status page. */
export function cartographicStyles(accentColor: string) {
  return `${localPublicPageFonts}${foundationSource.replace("__LAMP_ACCENT_COLOR__", accentColor)}${componentSource}${timelineSource}${responsiveSource}`;
}
