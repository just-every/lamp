import { Marked } from 'marked';
import type { Token, Tokens } from 'marked';
import type { DocsTocEntry } from '../types.ts';
import type { LinkResult } from './links.ts';
import { inlineCode } from './inline-code.ts';
import { decodeHtml } from './source.ts';

// One page's tokens to static HTML, at build time. Raw HTML in the Markdown is shown as text, never passed through. The
// page's h2s and h3s become its contents list. Inline code is kept whole by inline-code.ts. Code blocks become a card labelled with their language. Tables scroll inside
// a focusable region when they cannot fit. Links are resolved by the caller (links.ts); images are not published.

export type RenderedPage = { html: string; toc: DocsTocEntry[]; problems: string[] };

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const collapse = (value: string) => value.replace(/\s+/g, ' ').trim();

const languageNames: Record<string, string> = {
  sh: 'Shell', bash: 'Shell', shell: 'Shell', zsh: 'Shell', console: 'Shell', json: 'JSON', jsonc: 'JSON', js: 'JavaScript', mjs: 'JavaScript',
  javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', yaml: 'YAML', yml: 'YAML', toml: 'TOML', ini: 'INI',
  http: 'HTTP', sql: 'SQL', diff: 'Diff', text: 'Text', txt: 'Text', html: 'HTML', css: 'CSS',
};

export function renderPage(tokens: Token[], ids: WeakMap<Tokens.Heading, string>, resolve: (href: string) => LinkResult): RenderedPage {
  const toc: DocsTocEntry[] = [];
  const problems: string[] = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading(token) {
        const id = ids.get(token)!;
        const text = collapse(decodeHtml(this.parser.parseInline(token.tokens, this.parser.textRenderer)));
        if (token.depth === 2 || token.depth === 3) toc.push({ depth: token.depth, id, text });
        return `<h${token.depth} id="${id}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
      },
      code({ text, lang }) {
        const language = (lang ?? '').trim().split(/\s+/)[0].toLowerCase();
        const name = language ? (languageNames[language] ?? language.toUpperCase()) : 'Text';
        const head = `<div class="docs-code-head"><span class="docs-code-lang">${escapeHtml(name)}</span><button type="button" class="docs-copy" hidden>Copy</button></div>`;
        const className = language ? ` class="language-${escapeHtml(language)}"` : '';
        return `<div class="docs-code">${head}<pre><code${className}>${escapeHtml(text.replace(/\n$/, ''))}</code></pre></div>\n`;
      },
      codespan({ text }) {
        return inlineCode(text);
      },
      html({ text }) {
        return escapeHtml(text);
      },
      link({ href, title, tokens: inline }) {
        const resolved = resolve(href);
        if ('problem' in resolved) {
          problems.push(`links to ${resolved.problem}`);
          return this.parser.parseInline(inline);
        }
        const titled = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${escapeHtml(resolved.href)}"${titled}>${this.parser.parseInline(inline)}</a>`;
      },
      image({ href }) {
        problems.push(`has an image (${href}); the docs publish text only`);
        return '';
      },
    },
  });
  const html = marked.parser(Object.assign([...tokens], { links: {} }))
    .replace(/<table>/g, '<div class="docs-table" role="region" tabindex="0" aria-label="Table"><table>')
    .replace(/<\/table>/g, '</table></div>');
  return { html, toc, problems };
}
