/** What a public website says about itself. Every field is read from the site; absent means the site did not say. */
export interface SiteRead {
  /** The page that answered, after redirects. */
  url: string;
  host: string;
  /** The business or product name, e.g. "Harvest". */
  name: string | null;
  title: string | null;
  description: string | null;
  icon: SiteIcon | null;
  /** Brand colours as #rrggbb, most confident first. */
  colours: string[];
  /** The first colour in `colours` saturated enough to brand buttons and links. */
  accent: string | null;
  fonts: string[];
  /** Plausible service areas from navigation, in page order; empty if fewer than two are found. */
  components: SiteComponent[];
  /** A status page the site links to. */
  statusPage: { url: string } | null;
}

export interface SiteIcon {
  url: string;
  /** Sniffed from the bytes: image/svg+xml, image/png, image/jpeg, image/gif, image/webp or image/x-icon. */
  contentType: string;
  /** The icon bytes as a data: URL. Show an SVG only in an <img> (no scripts run there). */
  dataUrl: string;
  width: number | null;
  height: number | null;
}

export interface SiteComponent { name: string; url: string }

export type SiteReadFailure = "invalid-url" | "refused-address" | "unreachable" | "timeout" | "http-error" | "not-html";

export type SiteReadResult =
  | { ok: true; site: SiteRead }
  | { ok: false; reason: SiteReadFailure; message: string };

export interface SiteReadOptions {
  /** Network transport; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Hostname to IP addresses; defaults to DNS over HTTPS at cloudflare-dns.com. */
  resolve?: (hostname: string) => Promise<string[]>;
  /** Whole read, every request included. Default 10 s. */
  timeoutMs?: number;
  /** HTML beyond this is not read. Default 1.5 MB. */
  maxHtmlBytes?: number;
  /** A larger icon is skipped. Default 300 KB. */
  maxIconBytes?: number;
  /** Default 5. Every hop is checked again. */
  maxRedirects?: number;
}
