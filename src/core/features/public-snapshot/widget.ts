import runtime from "./widget-runtime.js?raw";
import type { statusPayload } from "./feed-widget";
import { parseWidgetAllowedOrigins } from "../../shared/widget-origins";

type WidgetPayload = ReturnType<typeof statusPayload> & {
  maintenance: { reference: string; title: string; state: string } | null;
};
type WidgetVariant = "banner" | "floating" | "dot";

/** Self-contained browser program: only public snapshot data crosses this boundary. */

export function renderWidget(payload: WidgetPayload, settings: { widgetAllowedOrigins: string }, defaultVariant: WidgetVariant = "banner"): string {
  const encode = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  return `(${runtime})(${encode(payload)},${encode(parseWidgetAllowedOrigins(settings.widgetAllowedOrigins))},${encode(defaultVariant)});`;
}
