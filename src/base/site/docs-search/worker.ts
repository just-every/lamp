import { search } from './retrieve';
import type { Embed, SearchIndex } from './types';

type Environment = { ASSETS: { fetch(request: Request): Promise<Response> }; AI: { run: Embed } };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/** No app state, credentials or database. Install on the site's Worker only. */
export function createSearchWorker({ corpusHash, endpoint = '/docs/search', minimumScore = 0.55, indexAsset = '/docs-search-vectors.json', model = '@cf/baai/bge-base-en-v1.5', pooling = 'cls' }: { corpusHash: string; endpoint?: string; minimumScore?: number; indexAsset?: string; model?: string; pooling?: string }) {
  let loaded: SearchIndex | undefined;
  async function load(request: Request, env: Environment): Promise<SearchIndex> {
    if (loaded) return loaded;
    const response = await env.ASSETS.fetch(new Request(new URL(indexAsset, request.url)));
    if (!response.ok) throw Error('Search index unavailable');
    const index = await response.json() as SearchIndex;
    if (index.corpusHash !== corpusHash || index.version !== 1 || index.pooling !== pooling || index.model !== model || !index.dimensions || !Array.isArray(index.chunks)) throw Error('Invalid search index');
    loaded = index;
    return index;
  }
  return {
    async fetch(request: Request, env: Environment): Promise<Response> {
      const url = new URL(request.url);
      if (url.hostname.startsWith('www.')) return Response.redirect(`https://${url.hostname.slice(4)}${url.pathname}${url.search}`, 301);
      if (url.pathname !== endpoint) return env.ASSETS.fetch(request);
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      const query = (url.searchParams.get('q') ?? '').trim();
      if (query.length < 2) return json({ results: [] });
      if (query.length > 240) return json({ error: 'Query too long' }, 400);
      try {
        // The generated entry contains the corpus digest, so docs changes also
        // change Worker code. Binding-only isolate reuse cannot retain old vectors.
        const index = await load(request, env);
        const vectors = await env.AI.run(index.model, { text: [`Represent this sentence for searching relevant passages: ${query}`], pooling: index.pooling });
        return json({ results: search(index, vectors.data[0], minimumScore) });
      } catch {
        return json({ error: 'Search unavailable' }, 503);
      }
    },
  };
}
