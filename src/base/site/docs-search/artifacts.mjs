import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildSearchIndex } from './index-build.mjs';

// The seed owns its build toolchain; rer remains dependency-free for offline launch.
const { build } = createRequire(resolve('package.json'))('esbuild');

/** Explicit credentialed build step. A failure stops publication; no lexical fallback. */
export async function buildSearchArtifacts({ corpus, assets, output, previousUrl, endpoint = '/docs/search', localName = 'docs-search-local', compatibilityDate = '2026-09-08' }, { embed, accountId } = {}) {
  const pages = JSON.parse(await readFile(corpus, 'utf8'));
  await mkdir(output, { recursive: true });
  const indexPath = resolve(output, 'index.json');
  const previous = [];
  try { previous.push(JSON.parse(await readFile(indexPath, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previousUrl) {
    const response = await fetch(previousUrl, { signal: AbortSignal.timeout(15000) });
    if (response.status !== 404) {
      if (!response.ok) throw Error(`Previous search artifact unavailable (${response.status}); build stopped.`);
      previous.push(await response.json());
    }
  }
  const remoteEmbed = async (model, input) => {
    if (!process.env.CLOUDFLARE_API_TOKEN || !accountId) throw Error('Search indexing requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI Read).');
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw Error(`Workers AI embedding failed (${response.status}); build stopped.`);
    const body = await response.json();
    if (!body.success) throw Error('Workers AI refused embeddings; build stopped.');
    return body.result;
  };
  const { index, counts } = await buildSearchIndex(pages, { previous, embed: embed ?? remoteEmbed,
    onBatch: ({ embedded, total }) => console.log(`Docs search embeddings: ${embedded}/${total}`) });
  const bytes = JSON.stringify(index);
  await writeFile(`${indexPath}.new`, bytes);
  await rename(`${indexPath}.new`, indexPath);
  // Published with the same assets as the pages; the next clean deployment
  // reuses these vectors by content hash, never a crawler or an update timer.
  await writeFile(resolve(assets, 'docs-search-vectors.json'), bytes);
  const runtime = fileURLToPath(new URL('./worker.ts', import.meta.url));
  await build({ stdin: { contents: `import {createSearchWorker} from ${JSON.stringify(runtime)};export default createSearchWorker(${JSON.stringify({ endpoint, corpusHash: index.corpusHash })});`,
    resolveDir: resolve(output), sourcefile: 'site-search-entry.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: resolve(output, 'worker.mjs') });
  const configuration = { name: localName, main: './worker.mjs', compatibility_date: compatibilityDate,
    ...(accountId ? { account_id: accountId } : {}), workers_dev: false,
    assets: { directory: relative(resolve(output), resolve(assets)), binding: 'ASSETS', run_worker_first: true, html_handling: 'auto-trailing-slash', not_found_handling: '404-page' },
    ai: { binding: 'AI', remote: true } };
  await writeFile(resolve(output, 'wrangler.json'), `${JSON.stringify(configuration, null, 2)}\n`);
  console.log(`Docs search: total=${counts.total} reused=${counts.reused} embedded=${counts.embedded} bytes=${Buffer.byteLength(bytes)}`);
  return { index, counts };
}
