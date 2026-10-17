import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';
import { keptSecrets, replacedSecrets, signingSecrets, withDeploymentSecrets } from '../../scripts/deployment-secrets.mjs';
import { database, load } from '../operator-readiness/runtime.mjs';

test('deployment secrets remain private and are removed after success or failure', async () => {
  const config = { sessionSecret:'synthetic-session-secret',setupToken:'synthetic-setup-token',mailProviderApiKey: 'test-provider-secret', subscriberTokenSecret: 'test-token-secret', webhookSigningSecret: 'test-signing-secret' };
  for (const fail of [false, true]) {
    let path;
    const action = withDeploymentSecrets(config, [], async file => {
      path = file;
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { SESSION_SECRET:config.sessionSecret,SETUP_TOKEN:config.setupToken,AUTH_PROVIDERS:"",MAIL_PROVIDER_API_KEY: config.mailProviderApiKey, MAIL_API_KEY: "", SUBSCRIBER_TOKEN_SECRET: config.subscriberTokenSecret, WEBHOOK_SIGNING_SECRET: config.webhookSigningSecret, RER_MAIL_RELAY_SECRET: "", RESEND_WEBHOOK_SECRET: "", AI_PROVIDER_API_KEY: "" });
      if (fail) throw new Error('test failure');
    });
    if (fail) await assert.rejects(action, /test failure/); else await action;
    await assert.rejects(access(path), /ENOENT/);
  }
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

// What rer hands a deploy when the owner's file has no signing secrets: a fresh
// random value for each, on every run (rer's deployEnvironment).
const generated = () => ({ sessionSecret: randomBytes(32).toString('hex'), setupToken: randomBytes(32).toString('hex'), subscriberTokenSecret: randomBytes(32).toString('hex'), webhookSigningSecret: randomBytes(32).toString('hex'), mailProviderApiKey: 'synthetic-provider-key' });

test('a redeploy as the guide says keeps subscriber links and operator sessions, keeps owner secrets and clears removed integrations', async t => {
  const dir = await mkdtemp(join(process.cwd(), '.lamp-redeploy-links-'));
  const { runtime, db } = await database(dir);
  t.after(async () => { await runtime.dispose(); await rm(dir, { recursive: true, force: true }); });
  const modules = await load('tests/auth-adoption/adapter.ts');
  // The Worker's secrets: a deploy writes what its secrets file names; Wrangler keeps the rest.
  const worker = {};
  // The owner's file carries OIDC_TRANSACTION_SECRET; a re-copied identity guide gives a new one each time.
  const deploy = (env = {}, oidc = randomBytes(32).toString('hex')) => withDeploymentSecrets({ ...generated(), oidcTransactionSecret: oidc }, keptSecrets(Object.keys(worker), replacedSecrets(env)), async file => Object.assign(worker, JSON.parse(await readFile(file, 'utf8'))));
  const messages = [];
  const pageFor = () => {
    const app = new Hono();
    modules.registerSubscriberRoutes(app, modules.createSubscribersService(modules.createSubscriberRepository(db), {
      tokenSecret: worker.SUBSCRIBER_TOKEN_SECRET, fromAddress: 'lamp@example.test',
      mail: { configured: true, async send(message) { messages.push(message); return { providerMessageId: `captured-${messages.length}` }; } },
    }));
    return app;
  };
  const link = (pattern) => messages.at(-1).text.match(pattern)[0];

  await deploy();
  const first = { ...worker };
  let page = pageFor();
  const subscribe = () => page.request('https://page.example.test/subscribe', { method: 'POST', body: new URLSearchParams({ email: 'reader@example.test' }) });
  assert.equal((await subscribe()).status, 202);
  const unsubscribe = link(/https:\/\/\S+\/unsubscribe\/\S+/u);
  assert.equal((await page.request(link(/https:\/\/\S+\/confirm-subscription\/\S+/u))).status, 200);
  assert.equal((await subscribe()).status, 202);
  const manage = link(/https:\/\/\S+\/manage\/\S+/u);

  // Redeploy with the same file: rer generates new values, and the Worker keeps its own.
  await deploy();
  page = pageFor();
  for (const name of signingSecrets) assert.equal(worker[name], first[name], `${name} survives a redeploy`);
  await deploy({}, undefined);
  assert.equal(worker.OIDC_TRANSACTION_SECRET, first.OIDC_TRANSACTION_SECRET, 'a file without it leaves the identity-provider secret as it is');
  assert.notEqual(worker.SETUP_TOKEN, first.SETUP_TOKEN, 'the one-time setup token is still replaced');
  assert.equal((await page.request(manage)).status, 200, 'an emailed Manage link still opens');
  assert.equal((await page.request(unsubscribe, { method: 'POST', body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }) })).status, 200, 'the RFC 8058 one-click POST still unsubscribes');

  // Replacing one on purpose is a named, deliberate act.
  await deploy({ LAMP_REPLACE_SECRETS: 'SESSION_SECRET' });
  assert.notEqual(worker.SESSION_SECRET, first.SESSION_SECRET);
  assert.equal(worker.SUBSCRIBER_TOKEN_SECRET, first.SUBSCRIBER_TOKEN_SECRET);
  await deploy({ RER_ROTATE_SECRETS: 'SUBSCRIBER_TOKEN_SECRET' });
  assert.notEqual(worker.SUBSCRIBER_TOKEN_SECRET, first.SUBSCRIBER_TOKEN_SECRET, 'rer deploy --rotate-secret reaches the pipeline');
  assert.equal(worker.OIDC_TRANSACTION_SECRET, first.OIDC_TRANSACTION_SECRET);
  assert.throws(() => replacedSecrets({ LAMP_REPLACE_SECRETS: 'SETUP_TOKEN' }), /takes only/);

  // Removed product integrations are cleared while unrelated owner secrets stay.
  const required = { mailProviderApiKey: 'required-mail', subscriberTokenSecret: 'required-token', webhookSigningSecret: 'required-signing' };
  const existing = { OWNER_PRIVATE_KEY: 'owner-value' };
  const apply = async config => withDeploymentSecrets(config, [], async file => Object.assign(existing, JSON.parse(await readFile(file, 'utf8'))));
  await apply({ ...required, mailApiKey: 'old-managed-mail', relaySecret: 'old-relay', resendWebhookSecret: 'old-resend', aiProviderApiKey: 'old-ai' });
  assert.equal(existing.RER_MAIL_RELAY_SECRET, 'old-relay');
  await apply(required);
  assert.equal(existing.OWNER_PRIVATE_KEY, 'owner-value');
  for (const name of ['MAIL_API_KEY', 'RER_MAIL_RELAY_SECRET', 'RESEND_WEBHOOK_SECRET', 'AI_PROVIDER_API_KEY']) assert.equal(existing[name], '');
});
