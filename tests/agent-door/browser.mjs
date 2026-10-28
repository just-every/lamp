import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { autonomousPolicy, heldPolicy } from '../../src/base/modules/agent-door/conformance/crypto.mjs';

/** Browser uses the compiled native Worker; interception only preserves its two
 * isolated production hostnames in the disposable runtime. */
export async function inspectNativePages(fixture, c, records) {
  const evidence = process.env.LAMP_AGENT_EVIDENCE;
  if (evidence) await mkdir(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.LAMP_CLOUD_BROWSER ? { executablePath: '/usr/bin/chromium' } : {}), args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const split = fixture.person.cookie.indexOf('=');
    await context.addCookies([{ name: fixture.person.cookie.slice(0, split), value: fixture.person.cookie.slice(split + 1), url: fixture.origin, httpOnly: true, secure: true, sameSite: 'Lax' }]);
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (![fixture.origin, 'https://status.rer-hosted-check.invalid'].includes(url.origin)) return route.abort();
      const response = await fixture.request(req.url(), { method: req.method(), headers: req.headers(), ...(!['GET','HEAD'].includes(req.method()) ? { body: req.postDataBuffer() } : {}) });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage();
    const check = async (name, path, expected) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(new URL(path, fixture.origin).href, { waitUntil: 'networkidle' });
      if (expected) await page.getByText(expected, { exact: false }).first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} overflows at 1440`);
      const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(row => ['serious','critical'].includes(row.impact));
      assert.deepEqual(violations.map(row => ({ id: row.id, targets: row.nodes.map(node => node.target) })), [], `${name} axe`);
      if (evidence) {
        await page.screenshot({ path: join(evidence, `${name}-1440.png`), fullPage: true });
        await page.setViewportSize({ width: 390, height: 1000 });
        await page.screenshot({ path: join(evidence, `${name}-390.png`), fullPage: true });
      }
    };
    await check('incident-report', `/app/incidents/${records.id}`, 'Jordan Harbour');
    await check('maintenance', '/app/maintenance', 'API dependency maintenance');
    await check('native-operators', '/app/settings#operators', 'Former operators');
    await check('audit', '/app/settings#audit-log', 'Audit log');
    const openAudit = page.getByRole('button', { name: /Open audit log/i });
    assert.equal(await openAudit.count(), 1);
    {
      await openAudit.click();
      await page.getByText('for Jordan Harbour', { exact: false }).first().waitFor();
      await page.setViewportSize({ width: 1440, height: 1000 });
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.filter(row => ['serious','critical'].includes(row.impact)).map(row => row.id), []);
      if (evidence) for (const width of [1440,390]) { await page.setViewportSize({width,height:1000}); await page.locator('#audit-log').scrollIntoViewIfNeeded(); await page.screenshot({path:join(evidence,`audit-open-${width}.png`)}); }
    }
    await check('agent-docs', '/docs/agents', 'Agents and MCP');
    await c.adopt(heldPolicy());
    const pending = await c.tool('lamp.maintenance.create', { title: 'Reviewed database maintenance', affectedAudience: 'API customers', customerImpact: 'Brief delays are possible.', startsAt: new Date(Date.now()+3600_000).toISOString(), endsAt: new Date(Date.now()+7200_000).toISOString(), componentIds: [records.componentId], autoStart: false, autoComplete: false, idempotency_key: randomUUID() });
    const handle = pending.result?._meta?.['com.runeditrun/approval'];
    assert.ok(handle?.id, 'Real policy approval must be pending');
    await check('agents-pending', '/agents', 'Pending approvals');
    const approvalPath = `/agents/approvals/${handle.id}`;
    await check('approval-pending', approvalPath, 'Reviewed database maintenance');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const approve = page.getByRole('button', {name:'Approve',exact:true});
    const rect = await approve.boundingBox();
    assert.ok(rect.height >= 44 && rect.width >= 44, 'Approval control needs a 44px target');
    await approve.click();
    await page.locator('[data-approval-state]').filter({hasText:'executed'}).waitFor();
    await check('approval-executed', approvalPath, 'Jordan Harbour');
    await check('maintenance-approved', '/app/maintenance', 'Reviewed database maintenance');
    const blocked = autonomousPolicy();
    blocked.rules.push({ id: 'block-public', class: 'external', do: 'blocked' });
    await c.adopt(blocked);
    const refusal = await c.tool('lamp.maintenance.start', {id:records.maintenanceId,idempotency_key:randomUUID()});
    assert.equal(refusal.result?._meta?.['com.runeditrun/error']?.code, 'policy_blocked');
    await check('agents-blocked', '/agents', 'blocked');
    await check('approval-unavailable', '/agents/approvals/no-such-approval', 'Approval unavailable');
    await c.adopt(autonomousPolicy());
    console.log('PASS native browser: incident/report, maintenance, audit, docs, Agents, pending/executed approval, blocked call and unavailable approval; axe and overflow at 1440.');
  } finally { await browser.close(); }
}
