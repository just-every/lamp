import { constants, linkSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

function requireOwner(stat, path, directory = false) {
 if (!(directory ? stat.isDirectory() : stat.isFile()) || (!directory && stat.nlink > 1 && (stat.mode & 0o7777) !== 0o600) || (process.getuid && stat.uid !== process.getuid())) {
  throw Error(`Installer private storage must be an owned ${directory ? 'directory' : 'regular private file (no permissive hard links)'}: ${path}`);
 }
}

// Refuse links and foreign-owned storage before changing permissions or bytes.
export async function privateDirectory(root, parts) {
 let path = root;
 for (const part of parts) {
  path = join(path, part);
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { requireOwner(await handle.stat(), path, true); await handle.chmod(0o700); } finally { await handle.close(); }
 }
 return path;
}

async function privateFile(path, flags, action) {
 const handle = await open(path, flags | constants.O_NOFOLLOW, 0o600);
 try {
  const stat = await handle.stat();
  requireOwner(stat, path);
  // Already-private hard links are safe to read or replace. Never chmod their
  // shared inode; this also permits a complete exclusive publication in flight.
  if (stat.nlink <= 1) await handle.chmod(0o600);
  return await action(handle);
 } finally { await handle.close(); }
}
export const readPrivateFile = path => privateFile(path, constants.O_RDONLY, handle => handle.readFile('utf8'));
export async function writePrivateFile(path, content, exclusive = false) {
 if (!exclusive) {
  try { await privateFile(path, constants.O_RDONLY, () => {}); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
 }
 const temporary = `${path}.${randomBytes(16).toString('hex')}.tmp`;
 try {
  await privateFile(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
   async handle => { await handle.writeFile(content); });
  if (exclusive) {
   // Publish complete bytes without replacing another process's credential.
   // Readers can safely use the fully written, already-private linked inode.
   // A process interruption before unlink does not invalidate the receipt.
   linkSync(temporary, path);
   unlinkSync(temporary);
  } else await rename(temporary, path);
 } finally {
  try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
 }
}
