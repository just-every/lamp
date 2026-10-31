import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { validateImporters } from '../../../modules/import-kit/src/status/index.ts';

const execute = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const command = args => execute(process.execPath, ['--experimental-strip-types', ...args], {
  cwd: process.cwd(), timeout: 240_000, maxBuffer: 2 * 1024 * 1024,
});

/** Folded into the Sorry owner journey: both new commands cross their public
 * command doors, and all Lamp application behavior runs in its native runtime. */
export async function sorryReceiptFlow() {
  // This is also the main-FAIL signal when the folded assertions run on main.
  await access('scripts/sorry-receipt.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'lamp-sorry-receipt-test-'));
  try {
    const capture = join(directory, 'capture'), output = join(directory, 'verified');
    const keyFile = join(directory, 'test-signing.pem');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    await writeFile(keyFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    await command(['--import', resolve('tests/e2e/helpers/sorry-public-edge.mjs'),
      'scripts/sorry-capture.mjs', '--public-url', 'https://status.example.test', '--out', capture]);
    const original = new Map();
    for (const name of await readdir('tests/fixtures/sorry/public')) {
      const expected = await readFile(join('tests/fixtures/sorry/public', name));
      const captured = await readFile(join(capture, name));
      assert.deepEqual(captured, expected, 'capture retains original Sorry bytes');
      original.set(name, sha256(captured));
    }
    await command(['scripts/sorry-receipt.mjs', '--capture', capture, '--key-file', keyFile, '--out', output]);
    const receiptBytes = await readFile(join(output, 'receipt.json'));
    const researchBytes = await readFile(join(output, 'research.md'));
    const receipt = JSON.parse(receiptBytes);
    const receiptLink = 'evidence:sorry-test/receipt.json', researchLink = 'evidence:sorry-test/research.md';
    const document = bytes => ({
      $schema: './schema/importers.schema.json', schemaVersion: 1,
      importers: [{ incumbent: receipt.payload.incumbent, product: receipt.payload.product, status: 'verified', evidence: {
        link: receiptLink, sha256: sha256(bytes), size: bytes.length,
        research: { link: researchLink, sha256: sha256(researchBytes), size: researchBytes.length },
      } }],
    });
    const publicPem = publicKey.export({ format: 'pem', type: 'spki' });
    const verify = (bytes, pinned) => validateImporters(document(bytes), {
      trustedHosts: [], receiptPublicKeys: pinned,
      resolve: link => ({ url: link, bytes: link === receiptLink ? bytes : researchBytes }),
    });
    const trusted = { 'lamp-test-20261030': publicPem };
    const accepted = await verify(receiptBytes, trusted);
    assert.equal(accepted.valid, true, JSON.stringify(accepted.issues));
    assert.equal(accepted.evidence.verifiedReceipts, 1);
    assert.equal(receipt.keyId, 'lamp-test-20261030');
    assert.deepEqual(receipt.payload.runs.dryRun, receipt.payload.runs.apply, 'reviewed counts match applied counts');
    for (const comparison of Object.values(receipt.payload.reconciliation)) {
      assert.equal(comparison.sourceCount, comparison.targetCount);
      assert.equal(comparison.sourceManifestSha256, comparison.targetManifestSha256);
    }
    for (const [name, hash] of original) assert.equal(sha256(await readFile(join(capture, name))), hash, 'receipt leaves the capture unchanged');

    // Change exactly one payload byte while updating the outer artifact hash,
    // so the pinned signature, rather than the transport digest, must refuse it.
    const changed = Buffer.from(receiptBytes);
    const marker = Buffer.from(JSON.stringify(receipt.payload.command));
    const markerAt = changed.indexOf(marker);
    assert.ok(markerAt >= 0 && marker.length > 2);
    changed[markerAt + 1] = changed[markerAt + 1] === 110 ? 111 : 110;
    assert.equal(changed.reduce((count, byte, index) => count + Number(byte !== receiptBytes[index]), 0), 1);
    JSON.parse(changed);
    const tampered = await verify(changed, trusted);
    assert.equal(tampered.valid, false);
    assert.ok(tampered.issues.some(issue => issue.code === 'RECEIPT_SIGNATURE_INVALID'));
    const otherKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' });
    const wrongKey = await verify(receiptBytes, { 'lamp-test-20261030': otherKey });
    assert.equal(wrongKey.valid, false);
    assert.ok(wrongKey.issues.some(issue => issue.code === 'RECEIPT_SIGNATURE_INVALID'));
    // Environments are consumer trust stores: the vendored schema has no
    // environment field. The production store never trusts this run's test key.
    const production = await verify(receiptBytes, {});
    assert.equal(production.valid, false);
    assert.ok(production.issues.some(issue => issue.code === 'RECEIPT_KEY_UNTRUSTED'));

    const incomplete = join(directory, 'incomplete'), refused = join(directory, 'refused');
    await cp(capture, incomplete, { recursive: true });
    await rm(join(incomplete, 'sorry-notice-100.json'));
    await assert.rejects(command(['scripts/sorry-receipt.mjs', '--capture', incomplete, '--key-file', keyFile, '--out', refused]), error => error.code === 1);
    await assert.rejects(access(join(refused, 'receipt.json')), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
