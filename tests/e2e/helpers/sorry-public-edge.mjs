import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The command still selects an HTTPS Sorry origin and its fixed API paths.
// Only its outbound network boundary returns synthetic, committed responses.
const origin = 'https://status.example.test';
const responses = new Map([
  ['/api/v1/status', 'sorry-status.json'],
  ['/api/v1/components', 'sorry-components.json'],
  ['/api/v1/notices', 'sorry-notices.json'],
  ['/api/v1/notices/100', 'sorry-notice-100.json'],
  ['/api/v1/notices/101', 'sorry-notice-101.json'],
]);
const seen = new Set();
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.origin, origin, 'capture stays on its selected Sorry origin');
  assert.equal(init?.method, 'GET', 'public capture only reads');
  assert.equal(init?.redirect, 'manual', 'public capture refuses redirects');
  assert.equal(new Headers(init?.headers).has('Authorization'), false, 'public capture sends no key');
  const file = responses.get(url.pathname + url.search);
  assert.ok(file, 'capture uses only documented public API paths');
  assert.equal(seen.has(file), false, 'synthetic capture requests each response once');
  seen.add(file);
  const text = await readFile(new URL(`../../fixtures/sorry/public/${file}`, import.meta.url), 'utf8');
  return new Response(text, { headers: { 'Content-Type': 'application/json' } });
};
