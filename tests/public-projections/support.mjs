import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {hash, git, json, writeTree} from '../../scripts/edition-authoring/files.mjs';
export const command = (root, ...args) => JSON.parse(execFileSync(process.execPath, [path.join(root, 'scripts/edition-authoring/cli.mjs'), ...args], {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']}));
export function commit(root) {
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=Projection verification', '-c', 'user.email=verification@example.test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Projection verification fixture');
}
export function candidate(directory, archive) {
  fs.mkdirSync(directory);
  git(directory, 'init', '--quiet');
  const prefix = archive.origin.path === '.' ? '' : archive.origin.path + '/';
  writeTree(directory, Object.fromEntries(Object.entries(archive.files).map(([name, file]) => [prefix + name, file])));
  commit(directory);
  return directory;
}
export function identities(directory) {
  const result = {};
  const visit = prefix => {
    for (const entry of fs.readdirSync(path.join(directory, prefix), {withFileTypes: true}).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) visit(name);
      else result[name] = {sha256: hash(fs.readFileSync(path.join(directory, name))), executable: !!(fs.statSync(path.join(directory, name)).mode & 0o111)};
    }
  };
  visit('');
  return result;
}
export function normalizeTree(files, receipt) {
  const result = {...files};
  for (const member of receipt.members) {
    if (result[member.path]?.sha256 !== member.originalSha256) continue;
    if (member.projectedSha256 === null) { if (result[member.path].executable === member.executable) delete result[member.path]; }
    else result[member.path] = {...result[member.path], sha256: member.projectedSha256};
  }
  return result;
}
