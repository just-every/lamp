import { posix } from 'node:path';
import type { DocsRepository } from '../types.ts';

// Link rules for Markdown that is written for GitHub and shown on the site. A relative link to a published file, or to a
// heading of one, becomes that page on the site; a link to any other file, directory or unpublished section of the
// repository goes to GitHub; an external link stays. Anything else is a problem the build reports.

export type PathKind = 'file' | 'directory' | null;

export type LinkContext = {
  /** The repository path of the Markdown file being rendered, and the slug of the page it is rendered into. */
  source: string;
  page: string;
  repository: DocsRepository;
  kind: (path: string) => PathKind;
  /** The first page drawn from a Markdown file, or undefined when the file is not published. */
  firstPage: (path: string) => string | undefined;
  /** The page that shows a heading of a Markdown file; null when the heading stays on GitHub; undefined when the file has no such heading. */
  pageOfHeading: (path: string, id: string) => string | null | undefined;
};

export type LinkResult = { href: string } | { problem: string };

const decode = (value: string) => {
  try { return decodeURIComponent(value); } catch { return null; }
};

/** Resolves a relative link against the Markdown file's directory; null when it leaves the repository. */
function resolvePath(source: string, path: string) {
  const resolved = posix.normalize(posix.join(posix.dirname(source), path)).replace(/\/$/, '');
  return resolved === '..' || resolved.startsWith('../') || resolved === '.' ? null : resolved;
}

export function resolveLink(href: string, context: LinkContext): LinkResult {
  if (/^(https?:|mailto:)/i.test(href)) return { href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return { problem: `${href} (unsupported link scheme)` };
  const hashAt = href.indexOf('#');
  const rawPath = hashAt === -1 ? href : href.slice(0, hashAt);
  const rawHash = hashAt === -1 ? '' : href.slice(hashAt + 1);
  const id = decode(rawHash);
  if (id === null || (hashAt !== -1 && !id)) return { problem: `${href} (malformed anchor)` };
  let path = context.source;
  if (rawPath) {
    if (rawPath.startsWith('/') || rawPath.includes('?')) return { problem: `${href} (use a path relative to ${context.source})` };
    const decoded = decode(rawPath);
    const resolved = decoded === null ? null : resolvePath(context.source, decoded);
    if (resolved === null) return { problem: `${href} (outside the repository)` };
    path = resolved;
  }
  const kind = context.kind(path);
  if (!kind) return { problem: `${href} (${path} does not exist)` };
  const { url, branch } = context.repository;
  const github = `${url}/${kind === 'directory' ? 'tree' : 'blob'}/${branch}/${path}${rawHash ? `#${rawHash}` : ''}`;
  if (id) {
    if (!path.endsWith('.md')) return { problem: `${href} (an anchor can only point into a Markdown file)` };
    const page = context.pageOfHeading(path, id);
    if (page === undefined) return { problem: `${href} (no heading #${id} in ${path})` };
    if (page === null) return { href: github };
    return { href: page === context.page ? `#${rawHash}` : `/docs/${page}#${rawHash}` };
  }
  const page = context.firstPage(path);
  return { href: page ? `/docs/${page}` : github };
}
