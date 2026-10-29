import type { PageTheme } from "./page-theme";

export type ThemePalette = NonNullable<PageTheme["palette"]>;
type Colour = keyof ThemePalette | `#${string}`;

export interface CardColourPair {
  foreground: Colour;
  background: Colour;
  /** Public selectors are relative to body.lamp-public; & selects the body itself. */
  selectors: readonly string[];
  fill?: boolean;
}

export interface ThemeCard {
  name: string;
  audience: "public" | "dashboard";
  pairs: readonly CardColourPair[];
}

export function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(offset => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function cardColour(colour: Colour, palette: ThemePalette) {
  return colour.startsWith("#") ? colour : palette[colour as keyof ThemePalette];
}

const stateSelectors = {
  operational: ":is(.tone-ok,.tone-operational,.tl-resolved .tl-kicker)",
  degraded: ":is(.tone-degraded,.tl-open .tl-kicker)",
  partial: ".tone-partial",
  major: ".tone-major",
  maintenance: ":is(.tone-maint,.tl-maint .tl-kicker)",
} as const;

function publicCard(name: string, roots: string[], background: "background" | "surface", fill = true): ThemeCard {
  const descendants = (selector: string) => roots.map(root => `${root === "&" ? "" : `${root} `}${selector}`);
  return { name, audience: "public", pairs: [
    { foreground: "text", background, selectors: roots, fill },
    { foreground: "link", background, selectors: descendants("a") },
    ...Object.entries(stateSelectors).map(([foreground, selector]) => ({
      foreground: foreground as keyof typeof stateSelectors, background, selectors: descendants(selector),
    })),
  ] };
}

function publicPaint(name: string, foreground: Colour, background: Colour, selectors: string[], fill = true): ThemeCard {
  return { name, audience: "public", pairs: [{ foreground, background, selectors, fill }] };
}

// Overview does not receive the owner's public palette. These are its actual fixed text
// tokens, from app/client/ui/{tokens,surfaces,records,page-live,states}.css and
// communication-performance/ui/performance.css, including nested and alternate fills.
const dashboard = {
  ink: "#182d24", secondary: "#44544c", muted: "#5f6d66", card: "#ffffff",
  tint: "#fbfaf7", chip: "#f5f4ef", amberWash: "#fff7e2", amberInk: "#8a5a06",
  onInk: "#fbfaf5", pill: "#182d24", pillHover: "#22392e",
  // color-mix(in srgb, #19865a 7%, #ffffff), as used by .live-strip.
  live: "#eff7f3",
} as const;

function dashboardCard(name: string, backgrounds: readonly (keyof typeof dashboard)[], foregrounds: readonly (keyof typeof dashboard)[] = ["ink", "secondary", "muted"]): ThemeCard {
  return { name, audience: "dashboard", pairs: backgrounds.flatMap(background => foregrounds.map(foreground => ({
    foreground: dashboard[foreground], background: dashboard[background], selectors: [],
  }))) };
}

/** The same pairs both gate publication and paint public cards. Dashboard entries
 * validate its independent fixed tokens and deliberately emit no public CSS. */
export const THEME_CARDS: readonly ThemeCard[] = [
  publicCard("Status canvas card", ["&", ".tpl"], "background"),
  publicCard("Status summary card", [".status-banner #status-live"], "surface"),
  publicCard("Component group card", [".component-group", ".component-group > h3"], "surface"),
  publicCard("Active incident card", [".timeline-incident"], "surface"),
  publicCard("Maintenance card", [".timeline-maintenance"], "surface"),
  publicCard("Resolved history card", [".resolved-list", ".history-item"], "surface"),
  publicCard("Incident document card", [".incident-document-main > .incident", ".incident-summary"], "surface"),
  publicCard("Incident about card", [".about"], "surface"),
  publicCard("Postmortem report card", [".report"], "surface"),
  publicCard("Subscription card", [".subscribe", ".subscriber-document", ".subscriber-scope"], "surface"),
  publicCard("Empty and missing status card", [".empty-state", ".not-found"], "surface"),
  publicCard("Calm component and history card", [".calm-components", ".calm-history"], "background", false),
  publicCard("Uptime summary card", [".up-situation", ".up-figure"], "background", false),
  publicCard("Uptime heatmap card", [".hm-frame"], "surface"),
  publicCard("Uptime incident and maintenance card", [".tpl-uptime .tl"], "surface"),
  publicCard("Regions map card", [".rg-card", ".rg-key-item"], "surface"),
  publicCard("Regions component card", [".rg-rows"], "surface"),
  publicCard("Regions incident and maintenance card", [".tpl-regions .tl"], "surface"),
  publicCard("Template subscription card", [".up-subscribe", ".tpl-subscribe"], "surface"),
  publicCard("Uptime header card", [".up-band"], "surface"),
  publicPaint("Uptime header brand", "text", "surface", [".up-band .tpl-brand", ".up-band .tpl-tagline"]),
  publicPaint("Stale snapshot notice card", "degraded", "surface", [".snapshot-stale"]),
  publicPaint("Maintenance overrun badge", "degraded", "surface", [".overrun"]),
  publicPaint("Heatmap incident callout card", "link", "surface", [".hm-callout a", ".hm-callout.is-done a"]),
  publicPaint("Incident state badge", "degraded", "surface", [".tl-state span"]),
  publicPaint("Incident operational state badge", "operational", "surface", [".tl-state .tone-ok"]),
  publicPaint("Incident degraded state badge", "degraded", "surface", [".tl-state .tone-degraded"]),
  publicPaint("Incident partial state badge", "partial", "surface", [".tl-state .tone-partial"]),
  publicPaint("Incident major state badge", "major", "surface", [".tl-state .tone-major"]),
  publicPaint("Incident maintenance state badge", "maintenance", "surface", [".tl-state .tone-maint"]),
  publicPaint("Status utility hover", "text", "surface", [".status-utilities a:hover", ".status-utilities a[aria-current=\"page\"]"]),
  publicPaint("Subscription action", "surface", "text", [".subscribe button", ".subscriber-document button", ".tpl-subscribe button", ".tpl-subscribe.on-dark button", ".up-band .up-band-subscribe", ".status-utilities .subscribe-link", ".status-utilities .subscribe-link:hover"]),
  publicPaint("Selected region filter", "surface", "text", [".rg-filters a[aria-current=\"true\"]"]),
  publicPaint("Region key number", "surface", "text", [".rg-key-item b"]),
  publicPaint("Degraded region key number", "surface", "degraded", [".rg-key-item.tone-degraded b"]),
  publicPaint("Partial region key number", "surface", "partial", [".rg-key-item.tone-partial b"]),
  publicPaint("Major region key number", "surface", "major", [".rg-key-item.tone-major b"]),
  publicPaint("Maintenance region key number", "surface", "maintenance", [".rg-key-item.tone-maint b"]),
  publicPaint("Subscriber cancellation action", "major", "surface", [".subscriber-document form + form button"]),
  publicPaint("Subscription input", "text", "surface", [".subscribe input", ".tpl-subscribe input"]),
  publicPaint("Subscription placeholder", "text", "surface", [".subscribe input::placeholder", ".tpl-subscribe input::placeholder"], false),
  publicPaint("Status operational icon", "operational", "surface", [".overall-status-icon"]),
  publicPaint("Status degraded icon", "degraded", "surface", [".status-banner.degraded-performance .overall-status-icon"]),
  publicPaint("Status partial icon", "partial", "surface", [".status-banner.partially-unavailable .overall-status-icon"]),
  publicPaint("Status major icon", "major", "surface", [".status-banner.major-outage .overall-status-icon"]),
  publicPaint("Status maintenance icon", "maintenance", "surface", [".status-banner.under-maintenance .overall-status-icon"]),
  publicPaint("Subscriber icon", "link", "surface", [".subscriber-icon"]),
  dashboardCard("Dashboard active incidents card", ["card", "tint", "amberWash"]),
  dashboardCard("Dashboard active incident overdue label", ["card", "tint", "amberWash"], ["amberInk"]),
  dashboardCard("Dashboard component states card", ["card", "chip"]),
  dashboardCard("Dashboard upcoming maintenance card", ["card"]),
  dashboardCard("Dashboard follow-ups card", ["card"], ["ink", "secondary", "muted", "amberInk"]),
  dashboardCard("Dashboard communication performance card", ["card"]),
  dashboardCard("Dashboard live status card", ["live", "amberWash"], ["ink", "secondary", "amberInk"]),
  dashboardCard("Dashboard updates due card", ["amberWash"], ["secondary", "amberInk"]),
  dashboardCard("Dashboard loading and error card", ["card", "amberWash"]),
  dashboardCard("Dashboard primary action", ["pill", "pillHover"], ["onInk"]),
  dashboardCard("Dashboard secondary action and form", ["card"]),
];
