import foundationSource from "./styles/foundation.css?raw";
import statusSource from "./styles/status.css?raw";
import componentsSource from "./styles/components.css?raw";
import recordSource from "./styles/record.css?raw";
import documentsSource from "./styles/documents.css?raw";
import responsiveSource from "./styles/responsive.css?raw";
import { localPublicPageFonts } from "./local-fonts";

function luminance(hex: string) {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const INK = "#182d24";

/** Text on the owner's accent: white when it reads at AA, otherwise the page ink, whichever contrasts more. */
export function accentInk(accentColor: string) {
  const accent = luminance(accentColor);
  const onWhite = 1.05 / (accent + 0.05);
  const onInk = (accent + 0.05) / (luminance(INK) + 0.05);
  return onWhite >= 4.5 || onWhite >= onInk ? "#ffffff" : INK;
}

/** The public page's stylesheet: the business's accent substituted into Lamp's warm, quiet public design. */
export function publicStyles(accentColor: string) {
  const foundation = foundationSource.replace("__LAMP_ACCENT_COLOR__", accentColor).replace("__LAMP_ACCENT_INK__", accentInk(accentColor));
  return `${localPublicPageFonts}${foundation}${statusSource}${componentsSource}${recordSource}${documentsSource}${responsiveSource}`;
}
