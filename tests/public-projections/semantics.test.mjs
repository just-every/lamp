import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {hash} from '../../scripts/edition-authoring/files.mjs';
import {projectFile} from '../../scripts/public-projections/archive.mjs';
import {verifyProjections} from '../../scripts/public-projections/verify.mjs';

const erasureIdentifiers = [
  '`deleted-${operatorId.toLowerCase()}@operator.invalid`',
  "'deleted-' || lower(${operators.id}) || '@operator.invalid'",
];
function edit(bytes, start, end, replacement, reason) {
  return {originalSha256: hash(bytes), edits: [{start, end, originalSha256: hash(bytes.subarray(start, end)), replacement: Buffer.from(replacement).toString('base64'), reason}]};
}
function parent() {
  const receipt = verifyProjections(process.cwd()).archives.find(entry => entry.selector === 'parent');
  const archive = JSON.parse(fs.readFileSync(`.edition/sources/${receipt.key}.json`));
  return {receipt, archive, bytes: name => Buffer.from(archive.files[name].data, 'base64')};
}

test('projection protects only the exact erasure identifier and SQL predicate while email edits remain available', () => {
  for (const identifier of erasureIdentifiers) {
    const bytes = Buffer.from(identifier + '\n"person@private.invalid"\n');
    const domain = bytes.indexOf('operator.invalid');
    assert.throws(() => projectFile(bytes, edit(bytes, domain, domain + 16, 'example.test')), /operator-erasure machine identifier/);
    const prefix = bytes.indexOf('deleted-');
    assert.throws(() => projectFile(bytes, edit(bytes, prefix, prefix + 7, 'removed-')), /operator-erasure machine identifier/);
    const email = bytes.indexOf('person@');
    const result = projectFile(bytes, edit(bytes, email, bytes.indexOf('"', email), 'person@example.test'));
    assert.ok(result.toString().startsWith(identifier));
    assert.ok(result.includes('person@example.test'));
  }
});

test('retained parent preserves the complete erasure repository and its unchanged assertion', () => {
  const {receipt, bytes} = parent();
  const name = 'src/core/features/session/repository.ts';
  const member = receipt.members.find(member => member.path === name);
  assert.equal(member.originalSha256, member.projectedSha256);
  for (const identifier of erasureIdentifiers) assert.ok(bytes(name).includes(identifier));
  assert.ok(bytes('tests/e2e/delivery-contract.test.mjs').includes('operator\\.invalid'));
  const plan = JSON.parse(fs.readFileSync('scripts/public-projections/plan.json'));
  assert.equal(plan.archives.find(entry => entry.selector === 'parent').members[name], undefined);
});

test('32-byte synthetic edits reject shortening or extension before producing transformed bytes', () => {
  const bytes = Buffer.from('x'.repeat(32));
  for (const length of [30, 31, 33]) {
    assert.throws(() => projectFile(bytes, edit(bytes, 0, 32, 'y'.repeat(length), 'synthetic test value, never a credential')), /32-byte credential validation boundary/);
  }
  assert.equal(projectFile(bytes, edit(bytes, 0, 32, 'y'.repeat(32), 'synthetic test value, never a credential')).length, 32);
});

test('actual archived deployment fixtures meet the unchanged validator at exactly 32 characters', async () => {
  const {receipt, bytes} = parent();
  const validator = 'scripts/ops-config.mjs';
  const member = receipt.members.find(member => member.path === validator);
  assert.equal(member.originalSha256, member.projectedSha256);
  const fixture = bytes('tests/e2e/deployment-artifact.test.mjs').toString();
  const declarations = [...fixture.matchAll(/const deploymentEnvironment = (\{[\s\S]*?\n\});/g)];
  assert.equal(declarations.length, 1);
  // Evaluate the actual archived declarative fixture, without importing its build/browser tests.
  const environment = runInNewContext(`(${declarations[0][1]})`, Object.create(null), {timeout: 1000});
  const fields = ['MAIL_PROVIDER_API_KEY', 'SUBSCRIBER_TOKEN_SECRET', 'WEBHOOK_SIGNING_SECRET'];
  assert.equal(new Set(fields.map(field => environment[field])).size, 2);
  assert.ok(environment.MAIL_PROVIDER_API_KEY !== environment.SUBSCRIBER_TOKEN_SECRET);
  assert.ok(environment.SUBSCRIBER_TOKEN_SECRET === environment.WEBHOOK_SIGNING_SECRET);
  for (const field of fields) {
    assert.equal(environment[field].length, 32);
    assert.ok(/^fixture-synthetic-[a-f0-9]{14}$/.test(environment[field]), 'Expected the reviewed synthetic format');
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'projection-validator-'));
  try {
    const filename = path.join(temp, 'ops-config.mjs');
    fs.writeFileSync(filename, bytes(validator));
    const {deploymentConfig} = await import(pathToFileURL(filename).href);
    assert.doesNotThrow(() => deploymentConfig(environment, 'staging'));
    for (const field of fields) {
      assert.throws(() => deploymentConfig({...environment, [field]: environment[field].slice(0, 31)}, 'staging'), new RegExp(field + ' must contain at least 32 characters'));
      assert.doesNotThrow(() => deploymentConfig({...environment, [field]: environment[field] + 'x'}, 'staging'));
    }
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});
