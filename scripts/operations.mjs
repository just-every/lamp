import { readFile, access } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

function usefulEnvironmentSource(source) {
  if (typeof source !== 'string') return false;
  const value = source.trim();
  if (source !== value || value.length < 8 || value.length > 180 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) return false;
  if (/(?:[a-z][a-z\d+.-]{1,20}:\/\/|www\.)/i.test(value)) return false;
  if (/(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?/i.test(value)
      && !/\.(?:md|txt|jsonc?|ya?ml|toml|m?js|cjs|tsx?|jsx?|py|pdf|docx?|csv|env|sh|html?|xml|sql|log|rst|adoc|conf|ini)(?:[/:#][^\s]*)?$/i.test(value)) return false;
  // Sources identify where to obtain a value, never assign one. Reject equals
  // assignments regardless of the variable name and colon labels containing a
  // credential term, including prefixed/suffixed names and quoted JSON keys.
  if (value.includes('=')) return false;
  if (/[\w.-]*(?:key|authorization|credential|password|passwd|secret|token|pwd)[\w.-]*["'`]?\s*:/i.test(value)) return false;
  if (/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{12,}/i.test(value)) return false;
  if (/\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|xox[baprs]|glpat|AIza|AKIA)[_-][A-Za-z0-9._-]{8,}\b/i.test(value)) return false;
  if (/\b(?:SG\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|whsec_[A-Za-z0-9]+|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{16,})\b/.test(value)) return false;
  if (/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/.test(value)) return false;
  if (/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value)) return false;
  return (value.match(/[A-Za-z0-9]+/g) ?? []).length >= 2;
}

export function validateEnvironmentSources(descriptor, knownNames) {
  const sources = descriptor.environmentSources;
  if (sources === undefined) return;
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) throw new Error('Invalid environment source declaration.');
  for (const [name, source] of Object.entries(sources)) {
    if (!knownNames.has(name) || !usefulEnvironmentSource(source)) throw new Error('Invalid environment source declaration.');
  }
}

export async function readOperations(root) {
  const descriptor = JSON.parse(await readFile(resolve(root, 'OPERATIONS.json'), 'utf8'));
  if (descriptor.version === 2) {
    const { readProjectOperations } = await import('./project-operations.mjs');
    return readProjectOperations(root, descriptor, validateEnvironmentSources);
  }
  if (descriptor.version !== 1 || typeof descriptor.edition !== 'string' || !descriptor.edition || !Array.isArray(descriptor.requiredEnvironment) || descriptor.requiredEnvironment.some(name => typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name)) || descriptor.acceptance?.document !== 'ACCEPTANCE.md') throw new Error('Invalid operations descriptor.');
  validateEnvironmentSources(descriptor, new Set(descriptor.requiredEnvironment));
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

async function inspectLoadedOperations(root, env, { descriptor, commands }) {
  const missingEnvironment = descriptor.requiredEnvironment.filter(name => typeof env[name] !== 'string' || !env[name].trim());
  let configuration = 'valid';
  let loops = [];
  if (descriptor.version === 2) {
    const { inspectRequiredLoops } = await import('./project-operations.mjs');
    loops = inspectRequiredLoops(descriptor, env);
  }
  try {
    const module = descriptor.version === 2 ? descriptor.configuration?.module : 'scripts/operations-config.mjs';
    if (module) {
      const adapter = await import(pathToFileURL(resolve(root, module)));
      await adapter.validateConfiguration(env);
    }
  } catch { configuration = 'invalid'; }
  return { version: descriptor.version, ...(descriptor.version === 2 ? { project: descriptor.project, runtime: descriptor.runtime } : { edition: descriptor.edition }), scope: 'local-inputs-only', ok: commands.every(c => c.available) && !missingEnvironment.length && configuration === 'valid' && loops.every(loop => ['ready', 'optional-disabled'].includes(loop.status)), ...(descriptor.version === 2 ? { loops } : {}), commands, missingEnvironment, configuration,
    unchecked: ['installed runtime versions and command executables', 'generated deployment caches and build artifacts', 'provider identity and permissions', 'remote resources and deployed health', 'provider credentials and delivery', 'product acceptance'],
    guidance: 'See the project operating documentation. Configuration errors are suppressed to avoid disclosing input values.' };
}

export async function inspectOperations(root, env = process.env) {
  return inspectLoadedOperations(root, env, await readOperations(root));
}

export async function describeOperations(root) {
  const { descriptor, commands } = await readOperations(root);
  if (commands.some(command => !command.available)) throw new Error('Unavailable operation target.');
  return descriptor;
}

const displayArgv = argv => argv.map(argument => {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(argument)) return argument;
  return `'${argument.replaceAll("'", "'\\''")}'`;
}).join(' ');
// A project without RER names this inspector by the path it was actually run from.
const invoked = root => displayArgv(['node', relative(root, process.argv[1] ?? 'operations.mjs')]);

async function checkSummary(result, descriptor, root) {
  const missing = [...new Set([
    ...result.missingEnvironment,
    ...(result.loops ?? []).flatMap(loop => loop.missingEnvironment)
  ])];
  const documentation = descriptor.version === 1
    ? 'OPERATIONS.md'
    : descriptor.documentation?.document ?? 'the project setup documentation';
  const declaredInputs = descriptor.version === 2
    ? (await import('./project-operations.mjs')).knownEnvironmentNames(descriptor)
    : new Set(descriptor.requiredEnvironment ?? []);
  const lines = [];
  if (missing.length) lines.push('Missing inputs are expected before a deployment is configured.');
  else lines.push(result.ok
    ? 'Operations check passed: declared local inputs expected before deployment are configured.'
    : 'Operations check failed: resolve local configuration or target issues before deployment.');
  if (missing.length) {
    const sources = descriptor?.environmentSources ?? {};
    lines.push('Missing inputs:');
    for (const name of missing) lines.push(`  ${name} — ${sources[name] ?? `see ${documentation}`}`);
    lines.push('Configuration is checked again once these inputs are set.');
  }
  const unavailable = result.commands.filter(command => !command.available).map(command => command.name);
  if (unavailable.length) lines.push(`Unavailable targets: ${unavailable.join(', ')}.`);
  if (result.configuration === 'invalid' && !missing.length) {
    lines.push('Configuration is invalid; validator details are suppressed.');
    if (declaredInputs.size) lines.push(`Check the values you set for these declared input names: ${[...declaredInputs].sort().join(', ')}.`);
  }
  const blockedLoops = (result.loops ?? []).filter(loop => !['ready', 'optional-disabled'].includes(loop.status));
  if (blockedLoops.length) lines.push(`Loops needing attention: ${blockedLoops.map(loop => `${loop.id} (${loop.status})`).join(', ')}.`);
  if (result.ok) lines.push('Remote deployment, provider access, and product acceptance remain unchecked.');
  else {
    const setup = descriptor.commands?.setup;
    if (setup?.argv) lines.push(`Next: read ${documentation}, then run the declared setup command when ready: ${displayArgv(setup.argv)}. For secondary descriptor inspection, run ${invoked(root)} describe.`);
    else lines.push(`Next: read ${documentation} for setup guidance. No setup command is declared. For secondary descriptor inspection, run ${invoked(root)} describe.`);
  }
  return lines.join('\n');
}

// A first-party checkout's rer: its vendored scripts/rer.mjs, or the
// @runeditrun/rer package it pins.
function checkoutRer(root) {
  const vendored = resolve(root, 'scripts/rer.mjs'), pinned = resolve(root, 'node_modules/@runeditrun/rer/bin/rer.mjs');
  if (existsSync(vendored)) return vendored;
  try { const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')); if ((pkg.devDependencies?.['@runeditrun/rer'] ?? pkg.dependencies?.['@runeditrun/rer']) && existsSync(pinned)) return pinned; } catch {}
  return vendored;
}

export async function main(args = process.argv.slice(2), root = process.cwd()) {
  const rer = checkoutRer(root);
  if (!['describe', 'check'].includes(args[0]) || (args.length !== 1 && !existsSync(rer))) throw new Error('Unsupported operations command.');
  // First-party projects describe and check through their RER command.
  if (existsSync(rer)) {
    process.exitCode = spawnSync(process.execPath, [rer, ...args], { cwd: root, stdio: 'inherit' }).status ?? 1;
    return;
  }
  let result;
  let descriptor;
  if (args[0] === 'describe') result = await describeOperations(root);
  else {
    const loaded = await readOperations(root);
    descriptor = loaded.descriptor;
    result = await inspectLoadedOperations(root, process.env, loaded);
  }
  console.log(JSON.stringify(result, null, 2));
  if (args[0] === 'check') {
    console.error(await checkSummary(result, descriptor, root));
    if (!result.ok) process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch {
    if (process.argv.slice(2).length === 1 && process.argv[2] === 'check') console.error('Operations check failed: descriptor or local configuration is invalid or unreadable; details are suppressed. Next: read OPERATIONS.md for recovery guidance, repair the descriptor or its referenced files, then rerun check.');
    const usage = existsSync(resolve('scripts/rer.mjs')) ? 'node scripts/rer.mjs' : invoked(process.cwd());
    console.error(JSON.stringify({ ok: false, error: `Invalid command or unreadable operations files. Usage: ${usage} describe|check` }));
    process.exitCode = 1;
  }
}
