import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DocsBody, DocsRepository, DocsSection } from '../types.ts';
import { resolveLink } from './links.ts';
import type { PathKind } from './links.ts';
import { manifestPath, readManifest } from './manifest.ts';
import type { ManifestPage } from './manifest.ts';
import { renderPage } from './render.ts';
import { readSource } from './source.ts';
import type { Source } from './source.ts';
import { runRecipe } from './run-recipe.ts';

// The whole docs site from the tree as it is: every page in docs/site.json cut from the repository's own Markdown, every
// section accounted for (shown on a page or named in githubOnly), every link and anchor checked, and nothing that names
// the build machine. Any problem fails the build with the full list. The Vite plugin and the tests share this.

export type DocsSite = { repository: DocsRepository; sections: DocsSection[]; bodies: Record<string, DocsBody>; files: string[] };

/** The public repository's web address and the branch the site's links name, from package.json. */
export function readRepository(root: string): DocsRepository {
  const { repository } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof repository?.url !== 'string' || !repository.url) throw new Error('package.json names no repository, so the docs have nowhere to link the files they do not publish.');
  // package.json names the clone URL (…/run-lamp.git); the pages link to the repository's web address.
  return { url: repository.url.replace(/\.git$/, ''), branch: 'main' };
}

const pathKind = (root: string) => (path: string): PathKind => {
  const full = join(root, path);
  if (!existsSync(full)) return null;
  return statSync(full).isDirectory() ? 'directory' : 'file';
};

export function buildDocs(root: string): DocsSite {
  const manifest = readManifest(root);
  const repository = readRepository(root);
  const pages: ManifestPage[] = manifest.sections.flatMap(section => section.pages);
  const kind = pathKind(root);
  const files = [join(root, manifestPath), join(root, 'package.json')];
  const problems: string[] = [];

  const sources = new Map<string, Source>();
  const load = (path: string) => {
    let source = sources.get(path);
    if (!source) {
      files.push(join(root, path));
      const markdown = readFileSync(join(root, path), 'utf8');
      source = readSource(path, path === 'docs/getting-started.md' ? runRecipe(markdown) : markdown);
      source.problems.forEach(problem => problems.push(`${path}: ${problem}`));
      sources.set(path, source);
    }
    return source;
  };

  // Which page shows which block of each published file. owners: heading id -> slug of the page that shows it, null on GitHub only.
  const published = new Map<string, ManifestPage[]>();
  for (const page of pages) published.set(page.source, [...(published.get(page.source) ?? []), page]);
  const owners = new Map<string, Map<string, string | null>>();
  const pageBlocks = new Map<string, Source['blocks']>(pages.map(page => [page.slug, []]));
  for (const [path, own] of published) {
    const source = load(path);
    const titles = source.blocks.slice(1).map(block => block.title!);
    const shown = new Map<string, string>();
    const hidden = new Set(manifest.githubOnly.filter(entry => entry.source === path).map(entry => entry.section));
    const whole = own.filter(page => !page.include);
    if (whole.length && own.length > 1) problems.push(`${manifestPath}: ${path} feeds ${own.map(page => page.slug).join(', ')}; a page without "sections" takes the whole file, so it must be the file's only page`);
    if (whole.length && hidden.size) problems.push(`${manifestPath}: ${path} is published whole, so githubOnly cannot name its sections`);
    for (const page of own) for (const title of page.include ?? []) {
      if (!titles.includes(title)) problems.push(`${manifestPath}: page "${page.slug}" lists section "${title}", which ${path} has no ## heading for`);
      else if (shown.has(title)) problems.push(`${manifestPath}: section "${title}" of ${path} is on both "${shown.get(title)}" and "${page.slug}"`);
      else if (hidden.has(title)) problems.push(`${manifestPath}: section "${title}" of ${path} is both on page "${page.slug}" and in githubOnly`);
      else shown.set(title, page.slug);
    }
    for (const title of hidden) if (!titles.includes(title)) problems.push(`${manifestPath}: githubOnly names section "${title}", which ${path} has no ## heading for`);
    if (!whole.length) for (const title of titles) {
      if (!shown.has(title) && !hidden.has(title)) problems.push(`${path}: section "${title}" is neither on a page nor in githubOnly in ${manifestPath}`);
    }
    if (!whole.length && new Set(titles).size !== titles.length) problems.push(`${path}: two ## sections share a heading, so docs/site.json cannot tell them apart`);
    const ids = new Map<string, string | null>();
    const first = own[0].slug;
    for (const block of source.blocks) {
      const slug = block.title === null ? first : (whole[0]?.slug ?? shown.get(block.title) ?? null);
      for (const id of block.ids) ids.set(id, slug);
      if (slug) pageBlocks.get(slug)!.push(block);
    }
    // The file's own title heading is the top of its first page.
    for (const id of source.allIds) if (!ids.has(id)) ids.set(id, first);
    owners.set(path, ids);
  }

  const outputs = pages.map(page => {
    const source = load(page.source);
    const tokens = pageBlocks.get(page.slug)!.flatMap(block => block.tokens);
    if (!tokens.length) problems.push(`${manifestPath}: page "${page.slug}" has no content`);
    const context = (href: string) => resolveLink(href, {
      source: page.source,
      page: page.slug,
      repository,
      kind,
      firstPage: path => published.get(path)?.[0].slug,
      pageOfHeading: (path, id) => {
        const known = owners.get(path);
        if (known) return known.has(id) ? known.get(id)! : undefined;
        if (!path.endsWith('.md')) return undefined;
        return load(path).allIds.has(id) ? null : undefined;
      },
    });
    const rendered = renderPage(tokens, source.ids, context);
    rendered.problems.forEach(problem => problems.push(`${page.source} (page "${page.slug}"): ${problem}`));
    for (const place of [root, homedir()].filter(value => value.length > 1)) {
      if (rendered.html.includes(place)) problems.push(`${page.source} (page "${page.slug}"): contains ${place}, a build machine path`);
    }
    return [page.slug, { html: rendered.html, toc: rendered.toc }] as const;
  });
  if (problems.length) throw new Error(`Docs: ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);

  const sections: DocsSection[] = manifest.sections.map(section => ({
    title: section.title,
    pages: section.pages.map(({ slug, title, summary, source, listed }) => ({ slug, title, summary, source, listed, section: section.title })),
  }));
  return { repository, sections, bodies: Object.fromEntries(outputs), files: [...new Set(files)] };
}
