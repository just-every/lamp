import { svgColours } from "./colour.ts";
import { iconCandidates, siteColours, siteComponents, siteDescription, siteFonts, siteName, siteStatusPage, type Manifest } from "./extract.ts";
import { checkedUrl, dohResolver, guardedFetch, SiteReadError, type GuardedFetchContext } from "./fetch.ts";
import { scanHtml } from "./html.ts";
import { navigationOutline } from "./outline.ts";
import { askForProducts, PRODUCTS_MODEL } from "./products.ts";
import type { SiteIcon, SiteRead, SiteReadOptions, SiteReadResult } from "./types.ts";

export type { AiRunner, SiteComponent, SiteIcon, SiteRead, SiteReadFailure, SiteReadOptions, SiteReadResult } from "./types.ts";
export { isPublicAddress } from "./address.ts";

/** "example.com", "www.example.com/about" or a full http(s) URL. */
export function normaliseWebsite(input: string): URL {
  const text = input.trim();
  return checkedUrl(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
}

/** Read one public website: its page, its web manifest if it declares one, and one icon. */
export async function readSite(input: string, options: SiteReadOptions = {}): Promise<SiteReadResult> {
  // Called unbound: Workers refuse a global fetch invoked as a method of another object.
  const transport = options.fetch ?? fetch;
  const context: GuardedFetchContext = {
    fetch: (input, init) => transport(input, init),
    resolve: options.resolve ?? dohResolver(),
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    maxRedirects: options.maxRedirects ?? 5,
  };
  try {
    const start = normaliseWebsite(input);
    const page = await guardedFetch(start, "text/html,application/xhtml+xml", options.maxHtmlBytes ?? 1_500_000, true, context);
    if (!/html|xml/i.test(page.contentType)) throw new SiteReadError("not-html", "That address isn't a web page.");
    const scan = scanHtml(new TextDecoder().decode(page.bytes));
    // One model call reads the products while the manifest and icon load.
    const model = options.aiModel ?? PRODUCTS_MODEL;
    const products = options.ai ? askForProducts(options.ai, navigationOutline(scan, page.url, { name: siteName(scan, page.url.hostname, null), title: scan.title, description: siteDescription(scan, null) }), page.url, { model, timeoutMs: options.aiTimeoutMs }) : null;
    const manifestHref = scan.tags.find((tag) => tag.name === "link" && (tag.attributes.rel ?? "").toLowerCase().split(/\s+/).includes("manifest"))?.attributes.href;
    let manifestUrl: URL | null = null;
    let manifest: Manifest | null = null;
    if (manifestHref) {
      try {
        manifestUrl = new URL(manifestHref, page.url);
        const parsed: unknown = JSON.parse(new TextDecoder().decode((await guardedFetch(manifestUrl, "application/manifest+json,application/json", 100_000, false, context)).bytes));
        manifest = parsed && typeof parsed === "object" ? parsed as Manifest : null;
      } catch { manifest = null; /* A broken manifest only means less to read. */ }
    }
    let icon: SiteIcon | null = null;
    for (const candidate of iconCandidates(scan, page.url, manifest, manifestUrl).slice(0, 3)) {
      try {
        const fetched = await guardedFetch(new URL(candidate.url), "image/svg+xml,image/png,image/*;q=0.8", options.maxIconBytes ?? 300_000, false, context);
        icon = iconFrom(fetched.url.href, fetched.bytes);
        if (icon) break;
      } catch (cause) {
        if (context.signal.aborted) throw cause;
      }
    }
    const { colours, accent } = siteColours(scan, icon?.contentType === "image/svg+xml" ? svgColours(new TextDecoder().decode(dataBytes(icon.dataUrl))) : [], manifest);
    const answer = await products;
    // Without a model answer, the rule-based reader chooses, and the result says why.
    const chosen: Pick<SiteRead, "components" | "componentsReadBy"> = answer?.ok
      ? { components: answer.components, componentsReadBy: { reader: "model", model } }
      : { components: siteComponents(scan, page.url), componentsReadBy: { reader: "rules", reason: answer?.reason ?? "no-model" } };
    return {
      ok: true,
      site: {
        url: page.url.href,
        host: page.url.hostname,
        name: siteName(scan, page.url.hostname, manifest),
        title: scan.title,
        description: siteDescription(scan, manifest),
        icon,
        colours,
        accent,
        fonts: siteFonts(scan),
        ...chosen,
        statusPage: siteStatusPage(scan, page.url),
      },
    };
  } catch (cause) {
    if (cause instanceof SiteReadError) return { ok: false, reason: cause.reason, message: cause.message };
    if (context.signal.aborted) return { ok: false, reason: "timeout", message: "That website took too long to answer." };
    return { ok: false, reason: "unreachable", message: "We couldn't reach that website." };
  }
}

function sniff(bytes: Uint8Array): string | null {
  const head = (length: number) => [...bytes.subarray(0, length)];
  if (head(8).join() === "137,80,78,71,13,10,26,10") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (String.fromCharCode(...head(4)) === "GIF8") return "image/gif";
  if (String.fromCharCode(...head(4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  if (head(4).join() === "0,0,1,0") return "image/x-icon";
  const text = new TextDecoder().decode(bytes.subarray(0, 2048)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(text)) return "image/svg+xml";
  return null;
}

function iconFrom(url: string, bytes: Uint8Array): SiteIcon | null {
  const contentType = sniff(bytes);
  if (!contentType || !bytes.byteLength) return null;
  let width: number | null = null, height: number | null = null;
  if (contentType === "image/png" && bytes.byteLength >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    width = view.getUint32(16); height = view.getUint32(20);
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return { url, contentType, dataUrl: `data:${contentType};base64,${btoa(binary)}`, width, height };
}

function dataBytes(dataUrl: string) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
