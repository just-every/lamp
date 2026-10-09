import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {verifyOriginalInventory} from '../../scripts/public-projections/input-inventory.mjs';

const archives = JSON.parse(fs.readFileSync('scripts/public-projections/plan.json')).archives;
const names = archives.map(entry => `${entry.originalKey}.json`);
function fixture(run, order = names) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'projection-inventory-'));
  const directory = path.join(temp, 'originals');
  fs.mkdirSync(directory, {mode: 0o700});
  for (const name of order) fs.writeFileSync(path.join(directory, name), 'Inventory fixture only.\n', {mode: 0o600});
  try { return run(directory, temp); }
  finally { fs.rmSync(temp, {recursive: true, force: true}); }
}

test('inventory accepts exactly four ordinary planned files regardless of creation or plan order', () => {
  assert.equal(names.length, 4);
  for (const order of [names, [...names].reverse(), [names[2], names[0], names[3], names[1]]]) {
    fixture(directory => {
      verifyOriginalInventory(directory, archives);
      verifyOriginalInventory(directory, [...archives].reverse());
    }, order);
  }
});

test('inventory rejects every missing planned file, including an empty store', () => {
  for (const name of names) fixture(directory => {
    fs.unlinkSync(path.join(directory, name));
    assert.throws(() => verifyOriginalInventory(directory, archives), /Missing file/);
  });
  fixture(directory => assert.throws(() => verifyOriginalInventory(directory, archives), /Missing file/), []);
});

test('inventory rejects extra archives, malformed filenames and same-count substitutions', () => {
  for (const name of ['0'.repeat(64) + '.json', 'archive.json', names[0] + '.bak', '.DS_Store', 'invalid\nname.json']) {
    fixture(directory => {
      fs.writeFileSync(path.join(directory, name), 'Unexpected input.\n');
      assert.throws(() => verifyOriginalInventory(directory, archives), /Unexpected filename/);
      fs.unlinkSync(path.join(directory, names[0]));
      assert.throws(() => verifyOriginalInventory(directory, archives), /Unexpected filename/);
    });
  }
  fixture(directory => {
    // Delete first so this control also changes the stored name on case-insensitive filesystems.
    fs.unlinkSync(path.join(directory, names[0]));
    fs.writeFileSync(path.join(directory, names[0].toUpperCase()), 'Unexpected input.\n');
    assert.throws(() => verifyOriginalInventory(directory, archives), /Unexpected filename/);
  });
});

test('inventory rejects directories under both planned and unexpected names', () => {
  for (const name of [names[0], 'nested']) fixture(directory => {
    if (names.includes(name)) fs.unlinkSync(path.join(directory, name));
    fs.mkdirSync(path.join(directory, name));
    assert.throws(() => verifyOriginalInventory(directory, archives), /only regular files/);
  });
  fixture(directory => assert.throws(() => verifyOriginalInventory(path.join(directory, names[0]), archives), /must be a directory/));
});

test('inventory rejects named pipes without trying to read them', () => {
  for (const name of [names[0], 'extra.json']) fixture(directory => {
    if (names.includes(name)) fs.unlinkSync(path.join(directory, name));
    execFileSync('mkfifo', [path.join(directory, name)]);
    assert.throws(() => verifyOriginalInventory(directory, archives), /only regular files/);
  });
});

test('inventory rejects planned and extra symlinks to files, directories and absent targets', () => {
  for (const name of [names[0], 'extra.json']) for (const target of [names[1], '.', 'absent.json']) fixture(directory => {
    if (names.includes(name)) fs.unlinkSync(path.join(directory, name));
    fs.symlinkSync(target, path.join(directory, name));
    assert.throws(() => verifyOriginalInventory(directory, archives), /Symlink/);
  });
});

test('inventory rejects linked directories and ancestors before path normalization', () => {
  fixture((directory, temp) => {
    fs.symlinkSync(directory, path.join(temp, 'linked-directory'));
    fs.symlinkSync(temp, path.join(temp, 'linked-ancestor'));
    fs.symlinkSync(path.join(temp, 'absent'), path.join(temp, 'dangling'));
    for (const supplied of [path.join(temp, 'linked-directory'), path.join(temp, 'linked-ancestor', 'originals'), path.join(temp, 'dangling'), path.join(temp, 'linked-directory') + '/../originals']) {
      assert.throws(() => verifyOriginalInventory(supplied, archives), /Symlink/);
    }
  });
});

test('inventory rejects duplicate and malformed planned keys without accepting fewer originals', () => {
  fixture(directory => {
    assert.throws(() => verifyOriginalInventory(directory, [...archives, archives[0]]), /duplicate/);
    for (const originalKey of ['../archive', 'archive', archives[0].originalKey.toUpperCase()]) {
      assert.throws(() => verifyOriginalInventory(directory, [{originalKey}, ...archives.slice(1)]), /Invalid/);
    }
  });
});

test('batch CLI validates the entire inventory before archive contents or output creation', () => {
  for (const [name, expected] of [[null, /Missing file/], ['extra.json', /Unexpected filename/], ['0'.repeat(64) + '.json', /Unexpected filename/]]) {
    fixture((directory, temp) => {
      if (name) fs.writeFileSync(path.join(directory, name), 'Unexpected input.\n');
      else fs.unlinkSync(path.join(directory, names.at(-1)));
      const output = path.join(temp, 'output');
      const result = spawnSync(process.execPath, ['scripts/public-projections/generate.mjs', directory, output], {encoding: 'utf8', timeout: 10000});
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expected);
      assert.equal(fs.lstatSync(output, {throwIfNoEntry: false}), undefined);
    });
  }
});
