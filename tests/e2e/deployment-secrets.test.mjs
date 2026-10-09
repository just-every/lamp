import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { withDeploymentSecrets } from '../../scripts/deployment-secrets.mjs';

test('deployment secrets remain private and are removed after success or failure', async () => {
  const config = { mailProviderApiKey: 'test-provider-secret', subscriberTokenSecret: 'test-token-secret', webhookSigningSecret: 'test-signing-secret' };
  for (const fail of [false, true]) {
    let path;
    const action = withDeploymentSecrets(config, async file => {
      path = file;
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { MAIL_PROVIDER_API_KEY: config.mailProviderApiKey, SUBSCRIBER_TOKEN_SECRET: config.subscriberTokenSecret, WEBHOOK_SIGNING_SECRET: config.webhookSigningSecret, RER_MAIL_RELAY_SECRET: "", RESEND_WEBHOOK_SECRET: "", AI_PROVIDER_API_KEY: "" });
      if (fail) throw new Error('test failure');
    });
    if (fail) await assert.rejects(action, /test failure/); else await action;
    await assert.rejects(access(path), /ENOENT/);
  }
});


test('redeploy clears removed product integrations but retains unrelated owner secrets', async () => {
  const required = { mailProviderApiKey: 'required-mail', subscriberTokenSecret: 'required-token', webhookSigningSecret: 'required-signing' };
  const existing = { OWNER_PRIVATE_KEY: 'owner-value' };
  const apply = async config => withDeploymentSecrets(config, async file => Object.assign(existing, JSON.parse(await readFile(file, 'utf8'))));
  await apply({ ...required, relaySecret: 'old-relay', resendWebhookSecret: 'old-resend', aiProviderApiKey: 'old-ai' });
  assert.equal(existing.RER_MAIL_RELAY_SECRET, 'old-relay');
  await apply(required);
  assert.equal(existing.OWNER_PRIVATE_KEY, 'owner-value');
  for (const name of ['RER_MAIL_RELAY_SECRET', 'RESEND_WEBHOOK_SECRET', 'AI_PROVIDER_API_KEY']) assert.equal(existing[name], '');
});

test('empty optional bindings disable runtime AI and relay instead of retaining stale configuration', async () => {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true } });
  try {
    const { createAppServices } = await vite.ssrLoadModule('/src/core/app/services.ts');
    const { handleSendGridEvents } = await vite.ssrLoadModule('/src/core/features/deliveries/sendgrid-events.ts');
    // No query is made during service composition; only configuration is checked.
    const bindings = { DB: {}, SNAPSHOT_CACHE: {}, MAIL_FROM_ADDRESS: 'test@example.test', MAIL_PROVIDER_API_KEY: '', AI_PROVIDER_API_KEY: '', RESEND_WEBHOOK_SECRET: '', RER_MAIL_RELAY_SECRET: '' };
    assert.doesNotThrow(() => createAppServices(bindings, {}));
    assert.throws(() => createAppServices({ ...bindings, AI_PROVIDER_API_KEY: 'stale-key' }, {}), /requires AI_PROVIDER_URL/);
    const response = await handleSendGridEvents(new Request('https://app.example.test/api/intake/mail-events', { method: 'POST', body: '[]' }), undefined, {}, '');
    assert.equal(response.status, 503);
  } finally { await vite.close(); }
});
