import assert from 'node:assert/strict';
import { eventually } from './status-journey.mjs';

function publicPath(key) {
  if (key === 'page.html') return '/';
  if (key === 'history.html') return '/history';
  if (key === 'status.json') return '/api/public/status';
  if (key === 'not-found.html') return '/incidents/INC-999999';
  if (key.startsWith('aliases/')) return decodeURIComponent(key.slice('aliases/'.length, -'.json'.length));
  const page = /^api\/public\/v1\/(components|incidents|maintenance)\/([^/]+)\.json$/.exec(key);
  if (page) return `/api/public/v1/${page[1]}?cursor=${page[2]}`;
  return `/${key.replace(/\.html$/, '')}`;
}

// Discover the complete retained generation, then read its ordinary public
// URLs. This includes newly retained surfaces without a handpicked allowlist.
export async function recoveryPublicSurfaces(j) {
  await eventually(
    () => j.db.prepare("SELECT requested_revision, completed_revision FROM public_snapshot_work WHERE id = 'default'").first(),
    row => row && row.requested_revision === row.completed_revision,
    'all publication work settles before recording public bytes',
  );
  const bucket = await j.runtime.getR2Bucket('SNAPSHOTS');
  const current = await bucket.get('snapshots/current.json');
  assert.ok(current, 'a published generation exists');
  const pointer = await current.json();
  assert.ok(Number.isInteger(pointer.generation) && pointer.generation > 0);
  const prefix = `snapshots/${pointer.version}/`;
  const retained = await bucket.get(`${prefix}retained.json`);
  assert.ok(retained, 'the generation has its complete retained inventory');
  const bundle = await retained.json();
  assert.equal(bundle.version, pointer.version);
  assert.equal(bundle.generation, pointer.generation);
  assert.equal(bundle.generatedAt, pointer.generatedAt);
  const artifacts = [...bundle.artifacts].sort((a, b) => a.key.localeCompare(b.key));
  const storedKeys = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    storedKeys.push(...page.objects.map(object => object.key.slice(prefix.length)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  assert.deepEqual(storedKeys.filter(key => key !== 'retained.json').sort(), artifacts.map(item => item.key).sort(), 'the retained inventory accounts for every stored public artifact');

  const responses = [];
  for (const artifact of artifacts) {
    const path = publicPath(artifact.key);
    const response = await j.publicResponse(path);
    const status = artifact.key === 'not-found.html' ? 404 : artifact.contentType === 'application/vnd.lamp.redirect+json' ? 301 : 200;
    assert.equal(response.status, status, path);
    assert.equal(response.headers.get('x-lamp-snapshot-generated-at'), pointer.generatedAt, path);
    assert.equal(response.headers.get('x-lamp-snapshot-version'), status === 404 ? null : pointer.version, path);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (status !== 301) assert.ok(bytes.length > 0, `${path} contains public content`);
    responses.push({ key: artifact.key, path, status, bytes, headers: Object.fromEntries(
      ['content-type', 'etag', 'location', 'x-lamp-snapshot-generated-at', 'x-lamp-snapshot-version'].map(name => [name, response.headers.get(name)]),
    ) });
  }
  return { pointer, artifacts, responses };
}

export function assertRecoveryPublicSurfacesUnchanged(before, after) {
  assert.deepEqual(after.pointer, before.pointer, 'recovery retains the complete selected generation');
  assert.deepEqual(after.artifacts, before.artifacts, 'recovery retains every artifact and its complete stored content');
  assert.deepEqual(after.responses.map(({ bytes, ...metadata }) => metadata), before.responses.map(({ bytes, ...metadata }) => metadata), 'every public URL retains its generation and response metadata');
  for (const [index, response] of after.responses.entries()) {
    assert.ok(response.bytes.equals(before.responses[index].bytes), `recovery leaves ${response.path} response bytes unchanged`);
  }
}
