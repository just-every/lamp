import { z } from "zod";

const colour = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Widget colours must be six-digit hex colours.");

export const widgetAppearanceSchema = z.object({
  variant: z.enum(["banner", "floating", "dot"]),
  position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
  background: colour,
  color: colour,
  hideOperational: z.boolean(),
}).strict();

export type WidgetAppearance = z.infer<typeof widgetAppearanceSchema>;

export const defaultWidgetAppearance: WidgetAppearance = {
  variant: "banner",
  position: "bottom-right",
  background: "#ffffff",
  color: "#182d24",
  hideOperational: false,
};
