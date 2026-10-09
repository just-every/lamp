import fs from 'node:fs';
import path from 'node:path';
import {hash, json, git, safe, noLinks} from './files.mjs';

// Match the whole-parent snapshot's archive-only exclusion. In particular, keep
// source locks and other .edition files visible, and observe tracked deletions.
export function parentFiles(root) {
  if (fs.realpathSync(git(root, 'rev-parse', '--show-toplevel')) !== fs.realpathSync(root)) throw Error('Current source must be a Git repository root');
  const files = {};
  for (const name of git(root, 'ls-files', '-z').split('\0').filter(Boolean)) {
    safe(name);
    if (name.startsWith('.edition/sources/')) continue;
    noLinks(root, name);
    let stat;
    try { stat = fs.lstatSync(path.join(root, name)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!stat.isFile()) throw Error('Unsupported current parent source');
    files[name] = {data: fs.readFileSync(path.join(root, name)).toString('base64'), executable: !!(stat.mode & 0o111)};
  }
  return files;
}

function privacyMembers(root, saved) {
  const receiptPath = 'scripts/public-projections/receipt.json', planPath = 'scripts/public-projections/plan.json';
  if (!fs.existsSync(path.join(root, receiptPath))) {
    if (saved.origin.projection) throw Error('Missing parent projection receipt');
    return [];
  }
  const receiptBytes = fs.readFileSync(path.join(root, receiptPath));
  const receipt = JSON.parse(receiptBytes);
  const selected = receipt.archives.find(item => item.selector === 'parent' &&
    (item.key === saved.key || item.originalKey === saved.key));
  if (!selected) {
    if (saved.origin.projection) throw Error('Unaccounted parent projection');
    return [];
  }
  const planBytes = fs.readFileSync(path.join(root, planPath));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'sources.lock.json')));
  if (lock.files[receiptPath]?.sha256 !== hash(receiptBytes) || lock.files[planPath]?.sha256 !== hash(planBytes) || receipt.recipeSha256 !== hash(planBytes)) throw Error('Parent comparison policy differs from source lock');
  const planned = JSON.parse(planBytes).archives.find(item => item.originalKey === selected.originalKey);
  const isOriginal = selected.originalKey === saved.key;
  if (!planned || planned.originalSha256 !== selected.originalSha256 || hash(json(saved)) !== (isOriginal ? selected.originalSha256 : selected.sha256)) throw Error('Parent comparison identity mismatch');
  if (!isOriginal && (saved.origin.projection.originalSha256 !== selected.originalSha256 || saved.origin.projection.recipeSha256 !== receipt.recipeSha256)) throw Error('Parent comparison derivation mismatch');
  const result = [];
  for (const [name, rule] of Object.entries(planned.members)) {
    const member = selected.members.find(item => item.path === name);
    if (!member || rule.originalSha256 !== member.originalSha256 || (member.projectedSha256 === null) !== !!rule.omit) throw Error('Parent member policy mismatch');
    if (rule.omit && !/^visual\/[^/]+\.png$/.test(name)) throw Error('Only declared presentation images may be omitted');
    const value = saved.files[name], expected = isOriginal ? member.originalSha256 : member.projectedSha256;
    if (expected === null ? value !== undefined : !value || hash(Buffer.from(value.data, 'base64')) !== expected || value.executable !== member.executable) throw Error('Parent member identity mismatch');
    result.push(member);
  }
  return result;
}

export function parentIdentities(root, saved) {
  const members = new Map(privacyMembers(root, saved).map(member => [member.path, member]));
  return files => Object.fromEntries(Object.entries(files).flatMap(([name, file]) => {
    const identity = {sha256: hash(Buffer.from(file.data, 'base64')), executable: file.executable};
    const member = members.get(name);
    if (member && identity.sha256 === member.originalSha256) {
      if (member.projectedSha256 === null) {
        if (identity.executable === member.executable) return [];
      } else identity.sha256 = member.projectedSha256;
    }
    return [[name, identity]];
  }));
}
