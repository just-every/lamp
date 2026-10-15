import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { describeOperations, inspectOperations } from '../scripts/operations.mjs';

test("Operations discoverability and value-free missing-input diagnostics", async t => {
  t.diagnostic("operations describe resolves actual commands without runtime dependencies");
  await (async () => {
  const result = await describeOperations(process.cwd());
  const { project } = JSON.parse(await readFile('deploy.json', 'utf8'));
  assert.equal(result.project, project);
  assert.deepEqual(result.commands.deploy.argv, ['rer', 'deploy']);
})(t);
  t.diagnostic("operations check reports absent inputs and suppresses invalid values");
  await (async () => {
  const missing = await inspectOperations(process.cwd(), {});
  assert.equal(missing.ok, false);
  assert.ok(missing.missingEnvironment.includes('CLOUDFLARE_API_TOKEN'));
  const invalid = await inspectOperations(process.cwd(), { LAMP_PAGE_HOST: 'secret-invalid-host/path' });
  assert.equal(invalid.configuration, 'invalid');
  assert.ok(!JSON.stringify(invalid).includes('secret-invalid-host/path'));
  assert.equal(invalid.scope, 'local-inputs-only');
})(t);
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

test("Dry-run and deployment refuse missing authority or invalid native configuration", async t => {
  t.diagnostic("deployment dry run reports missing native inputs and their sources without values");
  await (async () => {
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
})(t);
  t.diagnostic("deployment dry run still rejects invalid native configuration without provider credentials");
  await (() => {
  const result = deploy(['--dry-run'], { ...applicationEnvironment, LAMP_PAGE_HOST: 'private-invalid-value/path' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LAMP_PAGE_HOST/);
  assert.ok(!result.stderr.includes('CLOUDFLARE_API_TOKEN'));
  assert.ok(!result.stderr.includes('private-invalid-value'));
  assert.equal(result.stdout, '');
})(t);
  t.diagnostic("real deployment requires both Cloudflare authority inputs before provisioning");
  await (() => {
  for (const authority of [{}, { CLOUDFLARE_ACCOUNT_ID: 'test-account' }, { CLOUDFLARE_API_TOKEN: 'test-token' }]) {
    const result = deploy([], { ...applicationEnvironment, ...authority });
    assert.equal(result.status, 1);
    for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) {
      if (!authority[name]) assert.ok(result.stderr.includes(name));
    }
    assert.ok(!result.stderr.includes('test-account'));
    assert.ok(!result.stderr.includes('test-token'));
    assert.doesNotMatch(result.stderr, /pnpm/);
    assert.equal(result.stdout, '');
  }
})(t);
});





// Exercise the real provisioning command, replacing only its DNS network edge.
// A passing sender reaches the authority check; absent authority prevents any
// provider request or resource mutation in this credential-free test.
test('setup accepts aligned DKIM without From-domain SPF and names missing sender records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lamp-sender-dns-'));
  const preload = join(directory, 'dns.mjs');
  try {
    await writeFile(preload, `import { promises as dns } from 'node:dns';
      dns.resolveTxt = async host => {
        if (host === 'example.test') throw Error('The visible From domain must not need SPF');
        if (host === 's1._domainkey.example.test') {
          if (process.env.DNS_CASE === 'missing-dkim') throw Object.assign(Error('missing'), { code: 'ENODATA' });
          return [['v=DKIM1; k=rsa; p=', process.env.DNS_CASE === 'revoked-dkim' ? '' : 'cHVibGljLWtleQ==']];
        }
        if (host === '_dmarc.example.test') {
          if (process.env.DNS_CASE === 'missing-dmarc') throw Object.assign(Error('missing'), { code: 'ENOTFOUND' });
          return [['v=DMARC1; p=none']];
        }
        throw Error('Unexpected DNS query');
      };`);
    for (const scenario of ['authenticated', 'missing-dkim', 'revoked-dkim', 'missing-dmarc']) {
      const result = spawnSync(process.execPath, ['--import', preload, 'scripts/setup.mjs'], {
        env: { ...applicationEnvironment, MAIL_PROVIDER: 'sendgrid', MAIL_DKIM_SELECTOR: 's1', DNS_CASE: scenario, PATH: '' },
        encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(result.status, 1);
      if (scenario === 'authenticated') {
        assert.match(result.stderr, /CLOUDFLARE_ACCOUNT_ID is required/);
      } else {
        assert.doesNotMatch(result.stderr, /CLOUDFLARE_ACCOUNT_ID/);
        assert.match(result.stderr, scenario === 'missing-dmarc' ? /TXT record at _dmarc\.example\.test.*v=DMARC1; p=none/ : /s1\._domainkey\.example\.test.*CNAME target/);
      }
      assert.equal(result.stdout, '');
      assert.ok(!result.stderr.includes(applicationEnvironment.MAIL_PROVIDER_API_KEY));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
