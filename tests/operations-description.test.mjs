import assert from 'node:assert/strict';
import test from 'node:test';
import { describeOperations, inspectOperations } from '../scripts/operations.mjs';

test('operations describe resolves actual commands without runtime dependencies', async () => {
  const result = await describeOperations(process.cwd());
  assert.equal(result.edition, 'just-every/lamp');
  assert.deepEqual(result.commands.deploy.argv, ['pnpm', 'run', 'deploy']);
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
