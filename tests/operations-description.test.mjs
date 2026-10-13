import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { describeOperations, inspectOperations } from '../scripts/operations.mjs';

test('operations describe resolves actual commands without runtime dependencies', async () => {
  const result = await describeOperations(process.cwd());
  const { project } = JSON.parse(await readFile('deploy.json', 'utf8'));
  assert.equal(result.project, project);
  assert.deepEqual(result.commands.deploy.argv, ['rer', 'deploy']);
});

test('operations check reports absent inputs and suppresses invalid values', async () => {
  const missing = await inspectOperations(process.cwd(), {});
  assert.equal(missing.ok, false);
  assert.ok(missing.missingEnvironment.includes('CLOUDFLARE_API_TOKEN'));
  const invalid = await inspectOperations(process.cwd(), { LAMP_PAGE_HOST: 'secret-invalid-host/path' });
  assert.equal(invalid.configuration, 'invalid');
  assert.ok(!JSON.stringify(invalid).includes('secret-invalid-host/path'));
  assert.equal(invalid.scope, 'local-inputs-only');
});

// Synthetic application configuration only; these commands must stop before
// invoking setup, verification, a build, or any provider operation.
const applicationEnvironment = {
  LAMP_PAGE_HOST: 'status.lamp.test', LAMP_APP_HOST: 'app.lamp.test',
  LAMP_PAGE_NAME: 'Lamp', LAMP_PAGE_TAGLINE: 'Service status',
  LAMP_PAGE_TIMEZONE: 'UTC', LAMP_ACCENT_COLOR: '#163C60',
  MAIL_FROM_ADDRESS: 'ops@example.test', SESSION_SECRET:'test-only-session-secret-'.repeat(3),SETUP_TOKEN:'test-only-setup-token-'.repeat(3),SETUP_OPERATOR_EMAIL: 'owner@example.test',
  MAIL_PROVIDER_API_KEY: 'test-mail-key-'.repeat(3),
  SUBSCRIBER_TOKEN_SECRET: 'test-subscriber-secret-'.repeat(2),
  WEBHOOK_SIGNING_SECRET: 'test-webhook-secret-'.repeat(2),
  MAIL_DKIM_SELECTOR: 'resend',
};

function deploy(args, env) {
  return spawnSync(process.execPath, ['scripts/deploy.mjs', ...args], {
    env: { ...env, ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}), PATH: '' },
    encoding: 'utf8', timeout: 10_000,
  });
}

test('deployment dry run reports missing native inputs and their sources without values', async () => {
  const descriptor = await describeOperations(process.cwd());
  const result = deploy(['--dry-run'], {
    ...applicationEnvironment, LAMP_PAGE_NAME: ' \t ', MAIL_PROVIDER_API_KEY: '',
    LAMP_PAGE_HOST: 'private-invalid-value/path',
  });
  assert.equal(result.status, 1);
  for (const name of ['LAMP_PAGE_NAME', 'MAIL_PROVIDER_API_KEY']) {
    assert.ok(result.stderr.includes(name));
    assert.ok(result.stderr.includes(descriptor.environmentSources[name]));
  }
  assert.ok(result.stderr.includes(descriptor.commands.deploy.argv.join(' ')));
  assert.ok(!result.stderr.includes('CLOUDFLARE_API_TOKEN'));
  assert.ok(!result.stderr.includes('private-invalid-value'));
  assert.ok(!result.stderr.includes(applicationEnvironment.SUBSCRIBER_TOKEN_SECRET));
  assert.equal(result.stdout, '');
});

test('deployment dry run still rejects invalid native configuration without provider credentials', () => {
  const result = deploy(['--dry-run'], { ...applicationEnvironment, LAMP_PAGE_HOST: 'private-invalid-value/path' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LAMP_PAGE_HOST/);
  assert.ok(!result.stderr.includes('CLOUDFLARE_API_TOKEN'));
  assert.ok(!result.stderr.includes('private-invalid-value'));
  assert.equal(result.stdout, '');
});

test('real deployment requires both Cloudflare authority inputs before verification', () => {
  for (const authority of [{}, { CLOUDFLARE_ACCOUNT_ID: 'test-account' }, { CLOUDFLARE_API_TOKEN: 'test-token' }]) {
    const result = deploy([], { ...applicationEnvironment, ...authority });
    assert.equal(result.status, 1);
    for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) {
      if (!authority[name]) assert.ok(result.stderr.includes(name));
    }
    assert.ok(!result.stderr.includes('test-account'));
    assert.ok(!result.stderr.includes('test-token'));
    assert.ok(!result.stderr.includes('pnpm run verify failed'));
    assert.equal(result.stdout, '');
  }
});
