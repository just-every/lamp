import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ThemeAsset } from "../../shared/page-theme";

const elements = new Set(["a", "p", "span", "strong", "em", "br", "ul", "ol", "li", "nav", "img"]);
const discardContents = new Set(["script", "style", "iframe", "object", "embed", "template", "form", "svg", "math"]);
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function pageLinkAllowed(value: string, origin = "https://lamp.invalid") {
  if (/^[\s\u0000-\u001f\u007f]/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value, origin);
    return url.origin === new URL(origin).origin && (url.protocol === "http:" || url.protocol === "https:")
      || /^https:/i.test(value) && url.protocol === "https:";
  } catch { return false; }
}

export function portablePageLink(value: string, origin?: string) {
  if (!origin || !/^(?:https?:|\/\/)/i.test(value)) return value;
  const url = new URL(value, origin);
  return url.origin === new URL(origin).origin ? url.pathname + url.search + url.hash : value;
}

export function themeHtmlAssetPaths(html: string) {
  const paths = new Set<string>();
  function visit(node: DefaultTreeAdapterMap["childNode"]) {
    if (!("tagName" in node)) return;
    if (node.tagName === "img") {
      const src = node.attrs.find(attribute => attribute.name === "src" && !attribute.namespace)?.value;
      if (src) paths.add(src);
    }
    for (const child of node.childNodes) visit(child);
  }
  for (const node of parseFragment(html).childNodes) visit(node);
  return paths;
}

/** HTML is parsed as a fragment, reconstructed from the allow-list and never interpolated as untrusted tags. */
export function sanitizeThemeHtml(input: string, field: "headerHtml" | "footerHtml", assets: ThemeAsset[], origin?: string) {
  const images = new Set(assets.filter(asset => asset.kind === "image").map(asset => asset.path));
  function uploadedImage(value: string) {
    if (images.has(value)) return value;
    if (!origin || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
    try {
      const url = new URL(value, origin);
      return url.origin === new URL(origin).origin && images.has(url.pathname) ? url.pathname : null;
    } catch { return null; }
  }
  const removals: string[] = [];
  function render(node: DefaultTreeAdapterMap["childNode"]): string {
    if (node.nodeName === "#text") return escape((node as DefaultTreeAdapterMap["textNode"]).value);
    if (!("tagName" in node)) {
      removals.push(`${field}: ${node.nodeName} removed`);
      return "";
    }
    const name = node.tagName;
    if (!elements.has(name) || node.namespaceURI !== "http://www.w3.org/1999/xhtml") {
      removals.push(`${field}: <${name}> element removed`);
      return discardContents.has(name) ? "" : node.childNodes.map(render).join("");
    }
    const kept: string[] = [];
    let imageAllowed = false;
    for (const attribute of node.attrs) {
      const key = attribute.name;
      const value = attribute.value;
      if (!attribute.namespace && (key === "class" || key === "alt")) kept.push(`${key}="${escape(value)}"`);
      else if (!attribute.namespace && key === "href" && name === "a" && pageLinkAllowed(value, origin)) kept.push(`href="${escape(portablePageLink(value, origin))}"`);
      else if (!attribute.namespace && key === "src" && name === "img" && uploadedImage(value)) {
        imageAllowed = true;
        kept.push(`src="${escape(uploadedImage(value)!)}"`);
      } else removals.push(`${field}: ${key} attribute on <${name}> removed${key === "src" ? " (image must be uploaded to this page)" : ""}`);
    }
    if (name === "img" && !imageAllowed) {
      removals.push(`${field}: external or unowned <img> element removed`);
      return "";
    }
    const opening = `<${name}${kept.length ? " " + kept.join(" ") : ""}>`;
    return name === "img" || name === "br" ? opening : `${opening}${node.childNodes.map(render).join("")}</${name}>`;
  }
  return { html: parseFragment(input).childNodes.map(render).join(""), removals };
}
