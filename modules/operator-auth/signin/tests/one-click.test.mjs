import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, presets } from '../../identity/oidc/tests/fake-runtime.mjs';

test('one-click sign-in keeps visible provider forms and their return destination', async t => {
  // /signin exercises the dev layer; /login reaches the shared sign-in handler.
  for (const path of ['/signin', '/login']) {
    const origin = 'http://127.0.0.1:8787';
    const fixture = presets(origin);
    const devKey = 'one-click-provider-test-only-local-key-0000000000000';
    const r = await runtime(t, { ...fixture, providers: fixture.providers.slice(0, 1), devKey,
      core: { origin, local: true, branding: { productName: 'Workspace', signInPath: path } } });
    await r.bootstrap();
    await r.db.prepare("UPDATE oa_operators SET display_name='Alex Morgan' WHERE role='owner'").run();
    const returnTo = '/app/queue?view=assigned&sort=recent';
    const headers = { 'x-rer-dev-key': devKey };
    const response = await r.call(`${path}?returnTo=${encodeURIComponent(returnTo)}`, { headers });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Sign in as Alex Morgan/);
    const form = html.match(/<form method="post" action="([^"]+)"><input type="hidden" name="returnTo" value="([^"]+)"><button[^>]*>Continue with Auth<\/button><\/form>/);
    assert.ok(form, `${path}: a visible provider remains beside one-click entry`);
    assert.ok(html.indexOf('Sign in as Alex Morgan') < form.index, 'people come before providers');
    assert.equal(form[1], '/auth/oidc/auth/start');
    assert.equal(form[2], returnTo.replaceAll('&', '&amp;'));
    assert.match(response.headers.get('content-security-policy'), /form-action 'self' https:\/\/id\.example(?:;|$)/);
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin');
    const started = await r.call(form[1], { method: 'POST', form: true, headers, input: { returnTo: form[2].replaceAll('&amp;', '&') } });
    assert.equal(started.status, 303);
    const location = started.headers.get('location');
    assert.equal(new URL(location).origin, 'https://id.example');
    const granted = await r.call('/__fake/authorize', { method: 'POST', input: { location, claims: {} } });
    const { code, state } = await granted.json();
    const callback = new URL(new URL(location).searchParams.get('redirect_uri'));
    const signedIn = await r.call(`${callback.pathname}?code=${code}&state=${state}`, {
      cookie: started.headers.get('set-cookie').split(';')[0], headers,
    });
    assert.equal(signedIn.status, 303);
    assert.equal(signedIn.headers.get('location'), returnTo);
  }
});
