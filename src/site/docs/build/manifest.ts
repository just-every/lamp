import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DocsPageMeta } from '../types.ts';

// docs/site.json lists the published pages in display order, grouped in sections. A page names its slug, title and a
// one-sentence summary, and the repository Markdown file it is drawn from. A file shared by several pages (README.md,
// OPERATIONS.md) says which of its `##` sections each page shows; every other `##` section of such a file must be listed
// in `githubOnly` with the reason it stays on GitHub, so a new section never reaches the site by accident. Every
// problem is listed at once.

export const manifestPath = 'docs/site.json';
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export type ManifestPage = DocsPageMeta & { include?: string[] };
export type ManifestSection = { title: string; pages: ManifestPage[] };
export type GithubOnly = { source: string; section: string; reason: string };
export type Manifest = { sections: ManifestSection[]; githubOnly: GithubOnly[] };

export function readManifest(root: string): Manifest {
  const raw = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
  const problems: string[] = [];
  const slugs = new Set<string>();
  const sections: ManifestSection[] = (Array.isArray(raw?.sections) ? raw.sections : []).map((section: Record<string, unknown>, s: number) => {
    const title = text(section.title);
    if (!title) problems.push(`section ${s + 1} has no title`);
    const entries: Record<string, unknown>[] = Array.isArray(section.pages) ? section.pages : [];
    if (!entries.length) problems.push(`section "${title}" has no pages`);
    return {
      title,
      pages: entries.map((page, p) => {
        const where = `page ${p + 1} of "${title}"`;
        const slug = text(page.slug), pageTitle = text(page.title), source = text(page.source), summary = text(page.summary);
        if (!slugPattern.test(slug)) problems.push(`${where}: slug "${slug}" must be lowercase words joined by hyphens`);
        if (slugs.has(slug)) problems.push(`${where}: slug "${slug}" is used twice`);
        slugs.add(slug);
        if (!pageTitle) problems.push(`${where}: no title`);
        if (!summary) problems.push(`${where}: no summary`);
        if (!source.endsWith('.md') || source.startsWith('/') || source.split('/').includes('..')) problems.push(`${where}: source "${source}" must be a Markdown file path inside the repository`);
        else if (!existsSync(join(root, source)) || !statSync(join(root, source)).isFile()) problems.push(`${where}: ${source} does not exist`);
        const include = page.sections === undefined ? undefined : (Array.isArray(page.sections) ? page.sections.map(text).filter(Boolean) : []);
        if (include && !include.length) problems.push(`${where}: "sections" must list at least one section heading`);
        return { slug, title: pageTitle, summary, source, section: title, ...(include ? { include } : {}) };
      }),
    };
  });
  if (!sections.length) problems.push('no sections');
  const githubOnly: GithubOnly[] = (Array.isArray(raw?.githubOnly) ? raw.githubOnly : []).map((entry: Record<string, unknown>, index: number) => {
    const item = { source: text(entry.source), section: text(entry.section), reason: text(entry.reason) };
    if (!item.source || !item.section || !item.reason) problems.push(`githubOnly entry ${index + 1} needs a source, a section and a reason`);
    return item;
  });
  if (problems.length) throw new Error(`${manifestPath} is invalid:\n- ${problems.join('\n- ')}`);
  return { sections, githubOnly };
}
