import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    env: {...process.env, GIT_NO_REPLACE_OBJECTS: '1'}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
export function safe(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || /[\x00-\x1f\x7f]/.test(name) || path.posix.isAbsolute(name) || name.split('/').some(p => !p || p === '.' || p === '..' || p === '.git')) {
    throw Error(`Unsafe path: ${name}`);
  }
  return name;
}
export function noLinks(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat?.isSymbolicLink()) throw Error('Symlink in destination path');
  }
}
export function tracked(root, allowMissing = false) {
  const result = Object.create(null);
  for (const name of git(root, 'ls-files', '-z').split('\0').filter(Boolean)) {
    safe(name);
    if (name === 'sources.lock.json' || name.startsWith('.edition/')) continue;
    noLinks(root, name);
    if (allowMissing && !fs.existsSync(path.join(root, name))) continue;
    const stat = fs.statSync(path.join(root, name));
    if (!stat.isFile()) throw Error(`Unsupported tracked source: ${name}`);
    result[name] = {data: fs.readFileSync(path.join(root, name)).toString('base64'), executable: !!(stat.mode & 0o111)};
  }
  return result;
}
export const digest = files => hash(json(files));
export function writeTree(root, files) {
  // Validate the complete destination set before writing any selected source.
  for (const name of Object.keys(files)) {
    safe(name); noLinks(root, name);
    if (fs.existsSync(path.join(root, name))) throw Error(`Source destination already exists: ${name}`);
  }
  for (const [name, value] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, Buffer.from(value.data, 'base64'), {mode: value.executable ? 0o755 : 0o644, flag: 'wx'});
  }
}
export function fresh(destination, root) {
  let absolute = path.resolve(destination);
  let parent = path.dirname(absolute);
  let tail = path.basename(absolute);
  while (!fs.existsSync(parent)) {
    tail = path.join(path.basename(parent), tail);
    parent = path.dirname(parent);
  }
  absolute = path.join(fs.realpathSync(parent), tail);
  if (absolute === root || absolute.startsWith(root + path.sep) || fs.existsSync(absolute)) throw Error('Output must be absent and outside edition');
  return absolute;
}
