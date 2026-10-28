import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeReturnTo, normalizeEmail, isActiveOperator, defaultRolePolicy, requireLoopback } from '../index.mjs';
import { hashToken, opaqueToken, validToken } from '../crypto.mjs';
import { configure } from '../config.mjs';
const owner = { id: 'o', email: 'owner@example.com', role: 'owner', status: 'active' };
const admin = { ...owner, id: 'a', role: 'admin' };
const member = { ...owner, id: 'm', role: 'member' };
test('return paths retain valid query/fragment and reject URL/control/encoding redirects', () => {
  assert.equal(safeReturnTo('/app/projects?q=one%20two#today'), '/app/projects?q=one%20two#today');
  assert.equal(safeReturnTo('/app/projects?sort=recent#today'), '/app/projects?sort=recent#today');
  for (const input of ['https://evil.test', '//evil.test', '/\\evil.test', '/%2fevil.test', '/%252fevil.test', '/%5cevil.test', '/%0aLocation:evil', '/\n', 'javascript:alert(1)', '/%zz']) assert.equal(safeReturnTo(input), '/app', input);
});
test('normalization, allow list, active policy and default role hierarchy', () => {
  assert.equal(normalizeEmail(' OWNER@Example.COM '), 'owner@example.com');
  for (const input of ['invalid', 'a@example.com\r\nbcc:x@y.z', 'a b@example.com', null]) assert.throws(() => normalizeEmail(input));
  assert.equal(isActiveOperator(owner, []), false);
  assert.equal(isActiveOperator({ ...owner, status: 'inactive' }), false);
  assert.equal(defaultRolePolicy({ actor: admin, action: 'operators:invite', role: 'owner' }), false);
  assert.equal(defaultRolePolicy({ actor: admin, action: 'operators:invite', role: 'member' }), true);
  assert.equal(defaultRolePolicy({ actor: member, target: member, action: 'sessions:revoke' }), true);
  assert.equal(defaultRolePolicy({ actor: member, target: owner, action: 'sessions:revoke' }), false);
  assert.equal(defaultRolePolicy({ actor: admin, target: owner, action: 'operators:deactivate' }), false);
});
test('review requires literal URL and Host; forwarded headers confer no trust', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.doesNotThrow(() => requireLoopback(new Request(`http://${host}:8787`, { headers: { Host: `${host}:8787` } })));
  for (const host of ['evil.test', 'localhost.evil.test', '127.0.0.2', 'localhost:99']) assert.throws(() => requireLoopback(new Request('http://localhost:8787', { headers: { Host: host, 'X-Forwarded-Host': 'localhost:8787' } })), { status: 403 });
  assert.throws(() => requireLoopback(new Request('https://evil.test', { headers: { Host: 'localhost', Forwarded: 'host=localhost' } })), { status: 403 });
});
test('cryptographic tokens and strict config are domain-separated and fail closed', async () => {
  const token = opaqueToken(); assert.ok(validToken(token)); assert.notEqual(token, opaqueToken());
  assert.notEqual(await hashToken('secret', 'link', token), await hashToken('secret', 'session', token));
  const config = { origin: 'https://auth.test', OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: 'x'.repeat(32) };
  assert.equal(configure(config).cookieName, '__Host-operator_session');
  for (const patch of [{ origin: 'http://auth.test' }, { origin: 'https://auth.test/path' }, { local: true }, { sessionSeconds: 0 }, { SESSION_SECRET: 'short' }, { externalIssuers: ['http://issuer.test'] }]) assert.throws(() => configure({ ...config, ...patch }));
});
