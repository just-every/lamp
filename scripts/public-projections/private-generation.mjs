// Authentic CLI checks only; private originals are never public test fixtures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash, json, git} from '../edition-authoring/files.mjs';
import {verifyOriginalInventory} from './input-inventory.mjs';
import {verifyProjections} from './verify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [privateStore, output] = process.argv.slice(2);
if (!privateStore || !output) throw Error('Usage: private-generation.mjs <private-original-directory> <new-private-report-directory>');
for (const directory of [privateStore, output]) {
  if (path.resolve(directory) === root || path.resolve(directory).startsWith(root + path.sep)) throw Error('Private inputs and evidence must be outside public source');
}
if (fs.lstatSync(output, {throwIfNoEntry: false})) throw Error('Private report directory must not exist');
const plan = JSON.parse(fs.readFileSync(path.join(root, 'scripts/public-projections/plan.json')));
const receipt = verifyProjections(root);
verifyOriginalInventory(privateStore, plan.archives);
const names = plan.archives.map(entry => `${entry.originalKey}.json`);
const originals = () => fs.readdirSync(privateStore).sort().map(name => {
  const filename = path.join(privateStore, name);
  return {name, sha256: hash(fs.readFileSync(filename)), mode: fs.lstatSync(filename).mode & 0o777};
});
const before = originals();
const report = {schemaVersion: 1, node: process.version, sourceCommit: git(root, 'rev-parse', 'HEAD'), sourceTree: git(root, 'write-tree'), lockSha256: hash(fs.readFileSync(path.join(root, 'sources.lock.json'))), recipeSha256: receipt.recipeSha256, originals: before, runs: []};
const oldUmask = process.umask(0o077);
fs.mkdirSync(output, {recursive: true, mode: 0o700});
const temp = fs.mkdtempSync(path.join(output, 'work-'));
function copy(order = names) {
  const directory = fs.mkdtempSync(path.join(temp, 'originals-'));
  for (const name of order) fs.copyFileSync(path.join(privateStore, name), path.join(directory, name));
  return directory;
}
function generate(label, directory, expectedError) {
  const destination = path.join(temp, 'result-' + report.runs.length);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/public-projections/generate.mjs'), directory, destination], {cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120000});
  const raw = (result.stdout || '') + (result.stderr || '');
  const log = `${String(report.runs.length + 1).padStart(3, '0')}-${label}.log`;
  fs.writeFileSync(path.join(output, log), raw, {mode: 0o600});
  const run = {label, status: result.status, signal: result.signal, log, logSha256: hash(raw), outputExists: !!fs.lstatSync(destination, {throwIfNoEntry: false})};
  report.runs.push(run);
  assert.equal(result.error, undefined, 'Generator must execute without a spawn error');
  assert.equal(result.signal, null);
  if (expectedError) {
    assert.notEqual(result.status, 0, `Generator accepted ${label}`);
    assert.match(raw, expectedError);
    assert.equal(run.outputExists, false, 'Rejected input must not create any output directory or files');
    return;
  }
  assert.equal(result.status, 0, `Generator rejected ${label}; inspect private log`);
  assert.deepEqual(fs.readdirSync(destination).sort(), ['receipt.json', 'sources']);
  assert.deepEqual(fs.readdirSync(path.join(destination, 'sources')).sort(), receipt.archives.map(entry => entry.key + '.json').sort());
  assert.deepEqual(fs.readFileSync(path.join(destination, 'receipt.json')), fs.readFileSync(path.join(root, 'scripts/public-projections/receipt.json')));
  run.archives = receipt.archives.map(entry => {
    const bytes = fs.readFileSync(path.join(destination, 'sources', entry.key + '.json'));
    assert.deepEqual(bytes, fs.readFileSync(path.join(root, '.edition/sources', entry.key + '.json')));
    assert.equal(hash(bytes), entry.sha256);
    return {key: entry.key, sha256: hash(bytes)};
  });
  run.receiptSha256 = hash(fs.readFileSync(path.join(destination, 'receipt.json')));
  fs.rmSync(destination, {recursive: true});
}
function reject(label, mutate, error) {
  const directory = copy();
  try { generate(label, mutate(directory) || directory, error); }
  finally { fs.rmSync(directory, {recursive: true, force: true}); }
}
try {
  generate('authentic-originals', privateStore);
  for (const [label, order] of [['reverse-order', [...names].reverse()], ['mixed-order', [names[2], names[0], names[3], names[1]]]]) {
    const directory = copy(order);
    try { generate(label, directory); } finally { fs.rmSync(directory, {recursive: true}); }
  }
  for (const [index, name] of names.entries()) reject(`missing-${index}`, directory => { fs.unlinkSync(path.join(directory, name)); }, /Missing file/);
  for (const [label, name] of [['extra-archive', '0'.repeat(64) + '.json'], ['malformed-filename', 'archive.json'], ['malformed-extension', names[0] + '.bak']]) {
    reject(label, directory => { fs.copyFileSync(path.join(directory, names[0]), path.join(directory, name)); }, /Unexpected filename/);
  }
  reject('same-count-substitution', directory => { fs.renameSync(path.join(directory, names[0]), path.join(directory, 'archive.json')); }, /Unexpected filename/);
  reject('uppercase-substitution', directory => { fs.unlinkSync(path.join(directory, names[0])); fs.copyFileSync(path.join(privateStore, names[0]), path.join(directory, names[0].toUpperCase())); }, /Unexpected filename/);
  for (const [label, name] of [['extra-directory', 'nested'], ['planned-directory', names[0]]]) {
    reject(label, directory => { if (names.includes(name)) fs.unlinkSync(path.join(directory, name)); fs.mkdirSync(path.join(directory, name)); }, /only regular files/);
  }
  for (const [label, name] of [['extra-pipe', 'extra.json'], ['planned-pipe', names[0]]]) {
    reject(label, directory => { if (names.includes(name)) fs.unlinkSync(path.join(directory, name)); execFileSync('mkfifo', [path.join(directory, name)]); }, /only regular files/);
  }
  for (const [label, name, target] of [['planned-file-link', names[0], path.join(privateStore, names[0])], ['planned-dangling-link', names[0], 'absent.json'], ['extra-file-link', 'extra.json', names[1]], ['extra-dangling-link', 'extra.json', 'absent.json'], ['extra-directory-link', 'extra.json', '.']]) {
    reject(label, directory => { if (names.includes(name)) fs.unlinkSync(path.join(directory, name)); fs.symlinkSync(target, path.join(directory, name)); }, /Symlink/);
  }
  for (const label of ['directory-link', 'ancestor-link', 'dangling-directory-link', 'link-before-parent-traversal']) {
    reject(label, directory => {
      const link = path.join(temp, label);
      fs.symlinkSync(label === 'ancestor-link' ? temp : label === 'dangling-directory-link' ? path.join(temp, 'absent') : directory, link);
      if (label === 'ancestor-link') return path.join(link, path.basename(directory));
      if (label === 'link-before-parent-traversal') return link + '/../' + path.basename(directory);
      return link;
    }, /Symlink/);
  }
  reject('corrupt-final-input', directory => { fs.appendFileSync(path.join(directory, names.at(-1)), '\n'); }, /Original archive digest mismatch/);
  verifyOriginalInventory(privateStore, plan.archives);
  assert.deepEqual(originals(), before, 'Authentic original filenames, modes and bytes must remain unchanged');
  report.ok = true;
} finally {
  fs.writeFileSync(path.join(output, 'receipt.json'), json(report), {mode: 0o600});
  fs.rmSync(temp, {recursive: true, force: true});
  process.umask(oldUmask);
}
console.log(json({ok: true, archives: names.length, successfulGenerations: report.runs.filter(run => run.status === 0).length, rejections: report.runs.filter(run => run.status !== 0).length}));
