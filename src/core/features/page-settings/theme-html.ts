import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";
import { ThemeValidationError } from "../../shared/page-theme";

const allowedElements = new Set(["a", "p", "span", "strong", "em", "br", "ul", "ol", "li", "nav", "img"]);
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const invalidUrlCharacters = /[\x00-\x20\x7f\\]/;

/** Navigational links may leave the page over HTTPS; resources may not. */
export function validThemeHref(value: string, origin: string): boolean {
  if (!value || invalidUrlCharacters.test(value) || value.startsWith("//")) return false;
  try {
    const url = new URL(value, origin);
    if (url.username || url.password) return false;
    if (/^https:\/\//i.test(value)) return url.protocol === "https:";
    return !/^[a-z][a-z\d+.-]*:/i.test(value) && url.origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

function imageUrl(value: string, origin: string): string | null {
  if (!value || invalidUrlCharacters.test(value) || value.startsWith("//")) return null;
  try {
    const url = new URL(value, origin);
    return url.origin === new URL(origin).origin && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function sanitizeThemeHtml(source: string, field: "headerHtml" | "footerHtml", options: {
  origin: string;
  imagePaths: string[];
}): { html: string; removals: string[] } {
  const enforceSize = (html: string) => {
    if (new TextEncoder().encode(html).byteLength > 8192) {
      throw new ThemeValidationError(`${field} byte limit`, "Custom HTML must be at most 8192 UTF-8 bytes.");
    }
  };
  enforceSize(source);
  const images = new Set(options.imagePaths.map(path => imageUrl(path, options.origin)).filter((url): url is string => url !== null));
  const fragment = parseFragment(source);
  const removals: string[] = [];
  type Parent = DefaultTreeAdapterMap["documentFragment"] | DefaultTreeAdapterMap["element"];

  function sanitize(parent: Parent) {
    parent.childNodes = parent.childNodes.filter(node => {
      if (node.nodeName === "#text") return true;
      if (!("tagName" in node)) {
        removals.push(`${field}: removed ${node.nodeName}.`);
        return false;
      }
      const tag = node.tagName;
      if (node.namespaceURI !== htmlNamespace || !allowedElements.has(tag)) {
        removals.push(`${field}: removed <${tag}> element.`);
        return false;
      }
      node.attrs = node.attrs.filter(attr => {
        const name = attr.name;
        const permitted = !attr.namespace && !attr.prefix && (
          name === "class" || name === "alt" ||
          (name === "href" && tag === "a" && validThemeHref(attr.value, options.origin)) ||
          (name === "src" && tag === "img" && images.has(imageUrl(attr.value, options.origin) ?? ""))
        );
        if (!permitted) removals.push(`${field}: removed ${name} attribute from <${tag}>.`);
        return permitted;
      });
      if (tag === "img" && !node.attrs.some(attr => attr.name === "src")) {
        removals.push(`${field}: removed <img> without an uploaded image source.`);
        return false;
      }
      sanitize(node);
      return true;
    });
  }

  sanitize(fragment);
  const html = serialize(fragment);
  enforceSize(html);
  return { html, removals };
}
