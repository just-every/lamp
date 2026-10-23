import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Recorded Teams Workflows edge response: the enclosing fixture accepts each
// Adaptive Card with an empty HTTP 202. No live Microsoft call is made.
export const subscriberTeamsUrl = 'https://synthetic-lamp.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/synthetic-lamp-1/triggers/manual/paths/invoke?sig=synthetic-lamp-1';
const path = new URL(subscriberTeamsUrl).pathname;

async function proveScreen(page, name, errors) {
  const evidence = process.env.LAMP_BROWSER_EVIDENCE ?? 'test-results/teams-subscriptions';
  await mkdir(evidence, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Teams ${name} fits ${width}`);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(axe.violations.filter(violation => ['serious', 'critical'].includes(violation.impact)), [], `Teams ${name} accessible at ${width}`);
    assert.deepEqual(errors.filter(error => /hydrat|mismatch/i.test(error)), [], `Teams ${name} has no hydration error at ${width}`);
    await page.screenshot({ path: join(evidence, `teams-${name}-${width}.png`), fullPage: true });
  }
}

export async function prepareTeamsSubscription({ componentId, publicOrigin, received, sql }) {
  const refused = await fetch(`${publicOrigin}/subscribe/teams`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', 'CF-Connecting-IP': '192.0.2.15' },
    body: new URLSearchParams({ url: 'https://help.example.com/teams-webhook', componentId }),
  });
  assert.equal(refused.status, 400, 'a non-Microsoft webhook host is refused');
  assert.equal(received.filter(entry => entry.path.startsWith(path)).length, 0, 'the refused host receives no card');
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
  try {
    // A distinct channel visitor's recorded network identity keeps their quota
    // independent from the Slack visitors in the enclosing fixture.
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.15' } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${publicOrigin}/#subscribe`);
    await page.getByRole('heading', { name: 'Subscribe to status updates', exact: true }).waitFor();
    await page.getByText('Get updates in Teams', { exact: true }).click();
    const form = page.locator('form[action="/subscribe/teams"]');
    await form.getByLabel('Teams Workflows webhook URL', { exact: true }).fill(subscriberTeamsUrl);
    await form.getByText('Choose components', { exact: true }).click();
    await form.locator(`input[name="componentId"][value="${componentId}"]`).check();
    const result = page.waitForResponse(response => response.url() === `${publicOrigin}/subscribe/teams` && response.request().method() === 'POST');
    await form.getByRole('button', { name: 'Send verification card', exact: true }).click();
    assert.equal((await result).status(), 202);
    await page.getByRole('heading', { name: 'Check your Teams channel', exact: true }).waitFor();
    await proveScreen(page, 'verification-sent', errors);
    const cards = received.filter(entry => entry.path.startsWith(path));
    assert.equal(cards.length, 1, 'the recorded Workflows endpoint receives one verification card');
    const verification = JSON.parse(cards[0].body);
    assert.equal(verification.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
    const confirmation = verification.attachments[0].content.actions.find(action => action.title === 'Confirm subscription').url;
    assert.equal((await sql("SELECT state FROM subscribers WHERE channel='teams'")).at(-1).state, 'pending', 'receiving the card alone never activates');
    assert.equal((await page.goto(confirmation)).status(), 200);
    await page.getByRole('heading', { name: 'Confirm Teams subscription', exact: true }).waitFor();
    assert.equal((await sql("SELECT state FROM subscribers WHERE channel='teams'")).at(-1).state, 'pending', 'opening the channel link still asks for confirmation');
    await proveScreen(page, 'confirm', errors);
    const activated = page.waitForResponse(response => response.url() === confirmation && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Confirm subscription', exact: true }).click();
    assert.equal((await activated).status(), 200);
    await page.getByRole('heading', { name: 'Subscription confirmed', exact: true }).waitFor();
    await proveScreen(page, 'confirmed', errors);
    assert.equal((await sql("SELECT state FROM subscribers WHERE channel='teams'")).at(-1).state, 'active', 'the channel visitor confirms before activation');
    const stored = JSON.stringify(await sql("SELECT destination, sealed_url FROM subscribers JOIN subscriber_chat_destinations ON subscriber_id=subscribers.id WHERE subscribers.channel='teams'"));
    assert.ok(!stored.includes(subscriberTeamsUrl) && !stored.includes('sig=synthetic-lamp-1'), 'the bearer URL is sealed, never in subscriber destination');
    await context.close();
  } finally { await browser.close(); }
}

export function verifyTeamsPublication({ received }) {
  const cards = received.filter(entry => entry.path.startsWith(path));
  assert.equal(cards.length, 2, 'the active Teams subscription receives the next publication once');
  const card = JSON.parse(cards[1].body);
  assert.equal(card.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  const text = card.attachments[0].content.body.map(block => block.text).join('\n');
  assert.match(text, /See \[https:\/\/help\\\.example\\\.com\/kb\/123\]\(https:\/\/help\.example\.com\/kb\/123\)\\\./, 'URL visible text is the URL and punctuation stays outside');
  for (const [, label, url] of text.matchAll(/\[((?:\\.|[^\]\\])*)\]\(([^)]*)\)/g)) {
    assert.equal(label.replace(/\\(.)/g, '$1'), url);
    assert.match(url, /^https:\/\//);
  }
  assert.doesNotMatch(text, /\]\((?:javascript:|http:|data:|https:\/\/x\.test)/);
}
