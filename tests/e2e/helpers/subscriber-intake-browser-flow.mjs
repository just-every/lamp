import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { operatorHydrated } from './operator-hydrated.mjs';
import { subscriberCsvRows } from './subscriber-management-fixture.mjs';

// The native operator document and HTTP intake doors, with the same fixture
// session used by the surrounding migration journey. Mail delivery and consent
// are independently asserted by subscriberCsvFlow and subscriberAddFlow.
export async function subscriberIntakeBrowserFlow({ origin, cookie, api, request }) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 960 } });
      await context.addCookies(cookie.split('; ').filter(Boolean).map(pair => { const split = pair.indexOf('='); return { name: pair.slice(0, split), value: pair.slice(split + 1), url: origin }; }));
      const page = await context.newPage(), components = [];
      const hydrationErrors=[];
      page.on('console',message=>{if(/hydration|did not match|server rendered/i.test(message.text()))hydrationErrors.push(message.text());});
      page.on('pageerror',error=>{if(/hydration|did not match|server rendered/i.test(error.message))hydrationErrors.push(error.message);});
      const label = `synthetic-lamp-${width}`;
      const csvEmail = `${label}-csv@example.test`, addedEmail = `${label}-add@example.test`, webhook = `https://receiver.example.test/${label}`;
      try {
        for (const n of [1, 2, 3]) {
          const result = await api('/api/app/components', { groupId: null, name: `${label}-${n}`, description: '', internal: false, displayOrder: n, note: '' });
          assert.equal(result.status, 201, JSON.stringify(result.body)); components.push(result.body.component);
        }
        await page.goto(`${origin}/app/subscribers`); await operatorHydrated(page);
        const add = page.getByRole('region', { name: 'Add subscriber' });
        const capacity=page.getByRole('region',{name:'Subscriber capacity',exact:true});
        await capacity.getByRole('heading',{name:'Capacity',exact:true}).waitFor();
        assert.equal(await add.getByRole('checkbox',{name:'Component status changes',exact:true}).isChecked(),false);
        await add.getByRole('checkbox',{name:'Only incidents reaching Partially unavailable or worse',exact:true}).check();
        // Sections with aria-label have a region role in the accessibility tree.
        await add.getByLabel('Email address', { exact: true }).fill(addedEmail);
        for (const component of components.slice(0, 2)) await add.getByRole('checkbox', { name: component.name, exact: true }).check();
        const addResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/subscribers' && response.request().method() === 'POST');
        await add.getByRole('button', { name: 'Add subscriber and send confirmation', exact: true }).click();
        const added=await addResponse;assert.equal(added.status(),201);assert.equal((await added.json()).subscriber.preferences.minimumImpact,'Partially unavailable');
        await add.getByRole('status').filter({ hasText: 'One confirmation invitation was sent.' }).waitFor();
        const addedRow = page.getByRole('row').filter({ hasText: addedEmail });
        await addedRow.getByText('2 selected components', { exact: true }).waitFor();
        await addedRow.getByText('Added by Ingress test operator', { exact: true }).waitFor();

        await add.getByLabel('Channel', { exact: true }).selectOption('webhook');
        assert.equal(await add.getByLabel('Webhook body format', { exact: true }).inputValue(), 'lamp');
        assert.equal(await add.getByRole('checkbox',{name:'Component status changes',exact:true}).isChecked(),true);
        await add.getByRole('checkbox',{name:'Incidents',exact:true}).uncheck();
        await add.getByLabel('Endpoint URL', { exact: true }).fill(webhook);
        await add.getByLabel('Contact email', { exact: true }).fill(`${label}-webhook@example.test`);
        await add.getByLabel('Webhook body format', { exact: true }).selectOption('statuspage');
        const hookResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/subscribers' && response.request().method() === 'POST');
        await add.getByRole('button', { name: 'Add subscriber and send confirmation', exact: true }).click();
        const hook = await hookResponse; assert.equal(hook.status(), 201); const hookBody=await hook.json();assert.equal(hookBody.subscriber.webhookFormat,'statuspage');assert.deepEqual(hookBody.subscriber.preferences.eventKinds,['maintenance','components']);
        await page.getByRole('row').filter({ hasText: webhook }).getByText('Statuspage format', { exact: true }).waitFor();

        const section = page.getByRole('region', { name: 'Import and export subscribers' });
        const csv = `email,components,language\r\n${csvEmail},${components[0].id},en\r\ninvalid-email,${components[0].id},en\r\n`;
        await section.getByLabel('CSV contents', { exact: true }).fill(csv);
        const previewResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/subscribers/import/preview'));
        await section.getByRole('button', { name: 'Dry run CSV', exact: true }).click();
        assert.equal((await previewResponse).status(), 200);
        await section.getByText('1 would be created; 0 skipped; 1 refused.', { exact: true }).waitFor();
        assert.equal((await api('/api/app/subscribers?limit=100')).body.subscribers.some(row => row.destination === csvEmail), false, 'the visible dry run writes nothing');
        const applied = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/subscribers/import/apply'));
        await section.getByRole('button', { name: 'Create pending subscriptions', exact: true }).click();
        assert.equal((await applied).status(), 200);
        await section.getByRole('status').filter({ hasText: '1 pending subscriptions created. No invitations have been sent.' }).waitFor();
        await page.getByRole('row').filter({ hasText: csvEmail }).getByText('pending', { exact: true }).waitFor();
        for (const sent of [1, 0]) {
          const invitation = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/send-invitations'));
          await section.getByRole('button', { name: 'Send invitations', exact: true }).click();
          const response = await invitation; assert.equal(response.status(), 200); assert.deepEqual(await response.json(), { sent, remaining: 0 });
        }
        const downloaded = page.waitForEvent('download');
        await section.getByRole('link', { name: 'Export subscribers as CSV', exact: true }).click();
        const download = await downloaded, chunks = [];
        for await (const chunk of await download.createReadStream()) chunks.push(chunk);
        const rows = subscriberCsvRows(Buffer.concat(chunks).toString('utf8'));
        assert.ok(rows.some(row => row.destination === csvEmail && row.state === 'pending'));
        assert.ok(rows.some(row => row.destination === addedEmail && row.components.split(';').length === 2));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `subscriber intake fits ${width}`);
        const axe=await new AxeBuilder({page}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
        assert.deepEqual(axe.violations.filter(row=>['serious','critical'].includes(row.impact)).map(row=>row.id),[],`subscriber intake axe ${width}`);
        assert.deepEqual(hydrationErrors,[],`subscriber intake hydration ${width}`);
        if (process.env.LAMP_BROWSER_EVIDENCE) { await mkdir(process.env.LAMP_BROWSER_EVIDENCE, { recursive: true }); await page.screenshot({ path: join(process.env.LAMP_BROWSER_EVIDENCE, `subscriber-intake-${width}.png`), fullPage: true }); }
      } finally {
        const rows = (await api('/api/app/subscribers?limit=100')).body.subscribers;
        for (const row of rows.filter(row => row.destination.includes(label))) assert.equal((await request(`/api/app/subscribers/${row.id}`, { method: 'DELETE' })).status, 204);
        for (const component of components) assert.equal((await request(`/api/app/components/${component.id}`, { method: 'DELETE' })).status, 204);
        await context.close();
      }
    }
  } finally { await browser.close(); }
}
