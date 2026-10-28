import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openFollowUpsRuntime, eventuallyFollowUp } from './follow-ups-runtime.mjs';

const fixture = JSON.parse(await readFile(new URL('../../fixtures/social/recorded-api.json', import.meta.url), 'utf8'));
const prefix = 'Synthetic Lamp service status:';
const impact = 'Customers cannot complete card payments while the payment processor is recovering. Existing subscriptions remain available and account data is safe. Our operators are restoring the affected service and checking successful payments before recovery.';
const limits = { x: 280, bluesky: 300, mastodon: 500 };
const networkNames = ['x', 'bluesky', 'mastodon'];

/** Real authenticated routes, publish transaction, Queue and scheduled Worker;
 * the only fake is each recorded provider HTTP edge. No provider account is used. */
export async function socialPostsFlow(t) {
  const received = { x: [], bluesky: [], mastodon: [] };
  const sessionRequests = [];
  let failX = false;
  const fixtureRuntime = await openFollowUpsRuntime({ providerEdge: async request => {
    const url = new URL(request.url);
    const network = ['api.x.com', 'api.twitter.com'].includes(url.hostname) ? 'x' : url.hostname === 'bsky.social' ? 'bluesky' : url.hostname === 'mastodon.social' ? 'mastodon' : null;
    if (!network) return;
    assert.equal(request.method, 'POST');
    if (network === 'bluesky' && url.pathname === fixture.bluesky.session.request.path) {
      const body = await request.json();
      assert.deepEqual(body, { identifier: fixture.bluesky.session.request.identifier, password: fixture.bluesky.session.request.password });
      sessionRequests.push(body);
      return Response.json(fixture.bluesky.session.response);
    }
    const recorded = fixture[network];
    assert.equal(url.pathname, recorded.request.path);
    assert.equal(request.headers.get('authorization'), `Bearer ${network === 'bluesky' ? fixture.bluesky.session.response.accessJwt : recorded.request.credential}`);
    const body = await request.json();
    const entry = { body, idempotencyKey: request.headers.get('idempotency-key') };
    received[network].push(entry);
    if (network === 'x' && failX) return Response.json(recorded.failure.body, { status: recorded.failure.status });
    const response = recorded.responses[received[network].length - 1] ?? (network === 'bluesky'
      ? { uri: `at://did:plc:syntheticlamp1/app.bsky.feed.post/synthetic-lamp-post-${received[network].length}`, cid: `synthetic-lamp-cid-${received[network].length}` }
      : network === 'x' ? { data: { id: `synthetic-lamp-post-${received[network].length}` } } : { id: `synthetic-lamp-post-${received[network].length}` });
    entry.response = response;
    return Response.json(response, { status: network === 'x' ? 201 : 200 });
  } });
  const { api, post, raw, publicOrigin, db } = fixtureRuntime;
  const sql = async query => (await db.prepare(query).all()).results;
  const countPosts = async () => Number((await sql('SELECT count(*) n FROM social_posts'))[0].n);
  const socialLog = async () => {
    const response = await api('/api/app/social');
    assert.equal(response.status, 200, response.text);
    return response.body;
  };
  const flush = async () => {
    const result = await (await fixtureRuntime.runtime.getWorker()).scheduled({ cron: '* * * * *' });
    assert.equal(result.outcome, 'ok', 'the ordinary scheduled Worker processes social posts');
  };
  const settle = async (eventId, expected = 3) => {
    await flush();
    return eventuallyFollowUp(async () => (await socialLog()).posts.filter(row => row.eventId === eventId),
      rows => rows.length === expected && rows.every(row => ['delivered', 'failed', 'uncertain'].includes(row.state)),
      'the committed social recipients have terminal delivery outcomes');
  };
  const component = async name => {
    const added = await post('/api/app/components', { groupId: null, name, description: '', internal: false, displayOrder: 0, note: '' });
    assert.equal(added.status, 201, added.text);
    return added.body.component;
  };
  const createIncident = async (componentId, title = 'Synthetic Lamp social publication', extra = {}) => {
    const created = await post('/api/app/incidents', { title, components: [{ componentId, state: 'Degraded performance', relationship: 'Primary' }], ...extra });
    assert.equal(created.status, 201, created.text);
    return created.body.incident;
  };
  const publish = async (incident, { channels = ['social'], lifecycle = 'Investigating', customerImpact = impact, publishedAt } = {}) => {
    const saved = await api(`/api/app/incidents/${incident.id}/draft`, { method: 'PUT', body: JSON.stringify({ lifecycle, affectedAudience: 'Customers using card payments.', customerImpact, whatStillWorks: 'Existing subscriptions and account access remain available.', details: '', nextUpdateAt: lifecycle === 'Resolved' ? null : new Date(Date.now() + 3600000).toISOString() }) });
    assert.equal(saved.status, 200, saved.text);
    const version = `${saved.body.draft.id}:${(await api(`/api/app/incidents/${incident.id}`)).body.incident.updates.length}`;
    const request = { channels, ...(publishedAt ? { publishedAt } : {}) };
    const response = await api(`/api/app/incidents/${incident.id}/publish`, { method: 'POST', headers: { 'If-Match': version }, body: JSON.stringify(request) });
    assert.equal(response.status, 200, response.text);
    return { update: response.body.update, replay: () => api(`/api/app/incidents/${incident.id}/publish`, { method: 'POST', headers: { 'If-Match': version }, body: JSON.stringify(request) }) };
  };
  try {
    t.diagnostic('INTEG-002 acceptance 1: recorded X, Bluesky and Mastodon edges receive one bounded post per selected account; credentials stay sealed.');
    assert.equal((await socialLog()).postByDefault, false, 'social defaults to off on a fresh installation');
    const accounts = [];
    for (const network of networkNames) {
      const added = await post('/api/app/social', { network, name: `Synthetic Lamp ${network}`, prefix, credential: network === 'bluesky' ? fixture.bluesky.session.request.password : fixture[network].request.credential,
        ...(network === 'bluesky' ? { host: 'https://bsky.social', identifier: fixture.bluesky.session.request.identifier } : network === 'mastodon' ? { host: fixture.mastodon.request.origin } : {}), scopes: network === 'x' ? ['tweet.write'] : network === 'mastodon' ? ['write:statuses'] : [] });
      assert.equal(added.status, 201, added.text);
      accounts.push(added.body.account);
      assert.ok(added.body.account.id);
    }
    for (const host of ['https://127.0.0.1', 'https://10.0.0.1', 'https://localhost', 'https://service.internal', 'http://mastodon.social']) {
      const refused = await post('/api/app/social', { network: 'mastodon', name: 'Refused destination', prefix, credential: 'synthetic-lamp-9', host, scopes: ['write:statuses'] });
      assert.equal(refused.status, 400, `private/internal Mastodon destination refused: ${host}`);
    }
    for (const network of ['x', 'mastodon']) {
      const refused = await post('/api/app/social', { network, name: 'Missing write scope', prefix, credential: 'synthetic-lamp-9', ...(network === 'mastodon' ? { host: 'https://mastodon.social' } : {}), scopes: [] });
      assert.equal(refused.status, 400, 'an account without the required write scope cannot connect');
    }
    assert.equal((await raw('/api/app/social')).status, 401, 'social accounts require an authenticated operator');
    await db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) SELECT '01J00000000000000000000092',replace(email,'owner','backup'),'Synthetic Lamp backup owner','owner','active',created_at FROM oa_operators WHERE id='01J00000000000000000000091'").run();
    await db.prepare("UPDATE oa_operators SET role='member' WHERE id='01J00000000000000000000091'").run();
    try {
      assert.equal((await post('/api/app/social', { network: 'x', name: 'Refused member connection', prefix, credential: 'synthetic-lamp-9', scopes: ['tweet.write'] })).status, 403, 'a member cannot connect a social account');
      assert.equal((await api('/api/app/social', { method: 'PATCH', body: JSON.stringify({ postByDefault: true }) })).status, 403, 'a member cannot change the posting default');
      assert.equal((await api(`/api/app/social/${accounts[0].id}`, { method: 'DELETE' })).status, 403, 'a member cannot remove a social account');
    } finally {
      await db.prepare("UPDATE oa_operators SET role='owner' WHERE id='01J00000000000000000000091'").run();
      await db.prepare("DELETE FROM oa_operators WHERE id='01J00000000000000000000092'").run();
    }
    assert.equal((await socialLog()).accounts.length, 3, 'refused mutations preserve all connected accounts');
    assert.equal((await socialLog()).postByDefault, false, 'refused default mutation preserves explicit opt-in');
    const credentials = ['synthetic-lamp-1', 'synthetic-lamp-2', 'synthetic-lamp-3', 'synthetic-lamp-4', 'synthetic-lamp-5'];
    for (const value of credentials) {
      assert.ok(!(await api('/api/app/social')).text.includes(`"${value}"`), 'account API never returns a saved credential');
      assert.ok(!JSON.stringify(await sql('SELECT * FROM social_accounts')).includes(`"${value}"`), 'only encrypted credentials are stored');
    }
    const affected = await component('Synthetic Lamp social API');
    const incident = await createIncident(affected.id);
    const first = await publish(incident);
    const firstLog = await settle(first.update.id);
    const permalink = `${publicOrigin}/incidents/${incident.reference}`;
    for (const network of networkNames) {
      assert.equal(received[network].length, 1, `${network}: exactly one post for the first update`);
      const body = received[network][0].body;
      const text = network === 'bluesky' ? body.record.text : network === 'mastodon' ? body.status : body.text;
      assert.ok(text.includes(prefix), `${network}: owner prefix is retained`);
      assert.ok(text.includes('Investigating'), `${network}: lifecycle is retained`);
      assert.ok(text.includes(permalink), `${network}: incident permalink is complete`);
      assert.ok(Array.from(text).length <= limits[network], `${network}: ${Array.from(text).length} characters fit ${limits[network]}`);
      assert.ok(text.includes('Customers cannot complete card payments'), `${network}: customer-impact statement is present`);
      const impactPart = text.slice(text.indexOf('Customers cannot'), text.indexOf(permalink)).trim().replace(/[\s…]+$/, '');
      assert.ok(impact.startsWith(impactPart), `${network}: shortened impact is a prefix of the owner's statement`);
      if (impactPart !== impact) assert.ok(/\s/.test(impact[impactPart.length] ?? ''), `${network}: shortening ends at a word boundary`);
      assert.ok(!body.reply && !body.in_reply_to_id && !body.record?.reply, `${network}: first post starts a thread`);
      const row = firstLog.find(value => value.network === network);
      assert.equal(row.state, 'delivered'); assert.equal(row.attempts, 1); assert.ok(row.postId, `${network}: delivery log retains provider post id`);
      assert.ok(Number.isFinite(Date.parse(row.outcomeAt)), `${network}: successful receipt records an outcome time`);
      assert.equal(row.attemptLog.length, 1); assert.ok(row.attemptLog[0].finishedAt >= row.attemptLog[0].startedAt, `${network}: every successful attempt has a completion time`);
      t.diagnostic(`INTEG-002 ${network} first post (${Array.from(text).length}/${limits[network]}): ${JSON.stringify(text)}; postId=${row.postId}`);
    }
    assert.ok(sessionRequests.length > 0, 'Bluesky exchanges its app password only at its configured service');

    t.diagnostic('INTEG-002 acceptance 2: the second update uses each network’s native reply field and replies to the first provider id.');
    const second = await publish(incident, { lifecycle: 'Identified', customerImpact: 'Customers still cannot complete card payments.' });
    await settle(second.update.id);
    assert.equal(received.x[1].body.reply.in_reply_to_tweet_id, received.x[0].response.data.id);
    assert.equal(received.mastodon[1].body.in_reply_to_id, received.mastodon[0].response.id);
    assert.deepEqual(received.bluesky[1].body.record.reply.parent, received.bluesky[0].response);
    assert.deepEqual(received.bluesky[1].body.record.reply.root, received.bluesky[0].response);
    t.diagnostic(`INTEG-002 thread fields: X ${JSON.stringify(received.x[1].body.reply)}; Bluesky ${JSON.stringify(received.bluesky[1].body.record.reply)}; Mastodon in_reply_to_id=${received.mastodon[1].body.in_reply_to_id}`);
    const worker = await fixtureRuntime.runtime.getWorker();
    for (const publication of [first, second]) {
      await publication.replay();
      for (let redelivery = 1; redelivery <= 2; redelivery++) {
        const result = await worker.queue('lamp-follow-ups-jobs', [{ id: `synthetic-lamp-redelivery-${publication.update.id}-${redelivery}`, timestamp: new Date(), attempts: redelivery, body: { type: 'delivery-dispatch', eventId: publication.update.id } }]);
        assert.equal(result.outcome, 'ok', 'the real Queue consumer acknowledges a redelivered event');
      }
    }
    await flush(); await flush();
    for (const network of networkNames) assert.equal(received[network].length, 2, `${network}: publish retry and scheduled redelivery do not duplicate posts`);

    t.diagnostic('INTEG-002 acceptance 3: explicit deselection queues and posts nothing even with post by default on; retroactive updates and imports stay silent.');
    const defaults = await api('/api/app/social', { method: 'PATCH', body: JSON.stringify({ postByDefault: true }) });
    assert.equal(defaults.status, 200, defaults.text); assert.equal((await socialLog()).postByDefault, true);
    const beforeOff = await countPosts();
    const off = await publish(incident, { channels: [], lifecycle: 'Monitoring', customerImpact: 'A fix is being checked.' });
    await flush();
    assert.equal(await countPosts(), beforeOff, 'deselected publication commits no social recipient rows');
    assert.equal((await sql(`SELECT count(*) n FROM integration_deliveries WHERE namespace='lamp-social' AND json_extract(envelope,'$.id') LIKE '${off.update.id}%'`))[0].n, 0, 'deselected publication queues no social delivery');
    for (const network of networkNames) assert.equal(received[network].length, 2, `${network}: deselected publication sends nothing`);
    const historicalComponent = await component('Synthetic Lamp historical social API');
    const historicalAt = '2026-09-01T00:00:00.000Z';
    const historical = await createIncident(historicalComponent.id, 'Synthetic Lamp historical social publication', { openedAt: historicalAt });
    await publish(historical, { publishedAt: historicalAt });
    await flush(); assert.equal(await countPosts(), beforeOff, 'retroactive publication ignores a selected social channel');
    const files = await Promise.all(['page.json', 'page-access-groups.json', 'components.json', 'incidents.json'].map(async name => ({ name, text: await readFile(new URL(`../../fixtures/statuspage/small/${name}`, import.meta.url), 'utf8') })));
    // The incumbent export explicitly asks for Twitter notifications; imports must still remain silent.
    const importedIncidents = files.find(file => file.name === 'incidents.json');
    const rows = JSON.parse(importedIncidents.text);
    for (const row of rows) for (const update of row.incident_updates) update.wants_twitter_update = true;
    importedIncidents.text = JSON.stringify(rows);
    const { moveInDoor } = await import('../../helpers/import-notifications.mjs');
    const moveIn = moveInDoor(async (path, body, headers) => api(path, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers }));
    const reviewed = await moveIn.preview({ files });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    const imported = await moveIn.apply(reviewed.body);
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.equal(imported.body.job.state, 'completed');
    await flush(); assert.equal(await countPosts(), beforeOff, 'imported history creates no social recipient rows');
    for (const network of networkNames) assert.equal(received[network].length, 2, `${network}: neither retroactive updates nor imported Twitter preferences send posts`);

    const maintenance = async social => {
      const response = await post('/api/app/maintenance', { title: 'Synthetic Lamp social maintenance', affectedAudience: 'Card payment customers.', customerImpact: 'Payments may be delayed.', startsAt: new Date(Date.now() + 172800000).toISOString(), endsAt: new Date(Date.now() + 176400000).toISOString(), componentIds: [affected.id], autoStart: false, autoComplete: false, social });
      assert.equal(response.status, 201, response.text); return response.body.maintenance;
    };
    await maintenance(false); await flush(); assert.equal(await countPosts(), beforeOff, 'maintenance is silent unless the owner selects social');
    const chosenMaintenance = await maintenance(true); await flush();
    await eventuallyFollowUp(() => countPosts(), n => n === beforeOff + 3, 'chosen maintenance commits each social account');
    for (const network of networkNames) assert.equal(received[network].length, 3, `${network}: selected maintenance posts once`);
    const chosenNotice = chosenMaintenance.notices[0];
    assert.ok(chosenNotice);

    t.diagnostic('INTEG-002 acceptance 4: X 503 receives five retries, then a failed row and one operator alert; public artifacts, email and the other accounts continue.');
    const email = 'synthetic-lamp-social@example.test';
    const subscribed = await raw(`${publicOrigin}/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: publicOrigin }, body: new URLSearchParams({ email, componentId: affected.id }).toString() });
    assert.equal(subscribed.status, 202, await subscribed.clone().text());
    const invitation = await eventuallyFollowUp(() => fixtureRuntime.messages.find(message => message.to.includes(email)), Boolean, 'subscriber confirmation mail is sent');
    const confirmation = invitation.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
    assert.equal((await raw(confirmation)).status, 200);
    failX = true;
    const beforeFailure = received.x.length;
    const failedIncident = await createIncident(affected.id, 'Synthetic Lamp social failure isolation');
    const failure = await publish(failedIncident, { channels: ['social', 'email'], customerImpact: 'Synthetic social failure must not delay public status or subscriber email.' });
    await flush();
    const partialLog = await eventuallyFollowUp(async () => (await socialLog()).posts.filter(row => row.eventId === failure.update.id),
      rows => rows.length === 3 && rows.find(row => row.network === 'x')?.attempts === 1 && rows.filter(row => row.network !== 'x').every(row => row.state === 'delivered'), 'one X attempt does not delay other accounts');
    assert.equal(partialLog.find(row => row.network === 'x').state, 'queued');
    await eventuallyFollowUp(() => fixtureRuntime.messages.filter(message => message.to.includes(email) && message.text.includes('Synthetic social failure must not delay')).length, n => n === 1, 'subscriber email arrives while X is still queued for retry');
    for (const path of ['/', '/feed.atom', `/incidents/${failedIncident.reference}`]) {
      const publicText = await eventuallyFollowUp(async () => (await raw(publicOrigin + path)).text(), text => text.includes('Synthetic social failure must not delay'), `public ${path} updates while X is failing`);
    }
    const xRow = partialLog.find(row => row.network === 'x');
    const policy = (await sql(`SELECT max_attempts,retry_delays,next_at FROM integration_deliveries WHERE namespace='lamp-social' AND id='${xRow.id}'`))[0];
    assert.equal(policy.max_attempts, 6, 'NOTIFY-003 permits five retries after the first send');
    const delays = JSON.parse(policy.retry_delays);
    assert.equal(delays.length, 5); assert.ok(delays.every(delay => delay > 0));
    assert.ok(delays.reduce((sum, delay) => sum + delay, 0) >= 3600000, 'recorded retry policy spans one hour');
    for (let attempt = 2; attempt <= 6; attempt++) {
      await db.prepare("UPDATE integration_deliveries SET next_at=0 WHERE namespace='lamp-social' AND id=?").bind(xRow.id).run();
      await flush();
      await eventuallyFollowUp(async () => (await socialLog()).posts.find(row => row.id === xRow.id)?.attempts, n => n === attempt, `actual scheduled dispatch records attempt ${attempt}`);
    }
    const failedLog = (await socialLog()).posts.find(row => row.id === xRow.id);
    assert.equal(failedLog.state, 'failed'); assert.equal(failedLog.attempts, 6);
    assert.ok(Number.isFinite(Date.parse(failedLog.outcomeAt)), 'terminal failure records its outcome time');
    assert.equal(failedLog.attemptLog.length, 6);
    for (const attempt of failedLog.attemptLog) {
      assert.ok(attempt.finishedAt >= attempt.startedAt, 'each failed attempt records its completion time');
      assert.equal(JSON.parse(attempt.outcome).status, 503, 'every failed attempt log retains the safe HTTP outcome');
    }
    assert.equal(received.x.length - beforeFailure, 6, 'one initial X send and five retries cross the fake edge');
    const attempts = await sql(`SELECT number,outcome FROM integration_attempts WHERE namespace='lamp-social' AND delivery_id='${xRow.id}' ORDER BY number`);
    assert.deepEqual(attempts.map(row => row.number), [1, 2, 3, 4, 5, 6], 'every actual send has one recorded attempt');
    for (const row of attempts) assert.equal(JSON.parse(row.outcome).status, 503);
    await flush();
    await eventuallyFollowUp(() => fixtureRuntime.messages.filter(message => message.to.includes('synthetic-lamp-owner@example.test') && /social/i.test(message.subject) && !message.text.includes('/auth/')).length,
      n => n === 1, 'terminal social failure raises one operator email alert');
    await flush();
    assert.equal(fixtureRuntime.messages.filter(message => message.to.includes(email) && message.text.includes('Synthetic social failure must not delay')).length, 1, 'X retries never duplicate subscriber email');
    for (const network of ['bluesky', 'mastodon']) assert.equal(received[network].length, 4, `${network}: healthy account receives failure-isolated update once`);
    for (const value of credentials) {
      assert.ok(!(await api('/api/app/social')).text.includes(`\"${value}\"`), 'delivery log never includes credentials or Bluesky session tokens');
      assert.ok(!JSON.stringify(await sql("SELECT * FROM integration_attempts WHERE namespace='lamp-social'")).includes(`\"${value}\"`), 'attempt log contains safe outcome codes, never credentials');
    }
    t.diagnostic(`INTEG-002 X 503 attempts=${failedLog.attempts}; final=${JSON.stringify(failedLog)}; NOTIFY-006 operator mail=1; page, Atom, email, Bluesky and Mastodon delivered before X exhaustion.`);

    const savedPublicationData = JSON.stringify([
      await socialLog(),
      await sql("SELECT envelope FROM integration_deliveries WHERE namespace='lamp-social'"),
      await sql('SELECT body,text FROM social_posts'),
    ]);
    for (const credential of [fixture.x.request.credential, fixture.bluesky.session.request.password, fixture.bluesky.session.response.accessJwt, fixture.bluesky.session.response.refreshJwt, fixture.mastodon.request.credential]) {
      assert.ok(!savedPublicationData.includes(credential), 'saved delivery envelopes, publication bodies and delivery APIs never contain a posting credential or session token');
    }

    const pendingIncident = await createIncident(affected.id, 'Synthetic Lamp disconnect before retry');
    const pendingPublication = await publish(pendingIncident);
    await flush();
    const pendingX = await eventuallyFollowUp(async () => (await socialLog()).posts.find(row => row.eventId === pendingPublication.update.id && row.network === 'x'),
      row => row?.state === 'queued' && row.attempts === 1, 'a failing account has a queued retry before disconnection');
    const removed = await api(`/api/app/social/${accounts[0].id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200, removed.text);
    assert.ok(!(await socialLog()).accounts.some(row => row.id === accounts[0].id), 'removing an account leaves no active connection');
    const beforeRemoval = received.x.length;
    await db.prepare("UPDATE integration_deliveries SET next_at=0 WHERE namespace='lamp-social' AND id=?").bind(pendingX.id).run();
    await pendingPublication.replay();
    const replay = await worker.queue('lamp-follow-ups-jobs', [{ id: 'synthetic-lamp-disconnected-replay', timestamp: new Date(), attempts: 2, body: { type: 'delivery-dispatch', eventId: pendingPublication.update.id } }]);
    assert.equal(replay.outcome, 'ok');
    await flush();
    assert.equal(received.x.length, beforeRemoval, 'queued retries and a replay cannot use a disconnected credential');
    await publish(incident, { channels: ['social'], lifecycle: 'Monitoring', customerImpact: 'Payments are recovering after the account was removed.' });
    await flush(); assert.equal(received.x.length, beforeRemoval, 'a removed account receives no future update');
    assert.deepEqual(received.bluesky.at(-1).body.record.reply.parent, received.bluesky[1].response, 'a later update resumes its own incident thread after another incident publishes');
    assert.deepEqual(received.bluesky.at(-1).body.record.reply.root, received.bluesky[0].response, 'the Bluesky thread retains its first post as root');
    assert.equal(received.mastodon.at(-1).body.in_reply_to_id, received.mastodon[1].response.id, 'Mastodon replies to the preceding post of this incident');
  } finally { await fixtureRuntime.close(); }
}
