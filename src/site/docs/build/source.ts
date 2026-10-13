import { Marked } from 'marked';
import type { Token, Tokens } from 'marked';
import { createSlugger } from './slug.ts';

// One Markdown file read once: its GitHub-style heading ids (counted over the whole file, so an id on the site is the id on
// GitHub even when only some sections are published), and its tokens cut into the preamble and one block per `##` section.
// A block carries every deeper heading and everything else down to the next `##`.

export const decodeHtml = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const collapse = (value: string) => value.replace(/\s+/g, ' ').trim();

export type Block = { title: string | null; tokens: Token[]; ids: string[] };
export type Source = {
  path: string;
  /** The heading ids by heading token; the renderer reads them so a page shows the file's own ids. */
  ids: WeakMap<Tokens.Heading, string>;
  allIds: Set<string>;
  /** The preamble (title: null) first, then each `##` section in file order. */
  blocks: Block[];
  problems: string[];
};

const children = (token: Token): Token[] => {
  const nested = token as { tokens?: Token[]; items?: Token[] };
  return [...(nested.tokens ?? []), ...(nested.items ?? [])];
};

function walk(tokens: Token[], visit: (token: Token) => void) {
  for (const token of tokens) {
    visit(token);
    walk(children(token), visit);
  }
}

export function readSource(path: string, markdown: string): Source {
  const marked = new Marked({ gfm: true });
  const tokens = marked.lexer(markdown);
  const texts = new WeakMap<Tokens.Heading, string>();
  new Marked({
    gfm: true,
    renderer: {
      heading(token) {
        texts.set(token, collapse(decodeHtml(this.parser.parseInline(token.tokens, this.parser.textRenderer))));
        return '';
      },
    },
  }).parser(tokens);
  const slug = createSlugger();
  const ids = new WeakMap<Tokens.Heading, string>();
  const allIds = new Set<string>();
  walk(tokens, token => {
    if (token.type !== 'heading') return;
    const id = slug(texts.get(token as Tokens.Heading) ?? '');
    ids.set(token as Tokens.Heading, id);
    allIds.add(id);
  });

  const problems: string[] = [];
  const blocks: Block[] = [{ title: null, tokens: [], ids: [] }];
  let sawTitle = false;
  for (const token of tokens) {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading;
      if (heading.depth === 1) {
        if (sawTitle || blocks.length > 1) problems.push(`has a second level-1 heading, "${texts.get(heading)}"; only the file's first line may be one`);
        sawTitle = true;
        continue; // The page's title comes from docs/site.json.
      }
      if (heading.depth === 2) {
        blocks.push({ title: texts.get(heading) ?? '', tokens: [], ids: [] });
      }
    }
    const block = blocks[blocks.length - 1];
    block.tokens.push(token);
    walk([token], inner => { if (inner.type === 'heading') block.ids.push(ids.get(inner as Tokens.Heading)!); });
  }
  return { path, ids, allIds, blocks, problems };
}
