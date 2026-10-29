import { access } from 'node:fs/promises';
import { join } from 'node:path';

const documents = new Set(['CONTRACT.md', 'ACCEPTANCE.md', 'CLAIMS.md', 'HANDOVER.md', 'STATUS.md']);
const allowed = path => documents.has(path) || path === 'sources.lock.json' || /^(?:evidence|\.artifacts)\/.+/.test(path);

// Explicit readers of the maintained foundation and reference. An adopting
// edition can extend these with reviewed dependencies in verification.json's
// readers table. Unknown or malformed readers deliberately select full CI.
export async function lightReaders(files, { cwd = process.cwd(), plan } = {}) {
 if (!files.length || !files.every(allowed)) return;
 const commands = new Set(), changed = new Set(files);
 const known = Object.fromEntries([
  'tests/typecheck/incremental.test.mjs', 'tests/typecheck/incremental-typecheck.test.mjs',
  'tests/local-setup/foundation-setup.test.mjs', 'tests/local-journey/foundation-journey.test.mjs',
  'tests/local-journey/foundation-installer.test.mjs', 'tests/e2e/reference-runtime.mjs',
  'tests/e2e/private-response.test.mjs', 'tests/e2e/start-response-stream.test.mjs',
  'tests/e2e/import-archive.test.mjs', 'tests/operator-auth/conformance.test.mjs',
  'tests/operator-auth/demo.test.mjs', 'tests/operator-auth/emitted.test.mjs',
  'tests/operator-auth/scheduled-*.test.mjs', 'tests/operator-auth/business-settings.test.mjs',
  'tests/operator-auth/lobby.test.mjs',
  ...['cancellation', 'cli', 'hard-kill', 'native-bindings', 'operation-lock', 'outbox-read', 'setup-rerun']
   .map(name => `tests/local-setup/${name}.test.mjs`),
  ...['build-safety', 'demo', 'erasure', 'security', 'installer-browser', 'installer', 'journey']
   .map(name => `tests/local-journey/${name}.test.mjs`),
 ].map(path => [path, []]));
 const relative = path => typeof path === 'string' && path.length > 0 && !path.startsWith('/')
  && !path.includes('\\') && !path.split('/').some(part => !part || part === '.' || part === '..');
 if (plan.readers !== undefined) {
  if (!plan.readers || typeof plan.readers !== 'object' || Array.isArray(plan.readers)) return;
  for (const [path, dependencies] of Object.entries(plan.readers)) {
   if (!relative(path) || !/^tests\/[A-Za-z0-9_./*-]+\.(?:mjs|ts|tsx)$/.test(path)
    || !Array.isArray(dependencies) || !dependencies.every(relative)) return;
   known[path] = dependencies;
  }
 }
 const indirect = new Set(['pnpm run test:typecheck', 'pnpm run test:runtime']);
 // Edition-owned lock validation is required for every light candidate.
 for (const path of ['edition.json', 'sources.lock.json', 'scripts/edition-authoring/cli.mjs']) await access(join(cwd, path));
 if (files.some(path => /^(?:evidence|\.artifacts)\//.test(path) && !/\.(?:md|txt|png|jpe?g|pdf)$/.test(path))) return;
 const tests = new Set();
 for (const shard of [...plan.push, ...plan.nightly]) for (const command of shard.commands) {
  const paths = command.match(/\btests\/[^\s'";]+\.(?:mjs|ts|tsx)/g) ?? [];
  // Only these complete command forms have reviewed reader dependencies.
  if (!paths.length && !indirect.has(command) && !/^pnpm (?:run )?(?:build|typecheck|check(?: --profile first-party)?)$/.test(command)) return;
  if (paths.length && !/^node(?: --test(?: --test-concurrency=[1-9]\d*)?)?(?: tests\/[A-Za-z0-9_./*-]+\.(?:mjs|ts|tsx))+$/.test(command)) return;
  for (const path of paths) {
   if (!(path in known)) return;
   tests.add(path);
  }
 }
 for (const path of tests) {
  if (!path.includes('*')) await access(join(cwd, path));
  for (const dependency of known[path]) if (changed.has(dependency)) commands.add(`node --test --test-concurrency=1 ${path}`);
 }
 // Contract documents have an executable consumer independently of the suite.
 if (files.some(path => documents.has(path))) {
  await access(join(cwd, 'src/base/contract-docs.mjs'));
  commands.add('node src/base/contract-docs.mjs check');
 }
 return [...commands];
}
