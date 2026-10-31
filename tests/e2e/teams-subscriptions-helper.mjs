import assert from 'node:assert/strict';

// Recorded Teams Workflows edge response: the enclosing fixture accepts each
// Adaptive Card with an empty HTTP 202. No live Microsoft call is made.
export const subscriberTeamsUrl = 'https://synthetic-lamp.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/synthetic-lamp-1/triggers/manual/paths/invoke?sig=synthetic-lamp-1';
const path = new URL(subscriberTeamsUrl).pathname;

/** Follow the public form and the channel's real verification card. A GET is
 * a preview; the channel visitor must explicitly submit consent before delivery. */
export async function prepareTeamsSubscription({ componentId, publicOrigin, received, outboundDestinations, sql, onManage }) {
  const page = await fetch(publicOrigin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<form[^>]+action="\/subscribe\/teams"/);
  assert.equal(page.headers.get('set-cookie'), null);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'text/html', 'CF-Connecting-IP': '192.0.2.15' };
  const rejectedUrl = 'https://help.example.com/teams-webhook';
  const refused = await fetch(`${publicOrigin}/subscribe/teams`, {
    method: 'POST', headers,
    body: new URLSearchParams({ url: rejectedUrl, componentId }),
  });
  assert.equal(refused.status, 400, 'a non-Microsoft webhook host is refused');
  assert.equal(outboundDestinations.filter(url => url === rejectedUrl).length, 0, 'the refused destination receives no outbound request');
  const requested = await fetch(`${publicOrigin}/subscribe/teams`, {
    method: 'POST', headers, body: new URLSearchParams({ url: subscriberTeamsUrl, componentId }),
  });
  assert.equal(requested.status, 202, await requested.clone().text());
  assert.equal(requested.headers.get('set-cookie'), null);
  const cards = received.filter(entry => entry.path.startsWith(path));
  assert.equal(cards.length, 1, 'the recorded Workflows endpoint receives one verification card');
  const verification = JSON.parse(cards[0].body);
  assert.equal(verification.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  const confirmation = verification.attachments[0].content.actions.find(action => action.title === 'Confirm subscription').url;
  const state = async () => (await sql("SELECT state FROM subscriber_directory AS subscribers WHERE channel='teams'")).at(-1).state;
  assert.equal(await state(), 'pending', 'receiving the card alone never activates');
  const preview = await fetch(confirmation);
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /<form[^>]+method="post"/);
  assert.equal(preview.headers.get('set-cookie'), null);
  assert.equal(await state(), 'pending', 'opening the channel link still asks for confirmation');
  const confirmed = await fetch(confirmation, { method: 'POST', headers, body: new URLSearchParams({ action: 'confirm' }) });
  assert.equal(confirmed.status, 200, await confirmed.clone().text());
  assert.equal(confirmed.headers.get('set-cookie'), null);
  const management = (await confirmed.text()).match(/href="(\/manage\/[^"]+)"/);
  assert.ok(management, 'explicit consent returns the channel visitor a management link');
  if (onManage) await onManage(new URL(management[1], publicOrigin).href);
  assert.equal(await state(), 'active', 'the channel visitor confirms before activation');
  const stored = JSON.stringify(await sql("SELECT destination, sealed_url FROM subscriber_directory AS subscribers JOIN subscriber_chat_destinations ON subscriber_id=subscribers.id WHERE subscribers.channel='teams'"));
  assert.ok(!stored.includes(subscriberTeamsUrl) && !stored.includes('sig=synthetic-lamp-1'), 'the bearer URL is sealed, never in subscriber destination');
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
