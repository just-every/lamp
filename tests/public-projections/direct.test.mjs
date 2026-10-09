import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {snapshot, source} from '../../scripts/edition-authoring/sources.mjs';
import {hash, json, digest} from '../../scripts/edition-authoring/files.mjs';
import {verifyProjections} from '../../scripts/public-projections/verify.mjs';

const root = process.cwd();
const receipt = verifyProjections(root);
function store(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-projection-'));
  fs.mkdirSync(path.join(directory, '.edition/sources'), {recursive: true});
  for (const name of ['edition.json', 'sources.lock.json']) fs.copyFileSync(path.join(root, name), path.join(directory, name));
  for (const entry of receipt.archives) fs.copyFileSync(path.join(root, '.edition/sources', entry.key + '.json'), path.join(directory, '.edition/sources', entry.key + '.json'));
  try { run(directory); } finally { fs.rmSync(directory, {recursive: true, force: true}); }
}
const readers = [
  (directory, ref) => snapshot(directory, ref),
  (directory, ref) => snapshot(directory, ref, true),
  (directory, ref) => source(directory, ref),
  (directory, ref) => source(directory, ref, false, true),
  (directory, ref) => source(directory, ref, true, false),
  (directory, ref) => source(directory, ref, true, true),
];
function reject(directory, ref, pattern) {
  for (const read of readers) assert.throws(() => read(directory, ref), pattern);
}
function baseline(lock, selector) {
  return selector === 'parent' ? lock.parent : lock.components.find(component => component.id === selector).baseline;
}

test('direct snapshot and source accept every exact locked parent and component archive', () => {
  store(directory => {
    for (const entry of receipt.archives) {
      const expected = JSON.parse(fs.readFileSync(path.join(directory, '.edition/sources', entry.key + '.json')));
      for (const retain of [false, true]) {
        assert.deepEqual(snapshot(directory, entry.origin, retain), expected);
        for (const dev of [false, true]) assert.deepEqual(source(directory, entry.origin, dev, retain), expected.files);
      }
    }
  });
});

test('direct readers reject forged bytes, modes, additions and removals even with a valid recomputed member digest', () => {
  store(directory => {
    const lockBytes = fs.readFileSync(path.join(directory, 'sources.lock.json'));
    for (const entry of receipt.archives) {
      const filename = path.join(directory, '.edition/sources', entry.key + '.json');
      const originalBytes = fs.readFileSync(filename), original = JSON.parse(originalBytes);
      const member = Object.keys(original.files).find(name => /\.(?:mjs|ts)$/.test(name));
      assert.ok(member);
      const changes = [
        saved => { saved.files[member].data = Buffer.from('Unapproved member bytes.\n').toString('base64'); },
        saved => { saved.files[member].executable = !saved.files[member].executable; },
        saved => { saved.files['unapproved-addition.txt'] = {data: Buffer.from('Unapproved addition.\n').toString('base64'), executable: false}; },
        saved => { delete saved.files[member]; },
      ];
      for (const change of changes) {
        const forged = structuredClone(original); change(forged); forged.digest = digest(forged.files);
        assert.equal(forged.key, hash(json(forged.origin)));
        fs.writeFileSync(filename, json(forged));
        reject(directory, entry.origin, /artifact differs from source lock/);
        // Updating the claimed digest in the lock still cannot replace its exact artifact SHA.
        const lock = JSON.parse(lockBytes); baseline(lock, entry.selector).digest = forged.digest;
        fs.writeFileSync(path.join(directory, 'sources.lock.json'), json(lock));
        reject(directory, entry.origin, /artifact differs from source lock/);
        fs.writeFileSync(path.join(directory, 'sources.lock.json'), lockBytes);
      }
      fs.writeFileSync(filename, originalBytes);
    }
  });
});

test('direct readers bind raw serialization and all archive metadata, not just member digests', () => {
  store(directory => {
    for (const entry of receipt.archives) {
      const filename = path.join(directory, '.edition/sources', entry.key + '.json');
      const originalBytes = fs.readFileSync(filename), original = JSON.parse(originalBytes);
      fs.writeFileSync(filename, Buffer.concat([Buffer.from(' '), originalBytes]));
      reject(directory, entry.origin, /artifact differs from source lock/);
      const metadata = structuredClone(original); metadata.derivation.unapproved = true;
      fs.writeFileSync(filename, json(metadata));
      reject(directory, entry.origin, /artifact differs from source lock/);
      const invalidDigest = structuredClone(original); invalidDigest.digest = hash('invented member digest');
      fs.writeFileSync(filename, json(invalidDigest));
      reject(directory, entry.origin, /Corrupt retained source snapshot/);
      fs.writeFileSync(filename, originalBytes);
    }
  });
});

test('direct readers require an explicit lock binding and reject reselection of a forged recipe origin', () => {
  store(directory => {
    const lockPath = path.join(directory, 'sources.lock.json'), lockBytes = fs.readFileSync(lockPath);
    const editionPath = path.join(directory, 'edition.json'), editionBytes = fs.readFileSync(editionPath);
    fs.unlinkSync(lockPath);
    for (const entry of receipt.archives) reject(directory, entry.origin, /requires a selected source-lock binding/);
    fs.writeFileSync(lockPath, lockBytes);
    for (const entry of receipt.archives) {
      const lock = JSON.parse(lockBytes);
      if (entry.selector === 'parent') delete lock.parent;
      else delete lock.components.find(component => component.id === entry.selector).baseline;
      fs.writeFileSync(lockPath, json(lock));
      reject(directory, entry.origin, /artifact differs from source lock/);
      fs.writeFileSync(lockPath, lockBytes);
      const forged = JSON.parse(fs.readFileSync(path.join(directory, '.edition/sources', entry.key + '.json')));
      forged.origin.projection.recipeSha256 = hash('unapproved projection recipe');
      forged.key = hash(json(forged.origin));
      const filename = path.join(directory, '.edition/sources', forged.key + '.json');
      fs.writeFileSync(filename, json(forged));
      reject(directory, forged.origin, /not selected by this edition/);
      const edition = JSON.parse(editionBytes);
      const ref = entry.selector === 'parent' ? edition.parent : edition.components.find(component => component.id === entry.selector).source.origin;
      ref.projection = forged.origin.projection;
      fs.writeFileSync(editionPath, json(edition));
      reject(directory, forged.origin, /differs from source lock/);
      fs.writeFileSync(editionPath, editionBytes); fs.unlinkSync(filename);
    }
  });
});

test('a projected reference cannot bypass its immutable archive through development workspace flags', () => {
  store(directory => {
    for (const entry of receipt.archives) reject(directory, {...entry.origin, workspace: root}, /cannot select workspace source/);
  });
});
