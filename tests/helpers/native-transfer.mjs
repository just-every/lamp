import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, cp, copyFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
const exec = promisify(execFile);

// A fresh installation checkout sharing this one's dependencies: no setup, no records.
export async function checkout(root, destination) {
  await mkdir(destination, { recursive: true });
  const { stdout } = await exec('git', ['ls-files', '-z'], { cwd: root });
  for (const path of stdout.split('\0').filter(path => path && !path.includes('/'))) await copyFile(join(root, path), join(destination, path));
  // Archive safety resolves the installation's Vite config, including its local modules.
  for (const path of ['scripts', 'migrations', 'src', 'modules', 'management', 'docs']) await cp(join(root, path), join(destination, path), { recursive: true });
  await symlink(join(root, 'node_modules'), join(destination, 'node_modules'));
}
// The installed rer verb in that checkout.
export async function command(root, ...args) {
  // Each copied installation owns its own operation lock. The verifier's
  // checkout-local token cannot authorize an operation in this other checkout;
  // retain process custody so the verifier can still clean up its descendants.
  const { RER_LOCAL_OPERATION, ...environment } = process.env;
  try { return await exec(process.execPath, ['node_modules/@runeditrun/rer/bin/rer.mjs', ...args, '--json'], { cwd: root, env: { ...environment, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, maxBuffer: 4 * 1024 * 1024, timeout: 120000 }); }
  catch (error) {
    // Receipts carry symbolic errors only; never echo private archive or settings.
    const events = String(error.stdout ?? '').split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    throw new Error(`Native ${args[0]} failed: ${events.filter(e => e.event === 'error').map(e => e.code + ': ' + e.message).join('; ') || 'child exit ' + error.code}`);
  }
}
export const proxy = root => getPlatformProxy({ configPath: join(root, 'wrangler.jsonc'), remoteBindings: false, persist: { path: join(root, '.wrangler/state/v3') } });
