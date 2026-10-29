import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, presets } from '../identity/oidc/tests/fake-runtime.mjs';

const path = '/auth/settings/identity';
const html = { accept: 'text/html' };
const post = (cookie, input, form = false) => ({ method: 'POST', cookie, input, form, ...(form ? { headers: html } : {}) });
async function emailSession(r, email) {
  assert.equal((await r.call('/auth/magic-link', post(undefined, { email }))).status, 202);
  const confirmed = await r.call('/auth/confirm', post(undefined, { token: await r.link() }));
  assert.equal(confirmed.status, 303);
  return r.session(confirmed);
}

test('member settings navigation gets an actionable document while JSON clients retain typed authorization errors', async t => {
  const r = await runtime(t, { providers: [], fakes: [] });
  const owner = await r.bootstrap();
  assert.equal((await r.call('/auth/invite', post(owner, { email: 'member@example.com', displayName: 'Jordan', role: 'member' }))).status, 202);
  const joined = await r.call('/auth/confirm', post(undefined, { token: await r.link() }));
  const member = r.session(joined);
  const preferences = [
    ['application/json, text/html;q=0', 'json'],
    ['application/json;q=1, text/html;q=0.5', 'json'],
    ['application/json', 'json'],
    ['text/html', 'html'],
    ['text/html,application/json', 'html'],
    ['application/json,text/html', 'json'],
    ['application/json;q=0.5,text/html', 'html'],
    [undefined, 'json'], ['*/*', 'json'], ['*/*;q=0.8', 'json'],
    ['text/*', 'html'], ['application/*', 'json'],
    ['text/html;q=0,*/*;q=1', 'json'],
    ['text/*;q=1,text/html;q=0.2,application/json;q=0.5', 'json'],
    ['application/json;q=0,*/*;q=0.5', 'html'],
    ['*/*;q=1,text/html', 'html'],
    ['TEXT/HTML;CHARSET="UTF-8",application/json;q=0.5', 'html'],
    ['text/html;charset=iso-8859-1,application/json', 'json'],
    ['text/html;profile="a,b",application/json', 'json'],
    [',text/html,,application/json;q=0.5,', 'html'],
    ['text/html;q=0.,application/json;q=1.000', 'json'],
    ['text/html;q=bogus,application/json', 'json'],
    ['text/html;q=0.1234', 'json'], ['text/html,garbage', 'json'],
    ['text/html;profile="unterminated', 'json'], ['text/html;q=1;q=0', 'json'],
  ];
  for (const [accept, expected] of preferences) {
    const headers = accept === undefined ? {} : { accept };
    for (const [method, form] of [['GET', false], ['HEAD', false], ['POST', false], ['POST', true]]) {
      const response = await r.call(path, { method, cookie: member, headers, form,
        ...(method === 'POST' ? { input: { idpSignIn: form ? 'true' : true } } : {}) });
      assert.equal(response.status, 403, `${method} ${accept}`);
      assert.match(response.headers.get('content-type'), expected === 'html' ? /text\/html/ : /application\/json/, `${method} ${accept}`);
      const body = await response.text();
      if (method === 'HEAD') assert.equal(body, '');
      else if (expected === 'json') assert.deepEqual(JSON.parse(body), { error: 'owner_required' });
      else { assert.match(body, /<main>.*<h1>[^<]+<\/h1><p>[^<]+<\/p>/); assert.match(body, /href="\/app"/); }
    }
    for (const method of ['GET', 'HEAD']) {
      const response = await r.call(path, { method, cookie: owner, headers });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), expected === 'html' ? /text\/html/ : /application\/json/);
      if (method === 'HEAD') assert.equal(await response.text(), '');
      else if (expected === 'json') assert.equal(typeof (await response.json()).idpSignIn, 'boolean');
      else assert.match(await response.text(), /<form/);
    }
  }
});

test('OA and native settings refuse provider enablement without a configured or linked provider and preserve the disabled policy', async t => {
  for (const native of [false, true]) {
    const r = await runtime(t, { providers: [], fakes: [], ...(native ? { native: {} } : {}) });
    const owner = native ? await emailSession(r, 'owner@example.com') : await r.bootstrap();
    assert.equal((await r.call(path, post(owner, { idpSignIn: false }))).status, 200);
    const page = await r.call(path, { cookie: owner, headers: html });
    assert.match(await page.text(), /<input[^>]*name="idpSignIn"[^>]*disabled/);
    for (const form of [false, true]) {
      const response = await r.call(path, post(owner, { idpSignIn: form ? 'true' : true }, form));
      assert.equal(response.status, 409);
      if (form) { assert.match(response.headers.get('content-type'), /text\/html/); assert.match(await response.text(), /role="alert"/); }
      else assert.deepEqual(await response.json(), { error: 'provider_unlinked' });
    }
    for (const accept of [undefined, '*/*', 'application/json', 'application/json,text/html;q=0', 'text/html;q=invalid']) {
      const response = await r.call(path, { ...post(owner, { idpSignIn: 'true' }, true), headers: accept ? { accept } : {} });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: 'provider_unlinked' });
    }
    const settings = await (await r.call(path, { cookie: owner })).json();
    assert.equal(settings.idpSignIn, false);
    assert.equal(settings.providerSetup.canEnable, false);
    await r.restart();
    assert.equal((await (await r.call(path, { cookie: owner })).json()).idpSignIn, false);
  }
});

test('configured providers retain first-use setup, saved form settings persist, and an explicit unlink blocks re-enabling', async t => {
  const setup = presets();
  const r = await runtime(t, { providers: [setup.providers[0]], fakes: [setup.fakes[0]] });
  const owner = await r.bootstrap();
  assert.equal((await r.call(path, post(owner, { idpSignIn: true }))).status, 200, 'static providers still pin on first use');
  assert.equal((await r.stepUp(owner, 'providers:relink')).status, 303);
  assert.equal((await r.call('/auth/providers/relink', post(owner, { provider: 'auth' }))).status, 200);
  const saved = await r.call(path, post(owner, {}, true));
  assert.equal(saved.status, 303);
  const confirmation = await r.call(saved.headers.get('location'), { cookie: owner, headers: html });
  assert.match(await confirmation.text(), /role="status"/);
  await r.restart();
  const settings = await (await r.call(path, { cookie: owner })).json();
  assert.equal(settings.idpSignIn, false);
  assert.equal(settings.providerSetup.canEnable, true);
  assert.equal(settings.providerSetup.providers[0].state, 'linked');
  assert.equal((await r.stepUp(owner, 'providers:unlink')).status, 303);
  assert.equal((await r.call('/auth/providers/unlink', post(owner, { provider: 'auth' }))).status, 200);
  const refused = await r.call(path, post(owner, { idpSignIn: true }));
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { error: 'provider_unlinked' });
  assert.equal((await (await r.call(path, { cookie: owner })).json()).providerSetup.canEnable, false);
});
