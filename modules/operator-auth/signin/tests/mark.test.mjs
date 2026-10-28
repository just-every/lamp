import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOperatorAuth } from '../../index.mjs';
import { runtime } from '../../identity/oidc/tests/fake-runtime.mjs';

test('sign-in serves the installation mark beside its name and refuses unsafe mark paths', async t => {
  const branding = { productName: 'Harbour <Teams> & Co', mark: '/brand/mark.svg' };
  const marked = await runtime(t, { providers: [], fakes: [], core: { branding } });
  const response = await marked.call('/signin');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<img[^>]*src="\/brand\/mark\.svg"[^>]*alt="Harbour &lt;Teams&gt; &amp; Co"[^>]*width="32"[^>]*height="32"[^>]*decoding="async"/);
  assert.match(html, /<span data-rer-name>Harbour &lt;Teams&gt; &amp; Co<\/span>/);
  assert.match(response.headers.get('content-security-policy'), /(?:^|;) img-src 'self'(?:;|$)/);

  const config = { origin: 'https://app.example', OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: 'test-only-branding-session-secret' };
  const create = mark => createOperatorAuth({ db: {}, clientIp: () => '192.0.2.1', config: { ...config, branding: { ...branding, mark } } });
  const presentation = create(branding.mark).presentation;
  assert.equal(presentation.mark, branding.mark);
  assert.ok(Object.isFrozen(presentation));
  for (const mark of [null, 1, '', 'https://other.example/mark.svg', 'javascript:alert(1)', '//other.example/mark.svg', '/\\other.example/mark.svg', '/brand/"mark.svg', "/brand/'mark.svg", '/brand/<mark>.svg', '/brand/mark\n.svg', '/brand/mark.svg\n', '/brand/%2fmark.svg', '/brand/../mark.svg', '/brand/' + 'a'.repeat(2048)]) {
    assert.throws(() => create(mark), { code: 'invalid_configuration', status: 503 });
  }
  const plain = await runtime(t, { providers: [], fakes: [], core: { branding: { productName: branding.productName } } });
  const unmarked = await plain.call('/signin');
  assert.equal(unmarked.status, 200);
  assert.doesNotMatch(await unmarked.text(), /<img/);
  assert.equal(Object.hasOwn(create(undefined).presentation, 'mark'), false);
});
