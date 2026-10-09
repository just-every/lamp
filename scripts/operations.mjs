import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function readOperations(root) {
  const descriptor = JSON.parse(await readFile(resolve(root, 'OPERATIONS.json'), 'utf8'));
  if (descriptor.version !== 1 || typeof descriptor.edition !== 'string' || !descriptor.edition || !Array.isArray(descriptor.requiredEnvironment) || descriptor.requiredEnvironment.some(name => typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name)) || descriptor.acceptance?.document !== 'ACCEPTANCE.md') throw new Error('Invalid operations descriptor.');
  await access(resolve(root, 'OPERATIONS.md'));
  await access(resolve(root, descriptor.acceptance.document));
  await access(resolve(root, 'scripts/operations-config.mjs'));
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const commands = [];
  for (const name of ['setup', 'deploy', 'verify']) {
    const command = descriptor.commands?.[name];
    const argv = command?.argv;
    if (!Array.isArray(argv) || argv.length < 3 || argv.some(arg => typeof arg !== 'string' || !arg) || argv[0] !== 'pnpm' || argv[1] !== 'run' || typeof command.effects !== 'string' || !command.effects || typeof pkg.scripts?.[argv[2]] !== 'string') throw new Error('Invalid operation command.');
    let available = true;
    // Resolve script file references as well as the package-script entry.
    if (available) for (const match of pkg.scripts[argv[2]].matchAll(/(?:^|\s)node\s+([\w./-]+\.mjs)(?=\s|$)/g)) {
      try { await access(resolve(root, match[1])); } catch { available = false; }
    }
    commands.push({ name, available });
  }
  return { descriptor, commands };
}

export async function inspectOperations(root, env = process.env) {
  const { descriptor, commands } = await readOperations(root);
  const missingEnvironment = descriptor.requiredEnvironment.filter(name => typeof env[name] !== 'string' || !env[name].trim());
  let configuration = 'valid';
  try {
    const adapter = await import(pathToFileURL(resolve(root, 'scripts/operations-config.mjs')));
    await adapter.validateConfiguration(env);
  } catch { configuration = 'invalid'; }
  return { version: 1, edition: descriptor.edition, scope: 'local-inputs-only', ok: commands.every(c => c.available) && !missingEnvironment.length && configuration === 'valid', commands, missingEnvironment, configuration,
    unchecked: ['generated deployment caches and build artifacts', 'Cloudflare identity and permissions', 'remote resources and deployed health', 'provider credentials and delivery', 'product acceptance'],
    guidance: 'See OPERATIONS.md and the edition setup documentation. Configuration errors are suppressed to avoid disclosing input values.' };
}

export async function describeOperations(root) {
  const { descriptor, commands } = await readOperations(root);
  if (commands.some(command => !command.available)) throw new Error('Unavailable operation target.');
  return descriptor;
}

export async function main(args = process.argv.slice(2), root = process.cwd()) {
  if (args.length !== 1 || !['describe', 'check'].includes(args[0])) throw new Error('Usage: node scripts/operations.mjs describe|check');
  const result = args[0] === 'describe'
    ? await describeOperations(root)
    : await inspectOperations(root);
  console.log(JSON.stringify(result, null, 2));
  if (args[0] === 'check' && !result.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch { console.error(JSON.stringify({ ok: false, error: 'Invalid command or unreadable operations files. Usage: node scripts/operations.mjs describe|check' })); process.exitCode = 1; }
}
