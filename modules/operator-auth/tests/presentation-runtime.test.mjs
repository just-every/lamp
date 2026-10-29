import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './runtime.mjs';
import { createOperatorAuth } from '../index.mjs';
import { securityHeaders } from '../http.mjs';
const post = (input, cookie) => ({ method: 'POST', input, cookie });

test('real D1 preview and multipart mail preserve expiry, branding and single-use semantics', async () => {
  const r = await runtime({ branding: { productName: 'A <B> & Friends', accentColor: '#ffffff', signInPath: '/signin' }, linkSeconds: 1200, invitationSeconds: 1200 });
  try {
    const owner = await r.bootstrap();
    for (const kind of ['magic', 'invite']) {
      assert.equal((await r.call(kind === 'magic' ? '/auth/magic-link' : '/auth/invite', post(kind === 'magic' ? { email: 'owner@example.com' } : { email: 'join@example.com', displayName: 'Join' }, owner))).status, 202);
      const link = await r.link();
      const token = link.searchParams.get('token');
      const message = (await r.mails()).at(-1);
      assert.equal(message.subject, kind === 'invite' ? "You're invited to A <B> & Friends" : 'Your sign-in link for A <B> & Friends');
      assert.ok(!message.subject.includes(token));
      for (const part of [message.text, message.html]) {
        assert.equal(part.split(token).length - 1, 1);
        assert.equal((part.match(/https?:\/\//g) ?? []).length, 1);
        assert.match(part, /This link works once and expires in 20 minutes\./);
      }
      assert.equal((message.html.match(/<a /g) ?? []).length, 1);
      assert.match(message.html, /A &lt;B&gt; &amp; Friends/);
      assert.ok(!message.html.includes('A <B> & Friends'), 'HTML never contains the raw product name');
      assert.ok(message.html.includes(`<h1>${kind === 'invite' ? 'Accept your invitation to' : 'Confirm sign-in to'} A &lt;B&gt; &amp; Friends</h1>`), 'mail heading escapes the product name');
      assert.match(message.html, />Confirm<\/a>/);
      for (const part of [message.text, message.html]) {
        assert.ok(part.includes(`Open this link to review and confirm. On the confirmation page, press Confirm to ${kind === 'invite' ? 'accept your invitation to' : 'sign in to'}`));
      }
      assert.match(message.html, /<body style="margin:0;font-family:Arial,sans-serif;background:#fff;color:#172033"><main style="max-width:480px;margin:0 auto;padding:32px 24px">/);
      assert.doesNotMatch(message.html, /<script|<img|<link|<iframe|url\s*\(|@import/i);
      assert.match(message.html, /background:#ffffff;color:#000000/);
      const db = await r.db;
      await db.prepare('UPDATE oa_tokens SET expires_at=? WHERE consumed_at IS NULL').bind(Date.now() + 90000).run();
      const auth = createOperatorAuth({ db, config: r.config, clientIp: () => '192.0.2.1' });
      const metadata = await auth.previewLink(new Request(link), token);
      assert.deepEqual(metadata, { kind, expiresInMinutes: 2 }, 'preview exposes no credentials, identity or authority metadata');
      const before = (await db.prepare('SELECT * FROM oa_tokens').all()).results;
      const preview = await r.call(`${link.pathname}${link.search}`);
      assert.equal(preview.status, 200);
      assert.match(await preview.text(), /This link works once and expires in 2 minutes\./);
      assert.deepEqual((await db.prepare('SELECT * FROM oa_tokens').all()).results, before);
      await db.prepare('UPDATE oa_tokens SET expires_at=? WHERE consumed_at IS NULL').bind(Date.now() - 1).run();
      for (const method of ['GET', 'HEAD']) {
        const expired = await r.call(`${link.pathname}${link.search}`, { method });
        assert.equal(expired.status, 400);
        assert.equal(expired.headers.get('set-cookie'), null);
        assert.equal(expired.headers.get('referrer-policy'), 'no-referrer');
        if (method === 'GET') assert.match(await expired.text(), /href="\/signin">Request a new link/);
      }
      const failed = await r.call('/auth/confirm', post({ token }));
      assert.equal(failed.status, 400);
      assert.equal(failed.headers.get('content-security-policy'), securityHeaders()['Content-Security-Policy']);
    }
  } finally { await r.close(); }
});
