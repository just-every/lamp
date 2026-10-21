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
  /** The business's products from its navigation, in page order; empty if fewer than two are found. */
  components: SiteComponent[];
  /** Who chose `components`: the model, or the rule-based reader when no model answered, and why. */
  componentsReadBy: { reader: "model"; model: string } | { reader: "rules"; reason: "no-model" | "model-error" | "timeout" | "invalid-answer" };
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

/** The one method of a Workers AI binding the reader uses: `env.AI` in a Worker. */
export interface AiRunner { run(model: string, inputs: Record<string, unknown>, options?: { extraHeaders?: Record<string, string>; signal?: AbortSignal }): Promise<unknown> }

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
  /** A Workers AI binding: two calls at most read the products from the page's navigation. Without it the rules choose. */
  ai?: AiRunner | null;
  /** The Workers AI text model; the default is in model.ts. */
  aiModel?: string;
  /** How long the model may take, both calls together, before the rules choose instead. Default 20 s. */
  aiTimeoutMs?: number;
}
