import assert from 'node:assert/strict';
import { load } from '../../operator-readiness/runtime.mjs';
import { secret } from '../../auth-adoption/runtime.mjs';

export async function preparePortableAlertRules({ env, native, cookie }) {
  const [{ createApp }, { createUlid }] = await Promise.all([
    load('src/core/app/server.ts'), load('src/core/shared/ids.ts'),
  ]);
  const session = await native.auth.getSession(native.request('/auth/session', { cookie }));
  assert.ok(session);
  const bindings = { ...env, AUTH_ORIGIN: native.origin, LAMP_APP_HOST: new URL(native.origin).host,
    LAMP_PAGE_HOST: 'status.example.test', SESSION_SECRET: secret,
    SETUP_OPERATOR_EMAIL: session.operator.email, SUBSCRIBER_TOKEN_SECRET: 'portable-subscriber-secret',
    MAIL_FROM_ADDRESS: 'lamp@example.test' };
  const { app } = createApp(bindings);
  const call = (path, options = {}) => app.fetch(native.request(path, { cookie, ...options }), bindings);
  const modes = ['draft', 'claim', 'claim-and-publish'];
  const components = modes.map(mode => ({ id: createUlid(), name: `Portable ${mode} component` }));
  const now = new Date().toISOString();
  // The native archive is this journey's public door. Seed the component
  // catalogue because the binding proxy intentionally has no snapshot DO;
  // create templates and approve rules through the real authenticated routes.
  await env.DB.batch(components.map((component, index) => env.DB.prepare(
    'INSERT INTO components(id,name,display_order,created_at,updated_at) VALUES(?,?,?,?,?)',
  ).bind(component.id, component.name, index, now, now)));
  const templateResponse = await call('/api/app/incident-templates', { method: 'POST', body: {
    name: 'Portable owner-approved recovery template', lifecycle: 'Identified',
    affectedAudience: 'Customers using the portable API', customerImpact: 'Some API requests are delayed.',
    whatStillWorks: 'Existing connections remain available.', details: 'The operator saved this text before alerts fire.',
    nextUpdateOffsetMinutes: 15,
    components: [{ componentId: components[2].id, state: 'Degraded performance', relationship: 'Primary' }],
    channels: ['email'], resolvedUpdate: { affectedAudience: 'Customers using the portable API',
      customerImpact: 'API requests have recovered.', whatStillWorks: 'All API operations are available.',
      details: 'The operator also saved this recovery text in advance.' },
  } });
  assert.equal(templateResponse.status, 201, await templateResponse.clone().text());
  const template = (await templateResponse.json()).template;
  const sources = [];
  for (const [index, mode] of modes.entries()) {
    const response = await call('/api/app/intake/sources', { method: 'POST', body: {
      name: `Portable ${mode} source`, preset: 'pingdom', componentId: components[index].id,
      credentialKind: 'bearer-token',
    } });
    assert.equal(response.status, 201, await response.clone().text());
    const { source } = await response.json();
    sources.push({ id: source.id, componentId: components[index].id });
    const saved = await call(`/api/app/intake/rules/${source.id}/${components[index].id}`, { method: 'PUT', body: {
      name: `Portable ${mode} rule`, mode, state: 'Degraded performance',
      templateId: mode === 'claim-and-publish' ? template.id : null,
    } });
    assert.equal(saved.status, 200, await saved.clone().text());
  }
  const listed = await call('/api/app/intake/rules');
  assert.equal(listed.status, 200, await listed.clone().text());
  const rules = (await listed.json()).rules.filter(rule => sources.some(source => source.id === rule.sourceId));
  assert.equal(rules.length, modes.length);
  for (const rule of rules) {
    assert.equal(rule.approvedByOperatorId, session.operator.id);
    assert.equal(rule.approvedByName, session.operator.displayName);
    assert.ok(Number.isFinite(Date.parse(rule.createdAt)) && Number.isFinite(Date.parse(rule.updatedAt)), 'saved approval has durable timestamps');
  }
  assert.deepEqual(template.channels, ['email']);
  assert.equal(template.resolvedUpdate.customerImpact, 'API requests have recovered.');
  const rows = (await env.DB.prepare('SELECT * FROM alert_rules ORDER BY source_id,component_id').all()).results;
  assert.equal(rows.length, modes.length);
  const templateRow = await env.DB.prepare('SELECT * FROM incident_templates WHERE id=?').bind(template.id).first();
  return { sources, template, rules, rows, templateRow, actor: { id: session.operator.id, name: session.operator.displayName } };
}

export async function assertPortableAlertRules({ expected, app, bindings, origin, cookie, oldCookie, db }) {
  const call = (path, authority = cookie, method = 'GET') => app.fetch(new Request(origin + path, {
    method, headers: { Origin: origin, ...(authority ? { Cookie: authority } : {}) },
  }), bindings);
  for (const authority of [null, oldCookie]) {
    const refused = await call('/api/app/intake/rules', authority);
    assert.equal(refused.status, 401, 'restoring owner-approved settings never restores session authority');
  }
  const listing = await call('/api/app/intake/rules');
  assert.equal(listing.status, 200, await listing.clone().text());
  const restored = (await listing.json()).rules.filter(rule => expected.sources.some(source => source.id === rule.sourceId));
  assert.deepEqual(restored, expected.rules, 'all modes, chosen states, template references and saved owner approval survive native restore');
  assert.deepEqual((await db.prepare('SELECT * FROM alert_rules ORDER BY source_id,component_id').all()).results,
    expected.rows, 'rule identity and approval actor/time survive the archive unchanged');
  const templates = await call('/api/app/incident-templates');
  assert.equal(templates.status, 200, await templates.clone().text());
  assert.deepEqual((await templates.json()).templates.find(template => template.id === expected.template.id),
    expected.template, 'saved firing text, Resolved text and channel selection survive native restore');
  assert.deepEqual(await db.prepare('SELECT * FROM incident_templates WHERE id=?').bind(expected.template.id).first(),
    expected.templateRow, 'native restore retains the exact saved publication template');

  // Erase one source through its owner door after proving the roundtrip. Its
  // dependent rule disappears, while the saved template, unrelated rules and
  // audit history remain durable settings.
  const erasedSource = expected.sources[0];
  const erased = await call(`/api/app/intake/sources/${erasedSource.id}`, cookie, 'DELETE');
  assert.equal(erased.status, 200, await erased.clone().text());
  assert.equal((await db.prepare('SELECT count(*) n FROM alert_rules WHERE source_id=?').bind(erasedSource.id).first()).n, 0,
    'erasing an alert source removes its dependent owner rule');
  assert.equal((await db.prepare('SELECT count(*) n FROM alert_rules').first()).n, expected.rows.length - 1,
    'source erasure preserves every unrelated rule');
  assert.deepEqual(await db.prepare('SELECT * FROM incident_templates WHERE id=?').bind(expected.template.id).first(), expected.templateRow,
    'source erasure preserves operator-authored template text');
  const auditResponse = await call('/api/app/audit-log?action=erased');
  assert.equal(auditResponse.status, 200, await auditResponse.clone().text());
  const audit = (await auditResponse.json()).entries.find(entry => entry.entityId === erasedSource.id);
  assert.ok(audit, 'source erasure remains visible in the native audit view');
  assert.equal(audit.actorName, expected.actor.name);
  assert.ok(Number.isFinite(Date.parse(audit.createdAt)), 'source erasure records its time');
  const deletedRules = await call('/api/app/audit-log?action=deleted');
  assert.equal(deletedRules.status, 200, await deletedRules.clone().text());
  const erasedRule = expected.rules.find(rule => rule.sourceId === erasedSource.id);
  const deletion = (await deletedRules.json()).entries.find(entry => entry.entityType === 'alert-rule' && entry.entityId === erasedRule.id);
  assert.ok(deletion, 'rule deletion audit survives erasure of its source');
  assert.equal(deletion.actorId, expected.actor.id);
  assert.ok(Number.isFinite(Date.parse(deletion.createdAt)), 'cascaded rule deletion records its time');
}
