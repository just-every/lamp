import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const tests = readdirSync('tests/composition/sendgrid-email')
  .filter(file => file.endsWith('.test.ts'))
  .map(file => resolve('tests/composition/sendgrid-email', file));
if (!tests.length) throw new Error('Shared SendGrid tests are missing.');
const result = spawnSync(process.execPath, ['--test', ...tests], {
  stdio: 'inherit',
  env: { ...process.env, RER_COMPONENT_SOURCE: pathToFileURL(`${resolve('src/modules/sendgrid-email')}/`).href },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
