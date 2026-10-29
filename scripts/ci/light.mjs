import { spawnSync } from 'node:child_process';

const readers = JSON.parse(process.env.LIGHT_READERS);
if (!Array.isArray(readers) || readers.some(command => typeof command !== 'string')) throw Error('Invalid light readers');
for (const command of [
  'pnpm run source:copies',
  'pnpm run source:check',
  'pnpm run check',
  ...readers,
  'pnpm run build:site',
]) {
  console.log(`> ${command}`);
  const result = spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', command], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
