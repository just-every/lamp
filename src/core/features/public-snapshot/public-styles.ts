import templatesSource from "./styles/templates.css?raw";
import foundationSource from "./styles/foundation.css?raw";
import statusSource from "./styles/status.css?raw";
import componentsSource from "./styles/components.css?raw";
import recordSource from "./styles/record.css?raw";
import documentsSource from "./styles/documents.css?raw";
import responsiveSource from "./styles/responsive.css?raw";
import { localPublicPageFonts } from "./local-fonts";
import { accentInk } from "../../shared/accent-ink";

/** The public page's stylesheet: the business's accent substituted into Lamp's warm, quiet public design. */
export function publicStyles(accentColor: string) {
  const foundation = foundationSource.replace("__LAMP_ACCENT_COLOR__", accentColor).replace("__LAMP_ACCENT_INK__", accentInk(accentColor));
  return `${localPublicPageFonts}${foundation}${statusSource}${componentsSource}${recordSource}${documentsSource}${responsiveSource}${templatesSource}`;
}
