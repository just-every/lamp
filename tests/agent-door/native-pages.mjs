import assert from 'node:assert/strict';
import { withNativePageBrowser } from './native-page-browser.mjs';

/** Capture records at their real lifecycle point, before later deletion/expiry. */
export async function inspectNativePages(input) {
  const { request, origin, cookie, area, incidentId } = input;
  const person = async (path, method = 'GET', body) => {
    const response = await request(new URL(path, origin).href, { method,
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, `Native page fixture ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  let pending, executed;
  if (area === 'approval') {
    const { approvals } = await person('/agents/api/approvals');
    pending = approvals.find(item => item.state === 'pending');
    executed = approvals.find(item => item.state === 'executed');
    assert.ok(pending && executed, 'The real held-policy journey supplies pending and executed approvals');
  }
  if (area === 'incident') {
    const { incident } = await person(`/api/app/incidents/${incidentId}`);
    assert.equal(incident.lifecycle, 'Resolved');
    assert.ok(incident.updates.length, 'The native published incident still exists at report publication');
  }
  await withNativePageBrowser(input, async ({ page, capture, view }) => {
    for (const width of [1440, 390]) {
      if (area === 'incident') await view('incident-report', `/app/incidents/${incidentId}`, width);
      if (area === 'maintenance') await view('maintenance-attribution', '/app/maintenance', width);
      if (area === 'delivery') {
        await view('delivery-attribution', '/app/deliveries', width);
        await view('audit-attribution', '/app/settings#data', width);
        await page.getByRole('button', { name: 'Open audit log', exact: true }).click();
        await page.locator('#audit-log table').waitFor();
        await capture('audit-records', width);
      }
      if (area === 'approval') {
        await view('agents-pending', '/agents', width);
        await view('approval-pending', `/agents/approvals/${pending.id}`, width);
        const evidence = page.locator('form:has(button[data-approval-action="approve"]) input[name="revision"]');
        assert.equal(await evidence.count(), 1);
        await evidence.evaluate(input => { input.value = '-1'; });
        await page.getByRole('button', { name: 'Approve', exact: true }).click();
        await page.locator('#action-status').filter({ hasText: /changed|Unable to save/ }).waitFor();
        await capture('approval-error', width);
        await view('approval-executed', `/agents/approvals/${executed.id}`, width);
        await view('agent-guide', '/docs/agents', width);
        await view('native-proof-guide', '/docs/agent-native-proof', width);
      }
    }
    if (area === 'approval') {
      await person('/agents/api/pause', 'POST', { paused: true });
      try { for (const width of [1440, 390]) await view('agents-blocked', '/agents', width); }
      finally { await person('/agents/api/pause', 'POST', { paused: false }); }
    }
  });
}
