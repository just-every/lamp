import fs from 'node:fs';
import path from 'node:path';
import {hash, json, digest, safe, noLinks} from '../edition-authoring/files.mjs';

export const encode = bytes => ({data: bytes.toString('base64'), executable: false});
export function readOriginal(directory, entry) {
  // Inspect supplied components before resolving '..', which must not erase a link.
  const supplied = path.isAbsolute(directory) ? directory : process.cwd() + path.sep + directory;
  noLinks(path.parse(supplied).root, supplied.slice(path.parse(supplied).root.length));
  safe(`${entry.originalKey}.json`);
  const filename = path.join(directory, `${entry.originalKey}.json`);
  const absolute = path.resolve(filename);
  noLinks(path.parse(absolute).root, absolute.slice(path.parse(absolute).root.length));
  if (!fs.lstatSync(absolute).isFile()) throw Error('Original archive must be a regular file');
  const bytes = fs.readFileSync(absolute);
  if (hash(bytes) !== entry.originalSha256) throw Error('Original archive digest mismatch');
  const archive = JSON.parse(bytes);
  if (archive.key !== entry.originalKey || hash(json(archive.origin)) !== archive.key || digest(archive.files) !== archive.digest || archive.dependencies?.length) {
    throw Error('Invalid original archive or unplanned ancestry');
  }
  return archive;
}
export function projectFile(bytes, rule) {
  if (!rule) return bytes;
  if (hash(bytes) !== rule.originalSha256) throw Error('Member digest mismatch');
  if (rule.omit) return null;
  let offset = 0;
  const parts = [];
  const erasureIdentifiers = [
    '`deleted-${operatorId.toLowerCase()}@operator.invalid`',
    "'deleted-' || lower(${operators.id}) || '@operator.invalid'",
  ];
  for (const edit of rule.edits) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < offset || edit.end < edit.start || edit.end > bytes.length || hash(bytes.subarray(edit.start, edit.end)) !== edit.originalSha256) throw Error('Invalid projection edit');
    for (const identifier of erasureIdentifiers) {
      for (let start = bytes.indexOf(identifier); start !== -1; start = bytes.indexOf(identifier, start + 1)) {
        if (edit.start < start + Buffer.byteLength(identifier) && edit.end > start) throw Error('Projection edit overlaps an operator-erasure machine identifier');
      }
    }
    const replacement = Buffer.from(edit.replacement, 'base64');
    if (edit.reason === 'synthetic test value, never a credential' && edit.end - edit.start === 32 && replacement.length !== 32) {
      throw Error('Synthetic replacement must preserve the 32-byte credential validation boundary');
    }
    // A scoped package is a dependency identifier, even when its scope has a dot.
    // Check byte offsets with latin1 so UTF-8 preceding the identifier cannot shift them.
    for (const match of bytes.toString('latin1').matchAll(/@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*/gi)) {
      if (edit.start < match.index + match[0].length && edit.end > match.index) throw Error('Projection edit overlaps a scoped npm dependency identifier');
    }
    parts.push(bytes.subarray(offset, edit.start), replacement);
    offset = edit.end;
  }
  parts.push(bytes.subarray(offset));
  return Buffer.concat(parts);
}
export function projectArchive(original, entry, recipeSha256) {
  const origin = {repository: entry.repository, projection: {schemaVersion: 1, originalSha256: entry.originalSha256, recipeSha256}, path: original.origin.path, paths: original.origin.paths, excludeSnapshots: original.origin.excludeSnapshots};
  const files = {};
  for (const name of Object.keys(entry.members)) if (!Object.hasOwn(original.files, name)) throw Error('Projection references absent member');
  for (const [name, file] of Object.entries(original.files)) {
    safe(name);
    const bytes = projectFile(Buffer.from(file.data, 'base64'), entry.members[name]);
    if (bytes !== null) files[name] = {...file, data: bytes.toString('base64')};
  }
  const key = hash(json(origin));
  return {key, origin, digest: digest(files), files, dependencies: [], derivation: {schemaVersion: 1, originalSha256: entry.originalSha256, originalKey: entry.originalKey, upstreamRevision: original.origin.revision, recipeSha256}};
}
export function memberReceipt(original, projected) {
  return Object.entries(original.files).map(([name, file]) => ({path: name, originalSha256: hash(Buffer.from(file.data, 'base64')), projectedSha256: projected.files[name] ? hash(Buffer.from(projected.files[name].data, 'base64')) : null, executable: file.executable}));
}
