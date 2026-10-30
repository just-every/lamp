import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const published = new Map();
const wording = new Set();
const ownerInstructions = 'Keep the owner glossary and incident terminology.';
async function settings(request, origin, cookie, input) {
  const response = await request(`${origin}/api/app/page-settings`, {
    method: input ? 'PUT' : 'GET',
    headers: { Cookie: cookie, Origin: origin, ...(input ? { 'Content-Type': 'application/json' } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  assert.equal(response.status, 200, 'The current owner can read and save native page settings');
  return (await response.json()).settings;
}
export async function beforeStep({ request, origin, cookie, phase, step, args }) {
  if (step.id !== 'configure' || phase === 'autonomous') return;
  const { idempotency_key: _key, expected_revision: _revision, ...input } = args;
  await settings(request, origin, cookie, { ...input, aiToneInstructions: ownerInstructions });
  wording.add(`${origin}:${phase}`);
}
export async function afterStep({ request, origin, cookie, phase, step, args, result }) {
  if (step.id === 'configure') assert.equal(Object.hasOwn(result.settings, 'aiToneInstructions'), false, 'The page-identity receipt does not disclose unrelated owner instructions');
  if (step.id === 'configure' && wording.has(`${origin}:${phase}`)) {
    const current = await settings(request, origin, cookie);
    assert.equal(current.aiToneInstructions, ownerInstructions, 'An MCP page identity change preserves owner AI wording instructions');
  }
  if (phase === 'autonomous' && step.id === 'incident-publish') published.set(origin, args);
}

/** Inspect the actual hosted person door after the mandatory native phases. */
export default async function journey({ request, origin, cookie, tool }) {
  const before = await tool('lamp.witness', {});
  const stale = await tool('lamp.incidents.publish', { ...published.get(origin), idempotency_key: randomUUID() });
  assert.equal(stale.result?._meta?.['com.runeditrun/error']?.code, 'revision_conflict', 'A consumed draft cannot be published again under a new key');
  const after = await tool('lamp.witness', {});
  assert.deepEqual(after.result?.structuredContent, before.result?.structuredContent, 'Stale publication preserves all native product records');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.LAMP_CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.LAMP_CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: ['--no-sandbox'],
  });
  const directory = process.env.LAMP_AGENT_PROOF_DIR ?? join(tmpdir(), 'lamp-agent-native-proof');
  await mkdir(directory, { recursive: true });
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const incoming = route.request();
      if (new URL(incoming.url()).origin !== origin) return route.abort();
      const response = await request(incoming.url(), { method: incoming.method(), redirect: 'manual',
        headers: { ...incoming.headers(), Cookie: cookie, Host: new URL(origin).host },
        ...(incoming.postDataBuffer() ? { body: incoming.postDataBuffer() } : {}),
      });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/agents`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Native agent activity fits the desktop viewport');
    assert.ok(await page.locator('main').innerText(), 'Native agent activity is rendered for the signed-in person');
    await page.screenshot({ path: join(directory, 'agents-1440.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(directory, 'agents-390.png'), fullPage: true });
    const response = await request(`${origin}/agents/api/approvals`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const { approvals } = await response.json();
    assert.ok(approvals.length, 'The held journey retains its native approvals');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/agents/approvals/${encodeURIComponent(approvals[0].id)}`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Native approval details fit the desktop viewport');
    await page.screenshot({ path: join(directory, 'approval-1440.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(directory, 'approval-390.png'), fullPage: true });
  } finally {
    await browser.close();
  }
}
