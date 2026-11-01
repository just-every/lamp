#!/usr/bin/env node
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, realpath, mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../modules/import-kit/src/status/encoding.ts';
import { validateImporters } from '../modules/import-kit/src/status/index.ts';
import { openReceiptInstall } from './sorry-receipt/runtime.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checkout = await realpath(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(checkout);
const issuer = 'lamp-test-20261030';
const help = `Verify a public Sorry capture in an empty disposable Lamp test installation.

  pnpm sorry:receipt --capture /unchanged/capture --key-file /private/test.pem --out /new/output

The capture's request metadata is read from /unchanged/capture.metadata.json,
beside the folder. Build this candidate first with pnpm build. Both directories and the Ed25519
PKCS8 PEM private key must be outside the checkout; the key must be an owned,
regular 0600 file. No key value is accepted in arguments or environment.
Only test-environment receipts are issued. Keep its public key in the consumer's
test trust store; production must use its own independent issuer trust store.
`;

function outside(path) {
  const part = relative(checkout, path);
  assert.ok(part && (part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)), 'Save private inputs and receipt output outside the checkout.');
  return path;
}
async function newOutput(path) {
  const full = resolve(path);
  const target = outside(resolve(await realpath(dirname(full)), basename(full)));
  await assert.rejects(lstat(target), { code: 'ENOENT' }, 'Choose a new output directory.');
  return target;
}
async function signingKey(path) {
  outside(await realpath(path));
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await fd.stat();
    assert.ok(info.isFile() && (info.mode & 0o777) === 0o600 && info.size < 4096
      && (!process.getuid || info.uid === process.getuid()), 'Use an owned regular 0600 private key file.');
    const key = createPrivateKey(await fd.readFile());
    assert.equal(key.asymmetricKeyType, 'ed25519', 'Use an Ed25519 test key.');
    return key;
  } finally { await fd.close(); }
}
async function capture(path) {
  const directory = outside(await realpath(path));
  const metadata = JSON.parse(await readFile(`${directory}.metadata.json`, 'utf8'));
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.mode, 'public');
  assert.equal(metadata.format, 'sorry-public-v1-saved-responses');
  assert.ok(Number.isFinite(Date.parse(metadata.capturedAt)), 'Capture has no recorded capture instant.');
  const origin = new URL(metadata.origin);
  assert.ok(origin.protocol === 'https:' && origin.origin === metadata.origin && !origin.username && !origin.password);
  assert.ok(Array.isArray(metadata.files) && metadata.files.length > 0 && metadata.files.length <= 200);
  const names = metadata.files.map(file => file.name).sort();
  assert.deepEqual((await readdir(directory)).sort(), names, 'Capture files are incomplete or unexpected.');
  assert.equal(new Set(names).size, names.length);
  const files = [];
  let size = 0;
  for (const name of names) {
    assert.match(name, /^sorry-[A-Za-z0-9_-]+\.json$/);
    const path = resolve(directory, name), info = await lstat(path);
    assert.ok(info.isFile() && !info.isSymbolicLink());
    const bytes = await readFile(path), saved = metadata.files.find(file => file.name === name);
    assert.equal(hash(bytes), saved.sha256, 'Capture bytes changed.');
    assert.equal(bytes.length, saved.size, 'Capture size changed.');
    size += bytes.length;
    assert.ok(size <= 8 * 1024 * 1024);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    JSON.parse(text);
    files.push({ name, text });
  }
  assert.ok(names.includes('sorry-status.json') && !names.some(name => name.startsWith('sorry-subscribers')));
  const status = JSON.parse(files.find(file => file.name === 'sorry-status.json').text);
  assert.ok(Array.isArray(metadata.requests) && metadata.requests.length === files.length);
  assert.ok(metadata.requests.every(request => request.method === 'GET' && request.status === 200 && /^\/api\/v1\/(?:status|components|notices)(?:\/\d+|\?page=\d+)?$/.test(request.path)));
  const upload = { source: 'sorry', files, pageId: String(status.page.id ?? ''), publicAccessAcknowledged: true, publicUrl: metadata.origin };
  const bytes = Buffer.from(JSON.stringify(upload));
  const components = files.filter(file => /^sorry-components(?:-\d+)?\.json$/.test(file.name)).flatMap(file => JSON.parse(file.text).components);
  const notices = files.filter(file => /^sorry-notices(?:-\d+)?\.json$/.test(file.name)).flatMap(file => JSON.parse(file.text).notices);
  const sourceCounts = { group: new Set(components.flatMap(row => row.parent_id == null ? [] : [String(row.parent_id)])).size,
    component: components.length, incident: notices.filter(row => row.type !== 'planned').length,
    maintenance: notices.filter(row => row.type === 'planned').length,
    updates: notices.reduce((count, row) => count + JSON.parse(files.find(file => file.name === `sorry-notice-${row.id}.json`)?.text ?? 'null')?.notice?.updates?.length, 0) };
  assert.ok(Object.values(sourceCounts).every(Number.isSafeInteger), 'Every notice needs its original complete detail.');
  return { metadata, bytes, sourceCounts };
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(help); return; }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(['--capture', '--key-file', '--out'].includes(args[i]) && !options[args[i]] && args[i + 1] && !args[i + 1].startsWith('--'), 'Use --help for receipt options.');
    options[args[i]] = args[i + 1];
  }
  assert.equal(Object.keys(options).length, 3, 'Supply --capture, --key-file and --out.');
  const out = await newOutput(options['--out']);
  const capturePath = await realpath(options['--capture']);
  const outputWithinCapture = relative(capturePath, out);
  assert.ok(outputWithinCapture === '..' || outputWithinCapture.startsWith(`..${sep}`) || isAbsolute(outputWithinCapture), 'Receipt output must be outside the unchanged capture.');
  const input = await capture(options['--capture']);
  const privateKey = await signingKey(options['--key-file']);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: checkout }).trim();
  const install = await openReceiptInstall();
  const owner = install.request;
  const door = (action, body) => owner(`/api/operator/import/${action}`, body, 'POST', { 'X-Import-Source': 'sorry' });
  const snapshot = () => Promise.all(['/api/app/components', '/api/app/incidents', '/api/app/maintenance', '/api/app/subscribers'].map(path => owner(path)));
  let plan, applied = false, undone = false;
  try {
    const initial = await snapshot();
    let uploadId;
    const totalChunks = Math.ceil(input.bytes.length / 65536);
    for (let index = 0; index < totalChunks; index++) {
      const chunk = input.bytes.subarray(index * 65536, (index + 1) * 65536);
      const upload = await door('uploads', { ...(uploadId ? { uploadId } : {}), name: 'sorry-public.json',
        bundleSha256: hash(input.bytes), totalBytes: input.bytes.length, totalChunks, index, chunkSha256: hash(chunk), base64: chunk.toString('base64') });
      uploadId = upload.uploadId;
    }
    plan = await door('plan', { uploadId });
    assert.ok(plan.planId && plan.fingerprint && plan.counts, 'Door plan is incomplete.');
    assert.deepEqual(await snapshot(), initial, 'Planning changed native records.');
    async function until(action) {
      for (let round = 0; round < 1000; round++) {
        const result = await door(action, { planId: plan.planId, ...(action === 'apply' ? { reviewedFingerprint: plan.fingerprint } : {}) });
        if (result.job?.state === (action === 'apply' ? 'completed' : 'undone')) return result;
        assert.ok(['queued', 'applying', 'undoing'].includes(result.job?.state), 'Import action did not complete.');
      }
      throw new Error('Import action exceeded its bounded steps.');
    }
    applied = true;
    const result = await until('apply');
    const reconciled = await door('reconcile', { planId: plan.planId });
    assert.equal(reconciled.ok, true, 'Native reconciliation found unexplained differences.');
    const evidence = await owner(`/api/app/statuspage-import/jobs/${result.job.id}/verification`);
    assert.equal(evidence.unexplainedDifferences, 0, 'Source/native evidence differs.');
    assert.deepEqual(evidence.sourceCounts, evidence.nativeCounts, 'Source/native entity counts differ.');
    assert.deepEqual(input.sourceCounts, evidence.nativeCounts, 'Original source/native entity or update counts differ.');
    assert.deepEqual(plan.counts, evidence.counts, 'Applied counts differ from the reviewed plan.');
    assert.equal(evidence.counts.rejected, 0, 'Source rows were rejected.');
    assert.deepEqual(evidence.notifications, { outbox: 0, deliveries: 0, invitations: 0 }, 'Import created notification activity.');
    const undo = await until('undo');
    undone = true;
    assert.deepEqual(await snapshot(), initial, 'Undo did not restore the initial native state.');
    const publicKey = createPublicKey(privateKey).export({ format: 'pem', type: 'spki' });
    const now = new Date().toISOString();
    const research = `# Sorry public capture verification\n\nTest-environment key, not a production-trusted issuer. Public Sorry source; no subscribers.\n\nEnvironment: test. The environment boundary is the consumer's independent issuer key store; the vendored schema has no environment field. Production must not pin this test key.\n\nInput: sha256 ${hash(input.bytes)}, ${input.bytes.length} bytes (exact uploaded JSON envelope of unchanged response text, sorted by filename).\nOrigin: ${input.metadata.origin}\nCaptured at: ${input.metadata.capturedAt}\nFormat: ${input.metadata.format}\nCandidate and adapter revision: ${revision}\nMapping SHA-256: ${evidence.mapping.policySha256}\n\nSource/native counts (updates are nested native timeline rows):\n\n\`\`\`json\n${JSON.stringify({ source: input.sourceCounts, native: evidence.nativeCounts }, null, 2)}\n\`\`\`\n\nDry-run and apply accounting (includes one source metadata effect):\n\n\`\`\`json\n${JSON.stringify(evidence.counts, null, 2)}\n\`\`\`\n\nMapping policy:\n\n${evidence.mapping.policy}\n\nUnmapped / not carried: every door explanation below is a named loss; raw source responses are not published. Public capture has no subscriber export, invitations, private notices, RSS/Atom archive or production cutover proof.\n\n\`\`\`json\n${JSON.stringify({ unmapped: evidence.unmapped, explanations: reconciled.sourceIds.filter(row => row.reason).map(({ kind, sourceId, reason }) => ({ kind, sourceId, reason })) }, null, 2)}\n\`\`\`\n\nSource/native manifest comparison with independently read provenance (sorted hashed descriptors, no source text):\n\n\`\`\`json\n${JSON.stringify({ reconciliation: evidence.reconciliation, manifests: evidence.manifests, differences: evidence.differences, unexplainedDifferences: evidence.unexplainedDifferences }, null, 2)}\n\`\`\`\n\nNotification activity: ${JSON.stringify(evidence.notifications)}.\n\nUndo: ${undo.job.state}; initial native state restored exactly through owner HTTP reads. Plan wrote zero native records; apply used the exact reviewed fingerprint. No subscriber data was supplied and no invitations were requested.\n\nCapture request list (${input.metadata.requests.length} GETs; ${input.metadata.elapsedMs} ms; no retries):\n\n${input.metadata.requests.map(row => `- GET ${row.path} -> ${row.status}`).join('\n')}\n\nTest public key, keyId ${issuer}:\n\n\`\`\`text\n${publicKey}\`\`\`\n`;
    const payload = {
      incumbent: 'Sorry', product: 'Lamp', synthetic: false,
      source: { classification: 'authorized-real-export', origin: input.metadata.origin, exportedAt: input.metadata.capturedAt,
        format: input.metadata.format, version: '1', sha256: hash(input.bytes), size: input.bytes.length },
      candidate: { repository: 'https://github.com/just-every/run-lamp', revision },
      adapter: { repository: 'https://github.com/just-every/run-lamp', revision },
      mapping: evidence.mapping, command: 'pnpm sorry:receipt --capture CAPTURE --key-file PRIVATE_FILE --out NEW_OUTPUT',
      runs: { dryRun: plan.counts, apply: evidence.counts }, reconciliation: evidence.reconciliation, unmapped: evidence.unmapped,
      research: { state: 'finished', sha256: hash(research) }, review: { reviewer: 'lamp-test-receipt-command', reviewedAt: now, result: 'passed' },
    };
    const receipt = { schemaVersion: 1, type: 'runeditrun.importer-verification-receipt', keyId: issuer, algorithm: 'Ed25519', payload,
      signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64') };
    const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n'), researchBytes = Buffer.from(research);
    const document = { $schema: './schema/importers.schema.json', schemaVersion: 1, importers: [{ incumbent: 'Sorry', product: 'Lamp', status: 'verified', evidence: {
      link: 'evidence:receipt.json', sha256: hash(receiptBytes), size: receiptBytes.length,
      research: { link: 'evidence:research.md', sha256: hash(researchBytes), size: researchBytes.length },
    } }] };
    const verified = await validateImporters(document, { trustedHosts: [], receiptPublicKeys: { [issuer]: publicKey },
      resolve: link => ({ url: link, bytes: link === 'evidence:receipt.json' ? receiptBytes : researchBytes }) });
    assert.equal(verified.valid, true, `Vendored receipt validation refused: ${verified.issues.map(issue => issue.code).join(',')}`);
    // Re-read every file before publication: the input directory remains unchanged.
    assert.deepEqual(await capture(options['--capture']), input);
    await mkdir(out, { mode: 0o700 });
    try {
      await writeFile(resolve(out, 'research.md'), researchBytes, { flag: 'wx', mode: 0o600 });
      await writeFile(resolve(out, 'receipt.json'), receiptBytes, { flag: 'wx', mode: 0o600 });
    } catch (error) { await rm(out, { recursive: true, force: true }); throw error; }
    process.stdout.write(JSON.stringify({ inputSha256: hash(input.bytes), inputSize: input.bytes.length, revision,
      source: input.sourceCounts, native: evidence.nativeCounts, unexplainedDifferences: 0, undo: undo.job.state, verifier: verified.valid }) + '\n');
  } finally {
    if (applied && !undone && plan) {
      // A refused comparison never leaves a reusable installation or a receipt.
      try { for (let i = 0; i < 1000; i++) if ((await door('undo', { planId: plan.planId })).job?.state === 'undone') break; } catch { /* Dispose the whole test installation below. */ }
    }
    await install.close();
  }
}

main(process.argv.slice(2)).catch(error => {
  // Never echo provider content, private material, argv or process environment.
  const safe = error instanceof assert.AssertionError ? error.message.split('\n')[0] :
    /^Lamp |^Disposable |^Source\/native |^Import action/.test(error.message) ? error.message : 'Receipt verification failed; no receipt was issued. Check build, capture integrity and local runtime.';
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
});
