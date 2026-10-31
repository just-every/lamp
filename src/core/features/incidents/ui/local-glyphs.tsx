import type { SVGProps } from "react";
import { Icon } from "../../../app/client/ui/icon";

type SharedIcon = Parameters<typeof Icon>[0]["name"];

/** Glyphs the Update options menu and the incident panel need that `ui/icon.tsx` does not have yet. They stay here,
 * drawn exactly as that file draws its own, until the shared icon set takes them over; every other glyph is the
 * shared one. */
const local = {
  lines: "M4 7h16M4 12h16M4 17h10",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7L11.8 5.2M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  send: "M21 3 10 14M21 3l-6.5 18-4.5-7-7-4.5L21 3Z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  template: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4",
  pen: "m14.5 5.5 4 4M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5 4 20Z",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  note: "M5 4h14v11l-5 5H5zM14 20v-5h5",
  chart: "M6 20v-6M12 20V6M18 20v-9M4 20h16",
  person: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  report: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  chevron: "m9 6 6 6-6 6",
  lock: "M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
} as const;

export type GlyphName = keyof typeof local | SharedIcon;

export function Glyph({ name, ...props }: { name: GlyphName } & SVGProps<SVGSVGElement>) {
  if (!(name in local)) return <Icon name={name as SharedIcon} width={18} height={18} {...props} />;
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}><path d={local[name as keyof typeof local]} /></svg>;
}
