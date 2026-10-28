import * as css from "css-tree/dist/csstree.esm";
import { ThemeValidationError } from "../../shared/page-theme";

const scope = "body.lamp-public";
const safeAtRules = new Set([
  "media", "supports", "container", "layer", "scope", "starting-style",
  "keyframes", "-webkit-keyframes", "font-face", "property",
  "font-feature-values", "font-palette-values",
  "annotation", "ornaments", "stylistic", "styleset", "character-variant", "swash",
]);
const keyframes = (name: string) => /^(?:-webkit-)?keyframes$/.test(name);
const decoded = (name: string) => css.ident.decode(name).toLowerCase();

function validateResource(value: string, origin: string) {
  try {
    // URL and String AST values have already been unescaped by css-tree.
    const url = new URL(value, origin);
    if (url.origin === new URL(origin).origin && !url.username && !url.password && /^(https?:)$/.test(url.protocol)) return;
  } catch { /* Report the same named rule for malformed and external URLs. */ }
  throw new ThemeValidationError("CSS url()", "Resources must use the page's own origin.");
}

function parseCss(source: string, origin: string): css.CssNode {
  if (source.length > 16_000) throw new ThemeValidationError("CSS length", "Custom CSS must be at most 16000 characters.");
  let ast: css.CssNode;
  try {
    ast = css.parse(source, {
      parseCustomProperty: true,
      onParseError(error) { throw error; },
    });
  } catch (error) {
    throw new ThemeValidationError("CSS syntax", error instanceof Error ? error.message : "Invalid stylesheet.");
  }

  css.walk(ast, node => {
    if (node.type === "Atrule") {
      const name = decoded(node.name);
      if (name === "import") throw new ThemeValidationError("CSS @import", "Imports are not allowed.");
      if (!safeAtRules.has(name)) throw new ThemeValidationError(`CSS @${name}`, "This at-rule is not allowed in page CSS.");
      // Decode before generation as escaped names can prevent parser recognition.
      node.name = name;
    }
    if (node.type === "Declaration" && /(?:^|[-*_])behavior$/.test(decoded(node.property))) {
      throw new ThemeValidationError("CSS behavior", "Behavior declarations are not allowed.");
    }
    if (node.type === "Function") {
      const name = decoded(node.name);
      if (name === "expression") throw new ThemeValidationError("CSS expression()", "Expressions are not allowed.");
      if (name === "url") {
        // Escaped url() may be parsed as a generic function rather than a URL.
        const argument = node.children.toArray();
        validateResource(argument.length === 1 && argument[0].type === "String"
          ? argument[0].value
          : css.ident.decode(css.generate({ type: "Value", children: node.children }).trim()), origin);
      }
      if (["image-set", "-webkit-image-set", "image", "src"].includes(name)) {
        node.children.forEach(child => {
          if (child.type === "String") validateResource(child.value, origin);
        });
      }
    }
    if (node.type === "Url") validateResource(node.value, origin);
    if (node.type === "Raw") {
      // Raw nodes deliberately left by the parser (for example :lang()) are
      // tokenized as values too, so they cannot conceal resource functions.
      let value: css.CssNode;
      try {
        value = css.parse(node.value, { context: "value", parseCustomProperty: true, onParseError(error) { throw error; } });
      } catch {
        throw new ThemeValidationError("CSS syntax", "An unparsed CSS fragment cannot be safely validated.");
      }
      css.walk(value, child => {
        if (child.type === "Url") validateResource(child.value, origin);
        if (child.type === "Function" && decoded(child.name) === "expression") {
          throw new ThemeValidationError("CSS expression()", "Expressions are not allowed.");
        }
        if (child.type === "Raw") throw new ThemeValidationError("CSS syntax", "An unparsed CSS fragment cannot be safely validated.");
      });
    }
  });
  // image-set() also accepts bare strings. Follow custom-property substitutions
  // in that position, including fallbacks, so var() cannot conceal a remote URL.
  const variables = new Map<string, css.CssNode[]>();
  const addVariable = (name: string, value: css.CssNode) => variables.set(name, [...(variables.get(name) ?? []), value]);
  css.walk(ast, node => {
    if (node.type === "Declaration" && node.property.startsWith("--")) addVariable(css.ident.decode(node.property), node.value);
    if (node.type !== "Atrule" || decoded(node.name) !== "property" || node.prelude?.type !== "AtrulePrelude") return;
    const name = node.prelude.children.first;
    if (name?.type !== "Identifier") return;
    node.block?.children.forEach(child => {
      if (child.type === "Declaration" && decoded(child.property) === "initial-value") addVariable(css.ident.decode(name.name), child.value);
    });
  });
  function checkImageStrings(node: css.CssNode, resourcePosition = false, seen = new Set<string>()) {
    if (node.type === "String" && resourcePosition) validateResource(node.value, origin);
    if (node.type === "Function" && decoded(node.name) === "var") {
      const variable = node.children.first;
      if (variable?.type === "Identifier") {
        const name = css.ident.decode(variable.name);
        if (resourcePosition && !seen.has(name)) {
          seen.add(name);
          for (const value of variables.get(name) ?? []) checkImageStrings(value, resourcePosition, seen);
        }
      }
      node.children.forEach(child => checkImageStrings(child, resourcePosition, seen));
      return;
    }
    if (!("children" in node) || !node.children) return;
    const childrenAreResources = node.type === "Function"
      ? ["image-set", "-webkit-image-set", "image", "src"].includes(decoded(node.name))
      : resourcePosition;
    node.children.forEach(child => checkImageStrings(child, childrenAreResources, seen));
  }
  // A normal AST walk enters declaration values and at-rule blocks as well.
  css.walk(ast, node => {
    if (node.type === "Function" && ["image-set", "-webkit-image-set", "image", "src"].includes(decoded(node.name))) {
      checkImageStrings(node);
    }
  });
  return ast;
}

function isRoot(node: css.CssNode) {
  return (node.type === "TypeSelector" && ["html", "body"].includes(decoded(node.name))) ||
    (node.type === "PseudoClassSelector" && decoded(node.name) === "root");
}

function scopeSelector(selector: css.Selector, nested: boolean): css.CssNode {
  const parts = selector.children.toArray();
  // A root sibling selector must never escape the page. Place the boundary on
  // the final target compound, before its pseudo-element (if any). Constraining
  // the target preserves ancestor conditions and selectors that match the body
  // itself, unlike adding an unconditional descendant prefix.
  let lastCombinator = -1;
  parts.forEach((part, index) => { if (part.type === "Combinator") lastCombinator = index; });
  if (!nested) {
    const rootIndex = parts.findIndex((part, index) => index > lastCombinator && isRoot(part));
    if (rootIndex !== -1) {
      const root = (css.parse(scope, { context: "selector" }) as css.Selector).children.toArray();
      parts.splice(rootIndex, 1, ...root);
    }
  }
  const pseudo = parts.findIndex((part, index) => index > lastCombinator && part.type === "PseudoElementSelector");
  const boundary = (css.parse(`:where(${scope},${scope} *)`, { context: "selector" }) as css.Selector).children.toArray();
  parts.splice(pseudo === -1 ? parts.length : pseudo, 0, ...boundary);
  return css.parse(parts.map(part => css.generate(part)).join(""), { context: "selector" });
}

/** Validate input on save without storing the generated, scoped stylesheet. */
export function validateThemeCss(source: string, origin: string): void {
  scopedThemeCss(source, origin);
}

/** Generate the snapshot-only stylesheet from the original editor input. */
export function scopedThemeCss(source: string, origin: string): string {
  const ast = parseCss(source, origin);
  function scopeRules(parent: css.CssNode, nested = false, inKeyframes = false) {
    if (!("children" in parent) || !parent.children) return;
    parent.children.forEach(node => {
      if (node.type === "Atrule" && node.block) {
        scopeRules(node.block, nested, keyframes(decoded(node.name)) || inKeyframes);
      } else if (node.type === "Rule" && !inKeyframes) {
        if (node.prelude.type !== "SelectorList") throw new ThemeValidationError("CSS selector", "A selector could not be scoped safely.");
        node.prelude.children = node.prelude.children.map(selector => {
          if (selector.type !== "Selector") throw new ThemeValidationError("CSS selector", "A selector could not be scoped safely.");
          return scopeSelector(selector, nested);
        });
        scopeRules(node.block, true);
      }
    });
  }
  scopeRules(ast);
  return css.generate(ast);
}
