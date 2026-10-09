import fs from 'node:fs';
import path from 'node:path';
import {noLinks} from '../edition-authoring/files.mjs';

export function verifyOriginalInventory(directory, archives) {
  // Inspect the supplied path before resolving '..', including dangling links.
  const supplied = path.isAbsolute(directory) ? directory : process.cwd() + path.sep + directory;
  const root = path.parse(supplied).root;
  noLinks(root, supplied.slice(root.length));
  if (!fs.lstatSync(directory).isDirectory()) throw Error('Original archive store must be a directory');

  const expected = new Set();
  for (const entry of archives) {
    if (!/^[a-f0-9]{64}$/.test(entry.originalKey) || expected.has(`${entry.originalKey}.json`)) {
      throw Error('Invalid or duplicate original archive filename in plan');
    }
    expected.add(`${entry.originalKey}.json`);
  }
  const names = fs.readdirSync(directory);
  for (const name of names) {
    const stat = fs.lstatSync(path.join(directory, name));
    if (stat.isSymbolicLink()) throw Error('Symlink in original archive inventory');
    if (!stat.isFile()) throw Error('Original archive inventory must contain only regular files');
    if (!expected.has(name)) throw Error('Unexpected filename in original archive inventory');
  }
  if (names.length !== expected.size) throw Error('Missing file in original archive inventory');
}
