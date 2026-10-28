// The self-contained ESM distribution has no Node createRequire()/JSON lookups and runs in the Worker.
import { generate, ident, parse, walk, type CssNode, type List, type ListItem } from "css-tree/dist/csstree.esm";
import { InvalidThemeError } from "./theme-assets";

const defaultOrigin = "https://lamp.invalid";

function resourceUrl(value: string, origin: string) {
  try {
    const url = new URL(value, new URL("/assets/status-page.css", origin));
    if (url.origin === new URL(origin).origin && (url.protocol === "https:" || url.protocol === "http:")) return url;
  } catch { /* Name the invalid rule in the same refusal as an external resource. */ }
  throw new InvalidThemeError(`Owner CSS url() must stay on the page's own origin: ${value}`);
}

function cssAst(css: string, origin: string, assetPaths?: Set<string>) {
  let ast: CssNode;
  try {
    ast = parse(css, { parseCustomProperty: true, onParseError(error) { throw error; } });
  } catch (cause) {
    throw new InvalidThemeError(`Invalid owner CSS rule: ${cause instanceof Error ? cause.message : "CSS could not be parsed"}`);
  }
  walk(ast, node => {
    if (node.type === "Raw") throw new InvalidThemeError(`Invalid owner CSS rule: ${node.value}`);
    if (node.type === "Atrule" && ident.decode(node.name).toLowerCase() === "import") throw new InvalidThemeError("Owner CSS @import is not allowed.");
    if (node.type === "Declaration" && ident.decode(node.property).toLowerCase().replace(/^\*/, "") === "behavior") throw new InvalidThemeError("Owner CSS behavior is not allowed.");
    if (node.type === "Function") {
      const name = ident.decode(node.name).toLowerCase();
      if (name === "expression") throw new InvalidThemeError("Owner CSS expression() is not allowed.");
      // Escaped function identifiers remain Functions rather than Url nodes in CSS Tree.
      if (name === "url") {
        const argument = node.children.toArray();
        if (argument.length !== 1 || argument[0].type !== "String") throw new InvalidThemeError("Owner CSS url() contains an invalid resource URL.");
        const url = resourceUrl(argument[0].value, origin);
        assetPaths?.add(url.pathname);
      }
      // image-set() also accepts bare string URLs. Validate those as resource references.
      if (name === "image-set" || name === "-webkit-image-set") {
        for (const argument of node.children.toArray()) if (argument.type === "String") {
          const url = resourceUrl(argument.value, origin);
          assetPaths?.add(url.pathname);
        }
      }
    }
    if (node.type === "Url") {
      const url = resourceUrl(node.value, origin);
      assetPaths?.add(url.pathname);
    }
  });
  return ast;
}

/** Own-origin absolute resources become portable page paths. Ordinary owner CSS is retained as entered. */
export function normalizeOwnerCss(css: string, origin = defaultOrigin) {
  const ast = cssAst(css, origin);
  let changed = false;
  function portable(value: string) {
    if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return value;
    const url = resourceUrl(value, origin);
    changed = true;
    return url.pathname + url.search + url.hash;
  }
  walk(ast, node => {
    if (node.type === "Url") node.value = portable(node.value);
    if (node.type === "Function") {
      const name = ident.decode(node.name).toLowerCase();
      if (name === "url" || name === "image-set" || name === "-webkit-image-set") {
        for (const argument of node.children.toArray()) if (argument.type === "String") argument.value = portable(argument.value);
      }
    }
  });
  return changed ? generate(ast) : css;
}

/** Snapshot assembly copies only assets this stylesheet actually references. */
export function ownerCssAssetPaths(css: string, origin = defaultOrigin) {
  const paths = new Set<string>();
  cssAst(css, origin, paths);
  return paths;
}

/** Parse first, then scope the stylesheet as CSS. No owner selector can affect the operator application. */
export function scopeOwnerCss(css: string, origin = defaultOrigin) {
  if (!css.trim()) return "";
  const ast = cssAst(css, origin);
  walk(ast, {
    enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
      if (node.type === "TypeSelector" && ident.decode(node.name).toLowerCase() === "html" && item && list) {
        list.replace(item, list.createItem({ type: "PseudoClassSelector", name: "scope", children: null }));
      } else if (node.type === "PseudoClassSelector" && ident.decode(node.name).toLowerCase() === "root") node.name = "scope";
    },
  });
  return `@scope (body[data-lamp-theme]){${generate(ast)}}`;
}
